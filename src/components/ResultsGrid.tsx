'use client';

import React from 'react';
import { STATUS, STATUS_ORDER, statusDef, fmtPct } from '@/lib/ui/status';
import type { SearchRow } from '@/lib/query/search';
import {
  Empty,
  MethodBadge,
  OpenOdds,
  Radial,
  REGION_LABEL,
  SkeletonRows,
  StatusChip,
  availLabel,
  useMediaQuery,
} from './primitives';

export interface GridProps {
  rows: SearchRow[];
  total: number;
  shape: Array<{ status: string; count: number }>;
  loading: boolean;
  dense: boolean;
  selected: Set<string>;
  pref: string[];
  sort: string;
  dir: 'asc' | 'desc';
  onSort: (k: string) => void;
  onToggle: (call: string) => void;
  onOpen: (call: string) => void;
  onAddToPref: (call: string) => void;
  onWatch: (call: string) => void;
}

const COLUMNS: Array<{ key: string; label: string; align?: 'right'; cls?: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'call', label: 'Call' },
  { key: 'format', label: 'Fmt' },
  { key: 'region', label: 'Region', cls: 'col-region' },
  { key: 'grp', label: 'Grp', cls: 'col-grp' },
  { key: 'avail', label: 'Available' },
  { key: 'comp', label: 'Comp', align: 'right' },
  { key: 'morse', label: 'CW', align: 'right', cls: 'col-morse' },
  { key: 'des', label: 'Score', align: 'right' },
  { key: 'open', label: 'Still open?' },
];

