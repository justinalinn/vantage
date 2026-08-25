#!/usr/bin/env bash
#
# Clean rebuild + deploy to the remote host.
#
# Every derived artefact is destroyed and regenerated rather than updated in
# place. That is deliberate: the derived tables depend on each other in one
# direction (source -> universe -> status -> predictions -> survival), and
# refreshing only part of that chain leaves the database internally
# inconsistent in ways that look like plausible data. It has already bitten
# this project twice — once leaving every contested call reporting no
# competition because availability had not been recomputed.
#
# Rebuilding derived state costs a few minutes. Debugging silently stale
# derived state costs far more.
#
# Configure the target with environment variables — there are no hardcoded
# hosts. Installing the systemd units needs sudo on the remote; use a key and
# a NOPASSWD sudoers entry, or run the 6b block by hand.
#
# Usage:
#   VANTAGE_REMOTE=user@host scripts/deploy.sh          # rebuild derived data + deploy
#   VANTAGE_REMOTE=user@host scripts/deploy.sh --full   # also re-fetch ULS + re-ingest
#   VANTAGE_REMOTE=user@host scripts/deploy.sh --no-backtest
#
set -euo pipefail

REMOTE="${VANTAGE_REMOTE:?set VANTAGE_REMOTE, e.g. user@host}"
APP_DIR="${VANTAGE_DIR:-~/vantage}"
PORT="${VANTAGE_PORT:-3477}"
SERVICE="${VANTAGE_SERVICE:-vantage}"

FULL=0
BACKTEST=1
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --no-backtest) BACKTEST=0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# Local Node lives under nvm; the system node may be too old for Next 15.
if [ -n "${VANTAGE_NODE_BIN:-}" ]; then
  export PATH="$VANTAGE_NODE_BIN:$PATH"
fi

# ---------------------------------------------------------------- 1. verify
say "Typecheck + tests (local)"
npx tsc --noEmit
npx vitest run --reporter=dot 2>&1 | tail -4

# ------------------------------------------------------------------ 2. sync
say "Syncing source to $REMOTE"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude 'data' --exclude .git \
  --exclude 'design' --exclude '*.zip' \
  ./ "$REMOTE:$APP_DIR/"

# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: the ULS scraper drives the *system* Chrome
# via channel:'chrome', because Akamai blocks the bundled Chromium build. There
# is no reason to download 300 MB of browser that will never be launched.
ssh "$REMOTE" "cd $APP_DIR && mkdir -p logs && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PATCHRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund >/dev/null 2>&1 && echo 'deps ok'"

ssh "$REMOTE" "
  printf 'browser   : '; command -v google-chrome >/dev/null && google-chrome --version || echo 'MISSING — ULS lookup will not run'
  printf 'xvfb      : '; command -v xvfb-run >/dev/null && echo present || echo 'MISSING — ULS lookup will not run headless'
"

