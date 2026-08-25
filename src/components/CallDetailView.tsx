'use client';

import React from 'react';
import { statusDef, fmtPct, pColor } from '@/lib/ui/status';
import { MethodBadge, Radial, REGION_LABEL, Spinner, StatusChip, availLabel } from './primitives';

interface Props {
  call: string;
  onBack: () => void;
  onAddToPref: (call: string) => void;
  onWatch: (call: string) => void;
  onOpenApplicant: (call: string) => void;
  inPref: boolean;
}

export default function CallDetailView({ call, onBack, onAddToPref, onWatch, onOpenApplicant, inPref }: Props) {
  const [d, setD] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setD(null);
    setErr(null);
    fetch(`/api/call/${encodeURIComponent(call)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error ?? 'not found'))))
      .then((j) => live && setD(j))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [call]);

  if (err) {
    return (
      <main style={{ padding: 24 }}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← back
        </button>
        <p style={{ color: 'var(--fg2)' }}>
          {call} is not in the materialised universe. 2x3 calls are evaluated on demand rather than stored.
        </p>
      </main>
    );
  }
  if (!d) return <Spinner label={`Loading ${call}…`} />;

  const st = statusDef(d.status);
  const best = d.competitors?.[0];
  const p = best?.p ?? null;

  return (
    <main className="van-in" style={{ padding: '16px clamp(12px, 3vw, 24px)', maxWidth: 1240, margin: '0 auto', width: '100%' }}>
      <button className="btn btn-ghost mono" onClick={onBack} style={{ marginBottom: 14 }}>
        ← results
      </button>

      {/* header */}
      <div
        className="card"
        style={{ padding: '18px clamp(14px, 3vw, 24px)', marginBottom: 16, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ minWidth: 240, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <span className="call" style={{ fontSize: 'clamp(28px, 6vw, 40px)', letterSpacing: 4 }}>
              {d.call}
            </span>
            <StatusChip status={d.status} showLabel />
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12, color: 'var(--fg2)', flexWrap: 'wrap' }}>
            <span>
              Format <b className="mono" style={{ color: 'var(--fg)' }}>{d.format}</b>
            </span>
            <span>
              Group <b className="mono" style={{ color: 'var(--fg)' }}>{d.grp}</b>
            </span>
            <span>
              Region <b style={{ color: 'var(--fg)' }}>{REGION_LABEL[d.region] ?? d.region}</b>
            </span>
            <span>
              CW weight <b className="mono" style={{ color: 'var(--fg)' }}>{d.morse}</b>
            </span>
            <span>
              Syllables <b className="mono" style={{ color: 'var(--fg)' }}>{d.phonetic}</b>
            </span>
            <span>
              Score <b className="mono" style={{ color: 'var(--fg)' }}>{d.desirability}/100</b>
            </span>
          </div>
          <div className="mono" style={{ marginTop: 10, fontSize: 12, color: 'var(--fg3)', letterSpacing: 1 }}>
            {d.morseCode}
          </div>
        </div>

        {p != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <MethodBadge method={best?.method} />
              <span style={{ fontSize: 10, color: 'var(--fg3)' }}>
                leader of {d.competitors.length} applicant{d.competitors.length === 1 ? '' : 's'}
              </span>
            </div>
            <Radial p={p} size={104} />
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="btn" onClick={() => onWatch(d.call)}>
            ☆ Watch
          </button>
          {st.applyable && (
            <button className={inPref ? 'btn' : 'btn btn-primary'} disabled={inPref} onClick={() => onAddToPref(d.call)}>
              {inPref ? '✓ In list' : '+ Preference list'}
            </button>
          )}
        </div>
      </div>

      {/* The answer, before any of the evidence for it. */}
      {d.verdict && <VerdictBanner v={d.verdict} />}

      <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {/* why */}
          <div className="card" style={{ borderLeft: `3px solid ${st.color}`, padding: '16px 18px' }}>
            <div className="panel-title" style={{ marginBottom: 8 }}>
              Why this status — rule trace
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>{d.explain.summary}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {d.explain.rules.map((r: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline', fontSize: 12 }}>
                  <span className="mono" style={{ color: 'var(--accent)', fontSize: 10, flexShrink: 0, minWidth: 62 }}>
                    {r.tag}
                  </span>
                  <span style={{ color: 'var(--fg2)', lineHeight: 1.45 }}>{r.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* competitors */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderBottom: '1px solid var(--line)',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>Competing applications</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg3)' }}>
                {(() => {
                  const bad = d.competitors.filter((c: any) => c.ineligible).length;
                  const live = d.competitors.length - bad;
                  return bad > 0 ? `${live} can win · ${bad} will be dismissed` : `${d.competitors.length} pending`;
                })()}
              </span>
            </div>
            {d.competitors.length === 0 ? (
              <div style={{ padding: '22px 16px', fontSize: 12, color: 'var(--fg3)' }}>
                Nobody has applied for this call. Filing today faces no lottery unless someone else files the same day.
              </div>
            ) : (
              <div className="van-scroll" style={{ maxHeight: 340, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                  <thead style={{ position: 'sticky', top: 0 }}>
                    <tr style={{ background: 'var(--bg3)' }}>
                      {['File #', 'Applicant', 'St', 'Cls', 'Rank', 'Receipt', 'Outcome'].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: h === 'Outcome' ? 'right' : 'left',
                            padding: '7px 10px',
                            color: 'var(--fg3)',
                            fontWeight: 500,
                            borderBottom: '1px solid var(--line2)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.competitors.map((c: any, i: number) => (
                      <tr key={c.usi} style={{ borderBottom: '1px solid var(--line)', background: i % 2 ? 'color-mix(in srgb, var(--bg3) 40%, transparent)' : undefined }}>
                        <td className="mono" style={{ padding: '6px 10px', color: 'var(--fg3)' }}>
                          {c.file_number ?? '—'}
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          {c.source === 'uls' && (
                            <span
                              title="Read from the FCC's ULS website before the bulk export published it. Real, but unconfirmed until the FCC's own files catch up."
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                marginRight: 6,
                                padding: '1px 4px',
                                borderRadius: 3,
                                color: 'var(--s-upcoming)',
                                border: '1px solid color-mix(in srgb, var(--s-upcoming) 45%, transparent)',
                              }}
                            >
                              PROV
                            </span>
                          )}
                          {c.applicant_call ? (
                            <span
                              role="button"
                              tabIndex={0}
                              className="mono"
                              onClick={() => onOpenApplicant(c.applicant_call)}
                              onKeyDown={(e) => e.key === 'Enter' && onOpenApplicant(c.applicant_call)}
                              title={`See everything ${c.applicant_call} is chasing`}
                              style={{ letterSpacing: '.5px', cursor: 'pointer', color: 'var(--accent)', borderBottom: '1px dotted var(--accent)' }}
                            >
                              {c.applicant_call}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--fg2)' }}>{c.state ?? '—'}</td>
                        <td className="mono" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>
                          {c.operator_class ?? '—'}
                        </td>
                        <td className="mono" style={{ padding: '6px 10px', color: 'var(--fg2)' }} title="Where this call sits on their preference list">
                          #{c.seq}
                        </td>
                        <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>
                          {c.receipt_date ?? '—'}
                        </td>
                        <td className="mono tnum" style={{ padding: '6px 10px', textAlign: 'right' }}>
                          {c.ineligible ? (
                            <span
                              title={c.ineligibleDetail ?? undefined}
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: 0.3,
                                padding: '2px 6px',
                                borderRadius: 4,
                                whiteSpace: 'nowrap',
                                color: 'var(--s-canceled)',
                                background: 'color-mix(in srgb, var(--s-canceled) 14%, transparent)',
                              }}
                            >
                              {DISMISSAL[c.ineligible] ?? 'will be dismissed'}
                            </span>
                          ) : (
                            <span style={{ color: pColor(c.p) }}>{fmtPct(c.p, c.method === 'monte-carlo')}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="panel-title" style={{ marginBottom: 16 }}>
              Licence history
            </div>
            <div style={{ position: 'relative', paddingLeft: 22 }}>
              <div style={{ position: 'absolute', left: 5, top: 4, bottom: 4, width: 2, background: 'var(--line2)' }} />
              {d.history.map((h: any, i: number) => (
                <div key={i} style={{ position: 'relative', paddingBottom: 18 }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: -21,
                      top: 2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      background: i === d.history.length - 1 ? st.color : 'var(--fg3)',
                      border: '2px solid var(--bg2)',
                      boxShadow: '0 0 0 1px var(--line2)',
                    }}
                  />
                  <div className="mono tnum" style={{ fontSize: 11, color: 'var(--fg3)' }}>
                    {h.date}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginTop: 1 }}>{h.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--fg2)', marginTop: 2, lineHeight: 1.45 }}>{h.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="panel-title" style={{ marginBottom: 12 }}>
              Desirability breakdown
            </div>
            {(
              [
                ['brevity', 'Brevity on CW'],
                ['phonetic', 'Phonetic speed'],
                ['clarity', 'Clarity in a pileup'],
                ['rhythm', 'Rhythm'],
                ['repetition', 'Memorability'],
              ] as const
            ).map(([k, label]) => {
              const v = d.desirabilityBreakdown[k] as number;
              return (
                <div key={k} style={{ marginBottom: 9 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--fg2)', marginBottom: 3 }}>
                    <span>{label}</span>
                    <span className="mono tnum">{v}</span>
                  </div>
                  <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${v}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              );
            })}
            {d.desirabilityBreakdown.notes.length > 0 && (
              <ul style={{ margin: '12px 0 0', paddingLeft: 16, fontSize: 11.5, color: 'var(--fg2)', lineHeight: 1.5 }}>
                {d.desirabilityBreakdown.notes.map((n: string, i: number) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * The FCC's own dismissal reasons, in the words a filer would use.
 *
 * A contested call is routinely contested by applications that cannot win —
 * filed a week before the hold ran out, or by someone whose licence class
 * cannot hold the group. Listing them as rivals with a blank probability reads
 * as "unknown"; naming the reason turns the competitor table into the most
 * useful thing on the page.
 */
const DISMISSAL: Record<string, string> = {
  TOO_EARLY: 'filed too early',
  ACTIVE_CALLSIGN: 'still licensed',
  INSUFFICIENT_CLASS: 'class too low',
  RESTRICTED_REGION: 'wrong region',
  RESERVED_CALLSIGN: 'reserved',
  INVALID_FORMAT: 'invalid format',
  BANNED: 'withheld by FCC',
  BLOCKED_PENDING: 'call is frozen',
  DUPLICATE: 'duplicate filing',
};

const TONE: Record<string, { color: string; glyph: string }> = {
  go: { color: 'var(--s-avail)', glyph: '●' },
  plan: { color: 'var(--s-upcoming)', glyph: '◔' },
  wait: { color: 'var(--s-expired)', glyph: '▽' },
  stop: { color: 'var(--s-anomaly)', glyph: '⊘' },
};

/**
 * The verdict, given its own slab above the evidence.
 *
 * Everything else on this page explains the call. This says what to do about
 * it, which is what almost everyone came for — and it carries the filing date,
 * because that date is the difference between getting the call and losing $35.
 */
function VerdictBanner({ v }: { v: any }) {
  const t = TONE[v.tone] ?? TONE.wait;
  return (
    <div
      className="card"
      style={{
        padding: '16px 18px',
        marginBottom: 16,
        borderLeft: `4px solid ${t.color}`,
        background: `color-mix(in srgb, ${t.color} 7%, transparent)`,
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ color: t.color, fontSize: 18, lineHeight: 1.2 }} aria-hidden>
          {t.glyph}
        </span>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.35 }}>{v.headline}</div>
          <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, marginTop: 6 }}>{v.detail}</div>
        </div>
        {v.fileOn && v.daysUntil != null && v.daysUntil > 0 && (
          <div style={{ textAlign: 'right', minWidth: 108 }}>
            <div className="mono tnum" style={{ fontSize: 22, fontWeight: 600, color: t.color }}>
              {v.daysUntil}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--fg3)', letterSpacing: 0.4 }}>
              DAY{v.daysUntil === 1 ? '' : 'S'} TO FILE
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--fg2)', marginTop: 3 }}>
              {v.fileOn}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
