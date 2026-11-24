import type { Map as MlMap } from 'maplibre-gl';
import { STATUS_COLORS } from './colors';
import { busyAt, fmtTime, type Episode } from './history';

/**
 * Saves the playback as an MP4 video.
 *
 * The playback is rendered frame by frame, not recorded from the screen: for each video frame the
 * road statuses of that moment are set on the map, the map is drawn once, and the picture plus an
 * overlay (clock, active count, time bar, legend, attribution) is passed to the browser's H.264
 * encoder (WebCodecs). mp4-muxer packs the frames into an .mp4 file. So the video is smooth and
 * exact even on a slow computer; it just takes longer to make.
 */

export const VIDEO_FPS = 30;
/** Longest video we make; longer ones need a faster speed. */
export const MAX_VIDEO_S = 600;
const HOLD_END_S = 1.5; // the last frame stays this long
const MAX_W = 1920;
const MAX_H = 1080;

export type VideoJob = {
  map: MlMap;
  episodes: Episode[];
  from: number;
  to: number;
  /** Simulated minutes per video second (the playback speed). */
  speedMin: number;
  tz: string | undefined;
  tzName: string;
  signal: AbortSignal;
  onProgress: (fraction: number) => void;
};

/** Video length in seconds for a range and speed, without the hold at the end. */
export const videoSeconds = (from: number, to: number, speedMin: number) => (to - from) / (speedMin * 60_000);

export const videoSupported = () => typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;

/** H.264 profiles to try, best first; the browser picks the first one it can encode at this size. */
const CODECS = ['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.4d0028', 'avc1.42003e', 'avc1.42001f'];

async function pickCodec(width: number, height: number, bitrate: number): Promise<VideoEncoderConfig> {
  for (const codec of CODECS) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: VIDEO_FPS, avc: { format: 'annexb' } };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch {
      /* try the next one */
    }
  }
  throw new Error('This browser cannot encode H.264 video. Try a current Chrome, Edge or Safari.');
}

