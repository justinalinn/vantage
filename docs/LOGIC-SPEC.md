# Vanity Callsign Platform — Logic & Architecture Spec

Working name: **VANTAGE** (Vanity Analytics & Grant Engine). Renameable.

Section 1 surveys the three incumbent public tools this replaces — AE7Q, K2CR
Vanities, and RadioQTH — from their observable behaviour and published output.

---

## 1. What the three incumbents actually do

### AE7Q (`aj8u.net/query/`) — deepest logic, worst delivery
Public since 2003. PostgreSQL + PHP + Apache.

- **Two-tier ingest.** FCC ULS weekly full files + daily transaction files applied ~08:00/09:00 ET. Because ULS stamps applications received on day 1 with a `last_action_date` of day 2, downloaded *application* data is effectively **two days stale**, while license data is one day stale. AE7Q compensates by polling the ULS web search directly: licenses every ~4h (02:10, 05:10, 09:10, 13:10, 17:10, 21:10 ET), applications every ~8h (03:25, 10:25 for received/amended/withdrawn; 18:25 for granted/dismissed — *intentionally delayed so results stay visible in pending lists for one more day*).
- **Combinatorial callsign universe** via regex-ish prefix patterns per region, e.g. region 1: `K1`, `N1`, `W1` (1x2, 676 each), `A[^HL-Z]1`, `K[^HLP]1`, `N[^HLP]1`, `W[^HLP]1` (2x1). Totals reconcile exactly (4,082 per region for 1x2+2x1).
- **Availability math** (the canonical rules):
  - `end_date` = `cancel_date` if canceled, else `expire_date`
  - If **canceled**: `available_date = max(cancel_date + 2y + 1d, last_action_date + 31d)` — the second term enforces §97.19(c)(3)'s 30-day visibility rule, because FCC sometimes back-sets `cancel_date` to `last_action_date + 30d − 2y`
  - If **expired**: FCC waits 2y+1d past `expire_date`, then flips status to Expired and sets `cancel_date` = `last_action_date` = today → **immediately available**
  - Else active → not available
- **Prediction taxonomy** (17 outcomes): `Assigned`, `Assignment`, `Available`, `Competition`, `Pending`, `Unknown`, `Offlined by FCC`, `Active Callsign`, `Applicant Callsign`, `Duplicate`, `Inactive`, `Insufficient Class`, `Invalid Format`, `Not Deceased`, `Reserved Callsign`, `Reserved Region`, `Restricted Region`, `Taken`, `Too Early/Canceled`, `Too Early/Expired`, `Too Late`, `Unneeded`.
- **Desirability**: Phonetic Weight (syllable count) and Morse Weight, computed in SQL — dot = 2, dash = 4, +2 per char for inter-character space. Includes trailing space (constant offset, irrelevant for ranking).
- **Vanity request types**: `E` primary station preference list (normal), `A` former primary holder, `B` close relative of deceased holder, `F` club preference list, `C` former club holder, `D` club in-memoriam with relative's consent.

### K2CR Vanities (`vanities.k2cr.com`) — best prediction, zero queryability
- **Monte Carlo**: 175,000 iterations, ±0.2% stated accuracy. Correctly models that applications are *not* independent — an earlier grant cascades into later ones.
- Statuses: `available`, `pending`, `blocked`, `future`, `banned`. **`banned` is an empirically-derived signal** — e.g. N1GI has been available on paper since 2023-03-31 yet is never granted. That's an FCC administrative lock that no rules engine would find. Worth detecting independently.
- Per-call detail pages show every competing application: file number, entered/receipt/process dates, applicant call + state, and each applicant's per-call prediction.
- Fatal flaw: **statically pre-generated HTML, one file per callsign** (`vanity-KF1Q.html`). No query interface at all.

### RadioQTH (`radioqth.net/vanity/available`) — best UX, weakest logic
- Form: `CallFormat` (1x2/2x1/2x2/1x3/2x3) × `CallPrefix` (K/N/W/Any) × `CallPrefix2` (A–Z) × `CallDistrict` (0–9/Any) × `CallSuffix` (maxlength **2**) × `SortBy`. GET to `/vanity/DisplayAvailable`.
- Output: Call Sign | Available Date | Status, where status is `Available in N days` or `Application Filed`.
- **Admits its own fatal flaw**: *"there are valid call signs that will not show up here simply because they have never been held by anyone since the FCC began keeping track."* The never-issued calls — the most desirable, wholly uncontested ones — are invisible.
- Red asterisk = geographic restriction. No prediction, no class filter.

