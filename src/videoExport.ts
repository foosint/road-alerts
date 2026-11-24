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
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: VIDEO_FPS, avc: { format: 'avc' } };
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
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
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
