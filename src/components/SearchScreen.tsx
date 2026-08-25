'use client';

import React from 'react';
import { STATUS_ORDER, statusDef } from '@/lib/ui/status';

/**
 * The landing screen.
 *
 * People arrive here doing one of three things, and the old version of this
 * screen served none of them directly: it opened with eleven saved queries and
 * a syntax table, which asks the visitor to learn a query language before the
 * tool will tell them anything. The three tasks are:
 *
 *   1. "Is CALL available?" — they already have one in mind. This is by far the
 *      most common arrival and it should cost one keystroke, not a query.
 *   2. "What can I actually get?" — no specific call, wants the shortlist.
 *   3. "What opens soon?" — the planning question, and the one no other tool
 *      can answer, so it earns a place at the top.
 *
 * Presets and syntax still exist, further down, for the people who want them.
 */

const PRESETS: Array<{ label: string; q: string; blurb: string }> = [
  { label: '1x2 · truly uncontested', q: '1x2 available', blurb: 'Open right now with nobody queued against them.' },
  { label: 'Open 2x1 calls', q: '2x1 available', blurb: 'The scarcest thing in US amateur radio. Usually a single-digit count nationwide.' },
  { label: 'Never-issued 2x2', q: '2x2 never', blurb: 'Valid, unassigned since records began, zero competition. Invisible to every other tool.' },
  { label: 'Never-issued 1x3', q: '1x3 never', blurb: 'A large untapped pool for General and above.' },
  { label: 'Contested right now', q: 'contested', blurb: 'Calls with live applications queued against them.' },
  { label: 'Repeating suffixes', q: 'repeating available', blurb: 'AAA, ABC and friends — the most memorable calls on the air.' },
  { label: 'Fast CW, open now', q: 'available cw<=44', blurb: 'Light on the key: ideal for contesting and DX.' },
  { label: 'Frozen by FCC action', q: 'frozen', blurb: 'Look open, are not, and will not be until the FCC acts. Do not spend $35 here.' },
  { label: 'Anomalies', q: 'anomaly', blurb: 'Open on paper, never actually granted.' },
];

const SYNTAX: Array<[string, string]> = [
  ['1x2  2x1  2x2  1x3', 'callsign format'],
  ['region 6   ·   6', 'call district'],
  ['prefix K', 'exact prefix'],
  ['K?A*', 'glob pattern — ? one char, * any run'],
  ['ending in vowel', 'suffix class'],
  ['ends with RR', 'literal suffix'],
  ['never · available · contested · pending', 'status'],
  ['frozen · banned · anomaly', 'looks open, is not'],
  ['extra · general · technician · novice', 'what your licence class may hold'],
  ['group:A', 'FCC call sign group'],
  ['P>60', 'at least a 60% chance it is still open to you'],
  ['cw<=44', 'maximum Morse weight'],
  ['des>=70', 'minimum desirability score'],
  ['within 90 days', 'availability window'],
  ['repeating', 'repeated or sequential suffix'],
];

