#!/usr/bin/env bash
# deploy/scripts/backup-db.sh — daily SQLite snapshot. Installed by
# setup-server.sh at /srv/line-of-bugs/shared/scripts/backup-db.sh
# and triggered by cron at 3:30 AM server-local.

set -euo pipefail
DB=/srv/line-of-bugs/shared/data/db/line-of-bugs.db
DIR=/srv/line-of-bugs/shared/data/db/backups
mkdir -p "$DIR"

# Use SQLite's online backup API — safe while the app is writing.
sqlite3 "$DB" ".backup '$DIR/$(date +%Y%m%d).db'"

# Retain last 30 days
find "$DIR" -name '*.db' -mtime +30 -delete

# Size sanity print (visible in cron log)
ls -la "$DIR" | tail -5