# --------------------------------------------------- 3. wipe derived state
say "Destroying cached + derived data on remote"
ssh "$REMOTE" "cd $APP_DIR && node -e '
const D = require(\"better-sqlite3\");
const db = new D(\"data/vantage.db\");
db.pragma(\"busy_timeout = 30000\");

// Everything below is recomputed from the ingested ULS tables. Nothing here is
// a source of truth, so dropping it can never lose information.
const derived = [\"universe\", \"prediction\", \"prediction_app\"];
for (const t of derived) { try { db.exec(\"DELETE FROM \" + t); } catch (e) {} }
try { db.exec(\"DELETE FROM meta WHERE key IN (\x27backtest\x27, \x27backtest_at\x27)\"); } catch (e) {}
// Daily watermarks only. The complete-file watermarks (src:l_amat, src:a_amat)
// are the baseline the refresh uses to reject daily transaction files older
// than the data already loaded — the day-of-week slots rotate weekly, so after
// a reload most of them are stale. Clearing those would replay a week-old
// snapshot over current records.
try { db.exec(\"DELETE FROM meta WHERE key LIKE \x27src:%_am_%\x27\"); } catch (e) {}

// Reset the denormalized columns that hang off call_state.
try { db.exec(\"UPDATE call_state SET available_date=NULL, available_now=0, avail_rule=NULL, visibility_bound=0\"); } catch (e) {}

db.pragma(\"wal_checkpoint(TRUNCATE)\");
console.log(\"derived tables cleared\");
db.close();
'"

ssh "$REMOTE" "cd $APP_DIR && rm -rf .next && echo 'build cache cleared'"

# ------------------------------------------------------------- 4. re-ingest
if [ "$FULL" = "1" ]; then
  say "Full re-ingest: fetching ULS bulk data (~520 MB)"
  ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/fetch-uls.ts && npx tsx scripts/ingest.ts licenses && npx tsx scripts/ingest.ts apps && npx tsx scripts/ingest.ts blocks && rm -f data/raw/*.zip"
fi

# Backfill the complete-file watermarks if the fetch did not record them.
#
# These are the baseline the incremental refresh compares daily transaction
# files against. Without them the baseline is zero, every rotating daily slot
# looks newer than the database, and the next refresh replays week-old
# snapshots over current records. Cheap to assert, expensive to miss.
say "Recording ULS publication watermarks"
ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/stamp-sources.ts"


say "Rebuilding derived data (universe -> status -> predictions -> survival)"
ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/ingest.ts universe 2>&1 | tail -2"
ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/ingest.ts reconcile 2>&1 | tail -11"
ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/ingest.ts predict 2>&1 | tail -3"

if [ "$BACKTEST" = "1" ]; then
  say "Recomputing calibration backtest"
  ssh "$REMOTE" "cd $APP_DIR && npx tsx scripts/backtest.ts 400 2>&1 | head -5"
fi

# ---------------------------------------------------------------- 5. build
say "Production build on remote"
ssh "$REMOTE" "cd $APP_DIR && npm run build 2>&1 | grep -E 'Compiled|Error|error' | head -5"

# -------------------------------------------------------------- 6. restart
say "Restarting $SERVICE"
ssh "$REMOTE" "sudo systemctl restart $SERVICE"

# ------------------------------------------------- 6b. auto-update timer
say "Installing the FCC auto-update timer"
# The unit ships with %i as the user placeholder. Substituting it has to happen
# where the remote username is actually known — doing the sed remotely inside a
# quoted ssh command writes the literal string "$(whoami)" into User=, which
# systemd rejects with a status=217/USER that only shows up in journalctl.
REMOTE_USER=$(ssh "$REMOTE" 'whoami')
REMOTE_HOME=$(ssh "$REMOTE" 'echo $HOME')
sed "s|%i|$REMOTE_USER|g; s|/home/$REMOTE_USER|$REMOTE_HOME|g" deploy/vantage-refresh.service > /tmp/vantage-refresh.service
scp -q /tmp/vantage-refresh.service deploy/vantage-refresh.timer "$REMOTE:/tmp/"

ssh "$REMOTE" "sudo bash -c '
  install -m 644 /tmp/vantage-refresh.service /etc/systemd/system/vantage-refresh.service
  install -m 644 /tmp/vantage-refresh.timer   /etc/systemd/system/vantage-refresh.timer
  systemctl daemon-reload
  systemctl enable --now vantage-refresh.timer
'"
# Prove it can actually start, rather than trusting that the timer is armed.
ssh "$REMOTE" "sudo systemctl start vantage-refresh.service; sleep 2; systemctl show vantage-refresh.service -p Result --value | sed 's/^/refresh   : /'"
ssh "$REMOTE" "systemctl list-timers vantage-refresh.timer --no-pager | sed -n 2p"

# --------------------------------------------------------------- 7. verify
say "Verifying"
ssh "$REMOTE" "
  for i in \$(seq 1 30); do
    code=\$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/ 2>/dev/null || true)
    [ \"\$code\" = '200' ] && break
    sleep 2
  done
  echo \"service   : \$(systemctl is-active $SERVICE)\"
  curl -s -o /dev/null -w 'home      : HTTP %{http_code} in %{time_total}s\n' http://localhost:$PORT/
  curl -s 'http://localhost:$PORT/api/meta' | python3 -c \"
import sys,json; d=json.load(sys.stdin)
print('universe  :', format(d['universe'], ','), 'callsigns')
print('pending   :', d['pending'], 'apps in', d['batches'], 'batches')
print('methods   :', {m['method']: m['c'] for m in d['methods']})
print('ingested  :', (d['lastIngest'] or '')[:19])
print('refreshed :', (d.get('lastRefresh') or '-')[:19])
\"
  curl -s 'http://localhost:$PORT/api/search?q=1x2%20P%3E50&limit=1' | python3 -c \"import sys,json; print('1x2 open  :', json.load(sys.stdin)['total'])\"
  curl -s -X POST 'http://localhost:$PORT/api/recommend' -H 'content-type: application/json' -d '{\"operatorClass\":\"E\",\"formats\":[\"1x2\",\"2x1\"],\"count\":25}' | python3 -c \"import sys,json; d=json.load(sys.stdin); print('recommend :', len(d['slots']), 'slots,', d['bargains'], 'bargains')\"
  echo \"url       : http://\$(hostname -I | awk '{print \$1}'):$PORT\"
"
say "Done"