export default function SearchScreen({
  onRun,
  onOpenCall,
  onGoto,
  meta,
}: {
  onRun: (q: string) => void;
  onOpenCall: (call: string) => void;
  onGoto: (screen: 'opening' | 'build25') => void;
  meta: any;
}) {
  const [lookup, setLookup] = React.useState('');
  const [showSyntax, setShowSyntax] = React.useState(false);

  const submitLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const c = lookup.trim().toUpperCase();
    if (c) onOpenCall(c);
  };

  const n = (k: string) => meta?.byStatus?.find((s: any) => s.status === k)?.c ?? 0;
  const openNow = n('AVAILABLE') + n('AVAILABLE_CONTESTED') + n('NEVER_ISSUED');

  return (
    <main
      className="van-in"
      style={{ padding: '22px clamp(12px,3vw,24px) 40px', maxWidth: 1080, margin: '0 auto', width: '100%' }}
    >
      {/* ------------------------------------------------- 1. look one up */}
      <h1 style={{ fontSize: 20, margin: 0 }}>Look up a callsign</h1>
      <p style={{ fontSize: 12.5, color: 'var(--fg2)', marginTop: 8, lineHeight: 1.6, maxWidth: 720 }}>
        Type any US amateur callsign to see whether it is available, when it opens, who is queued for it, and the exact
        day to file.
      </p>

      <form onSubmit={submitLookup} style={{ display: 'flex', gap: 8, marginTop: 12, maxWidth: 460 }}>
        <input
          value={lookup}
          onChange={(e) => setLookup(e.target.value)}
          placeholder="K3UF"
          aria-label="Callsign"
          className="mono"
          style={{
            flex: 1,
            fontSize: 17,
            letterSpacing: 2,
            padding: '10px 14px',
            textTransform: 'uppercase',
            background: 'var(--bg2)',
            border: '1px solid var(--line2)',
            borderRadius: 8,
            color: 'var(--fg)',
          }}
        />
        <button className="btn" type="submit" style={{ padding: '10px 18px', fontSize: 13 }}>
          Check
        </button>
      </form>

      {/* ------------------------------------------------ 2. the two jobs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
          marginTop: 26,
        }}
      >
        <button
          onClick={() => onGoto('opening')}
          className="card"
          style={{ padding: '16px 18px', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)', borderLeft: '3px solid var(--s-upcoming)' }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>What opens soon →</div>
          <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55 }}>
            The calendar of calls clearing their 2-year hold, with the one day you can file for each. Filing a day early
            is dismissed; a day late is usually too late.
          </div>
        </button>

        <button
          onClick={() => onRun('1x2 P>50')}
          className="card"
          style={{ padding: '16px 18px', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)', borderLeft: '3px solid var(--s-avail)' }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>What can I get now →</div>
          <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55 }}>
            Short calls open today, including ones the other sites write off as contested because they count applicants
            instead of working out who actually wins.
          </div>
        </button>

        <button
          onClick={() => onGoto('build25')}
          className="card"
          style={{ padding: '16px 18px', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)', borderLeft: '3px solid var(--s-never)' }}
        >
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>Build my 25 →</div>
          <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55 }}>
            One $35 application buys 25 ranked slots. Leaving any of them empty is the only real mistake. This fills them
            in the right order.
          </div>
        </button>
      </div>

      {/* --------------------------------------------------- 3. the corpus */}
      {meta && (
        <>
          <div className="panel-title" style={{ margin: '28px 0 10px' }}>
            The board right now
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
            {STATUS_ORDER.map((k) => {
              const c = n(k);
              if (!c) return null;
              const st = statusDef(k);
              return (
                <button
                  key={k}
                  onClick={() =>
                    onRun(
                      k === 'NEVER_ISSUED'
                        ? 'never'
                        : k === 'BLOCKED_PENDING'
                          ? 'frozen'
                          : k.toLowerCase().replace(/_/g, ' '),
                    )
                  }
                  className="card"
                  style={{
                    padding: '11px 13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${st.color}`,
                    color: 'var(--fg)',
                  }}
                >
                  <div className="mono tnum" style={{ fontSize: 18, fontWeight: 600 }}>
                    {c.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--fg2)' }}>{st.label}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 10, lineHeight: 1.55, maxWidth: 720 }}>
            {openNow.toLocaleString()} callsigns are assignable today, {n('NEVER_ISSUED').toLocaleString()} of which have
            never been issued to anyone and so appear in no licence database at all.
          </div>
        </>
      )}

      {/* ------------------------------------------------- 4. saved queries */}
      <div className="panel-title" style={{ margin: '28px 0 10px' }}>
        Saved searches
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onRun(p.q)}
            className="card"
            style={{ padding: '13px 15px', textAlign: 'left', cursor: 'pointer', color: 'var(--fg)' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.label}</div>
            <div className="mono" style={{ fontSize: 10.5, color: 'var(--accent)', marginBottom: 6 }}>
              {p.q}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg2)', lineHeight: 1.5 }}>{p.blurb}</div>
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------ 5. syntax */}
      <button
        className="btn btn-ghost"
        style={{ marginTop: 26, fontSize: 12 }}
        onClick={() => setShowSyntax((v) => !v)}
        aria-expanded={showSyntax}
      >
        {showSyntax ? '▾' : '▸'} Query syntax — mix any of these freely
      </button>

      {showSyntax && (
        <div className="card" style={{ padding: '14px 16px', marginTop: 10 }}>
          {SYNTAX.map(([syn, desc]) => (
            <div
              key={syn}
              style={{
                display: 'flex',
                gap: 14,
                padding: '5px 0',
                borderBottom: '1px solid var(--line)',
                flexWrap: 'wrap',
              }}
            >
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', minWidth: 210 }}>
                {syn}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--fg2)' }}>{desc}</span>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 10, lineHeight: 1.55 }}>
            Example: <span className="mono" style={{ color: 'var(--fg2)' }}>2x1 region 6 ending in vowel available</span>{' '}
            — open 2x1 calls in California whose suffix ends in a vowel.
          </div>
        </div>
      )}
    </main>
  );
}
