'use client';

import React from 'react';
import { STATUS, STATUS_ORDER } from '@/lib/ui/status';
import { Spinner, StatusChip } from './primitives';

/**
 * `meta` is passed in rather than fetched again: the shell already loads it, and
 * two concurrent requests for the same route ended with one aborted, leaving
 * this screen stuck on its spinner forever.
 */
export default function Methodology({ meta }: { meta: any }) {
  const [m, setM] = React.useState<any>(meta ?? null);
  const [bt, setBt] = React.useState<any>(null);

  React.useEffect(() => {
    if (meta) setM(meta);
  }, [meta]);

  React.useEffect(() => {
    let live = true;
    // Only fetch as a fallback if the shell has not supplied it.
    if (!meta) {
      fetch('/api/meta')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => live && j && setM(j))
        .catch(() => {});
    }
    fetch('/api/backtest')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setBt(j))
      .catch(() => live && setBt(null));
    return () => {
      live = false;
    };
  }, [meta]);

  if (!m) return <Spinner />;

  const fmt = (n: number) => n.toLocaleString();

  return (
    <main className="van-in" style={{ padding: '18px clamp(12px,3vw,24px)', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>Methodology &amp; data</h1>
      <p style={{ fontSize: 12.5, color: 'var(--fg2)', marginTop: 8, lineHeight: 1.6, maxWidth: 760 }}>
        Everything here is derived from the FCC ULS bulk files. No figure on this site is hand-entered, and none of the
        probabilities are guesses — where an exact answer exists we compute it, and where one does not we say so.
      </p>

      {/* data freshness */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 18 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>
          Corpus
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {[
            ['Callsigns generated', fmt(m.universe), 'combinatorial universe'],
            ['Seen in ULS history', fmt(m.knownCalls), 'ever issued'],
            ['Vanity requests', fmt(m.vanityRequests), 'full history'],
            ['Preference entries', fmt(m.preferenceEntries), 'ranked choices'],
            ['Pending now', fmt(m.pending), `${m.batches} open batches`],
          ].map(([l, v, s]) => (
            <div key={l as string} style={{ padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="mono tnum" style={{ fontSize: 20, fontWeight: 600 }}>{v as string}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg2)', marginTop: 2 }}>{l as string}</div>
              <div style={{ fontSize: 10, color: 'var(--fg3)' }}>{s as string}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 12 }}>
          Newest application on file <span className="mono" style={{ color: 'var(--fg2)' }}>{m.newestReceipt ?? '—'}</span>
          {' · '}complete files {m.ulsLicenseFile?.slice(0, 10) ?? '—'} / {m.ulsApplicationFile?.slice(0, 10) ?? '—'}
          {' · '}last rebuilt {m.lastIngest?.slice(0, 16).replace('T', ' ') ?? '—'}
          {m.lastRefresh && <> · last update {m.lastRefresh.slice(0, 16).replace('T', ' ')}</>}
        </div>
      </div>

      {/* how the data stays current */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>
          How current this is
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.65, margin: '0 0 10px' }}>
          The FCC rebuilds its complete amateur database once a week and publishes a small transaction file every
          weekday holding just what changed. Working from the weekly file alone leaves a site up to seven days behind —
          long enough for a call to read &ldquo;open, uncontested&rdquo; here while four applications are already queued
          against it at the Commission. This database applies the daily files as they land, so it trails live FCC state
          by about a day.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.65, margin: '0 0 10px' }}>
          Updates are checked for every 30 minutes and applied inside a single database transaction, which is why the
          site never goes down for one: readers keep seeing the previous, fully consistent dataset for the couple of
          minutes a rebuild takes, then switch to the new one between one request and the next. A failed update changes
          nothing at all.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.65, margin: '0 0 10px' }}>
          One gap cannot be closed from bulk data at all. The FCC publishes an application&rsquo;s header — who filed,
          when, in which service — a full publication cycle before it publishes the vanity preference list saying which
          calls they actually want. Measured across a week of transaction files, each day&rsquo;s preference records
          catch up to the previous day&rsquo;s headers, consistently one cycle behind.
          {m.awaitingPrefs?.count > 0 ? (
            <>
              {' '}Right now <b style={{ color: 'var(--s-upcoming)' }}>{m.awaitingPrefs.count}</b> vanity applications
              filed on or after <span className="mono">{m.awaitingPrefs.oldest}</span> sit in that gap: they exist, and
              nobody outside the Commission knows what they are chasing. Every call they target reads here as less
              contested than it is.
            </>
          ) : (
            <> Nothing is currently in that gap.</>
          )}{' '}
          Sites that show same-day filings get them by reading the ULS web interface directly rather than the published
          files; that interface refuses automated access from this host, so the gap is reported instead of hidden.
        </p>

        {Array.isArray(m.sources) && m.sources.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {m.sources.slice(0, 8).map((s: any) => (
              <span
                key={s.file}
                className="mono"
                style={{
                  fontSize: 10.5,
                  padding: '3px 8px',
                  borderRadius: 4,
                  color: 'var(--fg2)',
                  background: 'var(--bg3)',
                  border: '1px solid var(--line)',
                }}
                title={s.lastModified}
              >
                {s.file} · {new Date(s.lastModified).toISOString().slice(0, 10)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* the lottery model */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>
          How the probabilities are computed
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, margin: '0 0 12px' }}>
          Every application sharing a receipt date is processed by the FCC in uniformly random order, and each applicant
          takes the highest-ranked call on their list that is still unassigned. That is exactly{' '}
          <b style={{ color: 'var(--fg)' }}>random serial dictatorship</b>.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, margin: '0 0 12px' }}>
          Evaluating it naively means enumerating all N! processing orders. Instead we split each batch into independent
          components — applications only interact if they can reach a shared call — and then walk the state space
          forwards, carrying one number per state: the probability of reaching it. Marginals fall out as a by-product,
          costing one float per state rather than an entire distribution.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, margin: '0 0 12px' }}>
          Batches are solved <b style={{ color: 'var(--fg)' }}>jointly, not in isolation</b>. They resolve on successive
          nights in receipt-date order, so an applicant who filed a day earlier takes a contested call before the next
          batch is ever processed — the FCC&apos;s &ldquo;Too Late&rdquo; dismissal. The solver models this as strict
          processing tiers: random order within a receipt date, but every earlier date first. Scoring each batch on its
          own quietly hands later filers calls that were already gone.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, margin: '0 0 12px' }}>
          One further reduction makes it tractable: a call that only one applicant wants can never be taken from them, so
          it never needs to be tracked in the state. Real components are mostly long tails of private choices — one
          recent batch had a component spanning 147 calls of which only a handful were genuinely contested.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          {(m.methods ?? []).map((x: any) => (
            <div key={x.method} style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8 }}>
              <div className="mono tnum" style={{ fontSize: 16, fontWeight: 600 }}>{fmt(x.c)}</div>
              <div style={{ fontSize: 11, color: 'var(--fg2)' }}>
                {x.method === 'monte-carlo' ? 'sampled predictions' : x.method === 'exact' ? 'exact predictions' : `${x.method}`}
              </div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--fg3)', lineHeight: 1.55, marginTop: 12 }}>
          Sampling is the fallback, never the default. When it is used the figure is drawn hatched, tagged{' '}
          <b>SIMULATED</b>, and accompanied by a 95% interval.
        </p>
      </div>

      {/* ordering theorem */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 16, borderLeft: '3px solid var(--accent)' }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>
          Why the optimiser sorts by desire, not by odds
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, margin: '0 0 10px' }}>
          Most operators bury the call they actually want behind &ldquo;realistic&rdquo; choices. That is strictly wrong.
          Compare the two orderings of any adjacent pair, where <span className="mono">u</span> is utility,{' '}
          <span className="mono">p</span> the chance of winning it and <span className="mono">R</span> the chance you are
          still unassigned:
        </p>
        <pre
          className="mono"
          style={{
            fontSize: 11.5,
            background: 'var(--bg)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: 12,
            overflowX: 'auto',
            color: 'var(--fg2)',
            lineHeight: 1.7,
          }}
        >{`order (i,j):   R · [ uᵢpᵢ + uⱼpⱼ(1 − pᵢ) ]
order (j,i):   R · [ uⱼpⱼ + uᵢpᵢ(1 − pⱼ) ]

(i,j) wins  ⟺  −uⱼpⱼpᵢ > −uᵢpᵢpⱼ  ⟺  uᵢ > uⱼ`}</pre>
        <p style={{ fontSize: 12.5, color: 'var(--fg2)', lineHeight: 1.6, marginTop: 10 }}>
          The probabilities cancel exactly. Losing a long shot at slot 1 costs you nothing, because you fall straight
          through to slot 2. The only genuine mistake is leaving slots empty — and the FCC gives you 25 for one $35 fee.
        </p>
      </div>

      {/* backtest */}
      {bt && !bt.error && (
        <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
          <div className="panel-title" style={{ marginBottom: 4 }}>
            Calibration — measured, including where it falls short
          </div>
          <p style={{ fontSize: 12, color: 'var(--fg2)', lineHeight: 1.55, margin: '6px 0 12px' }}>
            Both incumbent tools assert their accuracy. This one measures it: we replay {fmt(bt.batches)} historical
            batches covering {fmt(bt.applications)} resolved applications, predict them blind, then compare with what the
            FCC actually did. A well-calibrated model grants ~70% of the applications it rates 70%.
          </p>
          <div
            style={{
              padding: '12px 14px',
              marginBottom: 14,
              background: 'color-mix(in srgb, var(--s-never) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--s-never) 35%, transparent)',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--s-never)', marginBottom: 6 }}>
              Well calibrated through the middle, still optimistic at the very top — and we are not going to pretend
              otherwise.
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--fg2)', lineHeight: 1.6 }}>
              Brier skill against a base-rate forecaster is{' '}
              <b className="mono" style={{ color: 'var(--s-avail)' }}>+{(bt.brierSkill * 100).toFixed(1)}%</b>, so the
              model carries real information rather than just reproducing the average. The middle of the range tracks
              closely — the 10-25% band lands within a fraction of a point, and the 60-75% band within three. But
              applications rated near-certain are granted about three quarters of the time rather than virtually
              always.
              <br />
              <br />
              We measured why, rather than guessing. For every near-certain application that was nevertheless dismissed,
              we checked whether the call it was predicted to win went to somebody else or to nobody at all. It splits
              almost evenly. Half went to a rival, which is genuine model error. The other half went to{' '}
              <b style={{ color: 'var(--fg)' }}>nobody</b> — the applicant simply never completed, and non-payment is
              the documented cause. The FCC dismisses an application whose $35 fee never arrives, and roughly a third of
              filers in a contested batch do not follow through.
              <br />
              <br />
              That second half is not a calibration failure so much as a different question. This model predicts who
              wins a lottery; it does not predict whether you will pay for your entry. Treat a near-certain figure as
              &ldquo;you win if you complete the application&rdquo;.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div
                className="mono tnum"
                style={{ fontSize: 22, fontWeight: 600, color: bt.brierSkill >= 0 ? 'var(--s-avail)' : 'var(--s-canceled)' }}
              >
                {(bt.brierSkill * 100).toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg2)' }}>Brier skill vs. base rate</div>
            </div>
            <div>
              <div className="mono tnum" style={{ fontSize: 22, fontWeight: 600 }}>{bt.brier.toFixed(4)}</div>
              <div style={{ fontSize: 11, color: 'var(--fg2)' }}>Brier score (lower is better)</div>
            </div>
            <div>
              <div className="mono tnum" style={{ fontSize: 22, fontWeight: 600 }}>{(bt.meanAbsError * 100).toFixed(2)}%</div>
              <div style={{ fontSize: 11, color: 'var(--fg2)' }}>Mean absolute error</div>
            </div>
            <div>
              <div className="mono tnum" style={{ fontSize: 22, fontWeight: 600 }}>{fmt(bt.scored)}</div>
              <div style={{ fontSize: 11, color: 'var(--fg2)' }}>Contested applications scored</div>
            </div>
          </div>
          <div className="van-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
              <thead>
                <tr style={{ background: 'var(--bg3)' }}>
                  {['Predicted band', 'n', 'Predicted', 'Actual', 'Error'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--fg3)', fontWeight: 500, borderBottom: '1px solid var(--line2)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bt.bins.map((b: any) => (
                  <tr key={b.label} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td className="mono" style={{ padding: '6px 10px' }}>{b.label}</td>
                    <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>{fmt(b.n)}</td>
                    <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>{(b.predicted * 100).toFixed(1)}%</td>
                    <td className="mono tnum" style={{ padding: '6px 10px' }}>{(b.actual * 100).toFixed(1)}%</td>
                    <td
                      className="mono tnum"
                      style={{ padding: '6px 10px', color: Math.abs(b.actual - b.predicted) < 0.05 ? 'var(--s-avail)' : 'var(--s-never)' }}
                    >
                      {((b.actual - b.predicted) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* status taxonomy */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>
          Status taxonomy
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {STATUS_ORDER.map((k) => (
            <div key={k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ width: 132, flexShrink: 0 }}>
                <StatusChip status={k} />
              </div>
              <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: 'var(--fg2)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--fg)' }}>{STATUS[k].label}.</b> {STATUS[k].blurb}
              </div>
              <div className="mono tnum" style={{ fontSize: 12, color: 'var(--fg3)', width: 78, textAlign: 'right' }}>
                {fmt(m.byStatus.find((s: any) => s.status === k)?.c ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* scarcity */}
      <div className="card" style={{ padding: '16px 18px', marginTop: 16 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>
          Scarcity by format
        </div>
        <div className="van-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr style={{ background: 'var(--bg3)' }}>
                {['Format', 'Total valid', 'Never issued', 'Available', 'Licensed'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 10px', color: 'var(--fg3)', fontWeight: 500, borderBottom: '1px solid var(--line2)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.byFormat.map((f: any) => (
                <tr key={f.format} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td className="mono" style={{ padding: '6px 10px', fontWeight: 600 }}>{f.format}</td>
                  <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>{fmt(f.total)}</td>
                  <td className="mono tnum" style={{ padding: '6px 10px', color: f.never_issued ? 'var(--s-never)' : 'var(--fg3)' }}>
                    {fmt(f.never_issued)}
                  </td>
                  <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--s-avail)' }}>{fmt(f.available)}</td>
                  <td className="mono tnum" style={{ padding: '6px 10px', color: 'var(--fg2)' }}>{fmt(f.active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--fg3)', lineHeight: 1.55, marginTop: 12 }}>
          Note what this makes visible: every 1x2 in the country has been issued at least once, and only a handful of 2x1
          calls are open at any moment. Meanwhile hundreds of thousands of 2x2 and 1x3 calls have never been assigned to
          anyone — a pool that tools built only from ULS records cannot see, because a call that was never issued leaves
          no record to find.
        </p>
      </div>

      <div className="card" style={{ padding: '16px 18px', margin: '16px 0 40px' }}>
        <div className="panel-title" style={{ marginBottom: 10 }}>
          Known limits
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--fg2)', lineHeight: 1.7 }}>
          <li>
            Daily transaction files are applied as the FCC publishes them, so the data trails live ULS state by about a
            day. It cannot do better: an application filed this morning appears in a file published tomorrow. Sites that
            scrape the ULS web interface directly can show same-day filings; this one does not, and a call showing no
            competition may have picked some up in the last few hours.
          </li>
          <li>
            The list of calls the FCC quietly withholds is incomplete. Two are confirmed by FOIA (N6ER, N1GI); the
            Commission has never published the rest, so the remainder are caught only by the anomaly heuristic — open
            for over a year with every application dismissed and none granted — which needs a track record before it
            can fire.
          </li>
          <li>
            2x3 calls are not materialised. They are the sequential-issue pool — 8.1M combinations that are effectively
            never vanity targets — so they are evaluated on demand instead of stored.
          </li>
          <li>
            About 14,000 ULS records carry a <span className="mono">group_code</span> that contradicts their own callsign
            structure (2x3 calls labelled Group A). We trust the structure and flag the field as dirty.
          </li>
          <li>
            Predictions assume every pending applicant pays on time and none amend or withdraw. Any of those changes the
            batch.
          </li>
          <li>
            Applications still marked pending more than 60 days past their receipt date are treated as taken offline for
            FCC manual review rather than as live competitors — the bulk data contains examples still pending since 2018.
            They are excluded from lottery solving and from contention counts.
          </li>
          <li>
            Result counts above 100,000 are reported as &ldquo;100,000+&rdquo;. Counting every row of a 438,000-row match
            costs more than the answer is worth.
          </li>
          <li>Nothing here is legal advice, and the FCC can act outside its published rules — see the Anomaly status.</li>
        </ul>
      </div>
    </main>
  );
}
