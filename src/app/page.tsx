'use client';

import React from 'react';
import ResultsGrid, { ShapeBar } from '@/components/ResultsGrid';
import CallDetailView from '@/components/CallDetailView';
import Builder from '@/components/Builder';
import TimelineView from '@/components/TimelineView';
import Watchlist from '@/components/Watchlist';
import Methodology from '@/components/Methodology';
import SearchScreen from '@/components/SearchScreen';
import Recommender from '@/components/Recommender';
import OpeningSoon from '@/components/OpeningSoon';
import DataScreen from '@/components/DataScreen';
import ApplicantView from '@/components/ApplicantView';
import { useMediaQuery } from '@/components/primitives';
import type { SearchRow } from '@/lib/query/search';

type Screen =
  | 'search'
  | 'grid'
  | 'detail'
  | 'applicant'
  | 'opening'
  | 'build25'
  | 'builder'
  | 'timeline'
  | 'watchlist'
  | 'updates'
  | 'methodology';

const TABS: Array<[Screen, string]> = [
  ['search', 'Search'],
  ['grid', 'Grid'],
  ['detail', 'Detail'],
  ['opening', 'Opening soon'],
  ['build25', 'Build my 25'],
  ['builder', 'Builder'],
  ['timeline', 'Timeline'],
  ['watchlist', 'Watchlist'],
  ['updates', 'Updates'],
  ['methodology', 'Methodology'],
];

const SAVED = [
  { label: '★ 1x2 gettable', q: '1x2 P>50' },
  { label: '2x1 gettable', q: '2x1 P>50' },
  { label: '2x2 · never issued', q: '2x2 never' },
  { label: 'contested now', q: 'contested' },
];

