# VANTAGE — Vanity Callsign Analytics

FCC amateur radio vanity callsign intelligence. Exact lottery probabilities,
never-issued callsign discovery, and preference-list optimisation, built
directly on the ULS bulk data.

Replaces the three incumbent tools ([AE7Q](https://www.aj8u.net/query/),
[K2CR Vanities](https://vanities.k2cr.com/), [RadioQTH](https://www.radioqth.net/vanity/available))
with one queryable system.

---

## Deploying

```bash
VANTAGE_REMOTE=user@host npm run deploy        # clean rebuild + deploy
VANTAGE_REMOTE=user@host npm run deploy:full   # also re-fetch and re-ingest ULS data
```

The target is configured entirely through the environment — `VANTAGE_REMOTE`,
`VANTAGE_DIR`, `VANTAGE_PORT`, `VANTAGE_SERVICE`. Installing the systemd units
needs sudo on the remote, so use a key plus a NOPASSWD sudoers entry.

Every derived artefact is destroyed and regenerated rather than updated in
place. The derived tables form a strict chain — source → `universe` → status →
`prediction` → survival — and refreshing only part of it leaves the database
internally inconsistent in ways that look like plausible data rather than an
error. That has already caused two real bugs here, so the deploy script always
does the full thing: typecheck and tests locally, sync source, drop every
derived table and the cached backtest, clear `.next`, rebuild
universe → reconcile → predict → backtest, production build, restart the
service, then verify health and key endpoints.

## Staying current

The FCC rebuilds its complete amateur database weekly and publishes a small
transaction file every weekday with just what changed. Working from the weekly
file alone leaves the site up to seven days behind — several FCC batches, which
is long enough for a call to read "open, uncontested" here while four
applications are already queued against it.

```bash
npm run refresh:check   # what the FCC has published that we do not have
npm run refresh         # apply it
npm run refresh:watch   # stay resident and poll
```

A systemd timer fires every 15 minutes and runs whatever is due. What "due"
means lives in the database, not in the unit file, so the cadence is editable
from the **Updates** screen without root or a daemon-reload.

### Same-day filings

The bulk feed is not the whole picture. ULS serves pending applications that
appear in **no published file at all** — on 2026-08-19 the newest application in
this database was USI 16157903 while ULS was serving 16161536, which requested
K3UF. Until those are read, every call they target reads as less contested than
it is.

```bash
npm run scrape          # read them now
npm run scrape:dry      # fetch and parse, write nothing
npm run update:status   # what is due, and when it last ran
npm run update:all      # force both
```

This drives a real Chrome, because `wireless2.fcc.gov` answers 403 to curl and
to every headless browser — including headless real Chrome — and 200 to headful
real Chrome. On a server that means `xvfb`. Discovery uses ULS's own vanity
search sorted newest-first; only applications this database has never seen are
opened, serially, with a delay, off-hours by default.

Rows obtained this way carry `source='uls'`, feed the solver as real
competition, and are marked **PROV** wherever they appear. See
[docs/ULS-LIVE-ACCESS.md](docs/ULS-LIVE-ACCESS.md).

### Triggering by hand

Everything above is also a button on the **Updates** screen, alongside the
schedule controls and the last few runs. The same endpoints work from the shell:

```bash
curl -X POST localhost:3477/api/admin/update   -d '{"what":"scrape"}' -H 'content-type: application/json'
curl -X POST localhost:3477/api/admin/schedule -d '{"scrapeIntervalMin":360}' -H 'content-type: application/json'
curl localhost:3477/api/admin/update      # status, history, log tail
```

These spawn processes, so they are limited to private networks unless
`VANTAGE_ADMIN_TOKEN` is set, in which case that token is required from
everywhere.

**The site does not go down for an update.** The whole refresh — source upserts
plus a full rebuild of the derived chain — runs inside one SQLite write
transaction. Under WAL a writer never blocks readers, and readers keep seeing
the pre-transaction snapshot until it commits, so the site serves the previous
consistent dataset at full speed throughout and switches atomically between one
request and the next. A killed refresh rolls back entirely; a failed update is a
no-op rather than a broken site.

See [docs/HOSTING.md](docs/HOSTING.md) for deployment, including what does and
does not work on Hostinger.

## Data source

Everything here is built from the FCC's **public ULS bulk downloads** for the
amateur service. Nothing is scraped from another vanity site, and no dataset is
redistributed in this repository — `data/` is empty on checkout and every figure
is regenerated locally from the FCC files.

Two archives are needed, both published by the FCC at
<https://www.fcc.gov/uls/transactions/daily-weekly>:

| File | Contents | Size |
|---|---|---|
| `l_amat.zip` | complete amateur **licence** database, rebuilt weekly | ~430 MB |
| `a_amat.zip` | complete amateur **application** database, rebuilt weekly | ~90 MB |

Alongside those, the FCC publishes a small transaction file each weekday
containing only what changed; the refresh path in **Staying current** applies
those so the database tracks ULS to roughly one day.

```bash
npm run ingest:fetch    # downloads both weekly zips into data/raw/
npm run ingest          # streams them into data/vantage.db
```

`ingest:fetch` writes to `data/raw/`, which is gitignored. The zips are pure
derived input: delete them once ingest finishes and re-fetch whenever you want
fresher data. Ingest never extracts them to disk — it pipes from the archive —
which is what keeps the whole pipeline inside ~1.5 GB of free space.

FCC ULS data is a public record and carries no licence restriction. It does
contain licensee names and addresses as filed with the Commission; this project
reads only the callsign, class, status, and date fields it needs.

## Quick start

```bash
nvm use                 # Node 24 (see .nvmrc); Next 15 needs >= 18.18
npm install
npm run ingest:fetch    # ~520 MB from the FCC (l_amat.zip + a_amat.zip)
npm run ingest          # streams them into data/vantage.db (~5 min)
npm run backtest        # optional: measures calibration against history
npm run dev             # http://localhost:3000
```

The zips are pure derived input — delete them after ingest and re-fetch when
you want fresher data. Ingest needs roughly **1.5 GB of free disk**.

Individual stages can be re-run:

```bash
npm run ingest licenses | apps | universe | reconcile | predict
```

## What it does that the incumbents don't

| | AE7Q | K2CR | RadioQTH | VANTAGE |
|---|---|---|---|---|
| Grant prediction | rules + iterative | Monte Carlo 175k | ✗ | **exact RSD, sampling only as fallback** |
| Never-issued calls | counts only | ✗ | ✗ (admitted) | **665,088 enumerated** |
| Query language | rigid forms | none (static HTML) | 5 dropdowns | **full text query + globs** |
| Eligibility-aware | post-hoc diagnosis | note | ✗ | **pre-flight, per applicant** |
| Preference-list optimiser | ✗ | ✗ | ✗ | **core feature** |
| Accuracy published | asserted | asserted | n/a | **backtested: +25% Brier skill, failures included** |
| Mobile | ✗ | ✗ | partial | **card layout, no h-scroll** |
| Colour-independent status | ✗ | ✗ | partial | **glyph + code + label** |
| Calls inside the 2-year grace window | ✗ | ✗ | ✗ | **~82,000 with exact opening dates** |
| "File on this day" | ✗ | ✗ | ✗ | **per call, with countdown** |
| Data freshness | weekly + scrape | daily + scrape | weekly | **daily transaction files, ~1 day** |
| Live update without downtime | n/a | n/a | n/a | **single-transaction swap** |

### The calls nobody else can see

ULS does not mark a licence "Expired" when it expires. It leaves the status at
**Active** for the entire two-year grace period in which the holder could still
renew, and only sweeps afterwards. Every tool that reads the status letter to
decide availability — including, until recently, this one — therefore treats a
call that opens next Tuesday exactly like one licensed until 2034.

Deriving the date instead of trusting the letter surfaced **508 calls that were
already assignable** and about **82,000 with a knowable opening date**, of which
**201 are 1x2s opening within a year** against 9 findable before.

The proof is in the data rather than the rulebook: of 544,178 licences the FCC
has since flipped to Expired, 98.0% carry a cancel date 725–740 days after their
expiration date, clustered on 731 and 732. The sweep is mechanical and its clock
starts at expiry.

### Knowing which of those are lies

Deriving the date overshoots in the other direction, and two mechanisms account
for nearly all of it:

- **Frozen by a pending renewal.** The holder filed a renewal inside the grace
  window and the Commission has not acted. The call reads as open, is not, and
  has no deadline by which it must be resolved — some have been stuck since
  2011. Detecting these needs pending *non-vanity* applications keyed by
  callsign, which the vanity ingest has no reason to load.
- **Withheld outright.** N6ER and N1GI clear every test and are never granted. A
  2024 FOIA request returned redacted records showing hidden ULS entries marking
  them "Reserved by the FCC" for similarity to obscenity.

### The never-issued set

RadioQTH states outright that "there are valid call signs that will not show up
here simply because they have never been held by anyone since the FCC began
keeping track." Those are the *best* calls — permanently open, zero competition
— and they are invisible to any tool built only from licence records, because a
call that was never issued leaves no record to find.

Generating the callsign space combinatorially and subtracting everything ULS has
ever seen surfaces **665,088** of them. It also makes the scarcity at the top
visible: every 1x2 in the country has been issued at least once, and only a
handful of 2x1 calls are open at any moment.

## Architecture

```
FCC ULS weekly zips ──► scripts/ingest.ts ──► SQLite ──► API routes ──► Next.js
   (streamed, never          │                  │
    extracted to disk)       │                  └── universe · call_state
                             │                      application · application_call
                             └── src/lib/predict/    prediction
                                 (pure, unit-tested)
```

- `src/lib/callsign/` — formats, Groups A–D, regions, reserved blocks, Morse and
  phonetic weights, desirability, the combinatorial universe
- `src/lib/fcc/` — availability rules, holiday-aware filing timeline, ULS field
  semantics
- `src/lib/predict/` — the RSD solver, batch engine, portfolio optimiser,
  backtester
- `src/lib/query/` — query parser and SQL executor

The prediction engine is a pure module with no database access, so it is
exhaustively unit-tested — including against a brute-force N! reference.

## The lottery model

Every application sharing a receipt date is processed in uniformly random order,
each applicant taking the highest-ranked call on their list still unassigned.
That is textbook **random serial dictatorship**.

Rather than enumerate N! orders, batches are split into independent components
and the state space is walked *forwards*, carrying one number per state — the
probability of reaching it. Marginals fall out as a by-product, costing one
float per state instead of a whole distribution. One further reduction makes it
tractable: a call only one applicant wants can never be taken from them, so it
never enters the state at all.

Batches are solved jointly rather than in isolation. They resolve on successive
nights in receipt-date order, so an earlier filer takes a contested call before
the next batch runs — the FCC's "Too Late" dismissal. The solver represents this
as strict processing tiers: uniformly random within a receipt date, every earlier
date first.

Sampling is the fallback, never the default. When used, figures are hatched,
tagged `SIMULATED`, and carry a 95% interval — labelled per component, so one
sampled cluster never mislabels an exactly-solved neighbour.

## Preference-list ordering

Order strictly by how much you want each call — never by how likely you are to
get it. Adjacent exchange on any pair, with utility `u`, win chance `p` and
reach `R`:

```
order (i,j):   R · [ uᵢpᵢ + uⱼpⱼ(1 − pᵢ) ]
order (j,i):   R · [ uⱼpⱼ + uᵢpᵢ(1 − pⱼ) ]
(i,j) wins  ⟺  uᵢ > uⱼ
```

The probabilities cancel. A long shot at slot 1 costs nothing because you fall
straight through to slot 2. The only real mistake is leaving slots empty, and
the FCC gives you 25 for one $35 fee.

## Data notes established empirically

Several things were determined from the bulk data rather than documentation:

- `AM.group_code` describes the **callsign**, not the operator class (98.2%
  agreement with our derivation vs 27.1% for the class hypothesis).
- Territory prefixes sit one rung lower than mainland — 2x2 is General, not
  Advanced — because they have no 1x2 or 1x3 to fill the ladder. **`KP` is the
  lone exception at Advanced** (99.9% of 1,062 records).
- Application status `'2'` means pending. Every vanity request received on the
  file's final day carries it, with `action_date == receipt_date`.
- A vanity request is defined by having a `VC` preference list, not by radio
  service `HV`. Filtering on the service code drops genuine requests filed under
  `HA` and sweeps in unrelated renewals.
- ~14,000 licences carry a `group_code` contradicting their own callsign
  structure (2x3 labelled Group A). We trust the structure.

## Testing

```bash
npm test          # 45 tests
npm run typecheck
```

The RSD solver is verified against brute-force N! enumeration across 300 random
instances to 1e-9. Morse and phonetic weights are pinned to AE7Q's published
values so numbers are comparable across sites.

## Known limits

- The weekly dump lags live FCC state by up to two days for applications.
- 2x3 is not materialised — 8.1M combinations that are effectively never vanity
  targets. Evaluated on demand instead.
- The backtest scores **+25% Brier skill** against a base-rate forecaster and is
  well calibrated through the middle of the range, but remains optimistic at the
  very top: near-certain applications are granted about three quarters of the
  time. Measurement shows half of that shortfall is genuine model error and half
  is applicants who never paid the $35, which no lottery model can predict.
- Result counts above 100,000 are reported as `100,000+`.
- Nothing here is legal advice, and the FCC acts outside its published rules
  often enough that we ship an `ANOMALY` status for it.
