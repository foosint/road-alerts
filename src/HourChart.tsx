import { useState } from 'react';
import { STATUS_COLORS } from './colors';

const W = 300;
const H = 110;
const PAD = { top: 14, right: 4, bottom: 18, left: 22 };
const GAP = 2;

const hh = (h: number) => String(h).padStart(2, '0');

function niceMax(v: number) {
  if (v <= 4) return Math.max(v, 1);
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
}

/** A bar with rounded top corners, anchored square to the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

type Props = { counts: number[]; tzLabel: string; color?: string };

/** Alerts per hour of the day: 24 bars, a tooltip on hover/tap, and a table view. */
export default function HourChart({ counts, tzLabel, color = STATUS_COLORS.busy }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const total = counts.reduce((a, b) => a + b, 0);
  const max = niceMax(Math.max(...counts));
  const peak = counts.indexOf(Math.max(...counts));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const colW = plotW / 24;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  if (!total) return <div className="muted small">No alerts in this period.</div>;

  return (
    <div className="hour-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Alerts by hour of day (${tzLabel}). Peak ${hh(peak)}:00 with ${counts[peak]} of ${total}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* recessive grid: top and baseline */}
        <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} />
        <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        <text className="tick" x={PAD.left - 4} y={y(max) + 3} textAnchor="end">{max}</text>
        <text className="tick" x={PAD.left - 4} y={y(0) + 3} textAnchor="end">0</text>
        {[0, 6, 12, 18].map((h) => (
          <text key={h} className="tick" x={PAD.left + h * colW + colW / 2} y={H - 4} textAnchor="middle">{hh(h)}</text>
        ))}
        {counts.map((v, h) => {
          const x = PAD.left + h * colW + GAP / 2;
          const w = colW - GAP;
          const top = y(v);
          return (
            <g key={h}>
              {v > 0 && (
                <path d={barPath(x, top, w, y(0) - top)} fill={color} opacity={hover === null || hover === h ? 1 : 0.45} />
              )}
              {h === peak && (
                <text className="peak" x={x + w / 2} y={top - 3} textAnchor="middle">{v}</text>
              )}
              {/* hit target: the whole column, bigger than the bar */}
              <rect
                x={PAD.left + h * colW} y={PAD.top} width={colW} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(h)}
                onClick={() => setHover(h)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="chart-tip"
          style={{ left: `${((PAD.left + (hover + 0.5) * colW) / W) * 100}%` }}
        >
          <b>{hh(hover)}:00–{hh((hover + 1) % 24)}:00</b>
          <span>{counts[hover]} alert{counts[hover] === 1 ? '' : 's'} · {Math.round((counts[hover] / total) * 100)}%</span>
        </div>
      )}
      <details className="chart-table">
        <summary>Table</summary>
        <table>
          <thead><tr><th>Hour ({tzLabel})</th><th>Alerts</th></tr></thead>
          <tbody>
            {counts.map((v, h) => (
              <tr key={h}><td>{hh(h)}:00</td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
