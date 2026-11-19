import { useState } from 'react';
import { STATUS_COLORS } from './colors';

const W = 300;
const H = 110;
const PAD = { top: 14, right: 4, bottom: 18, left: 30 };

/** A round axis maximum: 1-4 as is, otherwise the next multiple of half a power of ten. */
function niceMax(v: number) {
  if (v <= 4) return Math.max(Math.ceil(v), 1);
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
}

/** A bar with rounded top corners, anchored square to the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export type BarChartProps = {
  /** One value per bar; null = no data (no bar, shown as "—"). */
  values: (number | null)[];
  /** Full name of each bar, for the tooltip and the table. */
  labels: string[];
  /** Axis labels under some of the bars. */
  ticks: { i: number; text: string }[];
  /** Format a value for the axis, tooltip and table. */
  fmt?: (v: number) => string;
  /** Format a value in the tooltip (default: fmt), e.g. "3 alerts". */
  tipValue?: (v: number) => string;
  /** Added to the tooltip value, e.g. a share of the total. */
  tipExtra?: (i: number) => string;
  ariaLabel: string;
  tableHead: [string, string];
  color?: string;
  emptyText?: string;
};

/** Single-series bar chart with a hover/tap tooltip, a peak label and a table view. */
export default function BarChart({
  values, labels, ticks, fmt = String, tipValue, tipExtra, ariaLabel, tableHead, color = STATUS_COLORS.busy,
  emptyText = 'No alerts in this period.',
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const nums = values.map((v) => v ?? 0);
  const top = Math.max(0, ...nums);
  if (!values.length || top === 0) return <div className="muted small">{emptyText}</div>;

  const max = niceMax(top);
  const peak = nums.indexOf(top);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const colW = plotW / values.length;
  const gap = colW >= 5 ? 2 : 0; // thin bars: no gap
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  return (
    <div className="hour-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(max)} y2={y(max)} />
        <line className="axis" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        <text className="tick" x={PAD.left - 4} y={y(max) + 3} textAnchor="end">{fmt(max)}</text>
        <text className="tick" x={PAD.left - 4} y={y(0) + 3} textAnchor="end">0</text>
        {ticks.map(({ i, text }) => (
          <text key={i} className="tick" x={PAD.left + i * colW + colW / 2} y={H - 4} textAnchor="middle">{text}</text>
        ))}
        {values.map((v, i) => {
          const x = PAD.left + i * colW + gap / 2;
          const w = Math.max(colW - gap, 0.5);
          const t = y(v ?? 0);
          return (
            <g key={i}>
              {!!v && (
                <path d={barPath(x, t, w, y(0) - t)} fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
              {i === peak && colW >= 8 && (
                <text className="peak" x={x + w / 2} y={t - 3} textAnchor="middle">{fmt(top)}</text>
              )}
              {/* hit target: the whole column, bigger than the bar */}
              <rect
                x={PAD.left + i * colW} y={PAD.top} width={colW} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((PAD.left + (hover + 0.5) * colW) / W) * 100}%` }}>
          <b>{labels[hover]}</b>
          <span>
            {values[hover] === null ? '—' : (tipValue ?? fmt)(values[hover]!)}
            {tipExtra ? ` · ${tipExtra(hover)}` : ''}
          </span>
        </div>
      )}
      <details className="chart-table">
        <summary>Table</summary>
        <table>
          <thead><tr><th>{tableHead[0]}</th><th>{tableHead[1]}</th></tr></thead>
          <tbody>
            {values.map((v, i) => (
              <tr key={i}><td>{labels[i]}</td><td>{v === null ? '—' : fmt(v)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