### Shared ground truth: the FCC timeline
```
file  → receipt date = first Federal workday on/after filing (online cutoff 23:59 ET)
      → FCC waits 10 calendar days for payments
      → FCC waits 7 more calendar days
      → batch date = first Federal workday >17 days past receipt date
      → process date = next day; 00:00–02:00 ET the whole same-receipt-date batch
        is processed in UNIFORMLY RANDOM ORDER
```
Delay is 18–20 days depending on weekday. §97.19(d)(1) forbids multiple same-day applications from one applicant — both get dismissed (first for non-payment, second as duplicate). Fee: $35.00 since 2022-04-19.

---

## 2. Consolidated flaw matrix

| Capability | AE7Q | K2CR | RadioQTH | **Us** |
|---|---|---|---|---|
| Grant prediction | Rules + iterative | Monte Carlo 175k | ✗ | **Exact RSD + MC fallback** |
| Never-issued calls | Counts only | ✗ | ✗ (admitted) | **Full combinatorial universe** |
| Query / filter | Rigid PHP forms | None (static) | 5 dropdowns, 2-char suffix | **Full query language** |
| Eligibility-aware | Post-hoc diagnosis | "Extra needed" note | ✗ | **Pre-flight, personalized** |
| Preference-list optimizer | ✗ | ✗ | ✗ | **Core feature** |
| Alerts / watchlist | ✗ | ✗ | ✗ | **Core feature** |
| Accuracy published | Asserted | Asserted | n/a | **Backtested + calibrated** |
| Mobile | ✗ | ✗ | Partial | **Yes** |
| Accessibility | Color-only encoding | Color-only | OK | **Never color-alone** |
| API | ✗ | ✗ | ✗ | **Public REST + bulk** |

---

## 3. Our differentiating logic

### 3.1 Complete universe, not just what ULS has seen
Generate every syntactically valid US amateur callsign combinatorially per (format × prefix-set × region), then LEFT ANTI JOIN against all ULS license history. The residual is the **never-issued set** — permanently available, zero competition, invisible to all three incumbents. Subtract reserved blocks:

- Prefixes `AM`–`AZ` (allocated to other countries)
- Suffixes `SOS` and `QRA`–`QUZ`
- `KA2AA`–`KA9ZZ` (US Army Japan), `KC4AAA`–`KC4AAF` (NSF South Pole), `KC4USA`–`KC4USZ` (USN Antarctic), `KG4AA`–`KG4ZZ` (Guantanamo), `KC6AA`–`KC6ZZ`, `KL9KAA`–`KL9KHZ` (Korea), `KX6AA`–`KX6ZZ`
- Territory prefixes gated by region: `AL/KL/NL/WL` (Alaska), `KP/NP/WP` (PR/VI), `AH/KH/NH/WH` (Pacific)

### 3.2 Exact lottery math instead of Monte Carlo noise
The FCC batch is precisely **random serial dictatorship**: N applications sharing a receipt date, processed in uniformly random order, each holding an ordered preference list of ≤25 calls.

1. Build a bipartite graph: applications ↔ requested callsigns. Take **connected components**.
2. Components are almost always tiny (2–5 applications). For any component with N ≤ 8, **enumerate all N! orderings exactly** (≤40,320 — microseconds). Exact probability, zero variance.
3. Only for genuinely large components fall back to Monte Carlo, and then report a real confidence interval rather than a bare number.

This beats K2CR: exact where exact is possible (nearly always), and no ±0.2% smear on a number users make $35 decisions from.

