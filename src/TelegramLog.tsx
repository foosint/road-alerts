import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { TelegramData, TelegramEvent } from './data';
import { fmtDay, fmtTime, periodStart, tzFor, tzLabel, type Period, type TimeMode } from './history';

const PAGE = 100;

/** Badge colour per kind; unknown kinds get the neutral one. */
const KIND_CLASS: Record<string, string> = { report: 'report', update: 'update', warning: 'warning' };

type Props = {
  data: TelegramData | null;
  error: string | null;
  period: Period;
  timeMode: TimeMode;
  now: number;
  /** The period and time zone selectors (shared with the alert log). */
  controls: ReactNode;
};

/**
 * Road reports from Telegram chats: English title and description, kind, date and time.
 * Everything else in the file (source chat, links, original text, replies, copies) is not shown for now.
 */
export default function TelegramLog({ data, error, period, timeMode, now, controls }: Props) {
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [period]);
  // The reports have no road, so they use the zone of the time setting for roads in general.
  const zone = tzFor(timeMode)();
  const label = tzLabel(timeMode, []);

  const list = useMemo(() => {
    const events = data?.events ?? [];
    if (period === 'all') return events;
    const from = periodStart(period, now, zone, []); // whole calendar days, like the alert log
    return events.filter((e) => Date.parse(e.at) >= from);
  }, [data, period, now, zone]);

  return (
    <div className="history">
      {controls}
      {!data ? (
        <div className="muted small">{error ? `Could not load the Telegram reports: ${error}` : 'No Telegram data yet.'}</div>
      ) : (
        <>
          <div className="muted small">
            {data.events.length > 0 && <>Telegram reports since {fmtDay(data.events[0].at, zone)} · </>}
            written by a local LLM from public chats, may contain errors · times in {label} · <span className="tg-experimental">Experimental</span>
          </div>
          {error && <div className="muted small">Last update failed ({error}); showing the last copy.</div>}
          <ReportList list={list} zone={zone} limit={limit} setLimit={setLimit} />
        </>
      )}
    </div>
  );
}

function ReportList({ list, zone, limit, setLimit }: {
  list: TelegramEvent[];
  zone: string | undefined;
  limit: number;
  setLimit: (n: number) => void;
}) {
  if (!list.length) return <div className="muted small">No reports in this period.</div>;
  const shown = list.slice(-limit).reverse(); // newest first
  let day = '';
  return (
    <div className="events tg-events">
      {shown.map((e) => {
        const d = fmtDay(e.at, zone);
        const head = d !== day ? (day = d) : null;
        return (
          <div key={e.id}>
            {head && <div className="day">{head}</div>}
            <div className="event tg-event">
              <time dateTime={e.at} title={e.at}>{fmtTime(e.at, zone, false)}</time>
              <div>
                <span className={`kind ${KIND_CLASS[e.kind] ?? ''}`}>{e.kind}</span>
                <b className="tg-title">{e.title}</b>
                {e.description && <p className="tg-desc">{e.description}</p>}
              </div>
            </div>
          </div>
        );
      })}
      {list.length > limit && (
        <button className="more" onClick={() => setLimit(limit + PAGE)}>
          Show older ({list.length - limit} more)
        </button>
      )}
    </div>
  );
}