export default function Page() {
  const [screen, setScreen] = React.useState<Screen>('search');
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');
  const [dense, setDense] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [committed, setCommitted] = React.useState('');
  const [rows, setRows] = React.useState<SearchRow[]>([]);
  const [shape, setShape] = React.useState<Array<{ status: string; count: number }>>([]);
  const [total, setTotal] = React.useState(0);
  const [approx, setApprox] = React.useState(false);
  const [took, setTook] = React.useState(0);
  const [describe, setDescribe] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [sort, setSort] = React.useState('des');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pref, setPref] = React.useState<string[]>([]);
  const [detailCall, setDetailCall] = React.useState<string | null>(null);
  const [applicantCall, setApplicantCall] = React.useState<string | null>(null);
  const [watchKey, setWatchKey] = React.useState(0);
  const [meta, setMeta] = React.useState<any>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isMobile = useMediaQuery('(max-width: 720px)');

  // theme + preference list persistence
  React.useEffect(() => {
    const t = (localStorage.getItem('vantage-theme') as 'dark' | 'light') ?? 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try {
      const p = JSON.parse(localStorage.getItem('vantage-pref') ?? '[]');
      if (Array.isArray(p)) setPref(p);
    } catch {}
    fetch('/api/meta').then((r) => r.json()).then(setMeta);
  }, []);

  React.useEffect(() => {
    localStorage.setItem('vantage-pref', JSON.stringify(pref));
  }, [pref]);

  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('vantage-theme', t);
  };

  // Debounced search. Requests are sequenced and the in-flight one is aborted
  // on every change: without this a slow broad query ("2x2 never", 400ms) can
  // land after a fast narrow one and overwrite it, leaving the grid showing
  // results that do not match the query in the box.
  const seqRef = React.useRef(0);
  React.useEffect(() => {
    if (screen !== 'grid') return;
    setLoading(true);
    const ctrl = new AbortController();
    const seq = ++seqRef.current;
    const id = setTimeout(() => {
      const u = new URL('/api/search', window.location.origin);
      u.searchParams.set('q', committed);
      u.searchParams.set('sort', sort);
      u.searchParams.set('dir', dir);
      u.searchParams.set('limit', '300');
      fetch(u, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((j) => {
          if (seq !== seqRef.current) return; // a newer query already won
          setRows(j.rows ?? []);
          setShape(j.shape ?? []);
          setTotal(j.total ?? 0);
          setApprox(!!j.approximate);
          setTook(j.tookMs ?? 0);
          setDescribe(j.describe ?? []);
          setLoading(false);
        })
        .catch((e) => {
          if (e?.name === 'AbortError') return;
          if (seq === seqRef.current) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [committed, sort, dir, screen]);

  // keyboard: "/" focuses search, Esc clears
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        setScreen('grid');
        setTimeout(() => inputRef.current?.focus(), 30);
      }
      if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const runQuery = (q: string) => {
    setQuery(q);
    setCommitted(q);
    setScreen('grid');
  };

  const openDetail = (call: string) => {
    setDetailCall(call);
    setScreen('detail');
  };

  const openApplicant = (call: string) => {
    setApplicantCall(call);
    setScreen('applicant');
  };

  const addToPref = (call: string) => {
    setPref((p) => (p.includes(call) || p.length >= 25 ? p : [...p, call]));
  };

  const watch = async (call: string) => {
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ call }),
    });
    setWatchKey((k) => k + 1);
  };

  const toggleSel = (call: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(call)) n.delete(call);
      else n.add(call);
      return n;
    });
  };

  const onSort = (k: string) => {
    if (k === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      setDir(k === 'call' || k === 'avail' ? 'asc' : 'desc');
    }
  };

  // What "current" means here is the newest application on file, not when the
  // pipeline last ran. A rebuild timestamp says the machine did some work; the
  // newest receipt date is the thing a user can check against the FCC, and it
  // is the number that moves when a daily transaction file lands.
  const freshness = meta?.newestReceipt
    ? `data to ${String(meta.newestReceipt)}`
    : meta?.lastRefresh
      ? `updated ${String(meta.lastRefresh).slice(0, 10)}`
      : 'loading…';
  const awaiting = meta?.awaitingPrefs?.count ?? 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexShrink: 0 }}>
          <span className="brand">VANTAGE</span>
          <span className="brand-sub">Vanity Callsign Analytics</span>
        </div>

        <nav className="tabs" aria-label="Screens">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              className="tab"
              aria-current={screen === k}
              onClick={() => {
                if (k === 'detail' && !detailCall) return;
                setScreen(k);
              }}
              disabled={k === 'detail' && !detailCall}
              style={k === 'detail' && !detailCall ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              {label}
              {k === 'builder' && pref.length > 0 && (
                <span className="mono" style={{ marginLeft: 5, fontSize: 10, color: 'var(--accent)' }}>
                  {pref.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        <div
          className="freshness hide-mobile"
          title={
            awaiting
              ? `The FCC has announced ${awaiting} vanity application${awaiting === 1 ? '' : 's'} filed on or after ${meta.awaitingPrefs.oldest} without publishing which calls they request. Until it does, competition on this site is understated by up to that many filings.`
              : 'Every application the FCC has published is loaded.'
          }
        >
          <span className="dot" />
          <span>{freshness}</span>
          {awaiting > 0 && (
            <span style={{ color: 'var(--s-upcoming)', marginLeft: 6, whiteSpace: 'nowrap' }}>
              {'\u00b7'} {awaiting} undisclosed
            </span>
          )}
        </div>
        <div className="seg hide-mobile">
          <button aria-pressed={dense} onClick={() => setDense(true)}>
            Dense
          </button>
          <button aria-pressed={!dense} onClick={() => setDense(false)}>
            Comfort
          </button>
        </div>
        <button className="iconbtn" onClick={toggleTheme} aria-label="Toggle colour theme" title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>

      {screen === 'search' && (
        <SearchScreen
          onRun={runQuery}
          onOpenCall={openDetail}
          onGoto={(k) => setScreen(k)}
          meta={meta}
        />
      )}

      {screen === 'opening' && <OpeningSoon onOpen={openDetail} onWatch={watch} />}

      {screen === 'updates' && <DataScreen />}

      {screen === 'grid' && (
        <>
          <div className="querybar">
            <div className="queryinput">
              <span className="mono" style={{ color: 'var(--fg3)', fontSize: 13 }}>
                &gt;
              </span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setCommitted(query);
                }}
                onBlur={() => {
                  if (query !== committed) setCommitted(query);
                }}
                placeholder="2x1 region 6 ending in vowel · never · P>60"
                aria-label="Search callsigns"
              />
              <kbd className="mono" style={{ fontSize: 10, color: 'var(--fg3)', border: '1px solid var(--line2)', borderRadius: 4, padding: '2px 5px' }}>
                /
              </kbd>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SAVED.map((s) => (
                <button key={s.label} className="chipbtn" onClick={() => runQuery(s.q)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {describe.length > 0 && (
            <div style={{ padding: '6px 16px', fontSize: 11, color: 'var(--fg3)', borderBottom: '1px solid var(--line)' }}>
              Reading as: <span style={{ color: 'var(--fg2)' }}>{describe.join(' · ')}</span>
              <span className="mono" style={{ marginLeft: 10 }}>{took}ms</span>
            </div>
          )}

          <ShapeBar shape={shape} total={total} approximate={approx} />

          <ResultsGrid
            rows={rows}
            total={total}
            shape={shape}
            loading={loading}
            dense={dense}
            selected={selected}
            pref={pref}
            sort={sort}
            dir={dir}
            onSort={onSort}
            onToggle={toggleSel}
            onOpen={openDetail}
            onAddToPref={addToPref}
            onWatch={watch}
          />

          {selected.size > 0 && (
            <div className="actionbar van-in">
              <span className="mono" style={{ fontSize: 12 }}>
                {selected.size} selected
              </span>
              <span className="mono hide-mobile" style={{ fontSize: 11, color: 'var(--fg3)' }}>
                {[...selected].slice(0, 8).join('  ')}
              </span>
              <div style={{ flex: 1 }} />
              <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>
                Clear
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setPref((p) => [...p, ...[...selected].filter((c) => !p.includes(c))].slice(0, 25));
                  setSelected(new Set());
                  setScreen('builder');
                }}
              >
                Add {selected.size} to preference list →
              </button>
            </div>
          )}
        </>
      )}

      {screen === 'detail' && detailCall && (
        <CallDetailView
          call={detailCall}
          onBack={() => setScreen('grid')}
          onAddToPref={addToPref}
          onWatch={watch}
          onOpenApplicant={openApplicant}
          inPref={pref.includes(detailCall)}
        />
      )}

      {screen === 'build25' && (
        <Recommender
          onOpen={openDetail}
          onAdopt={(calls) => {
            setPref(calls.slice(0, 25));
            setScreen('builder');
          }}
        />
      )}
      {screen === 'applicant' && applicantCall && (
        <ApplicantView call={applicantCall} onOpenCall={openDetail} onBack={() => setScreen('detail')} />
      )}
      {screen === 'builder' && <Builder pref={pref} setPref={setPref} onOpen={openDetail} />}
      {screen === 'timeline' && <TimelineView />}
      {screen === 'watchlist' && <Watchlist onOpen={openDetail} refreshKey={watchKey} />}
      {screen === 'methodology' && <Methodology meta={meta} />}
    </div>
  );
}
