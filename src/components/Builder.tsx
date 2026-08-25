'use client';

import React from 'react';
import { fmtPct, pColor, statusDef } from '@/lib/ui/status';
import { Empty, MethodBadge, Stat, StatusChip } from './primitives';

interface Props {
  pref: string[];
  setPref: (calls: string[]) => void;
  onOpen: (call: string) => void;
}

interface Slot {
  rank: number;
  call: string;
  utility: number;
  p: number;
  reachBefore: number;
  marginal: number;
}

export default function Builder({ pref, setPref, onOpen }: Props) {
  const [data, setData] = React.useState<any>(null);
  const [diff, setDiff] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const evaluate = React.useCallback(async (calls: string[]) => {
    if (calls.length === 0) {
      setData(null);
      return;
    }
    setBusy(true);
    const r = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls }),
    }).then((x) => x.json());
    setData(r);
    setBusy(false);
  }, []);

  React.useEffect(() => {
    evaluate(pref);
  }, [pref, evaluate]);

  const optimize = async () => {
    setBusy(true);
    const r = await fetch('/api/portfolio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ calls: pref, optimize: true }),
    }).then((x) => x.json());
    setDiff(r);
    setPref(r.order);
    setBusy(false);
  };

  const move = (from: string, to: string) => {
    if (from === to) return;
    const arr = [...pref];
    const i = arr.indexOf(from);
    const j = arr.indexOf(to);
    if (i < 0 || j < 0) return;
    arr.splice(j, 0, arr.splice(i, 1)[0]);
    setPref(arr);
    setDiff(null);
  };

  const nudge = (call: string, delta: number) => {
    const arr = [...pref];
    const i = arr.indexOf(call);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setPref(arr);
    setDiff(null);
  };

  if (pref.length === 0) {
    return (
      <Empty
        title="Your preference list is empty"
        hint="The FCC lets you rank up to 25 callsigns on one $35 application. Add candidates from the grid, then let the optimiser order them."
      />
    );
  }

  const slots: Slot[] = data?.slots ?? [];
  const maxMarginal = Math.max(...slots.map((s) => s.marginal), 0.0001);

  return (
    <main
      className="builder-grid van-in"
      style={{ display: 'grid', gridTemplateColumns: '1fr 320px', height: 'calc(100dvh - 52px)' }}
    >
      <div className="van-scroll" style={{ overflow: 'auto', borderRight: '1px solid var(--line)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px clamp(12px,3vw,20px)',
            position: 'sticky',
            top: 0,
            background: 'var(--bg2)',
            borderBottom: '1px solid var(--line)',
            zIndex: 5,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Preference list</div>
            <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>
              {pref.length}/25 slots · one $35 filing · drag or use ↑↓ to reorder
            </div>
          </div>
          <button className="btn btn-primary" onClick={optimize} disabled={busy}>
            ◆ Optimise for me
          </button>
        </div>

        {diff && (
          <div
            className="van-in"
            style={{
              margin: '12px clamp(12px,3vw,20px)',
              padding: '12px 16px',
              background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 8 }}>
              ◆ Reordered {diff.moved} slot{diff.moved === 1 ? '' : 's'} by descending desirability
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--fg2)' }}>
                Expected value{' '}
                <b className="mono" style={{ color: 'var(--fg3)' }}>{diff.before.expectedUtility.toFixed(1)}</b>
                <span style={{ color: 'var(--accent)' }}> → {diff.after.expectedUtility.toFixed(1)}</span>
              </span>
              <span style={{ color: 'var(--fg2)' }}>
                P(top-3) <b className="mono" style={{ color: 'var(--fg3)' }}>{fmtPct(diff.before.pTop3)}</b>
                <span style={{ color: 'var(--accent)' }}> → {fmtPct(diff.after.pTop3)}</span>
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 8, lineHeight: 1.5 }}>
              Ordering by desirability is provably optimal here: if you lose a contested call you simply fall through to
              your next choice, so a long shot at slot 1 costs nothing.
            </div>
          </div>
        )}

        <div style={{ padding: '8px clamp(12px,3vw,20px) 24px' }}>
          {slots.map((s) => {
            const st = statusDef('AVAILABLE');
            return (
              <div
                key={s.call}
                draggable
                onDragStart={() => setDragId(s.call)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId) move(dragId, s.call);
                }}
                onDragEnd={() => setDragId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  marginBottom: 6,
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  opacity: dragId === s.call ? 0.5 : 1,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ color: 'var(--fg3)', cursor: 'grab', fontSize: 14 }} aria-hidden>
                  ⠿
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--fg3)', width: 22, textAlign: 'right' }}>
                  {s.rank}
                </span>
                <button
                  onClick={() => onOpen(s.call)}
                  className="call"
                  style={{ background: 'none', border: 'none', color: 'var(--fg)', fontSize: 15, cursor: 'pointer', width: 86, textAlign: 'left' }}
                >
                  {s.call}
                </button>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 150 }}>
                  <div style={{ flex: 1, maxWidth: 160, height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.p * 100}%`, background: pColor(s.p) }} />
                  </div>
                  <span className="mono tnum" style={{ fontSize: 12, width: 52, textAlign: 'right' }}>
                    {fmtPct(s.p)}
                  </span>
                </div>
                <span className="mono tnum" title="desirability" style={{ fontSize: 11, color: 'var(--fg2)', width: 42, textAlign: 'right' }}>
                  v{s.utility}
                </span>
                <span
                  className="mono tnum"
                  title="How much this slot adds to P(get anything)"
                  style={{ fontSize: 11, color: 'var(--s-avail)', width: 56, textAlign: 'right' }}
                >
                  +{(s.marginal * 100).toFixed(1)}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => nudge(s.call, -1)} aria-label={`Move ${s.call} up`}>
                    ↑
                  </button>
                  <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={() => nudge(s.call, 1)} aria-label={`Move ${s.call} down`}>
                    ↓
                  </button>
                  <button
                    className="iconbtn"
                    style={{ width: 26, height: 26 }}
                    onClick={() => setPref(pref.filter((c) => c !== s.call))}
                    aria-label={`Remove ${s.call}`}
                  >
                    ×
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="van-scroll builder-aside" style={{ overflow: 'auto', padding: '18px 18px 28px', background: 'var(--bg2)' }}>
        <div className="panel-title" style={{ marginBottom: 14 }}>
          Portfolio outcome
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
          <Stat label="P(get anything)" value={fmtPct(data?.pAny)} sub="across all slots" color="var(--s-avail)" />
          <Stat label="P(first choice)" value={fmtPct(data?.pFirst)} sub={pref[0]} />
          <Stat label="P(top three)" value={fmtPct(data?.pTop3)} sub={pref.slice(0, 3).join(' · ')} />
          <Stat
            label="Expected value"
            value={(data?.expectedUtility ?? 0).toFixed(1)}
            sub="desirability-weighted"
            color="var(--accent)"
          />
        </div>

        <div style={{ padding: 14, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--fg2)', marginBottom: 10 }}>Marginal gain by slot</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 78 }}>
            {slots.map((s) => (
              <div
                key={s.call}
                title={`${s.call}: +${(s.marginal * 100).toFixed(2)}% to P(any)`}
                style={{
                  flex: 1,
                  height: `${Math.max(2, (s.marginal / maxMarginal) * 100)}%`,
                  minHeight: 2,
                  background: s.marginal > 0.001 ? 'var(--accent)' : 'var(--line2)',
                  borderRadius: '2px 2px 0 0',
                }}
              />
            ))}
          </div>
          <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--fg3)', marginTop: 6 }}>
            <span>slot 1</span>
            <span>diminishing returns →</span>
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <MethodBadge method={data?.method} />
          <span style={{ fontSize: 11, color: 'var(--fg3)' }}>
            {data?.fieldSize ?? 0} rival application{data?.fieldSize === 1 ? '' : 's'} modelled
          </span>
        </div>

        <p style={{ marginTop: 14, fontSize: 11, color: 'var(--fg3)', lineHeight: 1.55 }}>
          Slots are free. Every additional call can only raise P(get anything), never lower it — so the only real mistake
          is leaving slots empty. Order by what you actually want, not by what you think you can get.
        </p>
      </aside>
    </main>
  );
}