### 3.3 Preference-list optimizer — the killer feature
Nobody offers this. Given eligibility, live availability, known competition, and a user's own desirability weights, compute the **optimal ordering of up to 25 slots**. Because RSD is sequential, a contested call at slot #1 costs nothing if slot #2 is safe — so the dominant strategy is to stack contested-but-loved calls high and safe calls low. Surface:
- P(get #1), P(get top-3), P(get anything)
- E[satisfaction] under the user's own weights
- Marginal value of each additional slot ("adding a 12th call raises P(any) by 0.3%")

### 3.4 Multi-axis desirability scoring
Replace one-dimensional "CW weight" with a transparent, user-weightable composite:
- **Morse weight** (exact AE7Q algorithm — dot 2, dash 4, +2 inter-char)
- **Phonetic syllables**
- **Pileup confusability** — B/D/V, S/H/5, M/O, U/V, N/D under noise
- **Pronounceability / word-ness** of suffix
- **Personal match** — initials, name, callsign nostalgia, birth year
- **Scarcity** — rarity of the pattern within its format+region
- **Contention forecast** — modeled demand from historical application rates for comparable calls

### 3.5 Deterministic timeline, rendered as a timeline
Federal-holiday-aware calculator: filing date → receipt → payment deadline (receipt + 10d) → batch → process (00:00–02:00 ET). Plus strategy AE7Q buries in prose:
- **Delay payment 1–2 workdays** to scout competition before committing $35
- **Filing-date arbitrage** — pick a receipt date whose batch is thinner
- Amendment resets the receipt date (sometimes desirable, usually not)

### 3.6 Anomaly detection ("banned")
Generalize K2CR's empirical signal: flag calls whose `available_date` is well past yet which have never been granted despite applications. Report as *"Available on paper since 2023-03-31; 4 applications dismissed. Likely FCC administrative hold."*

### 3.7 Published, backtested accuracy
Run the predictor against every historical vanity batch in ULS where the outcome is known, and publish a **calibration curve** — of calls we called 70%, what fraction were actually granted? Neither incumbent proves its accuracy claim. This is the enterprise credibility move.

### 3.8 Watchlists and alerts
Notify on: call enters its available window, a competitor files on a watched call, your batch date arrives, your prediction materially changes, a Silent Key cancellation opens a call.

---

## 4. Architecture

```
FCC ULS weekly full  ─┐
FCC ULS daily txns   ─┼─► ingest worker ─► Postgres ─► API ─► Next.js
ULS live web polling ─┘   (Node/TS)         (partitioned)   │
                                                            └─► prediction engine
                                                                (pure TS, unit-tested,
                                                                 backtested)
```

- **Frontend**: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui. Server Components for the heavy tables; TanStack Table + virtualization for 40k-row grids.
- **DB**: Postgres. Tables `callsign_universe`, `license`, `license_history`, `application`, `application_call` (the ordered preference list), `availability` (materialized), `prediction`.
- **Cache**: Redis for hot availability queries.
- **Engine**: isolated pure-function module — no DB access — so it can be exhaustively unit-tested and backtested.
- **API**: public REST + bulk export. None of the three has one.

---

## 5. Status taxonomy (needs a visual language)

| Status | Meaning |
|---|---|
| `NEVER_ISSUED` | Valid, never assigned in ULS history. Permanently open. |
| `AVAILABLE` | Past its available date, no pending applications. |
| `AVAILABLE_CONTESTED` | Available but ≥1 pending application. |
| `PENDING` | In an active batch; probability computed. |
| `UPCOMING` | Known future available date. |
| `EXPIRED_WAITING` | Expired, inside the 2-year window. Silent-Key-cancellable. |
| `CANCELED_WAITING` | Canceled, inside the 2-year window. |
| `ACTIVE` | Currently licensed to someone. |
| `ANOMALY` | Available on paper but empirically never granted. |
| `RESERVED` | Reserved block or suffix. Never assignable. |
| `REGION_LOCKED` | Requires a mailing address in a specific region. |
| `CLASS_LOCKED` | Requires a higher operator class than the user holds. |

Twelve states. Color alone cannot carry this — every incumbent fails here.

---

## 8. What changed once it met real data

The plan above survived contact with the ULS mostly intact. These are the places
it did not, recorded because each was found by measurement rather than reasoning.

### Rules the data corrected
- **Territory groups sit one rung lower.** Mainland 2x2 is Advanced; territory
  2x2 is General, because territories have no 1x2 or 1x3 to fill the ladder.
  **`KP` is the sole exception**, sitting at Advanced. Found by validating our
  derivation against ULS `group_code` on all 1.69M licences (98.2% → 99.2%).
- **`group_code` describes the callsign, not the operator class.** Tested both
  hypotheses: 98.2% vs 27.1%.
- **~14,000 licences carry a `group_code` contradicting their own structure**
  (2x3 labelled Group A). We trust the structure and treat the field as dirty.
- **"Two years and one day" is calendar arithmetic, not 731 days.** A hold
  spanning a leap day runs 732 days. The constant was landing a day early, and
  filing a day early is dismissed outright. Caught by a unit test.
- **§97.19(d)(1) keeps the first same-day filing, not none of them.** We were
  dismissing every application in a duplicate set; the rule dismisses all *but*
  the first entered into the ULS. Real applicants do this — one filed five in a
  day.

### Data-shape discoveries
- **A vanity request is defined by having a `VC` preference list**, not by radio
  service `HV`. Filtering on `HV` dropped genuine requests filed under `HA` and
  swept in unrelated renewals — 58k requests recovered to 296k by inverting the
  ingest order so `VC` defines the key set.
- **Application status `'2'` means pending.** Undocumented; established from the
  weekly file, where every request received on the final day carries it with
  `action_date == receipt_date`.
- **Some applications stay pending for years.** Eleven date back to 2018-2022 —
  FCC manual-review holds. Counting them as live competitors marked seven calls
  contested that nobody was chasing. Now classified `OFFLINED` past 60 days.
- **Raw contention overstates competition.** K5DG had 18 filings but only 3 that
  could legally be granted it. `eligible_pending` is tracked separately.

### Engineering changes
- **Forward DP beat the memoized recursion.** Carrying one scalar per state
  instead of a full marginal distribution, and tracking only contested calls in
  the state, moved batches from sampled to exact. One component spanned 147
  calls of which a handful were genuinely contested.
- **Marginal slot value needed no extra solving.** Outcomes are mutually
  exclusive, so P(any) is the sum of per-call probabilities and each slot's
  marginal *is* its own probability. The original O(n)-solves loop made the
  builder appear to hang.
- **Search had to be denormalized.** Joining predictions at query time forced a
  full scan of 1.15M rows (3.1s). Carrying the best probability on `universe`
  and capping counts at 100k brought it to single-digit ms.

### Honest failure
The backtest is **overconfident** — it predicts 99.9% where 63.9% actually get
granted, and scores slightly worse than a base-rate forecaster. The cause is
identified: replaying historical batches against a current-state snapshot cannot
reconstruct which calls were assignable years ago, so the model credits
applicants with choices that were already gone. Most vanity dismissals are
applicant error, not lottery losses. This is stated on the Methodology screen
rather than hidden, and does not affect live predictions, which evaluate
availability as it is now. Fixing it needs the ULS licence-history file.

---

## 9. The overconfidence hunt

The backtest's overconfidence was chased down rather than left as a caveat.
Three distinct bugs, found by measurement:

1. **Point-in-time availability was never reconstructed.** `call_state` collapses
   to one row per callsign — correct for "what is it now", useless for "what was
   it in 2021". The superseded licence records were in the same file all along
   and were being discarded during ingest. A `license_period` table now retains
   all 1,672,012 intervals.
2. **The expired-licence interval ended on the wrong date.** The FCC stamps
   `cancel_date` only when it flips a record to Expired, which is already two
   years past expiry. Using that as the interval end and then applying the
   2-year hold on top double-counted, hiding calls for roughly four years.
3. **Batches were solved in isolation.** They resolve on successive nights in
   receipt-date order, so an earlier filer takes a contested call before the
   next batch ever runs — AE7Q lists this as "Too Late" and we had no equivalent.
   The solver now supports strict processing tiers, verified exact against
   tier-respecting brute-force enumeration.

The third was the significant one, and it affected **live** predictions too, not
just the backtest.

Result: Brier skill −3.83% → −1.76%; the near-certain band moved from 63.9% to
75.4% actual; mid-range bands landed within a few points.

**What remains is measured, not hand-waved.** Of near-certain applications that
were still dismissed, half had their call granted to a rival (real model error)
and half had it granted to nobody at all — the applicant never completed, and
non-payment is the documented cause. Roughly a third of filers in a contested
batch do not follow through. The model predicts who wins a lottery, not who pays
for their entry.

### The bug underneath the bugs

Chasing the remaining top-bin error turned up a fourth defect, and it was the
largest of all: **the sampling path's taken-set was a 32-bit mask**.

`pickSlot` tested `takenMask & (1 << b)`. JavaScript shifts wrap modulo 32, so
in a component with more than 31 contested calls, call 40 aliased onto call 8.
Unrelated callsigns read as already taken, and their probabilities collapsed to
zero — including for applicants who had ranked them first. A live component had
109 contested calls, and `AA5E` was reported as winnable by nobody despite nine
applicants ranking it first.

The exact solver guarded `tracked > 31` and returned null; the Monte Carlo
fallback had no such guard and silently produced garbage. It went unnoticed
because every unit test used small components. Sampling now uses an explicit
flag array with no width limit, and two regression tests cover components of 50
and 120 applications.

Final: Brier skill **−3.83% → +25.02%**, mean absolute error 34.1% → 26.2%, and
the mid-range bands land within a few points of their predicted rate.

## 10. The status letter that meant nothing

A user compared this site against `vanities.k2cr.com` on one callsign, K3UF, and
found we were missing applications they showed. Chasing that produced the
largest single correctness fix in the project.

### What was wrong

`computeAvailability` treated ULS licence status `A` as terminal:

```
Active license: not available.
// If the expiry is in the past the FCC simply has not run its sweep yet;
// the call is still not assignable.
```

That comment is false, and the same file said so three branches lower — the `E`
branch already noted that the FCC "leaves status Active until 2 years and 1 day
past the expiration date, then flips it to Expired." Both statements cannot be
true. The second one is.

The FCC does not mark a licence Expired when it expires. It leaves the record at
`A` for the entire two-year grace period during which the holder may still
renew, and only sweeps afterwards. So `status = 'A'` covers three completely
different situations:

| | licence | call |
|---|---|---|
| expiry in the future | in force | not available |
| expiry passed, < 2 years ago | lapsed, renewable | opens on a known date |
| expiry passed, > 2 years ago | gone | **available now** |

Collapsing all three into "not available" hid the last two entirely.

### Confirming it from the data rather than the rulebook

Of 544,178 records the FCC has since flipped to `E`, **533,257 — 98.0% — carry a
`cancel_date` between 725 and 740 days after their `expiration_date`**, clustered
hard on 731 and 732 (the spread is leap years). The sweep is mechanical and its
clock starts at expiry. A record sitting at `A` with a past expiry is simply one
the sweep has not reached.

### What it cost

| | before | after |
|---|---|---|
| assignable today but shown as licensed | — | **508** (8 of them 1x2) |
| calls with a knowable future opening date | 1,428 | **~82,000** |
| 1x2 calls opening within 12 months | 9 | **201** |

K2CR's own district index lists K3UF, AG9N and AK9J as available. All three were
in the hidden set.

### The second half: pending renewals

Reading availability off the dates alone overshoots in the other direction. Of
the 508 calls past their grace period, **232 of K2CR's 233 published "blocked by
pending renewal" calls were in that set** — the holder filed a renewal inside the
window, the Commission has not acted on it, and the call is frozen indefinitely.
Some have been frozen since 2011.

Nothing in the licence record shows this. It needs the *application* side, and
the vanity ingest deliberately ignores non-vanity applications because it keys
everything off `VC.dat`. So a third ingest stage now collects pending
applications of any purpose keyed by callsign (`call_block`), and a pending
renewal produces status `BLOCKED_RENEWAL`.

The remaining 276 are genuinely available and were invisible to us.

### And the ones the FCC just won't give you

Two calls — N6ER and N1GI — clear every test and are never granted. A 2024 FOIA
request returned redacted records showing hidden ULS entries marking them
"Reserved by the FCC", withheld for similarity to obscenity. They are now a
hard-coded `BANNED` status. The full list is unpublished, so the ANOMALY
heuristic still carries the unknown remainder.

## 11. Staying current without going down

The weekly complete dump leaves the site up to seven days stale. Seven days is
several FCC batches: a call that reads "open, uncontested" here can already have
four applications queued against it. That is precisely the discrepancy the K3UF
report started from.

The FCC also publishes **daily transaction files** — 27–125 KB, Tuesday through
Saturday, each holding the previous business day's changes. Applying those puts
the database about one day behind live ULS state instead of seven.

### Source vs derived

Making a delta safe to apply required drawing a line that had been implicit:

- **Source** — `license_min`, `application`, `application_call`, `call_block`.
  Raw ULS fields. Upserted.
- **Derived** — `license_period`, `call_state`, `universe` status, `prediction*`,
  `claimed_p`/`survive_p`. Destroyed and recomputed, never patched.

`license_min` used to be a scratch table dropped at the end of ingest, and the
enrichment (operator class, name, state) was written onto `call_state`. Both had
to change: `call_state` is rebuilt from `license_min` on every refresh, so
anything held only on `call_state` is lost the first time a single row changes.

### Why the site stays up

The whole refresh runs in **one SQLite write transaction**. Under WAL a writer
never blocks readers, and readers keep seeing the pre-transaction snapshot until
it commits. So for the couple of minutes the derived rebuild takes, the site
serves the previous, fully consistent dataset at full speed, then switches
atomically. No restart, no maintenance window, and no request can ever observe a
half-rebuilt chain.

A killed refresh rolls back completely. A failed update is a no-op, never a
broken site — which is a strictly better failure mode than the wipe-and-rebuild
the deploy script uses, where a crash midway leaves the database empty.

Freshness is decided by `Last-Modified`, not by a schedule. The FCC documents
05:00 ET for both cadences, but observed publication on `data.fcc.gov` runs
later and moves — ~12:00 UTC on weekdays, 08:00 after a Friday, 13:00 after a
Saturday. A timer polls every 30 minutes with six HEAD requests and does nothing
unless something is genuinely newer.
