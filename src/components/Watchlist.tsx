'use client';

import React from 'react';
import { fmtPct } from '@/lib/ui/status';
import { Empty, ProbabilityMeter, REGION_LABEL, Spinner, StatusChip, availLabel } from './primitives';

export default function Watchlist({ onOpen, refreshKey }: { onOpen: (call: string) => void; refreshKey: number }) {
  const [rows, setRows] = React.useState<any[] | null>(null);

  const load = React.useCallback(() => {
    fetch('/api/watchlist')
      .then((r) => r.json())
      .then((j) => setRows(j.rows));
  }, []);

  React.useEffect(load, [load, refreshKey]);

  const remove = async (call: string) => {
    await fetch(`/api/watchlist?call=${encodeURIComponent(call)}`, { method: 'DELETE' });
    load();
  };

  if (!rows) return <Spinner />;
  if (rows.length === 0) {
    return (
      <Empty
        title="Nothing on your watchlist"
        hint="Track a call and this page tells you the moment it clears its hold, when a rival files against it, and when its batch resolves."
      />
    );
  }

  const actionable = rows.filter((r) => ['AVAILABLE', 'AVAILABLE_CONTESTED', 'NEVER_ISSUED'].includes(r.status));
  const waiting = rows.filter((r) => !['AVAILABLE', 'AVAILABLE_CONTESTED', 'NEVER_ISSUED'].includes(r.status));

  const Section = ({ title, list, tone }: { title: string; list: any[]; tone: string }) =>
    list.length === 0 ? null : (
      <>
        <div className="panel-title" style={{ margin: '18px 0 10px', color: tone }}>
          {title} — {list.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((r) => (
            <div key={r.call} className="card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => onOpen(r.call)}
                  className="call"
                  style={{ background: 'none', border: 'none', color: 'var(--fg)', fontSize: 19, cursor: 'pointer', padding: 0 }}
                >
                  {r.call}
                </button>
                <StatusChip status={r.status ?? 'ACTIVE'} showLabel />
                <div style={{ flex: 1 }} />
                {r.p != null && <ProbabilityMeter p={r.p} compact />}
                <button className="btn btn-ghost" onClick={() => remove(r.call)} aria-label={`Stop watching ${r.call}`}>
                  ×
                </button>
              </div>
              <div className="callcard-meta" style={{ marginTop: 8 }}>
                <span>
                  Available <b>{availLabel(r.status ?? '', r.available_date)}</b>
                </span>
                {r.pending_count > 0 && (
                  <span>
                    Rivals <b>{r.pending_count}</b>
                  </span>
                )}
                {r.format && (
                  <span>
                    Fmt <b>{r.format}</b>
                  </span>
                )}
                {r.region != null && (
                  <span>
                    Region <b>{REGION_LABEL[r.region] ?? r.region}</b>
                  </span>
                )}
                {r.desirability != null && (
                  <span>
                    Score <b>{r.desirability}</b>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </>
    );

  return (
    <main className="van-in" style={{ padding: '18px clamp(12px,3vw,24px)', maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Watchlist</h1>
      <p style={{ fontSize: 12, color: 'var(--fg2)', marginTop: 6, lineHeight: 1.55 }}>
        A call opening up in fourteen months is useless information unless something reminds you. Everything you track
        is re-evaluated on each data refresh.
      </p>
      <Section title="Actionable now" list={actionable} tone="var(--s-avail)" />
      <Section title="Waiting" list={waiting} tone="var(--fg3)" />
    </main>
  );
}
