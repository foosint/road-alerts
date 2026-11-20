import BarChart from './BarChart';

const hh = (h: number) => String(h).padStart(2, '0');

type Props = { counts: number[]; tzLabel: string; width?: number; height?: number };

/** Alerts per hour of the day: 24 bars. */
export default function HourChart({ counts, tzLabel, width, height }: Props) {
  const total = counts.reduce((a, b) => a + b, 0);
  const peak = counts.indexOf(Math.max(...counts));
  const n = (v: number) => `${v} alert${v === 1 ? '' : 's'}`;
  return (
    <BarChart
      values={counts}
      labels={counts.map((_, h) => `${hh(h)}:00–${hh((h + 1) % 24)}:00`)}
      ticks={[0, 6, 12, 18].map((h) => ({ i: h, text: hh(h) }))}
      tipValue={n}
      tipExtra={(h) => `${total ? Math.round((counts[h] / total) * 100) : 0}%`}
      ariaLabel={`Alerts by hour of day (${tzLabel}). Peak ${hh(peak)}:00 with ${counts[peak]} of ${total}.`}
      tableHead={[`Hour (${tzLabel})`, 'Alerts']}
      width={width}
      height={height}
    />
  );
}
