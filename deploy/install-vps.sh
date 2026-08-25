#!/usr/bin/env bash
#
# Provisions VANTAGE on a fresh Ubuntu/Debian KVM VPS — Hostinger KVM, or any
# other provider that gives you root on a real VM.
#
# This will NOT work on shared or "cloud" hosting (Hostinger Premium/Business,
# cPanel, LiteSpeed-only plans). Those run PHP behind a web server that starts
# and stops per request; VANTAGE is a long-lived Node process holding a ~1.3 GB
# SQLite database open. See docs/HOSTING.md before buying anything.
#
# Usage, as root or with sudo:
#   ./deploy/install-vps.sh [--domain vanity.example.com] [--email you@example.com]
#
# Idempotent: safe to re-run after a code change.
set -euo pipefail

DOMAIN=""
EMAIL=""
APP_USER="${SUDO_USER:-$(whoami)}"
PORT="${VANTAGE_PORT:-3477}"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email)  EMAIL="$2";  shift 2 ;;
    --user)   APP_USER="$2"; shift 2 ;;
    --port)   PORT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

APP_DIR="/home/$APP_USER/vantage"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

[ "$(id -u)" = "0" ] || { echo "run with sudo"; exit 1; }

# ------------------------------------------------------------------ packages
say "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# unzip is not optional: the ingest pipes `unzip -p` rather than extracting,
# which is the only reason a 2.6 GB dataset fits in a 4 GB box.
# build-essential and python3 are for better-sqlite3's native build when no
# prebuilt binary matches the running Node.
apt-get install -y -qq curl ca-certificates unzip build-essential python3 nginx xvfb >/dev/null

# Real Google Chrome, not Chromium.
#
# The ULS lookup drives a browser because wireless2.fcc.gov answers 403 to curl
# and to every headless browser tried — including headless real Chrome. It
# answers 200 to headful real Chrome. Chromium is blocked too, so the bundled
# Playwright build is not a substitute; xvfb supplies the display this box does
# not have. Skip both and the site still works, minus same-day filings.
if ! command -v google-chrome >/dev/null; then
  say "Installing Google Chrome (needed for the ULS lookup)"
  curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
  apt-get install -y -qq /tmp/chrome.deb >/dev/null && rm -f /tmp/chrome.deb
fi

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

# --------------------------------------------------------------------- app
say "Building in $APP_DIR"
[ -d "$APP_DIR" ] || { echo "$APP_DIR does not exist — rsync the source there first"; exit 1; }
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm install --no-audit --no-fund && npm run build"

# ----------------------------------------------------------------- systemd
say "Installing systemd units"
sed "s/%i/$APP_USER/g; s/PORT=3477/PORT=$PORT/" deploy/vantage.service         > /etc/systemd/system/vantage.service
sed "s/%i/$APP_USER/g"                          deploy/vantage-refresh.service > /etc/systemd/system/vantage-refresh.service
cp deploy/vantage-refresh.timer /etc/systemd/system/vantage-refresh.timer

systemctl daemon-reload
systemctl enable --now vantage.service
# The timer, not the service: the refresh is a oneshot that exits in seconds
# when the FCC has published nothing new.
systemctl enable --now vantage-refresh.timer

# ------------------------------------------------------------------- nginx
say "Configuring nginx"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/vantage <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    # Next.js emits content-hashed asset names, so these can be cached hard.
    location /_next/static/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_cache_valid 200 1y;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        # A cold search over 1.15M rows can take a moment on a 1-vCPU box.
        proxy_read_timeout 120s;
    }

    gzip on;
    gzip_types application/json application/javascript text/css text/plain;
    gzip_min_length 1024;
}
NGINX
ln -sf /etc/nginx/sites-available/vantage /etc/nginx/sites-enabled/vantage
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# --------------------------------------------------------------------- tls
if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
  say "Requesting a certificate for $DOMAIN"
  apt-get install -y -qq certbot python3-certbot-nginx >/dev/null
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
    echo "certbot failed — the site is still up on http://"
fi

say "Done"
systemctl --no-pager --lines=0 status vantage.service || true
echo
echo "app     : http://$(hostname -I | awk '{print $1}')${DOMAIN:+ / https://$DOMAIN}"
echo "refresh : $(systemctl list-timers vantage-refresh.timer --no-pager | sed -n 2p)"
echo
echo "The database is NOT installed by this script — it is built from FCC bulk"
echo "data and takes ~20 minutes. Run once:"
echo "  sudo -u $APP_USER bash -lc 'cd $APP_DIR && npm run ingest:full'"
