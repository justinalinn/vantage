# Hosting VANTAGE

## The short answer for Hostinger

| Hostinger plan | Works? | Why |
|---|---|---|
| **VPS — KVM 1/2/4/8** | **Yes** | Full root on a real VM. Run `deploy/install-vps.sh`. |
| Premium / Business / Cloud shared hosting | **No** | No persistent Node process. |
| Web hosting with "Node.js support" add-on | **No** in practice | Process is recycled per request and the filesystem is not writable in the way SQLite needs. |

Buy a **VPS**, not shared hosting. If you already have a shared plan you can
point the domain at the VPS and keep using the shared plan for mail.

### Why shared hosting cannot host this

It is not a limitation that can be worked around with configuration.

- VANTAGE is a **long-lived Node process** that holds a ~1.3 GB SQLite database
  open. Shared hosting runs PHP-FPM behind LiteSpeed and starts a fresh
  short-lived worker per request. Opening a 1.3 GB database per request would
  be slower than the query.
- The refresh writes to that database **inside a transaction that lasts
  minutes**. Shared hosting kills processes long before that.
- Ingest shells out to `unzip -p` and streams 2.6 GB through it. Shared plans
  do not give you arbitrary subprocess execution.

### Which VPS size

| | KVM 1 | KVM 2 |
|---|---|---|
| vCPU / RAM / disk | 1 / 4 GB / 50 GB | 2 / 8 GB / 100 GB |
| Runs the site | yes | yes |
| Nightly refresh | ~6–10 min | ~3–5 min |
| Full rebuild from scratch | ~35 min | ~20 min |
| Calibration backtest | slow (~15 min) | fine |

**KVM 2 is the recommendation.** KVM 1 genuinely works — the ingest streams, so
peak RSS stays near 600 MB — but the RSD solver and the backtest are CPU-bound
and single-core is felt on both.

Disk actually used:

```
data/vantage.db     ~1.3 GB    the database
data/user.db        ~64 KB     watchlist; the only unrecoverable file here
data/raw/*.zip      ~520 MB    transient, deleted after ingest
node_modules        ~400 MB
.next               ~200 MB
                    ───────
steady state        ~2 GB      peak during a full rebuild ~3.5 GB
```

## Install

```bash
# 1. get the source onto the box
rsync -az --exclude node_modules --exclude .next --exclude data \
  ./ user@your-vps:~/vantage/

# 2. provision: packages, Node 22, build, systemd, nginx, TLS
ssh user@your-vps
sudo ~/vantage/deploy/install-vps.sh --domain vanity.example.com --email you@example.com

# 3. build the database once (~20–35 min, downloads ~520 MB from the FCC)
cd ~/vantage && npm run ingest:full
```

After that the site is live on port 80/443 and the auto-update timer is running.

## Staying current

The FCC publishes:

- **Complete files** — `l_amat.zip`, `a_amat.zip`. Rebuilt weekly. Documented as
  05:00 ET Sunday; observed on `data.fcc.gov` at 13:07 UTC Sunday and 08:16 UTC
  Saturday respectively.
- **Daily transaction files** — `l_am_mon.zip` … `a_am_sat.zip`, Tuesday through
  Saturday, each holding the previous business day's changes. 27–125 KB.
  Documented as 05:00 ET; observed at ~12:00 UTC on weekdays, 08:00 UTC after a
  Friday, 13:00 UTC after a Saturday.

The observed times move around, so nothing here is scheduled against them.
`vantage-refresh.timer` fires every 30 minutes, issues six `HEAD` requests, and
does nothing unless a `Last-Modified` is newer than the one already applied. A
check that finds nothing costs a few hundred bytes and about a second.

```bash
systemctl list-timers vantage-refresh.timer   # when it next runs
journalctl -u vantage-refresh -n 50           # what it did
npm run refresh:check                         # what is new, changing nothing
npm run refresh                               # apply now
```

### The site does not go down for an update

Every refresh runs inside a **single SQLite write transaction**:

1. New transaction files are downloaded *outside* the transaction.
2. The transaction opens. Source tables are upserted, then the whole derived
   chain — licence periods → call state → universe status → predictions →
   survival — is recomputed from scratch.
3. The transaction commits.

Under WAL a writer never blocks readers, and readers keep seeing the
pre-transaction snapshot until it commits. So for the two-or-so minutes the
rebuild takes, the site serves the **previous, fully consistent** dataset at
full speed, and then switches to the new one between one request and the next.
There is no restart, no maintenance page, and no window in which a request can
observe a half-updated database.

If the process is killed mid-refresh, SQLite rolls the whole thing back and the
site carries on serving what it was already serving. A failed update is a
no-op, never a broken site.

The derived chain is rebuilt wholesale rather than patched because it has one
direction of dependency, and refreshing part of it leaves the database
internally inconsistent in ways that read as plausible data rather than as an
error. That has caused two real bugs in this project. Inside a transaction the
full rebuild is invisible, so there is no reason to take the risk.

### What a weekly complete file does

The refresh will not apply a complete file as a delta — it is not one. When
`l_amat.zip` or `a_amat.zip` changes, the refresh logs a notice and leaves it
alone; the daily files keep the database current in the meantime. Reload the
complete files when convenient:

```bash
npm run ingest:full          # local
npm run deploy:full          # from a workstation, to the remote
```

## Operations

```bash
systemctl status vantage             # the site
systemctl restart vantage
journalctl -u vantage -f

sqlite3 data/vantage.db 'PRAGMA wal_checkpoint(TRUNCATE);'   # reclaim WAL
```

### Back up `data/user.db`

Everything in `vantage.db` is reconstructible from FCC bulk data, and the
pipeline treats it that way — it wipes and rebuilds derived tables freely.
`user.db` holds the watchlist and is the one file on the box that cannot be
regenerated.

```bash
sqlite3 data/user.db ".backup '/home/user/backups/user-$(date +%F).db'"
```

## Running somewhere else

Nothing here is Hostinger-specific. The requirements are:

- Linux with Node ≥ 20 and `unzip`
- a persistent process (not serverless — the database is a local file)
- ~4 GB disk, ~1 GB RAM
- outbound HTTPS to `data.fcc.gov`

That rules out Vercel, Netlify, Cloudflare Workers and Lambda, all of which
have ephemeral filesystems. It fits comfortably on any $5–10/month VPS —
Hetzner, DigitalOcean, Linode, Vultr, Oracle Cloud free tier — or a Raspberry
Pi 4 with an SSD.
