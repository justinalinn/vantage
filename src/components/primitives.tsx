'use client';

import React from 'react';
import { chipStyle, fmtPct, pColor, statusDef } from '@/lib/ui/status';

export function StatusChip({ status, size = 'md', showLabel = false }: { status: string; size?: 'sm' | 'md'; showLabel?: boolean }) {
  const st = statusDef(status);
  return (
    <span style={chipStyle(st, size)} title={st.label}>
      <span aria-hidden style={{ fontSize: size === 'sm' ? 10 : 11, lineHeight: 1 }}>
        {st.glyph}
      </span>
      <span className="mono" style={{ fontSize: size === 'sm' ? 10 : 11, fontWeight: 600, letterSpacing: '.5px' }}>
        {st.code}
      </span>
      {showLabel && <span style={{ fontWeight: 500 }}>{st.label}</span>}
      <span className="sronly">{st.label}</span>
    </span>
  );
}

/**
 * Probability meter. A simulated value is drawn with a hatched fill and a
 * "SIM" tag so an estimate can never be mistaken for an exact answer.
 */
export function ProbabilityMeter({
  p,
  method,
  compact = false,
}: {
  p: number | null | undefined;
  method?: string | null;
  compact?: boolean;
}) {
  if (p == null) return <span className="mono" style={{ fontSize: 11, color: 'var(--fg3)' }}>—</span>;
  const simulated = method === 'monte-carlo';
  const c = pColor(p);
  const base = `color-mix(in srgb, ${c} 78%, transparent)`;
  const fill = simulated
    ? `repeating-linear-gradient(45deg, ${base} 0 5px, color-mix(in srgb, ${c} 45%, transparent) 5px 10px)`
    : base;

  return (
    <div
      style={{
        position: 'relative',
        height: compact ? 16 : 18,
        minWidth: compact ? 92 : 130,
        background: 'var(--bg3)',
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid var(--line)',
      }}
      title={`${fmtPct(p, simulated)} — ${simulated ? 'Monte-Carlo estimate' : 'exact enumeration'}`}
    >
      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${p * 100}%`, background: fill }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--fg)',
        }}
      >
        <span>{fmtPct(p, simulated)}</span>
        <span style={{ fontSize: 8, letterSpacing: '.5px', color: 'var(--fg2)' }}>{simulated ? 'SIM' : 'EXACT'}</span>
      </div>
    </div>
  );
}

export function MethodBadge({ method }: { method?: string | null }) {
  const sim = method === 'monte-carlo';
  const c = sim ? 'var(--s-upcoming)' : 'var(--s-avail)';
  return (
    <span
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: 1,
        padding: '2px 7px',
        borderRadius: 4,
        color: c,
        background: `color-mix(in srgb, ${c} 15%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 40%, transparent)`,
      }}
    >
      {sim ? 'SIMULATED' : 'EXACT'}
    </span>
  );
}

export function Radial({ p, size = 96, label = 'P(WIN)' }: { p: number | null; size?: number; label?: string }) {
  const c = pColor(p);
  const deg = Math.round((p ?? 0) * 360);
  const inner = size - 26;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        background: `conic-gradient(${c} ${deg}deg, var(--bg3) ${deg}deg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: inner,
          height: inner,
          borderRadius: '50%',
          background: 'var(--bg2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span className="mono" style={{ fontSize: size > 90 ? 20 : 16, fontWeight: 600 }}>
          {fmtPct(p)}
        </span>
        <span style={{ fontSize: 8, letterSpacing: '.5px', color: 'var(--fg3)' }}>{label}</span>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg3)', fontSize: 12 }}>
      <div className="skeleton" style={{ height: 10, width: 180, margin: '0 auto 10px', borderRadius: 4 }} />
      {label ?? 'Loading…'}
    </div>
  );
}

export function SkeletonRows({ n = 12, cols = 10 }: { n?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
          <td colSpan={cols} style={{ padding: '6px 10px' }}>
            <div className="skeleton" style={{ width: `${45 + ((i * 37) % 50)}%` }} />
          </td>
        </tr>
      ))}
    </>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div style={{ padding: '56px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 6 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--fg3)', maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>{hint}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        background: 'var(--bg)',
        border: '1px solid var(--line)',
        borderRadius: 8,
      }}
    >
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg2)' }}>{label}</div>
        {sub && <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 1 }}>{sub}</div>}
      </div>
      <div className="mono tnum" style={{ fontSize: 22, fontWeight: 600, color: color ?? 'var(--fg)' }}>
        {value}
      </div>
    </div>
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const on = (e: MediaQueryListEvent) => setMatches(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return matches;
}

