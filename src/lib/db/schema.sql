-- VANTAGE schema. SQLite, but deliberately portable to Postgres.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ---------------------------------------------------------------- licenses
CREATE TABLE IF NOT EXISTS license (
  usi              INTEGER PRIMARY KEY,
  call             TEXT NOT NULL,
  status           TEXT,          -- A active, C canceled, E expired, T terminated
  radio_service    TEXT,
  grant_date       TEXT,
  expired_date     TEXT,
  cancel_date      TEXT,
  effective_date   TEXT,
  last_action_date TEXT,
  operator_class   TEXT,
  group_code       TEXT,
  region_code      TEXT,
  trustee_call     TEXT,
  prev_call        TEXT,
  entity_name      TEXT,
  first_name       TEXT,
  last_name        TEXT,
  state            TEXT,
  zip              TEXT,
  frn              TEXT,
  entity_type      TEXT
);
CREATE INDEX IF NOT EXISTS idx_license_call ON license(call);
CREATE INDEX IF NOT EXISTS idx_license_status ON license(status);

-- The current (most authoritative) record per callsign, chosen during ingest.
CREATE TABLE IF NOT EXISTS call_state (
  call             TEXT PRIMARY KEY,
  usi              INTEGER,
  status           TEXT,
  grant_date       TEXT,
  expired_date     TEXT,
  cancel_date      TEXT,
  last_action_date TEXT,
  operator_class   TEXT,
  entity_name      TEXT,
  state            TEXT,
  -- derived
  available_date   TEXT,          -- NULL when active or never-issued
  available_now    INTEGER NOT NULL DEFAULT 0,
  avail_rule       TEXT,
  visibility_bound INTEGER NOT NULL DEFAULT 0,
  ever_issued      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_call_state_avail ON call_state(available_date);

-- ------------------------------------------------------------ applications
CREATE TABLE IF NOT EXISTS application (
  usi              INTEGER PRIMARY KEY,
  file_number      TEXT,
  applicant_call   TEXT,
  radio_service    TEXT,          -- HV = vanity
  purpose          TEXT,          -- MD, RO, NE, AU, RM, DU, WD, AM
  app_status       TEXT,          -- G granted, D dismissed, W withdrawn, NULL pending
  receipt_date     TEXT,
  action_date      TEXT,
  operator_class   TEXT,
  request_type     TEXT,          -- E, A, B, C, D, F
  relationship     TEXT,
  entity_name      TEXT,
  state            TEXT,
  frn              TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_receipt ON application(receipt_date);
CREATE INDEX IF NOT EXISTS idx_app_status ON application(app_status);
CREATE INDEX IF NOT EXISTS idx_app_call ON application(applicant_call);

-- The ordered preference list attached to each vanity application.
CREATE TABLE IF NOT EXISTS application_call (
  usi        INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  call       TEXT NOT NULL,
  PRIMARY KEY (usi, seq)
);
CREATE INDEX IF NOT EXISTS idx_appcall_call ON application_call(call);

-- -------------------------------------------------------------- universe
CREATE TABLE IF NOT EXISTS universe (
  call         TEXT PRIMARY KEY,
  prefix       TEXT NOT NULL,
  digit        INTEGER NOT NULL,
  suffix       TEXT NOT NULL,
  format       TEXT NOT NULL,
  grp          TEXT NOT NULL,
  region       INTEGER NOT NULL,
  region_locked INTEGER NOT NULL DEFAULT 0,
  morse        INTEGER NOT NULL,
  phonetic     INTEGER NOT NULL,
  desirability INTEGER NOT NULL,
  -- denormalized status, refreshed after ingest
  status       TEXT NOT NULL DEFAULT 'NEVER_ISSUED',
  available_date TEXT,
  pending_count  INTEGER NOT NULL DEFAULT 0,
  -- Of those pending applications, how many could actually be granted this
  -- call. Filings that are too early, region-locked or class-locked are
  -- counted above but cannot win, and showing only the raw figure makes a
  -- call look contested when nobody eligible is chasing it.
  eligible_pending INTEGER NOT NULL DEFAULT 0,
  -- Denormalized best prediction for this call. Joining the prediction table at
  -- query time forced a full scan of all 1.15M universe rows; carrying it here
  -- keeps search single-table and indexable.
  p            REAL,
  p_method     TEXT,
  p_ci         REAL,
  -- Total probability that some *currently pending* applicant walks away with
  -- this call, and the complement: the chance it is still unclaimed once every
  -- open batch has resolved.
  --
  -- This is the number that matters to someone filing today. A call can carry
  -- twenty applications and still be near-certain to survive, because those
  -- applicants rank it below something they are more likely to win — when they
  -- take their first choice, everything further down their list is released.
  -- Judging a call by its raw application count badly misreads the board.
  claimed_p    REAL NOT NULL DEFAULT 0,
  survive_p    REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_universe_status ON universe(status);
CREATE INDEX IF NOT EXISTS idx_universe_format ON universe(format);
CREATE INDEX IF NOT EXISTS idx_universe_region ON universe(region);
CREATE INDEX IF NOT EXISTS idx_universe_grp ON universe(grp);
CREATE INDEX IF NOT EXISTS idx_universe_des ON universe(desirability DESC);
CREATE INDEX IF NOT EXISTS idx_universe_suffix ON universe(suffix);
CREATE INDEX IF NOT EXISTS idx_universe_avail ON universe(available_date);
CREATE INDEX IF NOT EXISTS idx_universe_status_des ON universe(status, desirability DESC);
CREATE INDEX IF NOT EXISTS idx_universe_fmt_status ON universe(format, status, desirability DESC);
CREATE INDEX IF NOT EXISTS idx_universe_region_status ON universe(region, status, desirability DESC);
CREATE INDEX IF NOT EXISTS idx_universe_p ON universe(p DESC);
CREATE INDEX IF NOT EXISTS idx_universe_survive ON universe(survive_p DESC, desirability DESC);

-- ------------------------------------------------------------ predictions
CREATE TABLE IF NOT EXISTS prediction (
  usi       INTEGER NOT NULL,
  call      TEXT NOT NULL,
  p         REAL NOT NULL,
  method    TEXT NOT NULL,
  ci        REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (usi, call)
);
CREATE INDEX IF NOT EXISTS idx_pred_call ON prediction(call);

-- Per-application summary of its predicted outcome.
CREATE TABLE IF NOT EXISTS prediction_app (
  usi        INTEGER PRIMARY KEY,
  best_call  TEXT,
  best_p     REAL,
  p_any      REAL,
  p_nothing  REAL,
  method     TEXT,
  outcome    TEXT
);

-- --------------------------------------------------------------- metadata
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ------------------------------------------------------------- watchlist
-- Deliberately absent: the watchlist is the only user-authored data on the
-- site and lives in data/user.db, attached as `user`. Everything in this file
-- is regenerated from FCC bulk data and gets wiped to do it. See src/lib/db.

-- ------------------------------------------------------- licence periods
-- Every interval during which a callsign was held by someone, across all
-- licence records rather than just the current one. `call_state` deliberately
-- collapses to one row per callsign, which is right for "what is it now" and
-- useless for "what was it in 2021" — reconstructing point-in-time
-- availability needs the superseded records too.
CREATE TABLE IF NOT EXISTS license_period (
  call       TEXT NOT NULL,
  usi        INTEGER NOT NULL,
  start_date TEXT,          -- grant date
  end_date   TEXT,          -- cancel date, else expiry; NULL while still active
  status     TEXT,
  PRIMARY KEY (call, usi)
);
CREATE INDEX IF NOT EXISTS idx_period_call_start ON license_period(call, start_date);

-- --------------------------------------------------------------- blocks
-- Applications pending against a callsign that are not vanity requests.
--
-- `application` deliberately holds only vanity requests, because that is what
-- the preference lists key off. But a call can be frozen by an application that
-- has nothing to do with vanity: a renewal filed inside the 2-year grace window
-- stops the clock, and while the FCC sits on it the call stays unassignable
-- while looking, by every other measure, wide open. 233 calls are in that state
-- right now, some since 2011.
CREATE TABLE IF NOT EXISTS call_block (
  call         TEXT NOT NULL,
  usi          INTEGER NOT NULL,
  file_number  TEXT,
  purpose      TEXT,
  receipt_date TEXT,
  kind         TEXT NOT NULL,     -- RENEWAL | OTHER
  PRIMARY KEY (call, usi)
);
CREATE INDEX IF NOT EXISTS idx_call_block_call ON call_block(call, kind);

-- ------------------------------------------------------- licence source
-- The raw per-licence rows, kept rather than dropped after the collapse.
--
-- Everything downstream (license_period, call_state, universe) is derived from
-- this and rebuilt wholesale. Keeping it is what makes an incremental daily
-- update safe: a daily transaction file upserts source rows here, and the
-- derived chain is then recomputed from scratch instead of being hand-patched.
CREATE TABLE IF NOT EXISTS license_min (
  usi              INTEGER PRIMARY KEY,
  call             TEXT,
  status           TEXT,
  grant_date       TEXT,
  expired_date     TEXT,
  cancel_date      TEXT,
  last_action_date TEXT,
  -- Enrichment lives here rather than only on call_state. call_state is wiped
  -- and rebuilt from this table on every refresh, so anything held only there
  -- is lost the first time a daily delta touches a single row.
  operator_class   TEXT,
  entity_name      TEXT,
  state            TEXT
);
CREATE INDEX IF NOT EXISTS idx_license_min_call ON license_min(call);

-- ------------------------------------------------- applications in the gap
-- Vanity applications the FCC has announced but not yet detailed.
--
-- The bulk feed publishes an application's header (HD/AD: who filed, when, in
-- which service) one publication cycle before it publishes the vanity
-- preference list (VC: which calls they actually want). Measured across a full
-- week of transaction files, each day's VC records catch up to the previous
-- day's HD records — the gap is consistently one cycle, and on 2026-08-18 it
-- held 49 applications.
--
-- Because this project keys vanity requests off VC (the only reliable way to
-- tell a vanity request from an address change), those applications are
-- otherwise invisible: the site reports a call as uncontested while an
-- application for it already exists at the Commission. That is the single
-- remaining way this data can mislead someone into spending $35, so the
-- applications get recorded even though their targets are unknown, and the
-- count is surfaced rather than hidden.
--
-- Rows are removed once the preference list lands and the application graduates
-- into `application`.
CREATE TABLE IF NOT EXISTS application_unlisted (
  usi            INTEGER PRIMARY KEY,
  file_number    TEXT,
  applicant_call TEXT,
  receipt_date   TEXT,
  app_status     TEXT,
  first_seen     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_unlisted_receipt ON application_unlisted(receipt_date);

-- ------------------------------------------------------- scraped ULS data
-- A record of every ULS scrape, so the provenance of provisional data is
-- inspectable rather than implied.
CREATE TABLE IF NOT EXISTS scrape_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  attempted  INTEGER NOT NULL DEFAULT 0,
  resolved   INTEGER NOT NULL DEFAULT 0,   -- preference list found and stored
  empty      INTEGER NOT NULL DEFAULT 0,   -- ULS served the section with no entries
  failed     INTEGER NOT NULL DEFAULT 0,
  note       TEXT
);