export function ShapeBar({ shape, total, approximate }: { shape: Array<{ status: string; count: number }>; total: number; approximate?: boolean }) {
  const sum = shape.reduce((s, x) => s + x.count, 0) || 1;
  const ordered = STATUS_ORDER.map((k) => shape.find((s) => s.status === k)).filter(Boolean) as Array<{
    status: string;
    count: number;
  }>;
  return (
    <div className="shapebar">
      <span className="mono tnum" style={{ fontSize: 11, color: 'var(--fg3)', whiteSpace: 'nowrap' }}>
        {total.toLocaleString()}{approximate ? '+' : ''} results
      </span>
      <div className="shapetrack">
        {ordered.map((s) => (
          <div
            key={s.status}
            title={`${statusDef(s.status).label}: ${s.count.toLocaleString()}`}
            style={{ width: `${(s.count / sum) * 100}%`, background: statusDef(s.status).color }}
          />
        ))}
      </div>
      <div className="legend">
        {ordered.slice(0, 5).map((s) => (
          <span key={s.status}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: statusDef(s.status).color }} />
            {statusDef(s.status).label} {s.count.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ResultsGrid(p: GridProps) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 720px)');

  if (!p.loading && p.rows.length === 0) {
    return (
      <Empty
        title="No callsigns match that query"
        hint="Try widening it — for example “2x2 never issued”, “region 6 available”, or a pattern like K?A*."
      />
    );
  }

  if (isMobile) {
    return (
      <div className="cardlist">
        {p.loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="callcard">
                <div className="skeleton" style={{ width: '55%', height: 18 }} />
                <div className="skeleton" style={{ width: '80%' }} />
              </div>
            ))
          : p.rows.map((r) => {
              const st = statusDef(r.status);
              const inPref = p.pref.includes(r.call);
              return (
                <div key={r.call} className="callcard">
                  <div className="callcard-top">
                    <button
                      onClick={() => p.onOpen(r.call)}
                      className="call"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--fg)',
                        fontSize: 22,
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {r.call}
                    </button>
                    <StatusChip status={r.status} />
                  </div>
                  <div className="callcard-meta">
                    <span>
                      Fmt <b>{r.format}</b>
                    </span>
                    <span>
                      Grp <b>{r.grp}</b>
                    </span>
                    <span>
                      Region <b>{REGION_LABEL[r.region] ?? r.region}</b>
                    </span>
                    <span>
                      CW <b>{r.morse}</b>
                    </span>
                    <span>
                      Score <b>{r.desirability}</b>
                    </span>
                  </div>
                  <div className="callcard-meta">
                    <span>
                      Available <b>{availLabel(r.status, r.available_date)}</b>
                    </span>
                    {r.pending_count > 0 && (
                      <span>
                        Competitors{' '}
                        <b>
                          {r.eligible_pending < r.pending_count
                            ? `${r.eligible_pending} of ${r.pending_count}`
                            : r.pending_count}
                        </b>
                      </span>
                    )}
                  </div>
                  <OpenOdds row={r} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => p.onOpen(r.call)}>
                      Detail
                    </button>
                    <button className="btn" onClick={() => p.onWatch(r.call)}>
                      ☆ Watch
                    </button>
                    {st.applyable && (
                      <button
                        className={inPref ? 'btn' : 'btn btn-primary'}
                        disabled={inPref}
                        onClick={() => p.onAddToPref(r.call)}
                      >
                        {inPref ? '✓ In list' : '+ Add'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
      </div>
    );
  }

  return (
    <div className="van-scroll" style={{ overflow: 'auto', flex: 1 }}>
      <table className={`grid ${p.dense ? 'dense' : 'comfy'}`} style={{ fontSize: p.dense ? 12 : 13 }}>
        <thead>
          <tr>
            <th style={{ width: 34 }} aria-label="select" />
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={c.cls}
                onClick={() => p.onSort(c.key)}
                style={{ textAlign: c.align ?? 'left' }}
                aria-sort={p.sort === c.key ? (p.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {c.label}
                  <span style={{ color: 'var(--accent)', fontSize: 9 }}>
                    {p.sort === c.key ? (p.dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </span>
              </th>
            ))}
            <th style={{ width: 28 }} aria-label="expand" />
          </tr>
        </thead>
        <tbody>
          {p.loading ? (
            <SkeletonRows n={14} cols={COLUMNS.length + 2} />
          ) : (
            p.rows.map((r) => {
              const st = statusDef(r.status);
              const isOpen = expanded === r.call;
              const sel = p.selected.has(r.call);
              const inPref = p.pref.includes(r.call);
              return (
                <React.Fragment key={r.call}>
                  <tr
                    className={`row${sel ? ' sel' : ''}`}
                    style={{ cursor: 'pointer', opacity: st.dim ? 0.72 : 1 }}
                    onClick={() => setExpanded(isOpen ? null : r.call)}
                  >
                    <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => p.onToggle(r.call)}
                        aria-label={`Select ${r.call}`}
                        style={{ accentColor: 'var(--accent)', width: 14, height: 14, cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <StatusChip status={r.status} size="sm" />
                    </td>
                    <td>
                      <span
                        role="button"
                        tabIndex={0}
                        className="call"
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onOpen(r.call);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') p.onOpen(r.call);
                        }}
                        style={{ fontSize: p.dense ? 13 : 14, cursor: 'pointer', borderBottom: '1px dotted var(--line2)' }}
                      >
                        {r.call}
                      </span>
                    </td>
                    <td className="mono" style={{ color: 'var(--fg2)', fontSize: 11 }}>
                      {r.format}
                    </td>
                    <td className="col-region" style={{ color: 'var(--fg2)' }}>
                      {REGION_LABEL[r.region] ?? r.region}
                    </td>
                    <td className="mono col-grp" style={{ color: 'var(--fg2)', fontSize: 11 }}>
                      {r.grp}
                    </td>
                    <td className="tnum" style={{ color: 'var(--fg2)' }}>
                      {availLabel(r.status, r.available_date)}
                    </td>
                    <td
                      className="mono tnum"
                      style={{ textAlign: 'right', color: 'var(--fg2)' }}
                      title={
                        r.pending_count > 0 && r.eligible_pending < r.pending_count
                          ? `${r.pending_count} filed, but only ${r.eligible_pending} could actually be granted it — the rest are too early, region-locked or class-locked.`
                          : undefined
                      }
                    >
                      {r.pending_count
                        ? r.eligible_pending < r.pending_count
                          ? `${r.eligible_pending}/${r.pending_count}`
                          : r.pending_count
                        : '—'}
                    </td>
                    <td className="mono tnum col-morse" style={{ textAlign: 'right', color: 'var(--fg2)' }}>
                      {r.morse}
                    </td>
                    <td className="mono tnum" style={{ textAlign: 'right', color: 'var(--fg2)' }}>
                      {r.desirability}
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <OpenOdds row={r} compact={p.dense} />
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--fg3)', fontSize: 11 }}>{isOpen ? '▾' : '▸'}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={COLUMNS.length + 2} style={{ padding: 0, background: 'var(--bg)' }}>
                        <div
                          className="van-in"
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'auto 1fr auto',
                            gap: 24,
                            padding: '16px 20px 18px 56px',
                            borderBottom: `2px solid ${st.color}`,
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                            <Radial p={r.survive_p} label="STILL OPEN" />
                            {r.pending_count > 0 && <MethodBadge method={r.method} />}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'center' }}>
                            <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 620, color: 'var(--fg2)' }}>
                              {st.blurb}
                              {r.pending_count > 0 && r.eligible_pending === 0 && (
                                <>
                                  {' '}
                                  <b style={{ color: 'var(--s-never)' }}>
                                    All {r.pending_count} filing{r.pending_count === 1 ? '' : 's'} for this call are
                                    ineligible — filed before it opened, or barred by region or licence class. Nobody
                                    currently in the queue can win it.
                                  </b>
                                </>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 22, fontSize: 12, flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--fg2)' }}>
                                Competitors <b className="mono" style={{ color: 'var(--fg)' }}>{r.pending_count}</b>
                              </span>
                              <span style={{ color: 'var(--fg2)' }}>
                                Available <b className="mono" style={{ color: 'var(--fg)' }}>{availLabel(r.status, r.available_date)}</b>
                              </span>
                              <span style={{ color: 'var(--fg2)' }}>
                                Already claimed <b className="mono" style={{ color: 'var(--fg)' }}>{(r.claimed_p * 100).toFixed(1)}%</b>
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                            <button className="btn" onClick={() => p.onOpen(r.call)}>
                              Open full detail →
                            </button>
                            <button className="btn" onClick={() => p.onWatch(r.call)}>
                              ☆ Add to watchlist
                            </button>
                            <button
                              className={inPref || !st.applyable ? 'btn' : 'btn btn-primary'}
                              disabled={inPref || !st.applyable}
                              onClick={() => p.onAddToPref(r.call)}
                            >
                              {!st.applyable ? 'Not eligible' : inPref ? '✓ In preference list' : '+ Add to preference list'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