export const REGION_LABEL: Record<number, string> = {
  0: '0 · Central',
  1: '1 · NE',
  2: '2 · NY/NJ',
  3: '3 · Mid-Atl',
  4: '4 · SE',
  5: '5 · S Ctrl',
  6: '6 · CA',
  7: '7 · NW',
  8: '8 · Gt Lakes',
  9: '9 · IL/IN/WI',
  11: 'AK',
  12: 'PR/VI',
  13: 'HI/Pac',
};

export function availLabel(status: string, date: string | null): string {
  if (status === 'NEVER_ISSUED') return 'Never issued';
  if (status === 'AVAILABLE' || status === 'AVAILABLE_CONTESTED') return 'Open now';
  // Every licensed call now carries a projected opening date — expiry plus the
  // 2-year grace. That projection is worth showing on the detail page, where
  // there is room to say "if it is never renewed", and actively misleading in a
  // grid cell, where a bare 2034 date reads as a promise.
  if (status === 'ACTIVE') return 'Licensed';
  if (status === 'BLOCKED_PENDING') return 'Frozen';
  if (status === 'BANNED') return 'Withheld';
  if (!date) return '—';
  const days = Math.ceil((Date.parse(date) - Date.now()) / 86400000);
  if (days <= 0) return 'Open now';
  if (days < 365) return `${days}d · ${date.slice(5)}`;
  return date;
}

/**
 * "Still open?" — the chance a call is *unclaimed* once every pending batch has
 * resolved, which is the only probability a prospective filer can act on.
 *
 * The grid previously showed the leading rival's own win probability. That
 * number is real but answers someone else's question: seeing "50%" next to a
 * call invites you to read it as your odds, when it actually meant a stranger
 * had a coin-flip on it. Survival is the complement of everything claimed, and
 * it is what decides whether filing is worth $35.
 */
export function OpenOdds({
  row,
  compact = false,
}: {
  row: { survive_p: number; claimed_p: number; pending_count: number; eligible_pending?: number; status: string };
  compact?: boolean;
}) {
  const st = statusDef(row.status);
  if (st.dim || !['NEVER_ISSUED', 'AVAILABLE', 'AVAILABLE_CONTESTED', 'PENDING'].includes(row.status)) {
    return <span className="mono" style={{ fontSize: 11, color: 'var(--fg3)' }}>—</span>;
  }
  // A call whose only filings will be dismissed is uncontested, whatever the
  // raw count says. Showing "100% open" beside "2 competitors" reads as a
  // contradiction; saying it is uncontested is both simpler and truer.
  const live = row.eligible_pending ?? row.pending_count;
  if (row.pending_count > 0 && live === 0) {
    return (
      <span
        className="mono"
        style={{ fontSize: 11, color: 'var(--s-avail)', whiteSpace: 'nowrap' }}
        title={`${row.pending_count} application${row.pending_count === 1 ? '' : 's'} on file, none of which can be granted this call — filed too early, or the applicant is not eligible for it.`}
      >
        ● uncontested*
      </span>
    );
  }
  if (row.pending_count === 0) {
    return (
      <span className="mono" style={{ fontSize: 11, color: 'var(--s-avail)', whiteSpace: 'nowrap' }}>
        ● uncontested
      </span>
    );
  }
  const s = row.survive_p;
  const c = s >= 0.9 ? 'var(--s-avail)' : s >= 0.5 ? 'var(--p-mid)' : 'var(--p-low)';
  return (
    <div
      title={`${(row.claimed_p * 100).toFixed(1)}% of this call is already spoken for by the ${row.pending_count} pending application${row.pending_count === 1 ? '' : 's'}, leaving a ${(s * 100).toFixed(1)}% chance it is still unclaimed when your batch runs.`}
      style={{
        position: 'relative',
        height: compact ? 16 : 18,
        minWidth: compact ? 92 : 130,
        background: 'var(--bg3)',
        borderRadius: 3,
        overflow: 'hidden',
        border: '1px solid var(--line)',
      }}
    >
      <div style={{ position: 'absolute', inset: '0 auto 0 0', width: `${s * 100}%`, background: `color-mix(in srgb, ${c} 78%, transparent)` }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--fg)',
        }}
      >
        <span>{(s * 100).toFixed(0)}%</span>
        <span style={{ fontSize: 8, letterSpacing: '.5px', color: 'var(--fg2)' }}>
          {s >= 0.9 ? 'OPEN' : s >= 0.5 ? 'LIKELY' : 'TIGHT'}
        </span>
      </div>
    </div>
  );
}
