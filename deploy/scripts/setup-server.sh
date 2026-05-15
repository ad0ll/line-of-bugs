#!/usr/bin/env bash
# deploy/scripts/setup-server.sh — one-shot, idempotent server bootstrap.
# Run from a checkout of the repo on YOUR LAPTOP:
#     ./deploy/scripts/setup-server.sh
# Connects as bawler@195.201.8.147 and uses NOPASSWD sudo.

set -euo pipefail
TARGET="bawler@195.201.8.147"
APP=/srv/line-of-bugs
REPO_URL="https://github.com/ad0ll/line-of-bugs.git"

# Ship the systemd unit + journald drop-in via stdin to avoid an extra scp.
ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
APP=/srv/line-of-bugs
REPO_URL="https://github.com/ad0ll/line-of-bugs.git"

# 1. Directory tree
sudo install -d -o bawler -g bawler "$APP/releases" "$APP/shared/data"/{images,medium,thumbnails,manifest,db,db/backups,logs} "$APP/shared/scripts" "$APP/logs"

# 2. Python venv for fetcher scripts (one venv, reused across releases via $APP/current)
if [ ! -d "$APP/shared/venv" ]; then
    sudo apt-get update -qq
    sudo apt-get install -y python3-venv python3-pip sqlite3
    python3 -m venv "$APP/shared/venv"
fi

# 3. .env stub (real values are scp'd in a later step, but ensure file exists with mode 600)
if [ ! -f "$APP/shared/.env" ]; then
    touch "$APP/shared/.env"
    chmod 600 "$APP/shared/.env"
    chown bawler:bawler "$APP/shared/.env"
fi

# 4. Clone the repo into a "scaffold" release so the first deploy has something to base off of.
SCAFFOLD="$APP/releases/scaffold"
if [ ! -d "$SCAFFOLD" ]; then
    git clone --depth 50 "$REPO_URL" "$SCAFFOLD"
fi
ln -sfn "$SCAFFOLD" "$APP/current"
ln -sfn "$APP/shared/data" "$SCAFFOLD/data"
ln -sfn "$APP/shared/.env" "$SCAFFOLD/.env"

# 5. Install python deps now so the fetcher scripts can run later
"$APP/shared/venv/bin/pip" install --quiet --upgrade pip
"$APP/shared/venv/bin/pip" install --quiet -r "$SCAFFOLD/scripts/requirements.txt"

# 6. journald disk cap (1 GB, 1 month retention)
sudo install -d /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/lob-limits.conf >/dev/null <<'EOF'
[Journal]
SystemMaxUse=1G
MaxRetentionSec=1month
EOF
sudo systemctl restart systemd-journald

# 7. Systemd unit (copied from the scaffold release)
sudo install -m 644 "$SCAFFOLD/deploy/line-of-bugs.service" /etc/systemd/system/line-of-bugs.service
sudo systemctl daemon-reload
sudo systemd-analyze verify line-of-bugs.service
sudo systemctl enable line-of-bugs.service

# 8. Backup script + cron
sudo install -m 755 "$SCAFFOLD/deploy/scripts/backup-db.sh" "$APP/shared/scripts/backup-db.sh"
# Idempotent cron line — check before adding
( crontab -l 2>/dev/null | grep -v 'line-of-bugs backup-db' ; \
  echo "30 3 * * * $APP/shared/scripts/backup-db.sh >> $APP/logs/backup.log 2>&1 # line-of-bugs backup-db" ) \
  | crontab -

echo
echo "=== setup-server.sh DONE ==="
echo "Next: scp .env, then run seed-images.sh + first deploy."
REMOTE
