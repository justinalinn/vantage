'use client';

import React from 'react';
import { OpenOdds, REGION_LABEL, Spinner, StatusChip } from './primitives';
import { OPERATOR_CLASS_LABEL, type OperatorClass } from '@/lib/callsign/groups';

const CLASSES: OperatorClass[] = ['E', 'A', 'G', 'T', 'N'];
const FORMATS = ['1x2', '2x1', '2x2', '1x3'];

export default function Recommender({
  onOpen,
  onAdopt,
}: {
  onOpen: (call: string) => void;
  onAdopt: (calls: string[]) => void;
}) {
  const [cls, setCls] = React.useState<OperatorClass>('E');
  const [formats, setFormats] = React.useState<string[]>(['1x2', '2x1']);
  const [initials, setInitials] = React.useState('');
  const [state, setState] = React.useState('');
  const [minSurvival, setMinSurvival] = React.useState(0.9);
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(async () => {
    setBusy(true);
    const r = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operatorClass: cls,
        formats,
        initials: initials || undefined,
        state: state || undefined,
        minSurvival,
        count: 25,
      }),
    }).then((x) => x.json());
    setData(r);
    setBusy(false);
  }, [cls, formats, initials, state, minSurvival]);

  React.useEffect(() => {
    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFormat = (f: string) =>
    setFormats((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]));

  return (
    <main className="van-in" style={{ padding: '18px clamp(12px,3vw,24px) 40px', maxWidth: 1120, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Build my 25</h1>
        <span style={{ fontSize: 12, color: 'var(--fg3)' }}>
          One $35 application. Twenty-five slots. Leaving any empty is the only real mistake.
        </span>
      </div>

      <div
        className="card"
        style={{ padding: '14px 16px', marginTop: 14, borderLeft: '3px solid var(--s-never)' }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6 }}>
          A call with fifteen applications on it is usually written off as gone. That misreads the board. Every
          applicant ranks up to 25 calls, and the instant one of them is granted a higher choice,{' '}
          <b style={{ color: 'var(--fg)' }}>every call below it on their list is released</b>. So the question is not how
          many people applied — it is how much of the call is genuinely spoken for. This list is built from that number,
          which means it deliberately includes calls the other tools show as contested.
        </div>
      </div>

      {/* controls */}
      <div className="card" style={{ padding: '14px 16px', marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>Your licence class</div>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value as OperatorClass)}
            style={{ background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line2)', borderRadius: 6, padding: '7px 10px', fontSize: 12 }}
          >
            {CLASSES.map((c) => (
              <option key={c} value={c}>
                {OPERATOR_CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <div>
          <div className="panel-title" style={{ marginBottom: 6 }}>Formats</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {FORMATS.map((f) => (
              <button
                key={f}
                onClick={() => toggleFormat(f)}
                className="chipbtn"
                style={
                  formats.includes(f)
                    ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                    : undefined
                }
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>Your initials</div>
          <input
            value={initials}
            onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 3))}
            placeholder="e.g. JL"
            style={{ width: 90, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line2)', borderRadius: 6, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}
          />
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--fg2)' }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>State</div>
          <input
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="TX"
            style={{ width: 70, background: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--line2)', borderRadius: 6, padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }}
          />
        </label>

        <label style={{ fontSize: 11.5, color: 'var(--fg2)', minWidth: 190 }}>
          <div className="panel-title" style={{ marginBottom: 6 }}>
            Minimum chance still open — {(minSurvival * 100).toFixed(0)}%
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minSurvival * 100}
            onChange={(e) => setMinSurvival(Number(e.target.value) / 100)}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
        </label>

        <button className="btn btn-primary" onClick={run} disabled={busy || formats.length === 0}>
          {busy ? 'Building…' : '◆ Build my list'}
        </button>
      </div>

      {!data ? (
        <Spinner label="Building your list…" />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', margin: '16px 0 10px' }}>
            <span className="mono tnum" style={{ fontSize: 13 }}>
              {data.slots.length} slots from a pool of {data.poolSize.toLocaleString()}
            </span>
            {data.bargains > 0 && (
              <span
                style={{
                  fontSize: 11.5,
                  color: 'var(--s-never)',
                  border: '1px solid color-mix(in srgb, var(--s-never) 40%, transparent)',
                  background: 'color-mix(in srgb, var(--s-never) 12%, transparent)',
                  borderRadius: 20,
                  padding: '4px 11px',
                }}
              >
                ◆ {data.bargains} look contested but are ≥90% likely to survive
              </span>
            )}
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={() => navigator.clipboard?.writeText(data.slots.map((s: any) => s.call).join('\n'))}>
              Copy list
            </button>
            <button className="btn btn-primary" onClick={() => onAdopt(data.slots.map((s: any) => s.call))}>
              Send to Builder →
            </button>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="van-scroll" style={{ overflowX: 'auto' }}>
              <table className="grid dense" style={{ fontSize: 12, minWidth: 720 }}>
                <thead>
                  <tr>
                    {['#', 'Call', 'Fmt', 'Region', 'Status', 'Filed', 'Score', 'Still open?', 'Why'].map((h) => (
                      <th key={h} style={{ cursor: 'default' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.slots.map((s: any) => (
                    <tr key={s.call} className="row">
                      <td className="mono tnum" style={{ color: 'var(--fg3)' }}>{s.rank}</td>
                      <td>
                        <span
                          role="button"
                          tabIndex={0}
                          className="call"
                          onClick={() => onOpen(s.call)}
                          onKeyDown={(e) => e.key === 'Enter' && onOpen(s.call)}
                          style={{ fontSize: 14, cursor: 'pointer', borderBottom: '1px dotted var(--line2)' }}
                        >
                          {s.call}
                        </span>
                      </td>
                      <td className="mono" style={{ color: 'var(--fg2)', fontSize: 11 }}>{s.format}</td>
                      <td style={{ color: 'var(--fg2)' }}>{REGION_LABEL[s.region] ?? s.region}</td>
                      <td><StatusChip status={s.status} size="sm" /></td>
                      <td className="mono tnum" style={{ textAlign: 'right', color: 'var(--fg2)' }}>
                        {s.pending_count || '—'}
                      </td>
                      <td className="mono tnum" style={{ textAlign: 'right' }}>{s.desirability}</td>
                      <td style={{ minWidth: 130 }}>
                        <OpenOdds row={s} compact />
                      </td>
                      <td style={{ color: 'var(--fg2)', fontSize: 11, maxWidth: 280 }}>
                        {s.pending_count > 0 && s.survive_p >= 0.9
                          ? `${s.pending_count} filed, but ${(s.claimed_p * 100).toFixed(0)}% claimed — they are chasing other calls`
                          : s.notes?.[0] ?? (s.status === 'NEVER_ISSUED' ? 'Never issued to anyone' : 'Open, no competition')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p style={{ fontSize: 11.5, color: 'var(--fg3)', lineHeight: 1.6, marginTop: 12 }}>
            Ordered by desirability, which is provably optimal: if you lose a contested call you fall straight through to
            the next entry, so a long shot at slot 1 costs nothing. Verify each call on its detail page before filing —
            these are predictions, not guarantees, and the FCC can act outside its published rules.
          </p>
        </>
      )}
    </main>
  );
}
