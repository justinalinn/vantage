'use client';

import React from 'react';
import { REGION_LABEL, Spinner, Empty } from './primitives';
import { OPERATOR_CLASS_LABEL, type OperatorClass } from '@/lib/callsign/groups';

const CLASSES: OperatorClass[] = ['E', 'A', 'G', 'T', 'N'];
const FORMATS = ['1x2', '2x1', '2x2', '1x3'];
const HORIZONS = [
  { d: 30, label: '30 days' },
  { d: 90, label: '3 months' },
  { d: 180, label: '6 months' },
  { d: 365, label: '1 year' },
];

function relative(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

function weekday(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The filing calendar.
 *
 * Every other tool answers "is this call available right now". That question is
 * almost useless for a good call, because a good call is never sitting around
 * unclaimed — by the time it reads as available, the people watching it have
 * already filed. The useful question is "what opens next, and what day do I
 * send the application", and answering it needs the opening date of a call whose
 * ULS record still says Active. That is the whole reason this screen can exist.
 */
export default function OpeningSoon({
  onOpen,
  onWatch,
}: {
  onOpen: (call: string) => void;
  onWatch: (call: string) => void;
}) {
  const [days, setDays] = React.useState(90);
  const [cls, setCls] = React.useState<OperatorClass>('E');
  const [formats, setFormats] = React.useState<string[]>(['1x2', '2x1']);
  const [region, setRegion] = React.useState<string>('');
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(true);

  React.useEffect(() => {
    setBusy(true);
    const ctl = new AbortController();
    const u = new URL('/api/opening', window.location.origin);
    u.searchParams.set('days', String(days));
    u.searchParams.set('class', cls);
    if (formats.length) u.searchParams.set('formats', formats.join(','));
    if (region) u.searchParams.set('region', region);
    fetch(u, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => {
        setData(j);
        setBusy(false);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') setBusy(false);
      });
    return () => ctl.abort();
  }, [days, cls, formats, region]);

  const toggleFormat = (f: string) =>
    setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <main
      className="van-in"
      style={{ padding: '18px clamp(12px,3vw,24px) 40px', maxWidth: 1120, margin: '0 auto', width: '100%' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Opening soon</h1>
        <span style={{ fontSize: 12, color: 'var(--fg3)' }}>
          Calls whose 2-year hold runs out shortly, and the day to file for each.
        </span>
      </div>

      <div className="card" style={{ padding: '14px 16px', marginTop: 14, borderLeft: '3px solid var(--s-upcoming)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6 }}>
          There is exactly one right day to file for each of these.{' '}
          <b style={{ color: 'var(--fg)' }}>A day early is dismissed</b> and the $35 is not refunded. A day late and, if
          anyone filed on the opening day, the call is already gone — the FCC works through batches in receipt-date
          order, so a later batch only ever sees what an earlier one left behind. Everyone who files on the right day
          goes into the same random draw.
        </div>
      </div>

      {/* ---------------------------------------------------------- filters */}
      <div
        className="card"
        style={{ padding: '12px 16px', marginTop: 12, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', marginRight: 2 }}>WITHIN</span>
          {HORIZONS.map((h) => (
            <button
              key={h.d}
              className={`btn ${days === h.d ? '' : 'btn-ghost'}`}
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              onClick={() => setDays(h.d)}
            >
              {h.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)', marginRight: 2 }}>FORMAT</span>
          {FORMATS.map((f) => (
            <button
              key={f}
              className={`btn ${formats.includes(f) ? '' : 'btn-ghost'} mono`}
              style={{ fontSize: 11.5, padding: '4px 9px' }}
              onClick={() => toggleFormat(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)' }}>MY CLASS</span>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value as OperatorClass)}
            style={{ fontSize: 12, padding: '4px 6px' }}
          >
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {OPERATOR_CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--fg3)' }}>REGION</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }}>
            <option value="">any</option>
            {Object.entries(REGION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {k} — {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {busy && <Spinner label="Reading the calendar…" />}

      {!busy && data && data.total === 0 && (
        <Empty
          title="Nothing opens in that window"
          hint="Widen the horizon or add formats. 1x2 calls are genuinely rare — only about 200 open in a typical year, which is exactly why knowing the date matters."
        />
      )}

      {!busy && data && data.total > 0 && (
        <>
          <div style={{ margin: '18px 0 8px', fontSize: 12.5, color: 'var(--fg2)' }}>
            <b style={{ color: 'var(--fg)' }}>{data.total.toLocaleString()}</b> calls open across{' '}
            <b style={{ color: 'var(--fg)' }}>{data.dates.length.toLocaleString()}</b> dates in the next {days} days.
          </div>

          {data.dates.map((d: any) => (
            <div key={d.date} className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--line)',
                  flexWrap: 'wrap',
                  background: 'color-mix(in srgb, var(--s-upcoming) 8%, transparent)',
                }}
              >
                <span className="mono" style={{ fontSize: 15, fontWeight: 600, letterSpacing: 0.5 }}>
                  {d.date}
                </span>
                <span style={{ fontSize: 12, color: 'var(--fg2)' }}>{weekday(d.date)}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 20,
                    color: 'var(--s-upcoming)',
                    background: 'color-mix(in srgb, var(--s-upcoming) 15%, transparent)',
                  }}
                >
                  {relative(d.daysUntil)}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>
                  {d.calls.length} call{d.calls.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="van-scroll" style={{ overflowX: 'auto' }}>
                <table className="grid dense" style={{ fontSize: 12, minWidth: 620 }}>
                  <thead>
                    <tr>
                      {['Call', 'Fmt', 'Region', 'Held by', 'Expired', 'Early filings', ''].map((h) => (
                        <th key={h} style={{ cursor: 'default' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.calls.map((c: any) => (
                      <tr key={c.call} className="row">
                        <td>
                          <span
                            role="button"
                            tabIndex={0}
                            className="call"
                            onClick={() => onOpen(c.call)}
                            onKeyDown={(e) => e.key === 'Enter' && onOpen(c.call)}
                            style={{ fontSize: 14, cursor: 'pointer', borderBottom: '1px dotted var(--line2)' }}
                          >
                            {c.call}
                          </span>
                        </td>
                        <td className="mono" style={{ color: 'var(--fg2)', fontSize: 11 }}>
                          {c.format}
                        </td>
                        <td style={{ color: 'var(--fg2)' }}>{REGION_LABEL[c.region] ?? c.region}</td>
                        <td style={{ color: 'var(--fg3)', fontSize: 11.5, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.entity_name ?? '—'}
                        </td>
                        <td className="mono tnum" style={{ color: 'var(--fg2)', fontSize: 11.5 }}>
                          {c.expired_date ?? '—'}
                        </td>
                        <td>
                          {c.tooEarlyFilings > 0 ? (
                            <span
                              title="Applications already filed against this call. They were filed before it opens, so the FCC will dismiss every one of them — but they tell you how many people are watching."
                              style={{ fontSize: 11, color: 'var(--s-contested)' }}
                            >
                              {c.tooEarlyFilings} watching
                            </span>
                          ) : (
                            <span style={{ color: 'var(--fg3)', fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            onClick={() => onWatch(c.call)}
                          >
                            + watch
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </>
      )}
    </main>
  );
}