/** Waits until the map has its tiles, then draws it once and calls `draw` while the picture is valid. */
function renderMap(map: MlMap, draw: () => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const capture = () => {
      map.once('render', () => {
        try {
          draw(); // inside the render event the WebGL picture is still there (no preserveDrawingBuffer needed)
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      map.triggerRepaint();
    };
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    if (map.areTilesLoaded()) capture();
    else map.once('idle', capture);
  });
}

export async function exportPlaybackVideo(job: VideoJob): Promise<Blob> {
  if (!videoSupported()) throw new Error('This browser cannot make videos (no WebCodecs). Try a current Chrome, Edge or Safari.');
  const { map, episodes, from, to, speedMin, tz, tzName, signal, onProgress } = job;
  const seconds = videoSeconds(from, to, speedMin);
  if (seconds > MAX_VIDEO_S) {
    throw new Error(`The video would be ${Math.round(seconds / 60)} minutes long. Choose a faster speed or a shorter range.`);
  }

  // Output size: the map's pixels, at most Full HD, even numbers for H.264.
  const src = map.getCanvas();
  const scale = Math.min(1, MAX_W / src.width, MAX_H / src.height);
  const width = Math.floor((src.width * scale) / 2) * 2;
  const height = Math.floor((src.height * scale) / 2) * 2;
  const bitrate = Math.min(8_000_000, Math.round(width * height * VIDEO_FPS * 0.12));
  const config = await pickCodec(width, height, bitrate);

  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: VIDEO_FPS },
    fastStart: 'in-memory',
    // The first decode timestamp becomes 0 (Firefox's first chunk starts at 1/30 s, and with B-frames
    // the decode times start before the first picture).
    firstTimestampBehavior: 'offset',
  });
  let encodeError: unknown = null;
  // The encoder writes Annex B (SPS and PPS inside each keyframe); the MP4 header (avcC) is built from them
  // here. Not every browser hands over a ready-made header (Firefox gives no decoderConfig).
  let description: Uint8Array | null = null;
  // Some encoders (Firefox) use B-frames: chunks come in decode order, which differs from the picture order.
  // The MP4 file then needs a decode time per chunk. With a constant frame rate the k-th chunk is decoded at
  // first + (k - reorder) frames, where `reorder` is how many frames the encoder holds back. It is measured
  // on the first PROBE chunks (0 in Chrome, Edge and Safari, which don't reorder).
  const FRAME_US = 1e6 / VIDEO_FPS;
  const PROBE = 8;
  type Chunk = { data: Uint8Array; type: EncodedVideoChunkType; pts: number; header?: EncodedVideoChunkMetadata };
  const probe: Chunk[] = [];
  let reorder: number | null = null;
  let firstPts = 0;
  let decoded = 0;
  const mux = (c: Chunk) => {
    const dts = firstPts + Math.round((decoded++ - reorder!) * FRAME_US);
    if (c.pts < dts - 2) throw new Error('The video encoder reorders frames more than expected.');
    // pts - offset = dts; never below 0 (a rounding difference of a microsecond is fine).
    muxer.addVideoChunkRaw(c.data, c.type, c.pts, Math.round(FRAME_US), c.header, Math.max(0, c.pts - dts));
  };
  const settle = () => {
    if (reorder !== null) return;
    firstPts = probe.length ? probe[0].pts : 0;
    reorder = 0;
    probe.forEach((c, k) => {
      reorder = Math.max(reorder!, Math.ceil(k - (c.pts - firstPts) / FRAME_US - 0.01));
    });
    probe.splice(0).forEach(mux);
  };
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const nals = splitAnnexB(data);
        let header: EncodedVideoChunkMetadata | undefined;
        if (!description) {
          description = avcConfig(nals);
          if (!description) throw new Error('The video encoder gave no SPS/PPS with its first frame.');
          header = { decoderConfig: { codec: meta?.decoderConfig?.codec ?? config.codec, codedWidth: width, codedHeight: height, description } };
        }
        const c: Chunk = { data: toAvcSample(nals), type: chunk.type, pts: chunk.timestamp, header };
        if (reorder !== null) mux(c);
        else {
          probe.push(c);
          if (probe.length >= PROBE) settle();
        }
      } catch (e) {
        encodeError = e;
      }
    },
    error: (e) => (encodeError = e),
  });
  encoder.configure(config);

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d')!;
  // Overlay sizes follow the map's CSS size, so the video looks like the page.
  const px = width / src.clientWidth || 1;
  const attribution = document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent?.trim() ?? '';
  const roads = [...new Set(episodes.map((e) => e.road))];
  const ticks = episodes.map((e) => Date.parse(e.start)).filter((s) => s >= from && s <= to);

  const step = (speedMin * 60_000) / VIDEO_FPS; // simulated ms per video frame
  const frames = Math.ceil((to - from) / step) + 1;
  const hold = Math.round(HOLD_END_S * VIDEO_FPS);
  const total = frames + hold;

  try {
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      const t = Math.min(from + i * step, to);
      const busy = busyAt(episodes, t);
      for (const id of roads) map.setFeatureState({ source: 'roads', id }, { pb: busy.has(id) ? 'busy' : 'neutral' });
      await renderMap(map, () => {
        ctx.drawImage(src, 0, 0, width, height);
        drawOverlay(ctx, { width, height, px, t, from, to, tz, tzName, active: busy.size, ticks, attribution });
      }, signal);

      // The last picture stays on screen a bit longer (repeated frames; players ignore a long last frame).
      const last = i === frames - 1;
      for (let k = 0; k <= (last ? hold : 0); k++) {
        const n = i + k;
        const frame = new VideoFrame(out, { timestamp: Math.round((n * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
        encoder.encode(frame, { keyFrame: n % (VIDEO_FPS * 2) === 0 });
        frame.close();
        // Don't let the encoder queue grow without bound.
        while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
      }
      if (i % 5 === 0 || last) onProgress((i + 1) / total);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    settle(); // a video shorter than the probe
    muxer.finalize();
    onProgress(1);
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

type Overlay = {
  width: number;
  height: number;
  px: number;
  t: number;
  from: number;
  to: number;
  tz: string | undefined;
  tzName: string;
  active: number;
  ticks: number[];
  attribution: string;
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Clock, active count and time bar at the bottom left; legend at the top left; attribution at the bottom right. */
function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay) {
  const { px } = o;
  const s = (n: number) => n * px;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // Legend, top left.
  {
    const x = s(12), y = s(12), w = s(150), h = s(62);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, y, w, h, s(8));
    ctx.fill();
    ctx.fillStyle = '#1f2933';
    ctx.font = `600 ${s(14)}px ${FONT}`;
    ctx.fillText('Road Alerts', x + s(10), y + s(20));
    const rows: [string, string][] = [['Neutral', STATUS_COLORS.neutral], ['Busy', STATUS_COLORS.busy]];
    ctx.font = `${s(12)}px ${FONT}`;
    rows.forEach(([label, color], k) => {
      const ly = y + s(37 + k * 17);
      ctx.strokeStyle = color;
      ctx.lineWidth = s(4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x + s(12), ly - s(4));
      ctx.lineTo(x + s(32), ly - s(4));
      ctx.stroke();
      ctx.fillStyle = '#1f2933';
      ctx.fillText(label, x + s(40), ly);
    });
  }

  // Clock box, bottom left.
  {
    const w = Math.min(s(420), o.width - s(24));
    const h = s(78);
    const x = s(12);
    const y = o.height - h - s(24);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRect(ctx, x, y, w, h, s(10));
    ctx.fill();

    ctx.fillStyle = '#1f2933';
    ctx.font = `700 ${s(22)}px ${FONT}`;
    const clock = fmtTime(new Date(o.t).toISOString(), o.tz);
    ctx.fillText(clock, x + s(12), y + s(30));
    const clockW = ctx.measureText(clock).width;
    ctx.font = `${s(12)}px ${FONT}`;
    ctx.fillStyle = '#6b7280';
    ctx.fillText(o.tzName, x + s(20) + clockW, y + s(30));

    ctx.textAlign = 'right';
    ctx.font = `${o.active ? 700 : 400} ${s(15)}px ${FONT}`;
    ctx.fillStyle = o.active ? STATUS_COLORS.busy : '#6b7280';
    ctx.fillText(`${o.active} active`, x + w - s(12), y + s(28));
    ctx.textAlign = 'left';

    // Time bar with the alert starts as ticks.
    const bx = x + s(12), bw = w - s(24), by = y + s(50), bh = s(6);
    const at = (ms: number) => bx + ((ms - o.from) / Math.max(1, o.to - o.from)) * bw;
    ctx.fillStyle = '#e5e7eb';
    roundRect(ctx, bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = '#1d4ed8';
    roundRect(ctx, bx, by, Math.max(bh, at(o.t) - bx), bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(224,49,49,0.7)';
    for (const tk of o.ticks) ctx.fillRect(at(tk) - s(1), by - s(6), s(2), s(5));

    ctx.font = `${s(10)}px ${FONT}`;
    ctx.fillStyle = '#6b7280';
    ctx.fillText(fmtTime(new Date(o.from).toISOString(), o.tz), bx, by + s(18));
    ctx.textAlign = 'right';
    ctx.fillText(fmtTime(new Date(o.to).toISOString(), o.tz), bx + bw, by + s(18));
    ctx.textAlign = 'left';
  }

  // Attribution, bottom right (required by the map tiles).
  if (o.attribution) {
    ctx.font = `${s(10)}px ${FONT}`;
    const tw = ctx.measureText(o.attribution).width;
    const w = Math.min(tw + s(12), o.width);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(o.width - w, o.height - s(16), w, s(16));
    ctx.fillStyle = '#333';
    ctx.textAlign = 'right';
    ctx.fillText(o.attribution, o.width - s(6), o.height - s(4), o.width - s(12));
  }
  ctx.restore();
}

/* ---- H.264 helpers: Annex B (start codes) to MP4 (length-prefixed NAL units plus an avcC header) */

/** The NAL units of an Annex B buffer, without their start codes. */
function splitAnnexB(b: Uint8Array): Uint8Array[] {
  const starts: [number, number][] = []; // [start code position, payload position]
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0) {
      if (b[i + 2] === 1) {
        starts.push([i, i + 3]);
        i += 2;
      } else if (b[i + 2] === 0 && b[i + 3] === 1) {
        starts.push([i, i + 4]);
        i += 3;
      }
    }
  }
  if (!starts.length) return [b]; // already one bare NAL unit
  return starts.map(([, p], k) => b.subarray(p, k + 1 < starts.length ? starts[k + 1][0] : b.length));
}

const nalType = (n: Uint8Array) => n[0] & 0x1f;
const SPS = 7, PPS = 8, AUD = 9;

/** A sample for the MP4 file: each NAL unit with a 4-byte length, without SPS/PPS/AUD (those go in avcC). */
function toAvcSample(nals: Uint8Array[]): Uint8Array {
  const keep = nals.filter((n) => n.length && ![SPS, PPS, AUD].includes(nalType(n)));
  const out = new Uint8Array(keep.reduce((sum, n) => sum + 4 + n.length, 0));
  const view = new DataView(out.buffer);
  let o = 0;
  for (const n of keep) {
    view.setUint32(o, n.length);
    out.set(n, o + 4);
    o += 4 + n.length;
  }
  return out;
}

/** The avcC record (AVCDecoderConfigurationRecord) from the SPS and PPS of a keyframe, or null if it has none. */
function avcConfig(nals: Uint8Array[]): Uint8Array | null {
  const sps = nals.filter((n) => nalType(n) === SPS);
  const pps = nals.filter((n) => nalType(n) === PPS);
  if (!sps.length || !pps.length) return null;
  const profile = sps[0][1];
  const bytes: number[] = [1, profile, sps[0][2], sps[0][3], 0xff, 0xe0 | sps.length];
  for (const n of sps) bytes.push(n.length >> 8, n.length & 0xff, ...n);
  bytes.push(pps.length);
  for (const n of pps) bytes.push(n.length >> 8, n.length & 0xff, ...n);
  // High profiles add chroma format and bit depths: we always encode 8-bit 4:2:0.
  if ([100, 110, 122, 144].includes(profile)) bytes.push(0xfc | 1, 0xf8, 0xf8, 0);
  return new Uint8Array(bytes);
}
