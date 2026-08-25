'use client';

import React from 'react';
import { Spinner, useMediaQuery } from './primitives';

const STAGE_COLOR: Record<string, string> = {
  filed: 'var(--fg3)',
  receipt: 'var(--accent)',
  payment: 'var(--s-never)',
  batch: 'var(--s-upcoming)',
  process: 'var(--s-avail)',
};

export default function TimelineView() {
  const [from, setFrom] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [d, setD] = React.useState<any>(null);
  // Five stages need ~190px each; below this they overlap into illegibility.
  const narrow = useMediaQuery('(max-width: 900px)');

  React.useEffect(() => {
    let live = true;
    fetch(`/api/timeline?from=${from}`)
      .then((r) => r.json())
      .then((j) => live && setD(j));
    return () => {
      live = false;
    };
  }, [from]);

  if (!d) return <Spinner />;

  const { timeline: tl, stages, options } = d;

  const workdayOptions = options.filter((o: any) => o.isWorkday);
  const comps = workdayOptions.map((o: any) => o.knownCompetitors);
  const minComp = Math.min(...comps);
  // Only worth flagging a "thinnest" batch when the batches actually differ.
  // Future receipt dates all have zero filings so far, and marking every row
  // as the best choice tells the user nothing.
  const compsVary = Math.max(...comps) > minComp;

  /**
   * Horizontal positions for the rail. Placing each stage purely at its date
   * fraction collides whenever two stages fall close together — Filed and
   * Receipt often share a date, and Batch and Lottery are one day apart out of
   * nineteen. Positions stay proportional but are pushed apart to a legible
   * minimum, preserving order and rough scale.
   */
  const MIN_GAP = 0.19;
  // Every label is left-aligned and one MIN_GAP wide, so the last one must
  // start no further right than 1 - MIN_GAP or it runs off the track. Scale the
  // raw date fractions into that usable span first, then push apart to the
  // minimum, then clamp — which keeps the ordering and rough proportions while
  // guaranteeing no two labels ever share space.
  const usable = 1 - MIN_GAP;
  const positions: number[] = [];
  stages.forEach((s: any, i: number) => {
    const raw = Math.min(1, Math.max(0, s.t)) * usable;
    positions.push(i === 0 ? raw : Math.max(raw, positions[i - 1] + MIN_GAP));
  });
  for (let i = positions.length - 1; i >= 0; i--) {
    const ceiling = usable - (positions.length - 1 - i) * MIN_GAP;
    positions[i] = Math.max(0, Math.min(positions[i], ceiling));
  }

  return (
    <main className="van-in" style={{ padding: '18px clamp(12px,3vw,24px)', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Filing timeline</h1>
        <span style={{ fontSize: 12, color: 'var(--fg3)' }}>
          Deterministic and holiday-aware. Every date below is computed, not estimated.
        </span>
      </div>

      <div className="card" style={{ padding: '16px 18px', margin: '16px 0' }}>
        <label style={{ fontSize: 12, color: 'var(--fg2)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          If I file on
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line2)',
              borderRadius: 6,
              color: 'var(--fg)',
              padding: '7px 10px',
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
            }}
          />
          <span className="mono" style={{ color: 'var(--fg3)' }}>
            → the lottery runs {tl.totalDays} days later
          </span>
        </label>

        {/* Timeline rail. Five absolutely-positioned stages need roughly 190px
            each; below ~900px they collide into unreadable overlap, so narrow
            viewports get the same information stacked vertically instead. */}
        {narrow ? (
          <div style={{ position: 'relative', paddingLeft: 24, marginTop: 24 }}>
            <div style={{ position: 'absolute', left: 6, top: 6, bottom: 6, width: 2, background: 'var(--line2)' }} />
            {stages.map((s: any) => (
              <div key={s.key} style={{ position: 'relative', paddingBottom: 20 }}>
                <div
                  style={{
                    position: 'absolute',
                    left: -23,
                    top: 3,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: STAGE_COLOR[s.key],
                    border: '3px solid var(--bg2)',
                    boxShadow: '0 0 0 1px var(--line2)',
                  }}
                />
                <div className="mono tnum" style={{ fontSize: 11, color: STAGE_COLOR[s.key], fontWeight: 600 }}>
                  {s.date}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{s.label}</div>
                <div style={{ fontSize: 11.5, color: 'var(--fg2)', marginTop: 3, lineHeight: 1.5 }}>{s.description}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ position: 'relative', margin: '34px 0 8px', paddingBottom: 96 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 7, height: 3, background: 'var(--line2)', borderRadius: 2 }} />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 7,
                height: 3,
                width: '100%',
                background: 'linear-gradient(90deg, var(--fg3), var(--accent), var(--s-upcoming), var(--s-avail))',
                borderRadius: 2,
              }}
            />
            {stages.map((s: any, i: number) => {
              const pct = positions[i] * 100;
              return (
                <div
                  key={s.key}
                  style={{
                    position: 'absolute',
                    left: `${pct}%`,
                    top: 0,
                    width: `${MIN_GAP * 100}%`,
                    paddingRight: 14,
                  }}
                >
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: '50%',
                      background: STAGE_COLOR[s.key],
                      border: '3px solid var(--bg)',
                      boxShadow: '0 0 0 1px var(--line2)',
                      marginLeft: 0,
                    }}
                  />
                  <div style={{ marginTop: 8 }}>
                    <div className="mono tnum" style={{ fontSize: 11, color: STAGE_COLOR[s.key], fontWeight: 600 }}>
                      {s.date}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 1 }}>{s.label}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--fg3)', marginTop: 3, lineHeight: 1.45 }}>{s.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '16px 18px' }}>
        <div className="panel-title" style={{ marginBottom: 4 }}>
          Filing-date arbitrage
        </div>
        <p style={{ fontSize: 12, color: 'var(--fg2)', margin: '6px 0 14px', lineHeight: 1.55, maxWidth: 780 }}>
          Your receipt date decides which batch you land in, and receipt dates are Federal workdays. Filing Friday,
          Saturday or Sunday all land you in Monday&apos;s batch — so a weekend filing shares a lottery with three days of
          rivals and gains nothing. Pick a thin batch.
        </p>
        <div className="van-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                {['File on', 'Receipt date', 'Lottery runs', 'Days folded in', 'Rivals filed', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--fg3)', fontWeight: 500, borderBottom: '1px solid var(--line2)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {options.map((o: any) => {
                const best = compsVary && o.isWorkday && o.knownCompetitors === minComp;
                return (
                  <tr
                    key={o.date}
                    style={{
                      borderBottom: '1px solid var(--line)',
                      background: o.date === from ? 'var(--sel)' : undefined,
                      opacity: o.isWorkday ? 1 : 0.55,
                    }}
                  >
                    <td className="mono tnum" style={{ padding: '7px 10px' }}>{o.date}</td>
                    <td className="mono tnum" style={{ padding: '7px 10px', color: 'var(--fg2)' }}>{o.receipt}</td>
                    <td className="mono tnum" style={{ padding: '7px 10px', color: 'var(--fg2)' }}>{o.process}</td>
                    <td style={{ padding: '7px 10px', color: o.collisionDays > 1 ? 'var(--s-canceled)' : 'var(--fg2)' }}>
                      {o.collisionDays > 1 ? `${o.collisionDays} days share this batch` : '1 day'}
                    </td>
                    <td className="mono tnum" style={{ padding: '7px 10px', color: 'var(--fg2)' }}>{o.knownCompetitors}</td>
                    <td style={{ padding: '7px 10px' }}>
                      {!o.isWorkday && <span style={{ fontSize: 11, color: 'var(--fg3)' }}>not a workday</span>}
                      {best && <span style={{ fontSize: 11, color: 'var(--s-avail)', fontWeight: 600 }}>thinnest batch</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>
          Strategy the FCC does not advertise
        </div>
        {[
          ['Pay on day 2 or 3, not day 1.', 'You have 10 days from the receipt date to pay. Waiting a couple of workdays lets you see who else filed for your calls before committing the $35 — and if the field looks hopeless you can withdraw instead of paying.'],
          ['Never file twice on the same day.', '47 CFR 97.19(d)(1) treats same-day duplicate filings from one applicant as an unfair practice. Both get dismissed — the first for non-payment, the second as a duplicate.'],
          ['Amending resets your receipt date.', 'An amendment moves you into a later batch entirely. That is occasionally useful — to escape a crowded batch, or to buy time for a Silent Key notice to land — but it is usually a costly mistake.'],
          ['Eligibility is judged on the receipt date.', 'Not the filing date, and not the grant date. If your upgrade posts to the ULS after your receipt date, you were not eligible when it counted.'],
        ].map(([t, b]) => (
          <div key={t} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{t}</div>
            <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55 }}>{b}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
