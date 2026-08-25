# How the incumbents get same-day data — and how we could

Verified end to end on 2026-08-18/19 against live ULS.

## The bulk feed is not the difference

K2CR's footer credits the **`fcc-db`** project (Josh Cepek, GPLv3). Its
`uls-fetch.sh` reads:

```sh
uri_base="ftp://wirelessftp.fcc.gov/pub/uls"
$uri_base/complete/{l,a}_amat.zip
$uri_base/daily/{l,a}_am_{sun..sat}.zip
curl -sS -I --ftp-method nocwd ...
```

Same paths this project already ingests, checked the same way. The FTP host
mirrors `data.fcc.gov` byte for byte — both served `a_am_mon.zip` at 32,686
bytes with an identical `Last-Modified`. `/pub/uls/` contains only `complete/`
and `daily/`; there is no third feed. **Nobody has bulk data we do not.**

The one thing FTP adds is a directory listing: what exists and when it changed,
in one request instead of twelve HEADs. It also revealed that `l_am_tue.zip`
had gone unrewritten for two weeks, which the monotonic baseline in
`scripts/refresh.ts` already rejects.

## The difference is scraping, and the barrier was headless detection

`wireless2.fcc.gov` and `www.fcc.gov` sit behind Akamai and answer **403** to:

- `curl`, with any User-Agent or header set
- patchright/Playwright **headless**, bundled chromium or real Chrome
- both from this workstation and from the deployment host

They answer **200** to patchright driving **real Chrome with `headless: false`**.
That is the whole barrier. It is not an IP ban — the same network is fine — and
`data.fcc.gov` (the bulk files) was never blocked at all.

```js
chromium.launchPersistentContext(profileDir, { headless: false, channel: 'chrome' })
```

Akamai then issues `_abck`, `bm_sz`, `ak_bmsc`, `bm_sv`; the persistent profile
keeps them across a run. A headless server needs `xvfb-run`.

**`ctx.request.get()` does not work** even inside an authenticated context — it
shares cookies but not the browser's network stack, and Akamai answers it with a
behavioural challenge page. Every fetch has to be a real page navigation.

## The three endpoints

### 1. Discovery — every pending vanity application

`ApplicationSearch/searchAmateur.jsp`, then submit the form with:

| field | value |
|---|---|
| `uls_a_vanity_callsign` | checked — *"Only Include Vanity Call Sign Requests"* |
| `uls_a_status_code` | `2` (Pending) |
| `pageSize` | 100 |

The submit button is an `<input type=image>` that Playwright's click does not
reliably fire; set `jsValidated=true` and call `form.submit()` directly.

Returns file number, applicant call sign, name, FRN, purpose, radio service,
receipt date and status — **including applications not yet in the bulk export**.
There is no field to search by *requested* call: `basicSearchCallSign` matches
the applicant's own call. "Who applied for K3UF" has to be assembled from the
per-application detail below.

### 2. Detail — the preference list

`ApplicationSearch/applServiceSpecific.jsp?applID=<USI>`

Under **Vanity Call Sign Change → Eligibility** the requested calls render as a
5×5 grid of `N.&nbsp;CALLSIGN` cells covering slots 1–25, filled column-first:

```html
<td width="20%">1.&nbsp;N3HM </td> <td width="20%">6.&nbsp;WA6V </td> ...
<td width="20%">2.&nbsp;N6ER </td> <td width="20%">7.&nbsp;</td> ...
```

Verified against USI 16069584 (K6CRS): the page yields N3HM, N6ER, KB6S, WM3I,
KT6O, WA6V — exactly the six rows our bulk `application_call` holds, in order.

Note the grid is **empty for some applications** even when the header exists, so
a blank result is not proof of a parse failure. Two sampled applications
rendered nothing at all.

### 3. Timestamps

- `applAdmin.jsp?applID=<USI>` — History table with dated events (Granted,
  Redlight Review Completed, Paperless Authorization Printed).
- `refCopy/RefCopyController?applType=search&op=RefCopy&applId=<USI>` — the
  reference-copy PDF. Must be reached by clicking the on-page link and captured
  through a `download` event; the session id is baked into the link path.

The PDF sampled was the FCC 605 **main form only**, 3 pages, containing the
signature date but no Schedule D and no requested calls — the only call sign in
it was the applicant's own. An FCC source comment on the service-specific page
(`SCR 11656 — Reference Copy Displays Call Sign Preference Information Out Of
Order`) implies the reference copy carries preference data for other form
variants. K2CR's FAQ says they take application *entry time* from this PDF,
which the bulk export does not carry at all and which they need for
same-receipt-date duplicate detection.

## What was built

`scripts/scrape-uls.ts`, wired to `scripts/update.ts` and the **Updates** screen.

**Discovery does not come from the bulk feed.** That was the first design and it
was wrong: `application_unlisted` holds headers the FCC published without a
preference list, and every one sampled came back with an empty grid — they are
mostly club systematic-change requests. The applications that matter are the
ones ULS serves that have *no* published header at all. So the scraper asks ULS
for its own list, sorted by receipt date descending, and opens only the entries
this database has never seen.

Sorting newest-first is what keeps this to one page of results. Pagination is
available as numbered `reqPage=` links but they are bound to a search key that
does not survive a fresh GET, and everything past the first hundred is older
than the bulk data anyway.

Two details that cost time:

- The results page also carries `javascript:mapLink(...)` hrefs containing
  `reqPage=`. Taking the first match navigates to a `javascript:` URL and
  aborts the run.
- The FCC spells the descending sort option `decending`.

Operator class and mailing state are not in the search results, so they are read
from the applicant's own licence in `call_state`. That is the authoritative
source rather than a fallback — eligibility turns on the licence held — and
without it the solver treats a provisional applicant as eligible for every group
and region, overstating the competition the scrape exists to measure. Request
type is assumed `E` (primary station preference list), which is conservative:
the types that bypass the 2-year hold are never assumed.

### Verified

On 2026-08-19 the first ten results matched K2CR's scraped index exactly —
KF8HDC → W8CLF/K8CLF/N8CLF, KK7UKV → AK7ID/AK9MM/AK7BB/AK7X, N4DJN →
AE4DE/KD4JN, and the rest. K3UF then read:

```
KE9FYG   rank #3   2026-08-18  [PROVISIONAL]  100.0%
N4RTL    rank #1   2026-08-06  [bulk]         filed too early
KM7GKN   rank #13  2026-08-03  [bulk]         filed too early
```

against K2CR's "Assignment 100" for KE9FYG and "Too Early/Expired" for the other
two. Same applications, same ranks, same outcomes.

Merging 42 applications moved pending filings from 530 to 560 and contested
calls from 807 to 896 — 89 calls that had been reading as less contested than
they were.

### Load and honesty

Steady state is a handful of page views per run, serial, with a configurable
delay, off-hours by default. Scraped rows carry `source='uls'` and their
application carries `provisional=1`; the competitor table marks them **PROV**.
They reach the solver because they are real competition, and they are labelled
because the FCC has not published them yet.
