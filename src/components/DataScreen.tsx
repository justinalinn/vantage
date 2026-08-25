'use client';

import React from 'react';
import { Spinner } from './primitives';

/**
 * Update control.
 *
 * Two things happen on a schedule and both can be forced from here:
 *
 *   - **FCC check** — ask whether new bulk files exist and apply them. Cheap,
 *     safe, frequent.
 *   - **ULS lookup** — read the preference lists the FCC has announced but not
 *     yet published. Needs a real browser, so it is slower and deliberately
 *     rate-limited; off by default.
 *
 * The schedule lives in the database rather than in systemd, which is why it is
 * editable here at all.
 */

const POLL_MS = 4000;

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return 'never';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export default function DataScreen() {
  const [st, setSt] = React.useState<any>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await fetch('/api/admin/update');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'request failed');
      setSt(j);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }, []);

  React.useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const trigger = async (what: 'bulk' | 'scrape') => {
    setBusy(what);
    try {
      const r = await fetch('/api/admin/update', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ what }),
      });
      const j = await r.json();
      if (!r.ok) setErr(j.reason ?? j.error ?? 'could not start');
      else setErr(null);
    } finally {
      setBusy(null);
      setTimeout(load, 600);
    }
  };

  const patch = async (p: Record<string, unknown>) => {
    const r = await fetch('/api/admin/schedule', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    });
    const j = await r.json();
    if (j.schedule) setSt((s: any) => ({ ...s, schedule: j.schedule }));
  };

  if (err && !st) {
    return (
      <main style={{ padding: 24, maxWidth: 700, margin: '0 auto' }}>
        <h1 style={{ fontSize: 19 }}>Updates</h1>
        <div className="card" style={{ padding: 16, borderLeft: '3px solid var(--s-anomaly)' }}>
          <div style={{ fontSize: 13, color: 'var(--fg2)', lineHeight: 1.6 }}>{err}</div>
        </div>
      </main>
    );
  }
  if (!st) return <Spinner label="Reading update status…" />;

  const s = st.schedule;
  const running = st.running.bulk || st.running.scrape;

  return (
    <main
      className="van-in"
      style={{ padding: '18px clamp(12px,3vw,24px) 40px', maxWidth: 980, margin: '0 auto', width: '100%' }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Updates</h1>
        <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Run one now, or change how often they run.</span>
      </div>

      {err && (
        <div
          className="card"
          style={{ padding: '10px 14px', marginTop: 12, borderLeft: '3px solid var(--s-anomaly)', fontSize: 12.5, color: 'var(--fg2)' }}
        >
          {err}
        </div>
      )}

      {/* ------------------------------------------------------- run now */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 14 }}>
        <div className="card" style={{ padding: '16px 18px', borderLeft: '3px solid var(--s-avail)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>FCC bulk check</div>
          <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55, margin: '6px 0 10px' }}>
            Asks whether the FCC has published new transaction files and applies them. The site keeps serving the
            previous data throughout — the whole rebuild happens in one transaction.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 10 }}>
            Last checked <b style={{ color: 'var(--fg2)' }}>{ago(st.lastBulkCheck)}</b> · last applied{' '}
            <b style={{ color: 'var(--fg2)' }}>{ago(st.lastRefresh)}</b>
          </div>
          <button
            className="btn btn-primary"
            disabled={st.running.bulk || busy === 'bulk'}
            onClick={() => trigger('bulk')}
          >
            {st.running.bulk ? 'Running…' : 'Check the FCC now'}
          </button>
        </div>

        <div className="card" style={{ padding: '16px 18px', borderLeft: '3px solid var(--s-upcoming)' }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>ULS lookup</div>
          <div style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55, margin: '6px 0 10px' }}>
            Reads the preference lists for applications the FCC has announced but not yet detailed. Needs a real browser
            and is rate-limited, so it takes a few minutes.
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginBottom: 10 }}>
            <b style={{ color: st.awaitingPrefs ? 'var(--s-upcoming)' : 'var(--fg2)' }}>{st.awaitingPrefs}</b> waiting ·
            last run <b style={{ color: 'var(--fg2)' }}>{ago(st.lastScrape)}</b>
          </div>
          <button
            className="btn btn-primary"
            disabled={st.running.scrape || busy === 'scrape' || st.awaitingPrefs === 0}
            onClick={() => trigger('scrape')}
          >
            {st.running.scrape ? 'Running…' : 'Look up now'}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ schedule */}
      <div className="panel-title" style={{ margin: '24px 0 10px' }}>
        Schedule
      </div>
      <div className="card" style={{ padding: '16px 18px' }}>
        <Row label="Check the FCC every">
          <select
            value={s.bulkIntervalMin}
            onChange={(e) => patch({ bulkIntervalMin: Number(e.target.value) })}
            style={{ fontSize: 12.5, padding: '4px 8px' }}
          >
            {[15, 30, 60, 120, 360, 720, 1440].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : m === 60 ? 'hour' : m < 1440 ? `${m / 60} hours` : 'day'}
              </option>
            ))}
          </select>
          <Note>
            The FCC publishes once a weekday, at a time that moves around. Checking often costs six HEAD requests and
            catches it promptly.
          </Note>
        </Row>

        <Row label="Read ULS for undisclosed filings">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={s.scrapeEnabled}
              onChange={(e) => patch({ scrapeEnabled: e.target.checked })}
            />
            {s.scrapeEnabled ? 'Enabled' : 'Disabled'}
          </label>
          <Note>
            Off by default. When on, this is the only way to see applications filed today — the bulk feed does not carry
            them for another publication cycle.
          </Note>
        </Row>

        {s.scrapeEnabled && (
          <>
            <Row label="…every">
              <select
                value={s.scrapeIntervalMin}
                onChange={(e) => patch({ scrapeIntervalMin: Number(e.target.value) })}
                style={{ fontSize: 12.5, padding: '4px 8px' }}
              >
                {[60, 180, 360, 720, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m < 1440 ? `${m / 60} hours` : 'day'}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="…only between 22:00 and 06:00">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5 }}>
                <input
                  type="checkbox"
                  checked={s.scrapeOffHoursOnly}
                  onChange={(e) => patch({ scrapeOffHoursOnly: e.target.checked })}
                />
                {s.scrapeOffHoursOnly ? 'Off-hours only' : 'Any time'}
              </label>
              <Note>
                ULS is slow and shared. The site this one is measured against limits its own reads to off-hours for the
                same reason.
              </Note>
            </Row>
            <Row label="Pages per run / delay">
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={s.scrapeMaxPages}
                  onChange={(e) => patch({ scrapeMaxPages: Number(e.target.value) })}
                  style={{ width: 74, fontSize: 12.5, padding: '4px 6px' }}
                />
                <span style={{ fontSize: 12, color: 'var(--fg3)' }}>pages, every</span>
                <input
                  type="number"
                  min={2}
                  max={120}
                  value={s.scrapeDelaySec}
                  onChange={(e) => patch({ scrapeDelaySec: Number(e.target.value) })}
                  style={{ width: 62, fontSize: 12.5, padding: '4px 6px' }}
                />
                <span style={{ fontSize: 12, color: 'var(--fg3)' }}>seconds</span>
              </span>
            </Row>
          </>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 12, lineHeight: 1.6 }}>
          {st.scrapeDue?.due
            ? 'A ULS lookup is due and will run on the next tick.'
            : `ULS lookup: ${st.scrapeDue?.reason ?? '—'}.`}{' '}
          A timer checks every 15 minutes and acts only when something is due.
        </div>
      </div>

      {/* ---------------------------------------------------------- logs */}
      <div className="panel-title" style={{ margin: '24px 0 10px' }}>
        Recent activity {running && <span style={{ color: 'var(--s-avail)' }}>· running</span>}
      </div>
      {Array.isArray(st.scrapeHistory) && st.scrapeHistory.length > 0 && (
        <div className="card van-scroll" style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table className="grid dense" style={{ fontSize: 11.5, minWidth: 520 }}>
            <thead>
              <tr>
                {['Started', 'Looked up', 'Found', 'Empty', 'Failed', 'Result'].map((h) => (
                  <th key={h} style={{ cursor: 'default' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {st.scrapeHistory.map((r: any) => (
                <tr key={r.id} className="row">
                  <td className="mono">{String(r.started_at).slice(0, 16).replace('T', ' ')}</td>
                  <td className="mono tnum">{r.attempted}</td>
                  <td className="mono tnum" style={{ color: r.resolved ? 'var(--s-avail)' : undefined }}>
                    {r.resolved}
                  </td>
                  <td className="mono tnum">{r.empty}</td>
                  <td className="mono tnum" style={{ color: r.failed ? 'var(--s-anomaly)' : undefined }}>
                    {r.failed}
                  </td>
                  <td style={{ color: 'var(--fg2)' }}>{r.note ?? (r.ended_at ? '' : 'running')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(['bulk', 'scrape'] as const).map((k) =>
        st.log?.[k] ? (
          <div key={k} className="card" style={{ padding: '12px 14px', marginBottom: 10 }}>
            <div className="panel-title" style={{ marginBottom: 8 }}>
              {k === 'bulk' ? 'FCC check log' : 'ULS lookup log'}
            </div>
            <pre
              className="mono van-scroll"
              style={{
                margin: 0,
                fontSize: 10.5,
                lineHeight: 1.55,
                color: 'var(--fg2)',
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {st.log[k]}
            </pre>
          </div>
        ) : null,
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'baseline',
        padding: '9px 0',
        borderBottom: '1px solid var(--line)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 12.5, minWidth: 220, color: 'var(--fg)' }}>{label}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</span>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 11, color: 'var(--fg3)', lineHeight: 1.5, maxWidth: 520 }}>{children}</span>;
}
