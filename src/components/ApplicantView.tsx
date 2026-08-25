'use client';

import React from 'react';
import { fmtPct, pColor, statusDef } from '@/lib/ui/status';
import { OpenOdds, REGION_LABEL, Spinner, StatusChip, availLabel } from './primitives';

/**
 * Who is this competitor and what else are they chasing?
 *
 * On a contested call the rival applicants are the most informative thing on
 * the page, and they used to be inert text. Seeing that the person ahead of you
 * ranks your call ninth — behind eight they are more likely to win — tells you
 * the call is far less contested than the raw count suggests.
 */
export default function ApplicantView({
  call,
  onOpenCall,
  onBack,
}: {
  call: string;
  onOpenCall: (c: string) => void;
  onBack: () => void;
}) {
  const [d, setD] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setD(null);
    setErr(null);
    fetch(`/api/applicant/${encodeURIComponent(call)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error))))
      .then((j) => live && setD(j))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [call]);

  if (err) {
    return (
      <main style={{ padding: 24 }}>
        <button className="btn btn-ghost" onClick={onBack}>← back</button>
        <p style={{ color: 'var(--fg2)' }}>No vanity applications on file for {call}.</p>
      </main>
    );
  }
  if (!d) return <Spinner label={`Loading ${call}…`} />;

  return (
    <main className="van-in" style={{ padding: '16px clamp(12px,3vw,24px) 40px', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <button className="btn btn-ghost mono" onClick={onBack} style={{ marginBottom: 14 }}>
        ← back
      </button>

      <div className="card" style={{ padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="call" style={{ fontSize: 'clamp(26px,5vw,34px)', letterSpacing: 3 }}>{d.applicant}</span>
          {d.licence?.entity_name && (
            <span style={{ fontSize: 13, color: 'var(--fg2)' }}>{d.licence.entity_name}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: 'var(--fg2)', flexWrap: 'wrap' }}>
          {d.licence?.state && <span>State <b style={{ color: 'var(--fg)' }}>{d.licence.state}</b></span>}
          {d.licence?.operator_class && (
            <span>Class <b className="mono" style={{ color: 'var(--fg)' }}>{d.licence.operator_class}</b></span>
          )}
          {d.licence?.grant_date && (
            <span>Licensed since <b className="mono" style={{ color: 'var(--fg)' }}>{d.licence.grant_date}</b></span>
          )}
          <span>Vanity applications <b className="mono" style={{ color: 'var(--fg)' }}>{d.applications.length}</b></span>
        </div>
      </div>

      {d.applications.map((a: any) => (
        <div key={a.usi} className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 16px',
              borderBottom: '1px solid var(--line)',
              flexWrap: 'wrap',
              background: a.isPending ? 'color-mix(in srgb, var(--accent) 7%, transparent)' : undefined,
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: 'var(--fg3)' }}>{a.file_number}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 9px',
                borderRadius: 5,
                color: a.app_status === 'G' ? 'var(--s-avail)' : a.isPending ? 'var(--s-pending)' : 'var(--s-canceled)',
                background: `color-mix(in srgb, ${a.app_status === 'G' ? 'var(--s-avail)' : a.isPending ? 'var(--s-pending)' : 'var(--s-canceled)'} 14%, transparent)`,
              }}
            >
              {a.statusLabel}
            </span>
            <span style={{ fontSize: 12, color: 'var(--fg2)' }}>
              Receipt <b className="mono" style={{ color: 'var(--fg)' }}>{a.receipt_date}</b>
            </span>
            {a.requestTypeLabel && (
              <span style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{a.requestTypeLabel}</span>
            )}
            <div style={{ flex: 1 }} />
            {a.outcome && (
              <span className="mono" style={{ fontSize: 11, color: 'var(--fg2)' }}>
                predicted: {a.outcome}
                {a.best_call ? ` → ${a.best_call} ${fmtPct(a.best_p)}` : ''}
              </span>
            )}
          </div>

          <div className="van-scroll" style={{ overflowX: 'auto' }}>
            <table className="grid dense" style={{ fontSize: 12, minWidth: 700 }}>
              <thead>
                <tr>
                  {['Rank', 'Call', 'Fmt', 'Region', 'Status', 'Available', 'Their odds', 'Still open?'].map((h) => (
                    <th key={h} style={{ cursor: 'default' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {a.preferences.map((p: any) => (
                  <tr key={p.seq} className="row">
                    <td className="mono tnum" style={{ color: 'var(--fg3)' }}>#{p.seq}</td>
                    <td>
                      <span
                        role="button"
                        tabIndex={0}
                        className="call"
                        onClick={() => onOpenCall(p.call)}
                        onKeyDown={(e) => e.key === 'Enter' && onOpenCall(p.call)}
                        style={{ fontSize: 13, cursor: 'pointer', borderBottom: '1px dotted var(--line2)' }}
                      >
                        {p.call}
                      </span>
                    </td>
                    <td className="mono" style={{ color: 'var(--fg2)', fontSize: 11 }}>{p.format ?? '—'}</td>
                    <td style={{ color: 'var(--fg2)' }}>{p.region != null ? REGION_LABEL[p.region] ?? p.region : '—'}</td>
                    <td>{p.status ? <StatusChip status={p.status} size="sm" /> : <span style={{ color: 'var(--fg3)' }}>—</span>}</td>
                    <td className="tnum" style={{ color: 'var(--fg2)' }}>
                      {p.status ? availLabel(p.status, p.available_date) : '—'}
                    </td>
                    <td className="mono tnum" style={{ color: pColor(p.p) }}>
                      {p.p != null ? fmtPct(p.p, p.p_method === 'monte-carlo') : '—'}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      {p.status ? (
                        <OpenOdds
                          row={{
                            survive_p: p.survive_p ?? 1,
                            claimed_p: 1 - (p.survive_p ?? 1),
                            pending_count: p.pending_count ?? 0,
                            eligible_pending: p.eligible_pending,
                            status: p.status,
                          }}
                          compact
                        />
                      ) : (
                        <span style={{ color: 'var(--fg3)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </main>
  );
}
