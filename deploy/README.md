# line-of-bugs deploy runbook

**Target:** `bawler@195.201.8.147` (Hetzner, Debian 13)
**Domain:** `line-of-bugs.com`
**Spec:** `docs/superpowers/specs/2026-05-15-deploy-design.md`
**Plan:** `docs/superpowers/plans/2026-05-15-deploy.md`

## First-time bootstrap (in order)

1. Add Namecheap DNS records (see plan Task C1).
2. `./deploy/scripts/setup-server.sh` — creates `/srv/line-of-bugs/`, systemd unit, venv, journald limits, backup cron.
3. `scp .env.local bawler@195.201.8.147:/srv/line-of-bugs/shared/.env`
4. `./deploy/scripts/seed-images.sh` — rsync the 36 GB image dataset (one-time, ~1-2 h).
5. `./deploy/scripts/deploy.sh main` — first deploy. Boots Next.js on `127.0.0.1:3000`.
6. `./deploy/scripts/issue-cert.sh` — issues TLS cert + wires the haproxy deploy hook.
7. `./deploy/scripts/install-fragment.sh` — interactive: appends the haproxy cache + backend, prompts for the frontend edits.
8. `./deploy/scripts/smoke.sh https://line-of-bugs.com` — public verification.
9. Optional: `sudo reboot` on the host to apply the pending kernel update.

> **Note:** `/api/healthz` returns `{"ok":true, "images":0}` on a server before `seed-images.sh` runs (better-sqlite3 creates an empty DB on first connect). A green healthz alone is NOT proof that the dataset was seeded — confirm `images > 0` or rely on the `/api/session/start` check in smoke.sh.

## Everyday deploy

```bash
git push                          # to GitHub
./deploy/scripts/deploy.sh        # deploys HEAD
# or:
./deploy/scripts/deploy.sh main   # deploys main branch tip
```

The script: pushes, server `git clone`s the SHA, `npm ci && npm run build`, runs migrations, swaps the `current/` symlink, restarts the unit, runs smoke.

## Rollback

```bash
./deploy/scripts/deploy.sh --rollback <sha>
```

Where `<sha>` is the short SHA of a previously deployed release. List available releases:

```bash
ssh bawler@195.201.8.147 'ls -1dt /srv/line-of-bugs/releases/*/ | head -5'
```

## Restore SQLite from backup

Backups live at `/srv/line-of-bugs/shared/data/db/backups/YYYYMMDD.db`.

```bash
ssh bawler@195.201.8.147 '
    set -euo pipefail
    sudo systemctl stop line-of-bugs
    cp /srv/line-of-bugs/shared/data/db/backups/20260515.db \
       /srv/line-of-bugs/shared/data/db/line-of-bugs.db
    rm -f /srv/line-of-bugs/shared/data/db/line-of-bugs.db-wal \
          /srv/line-of-bugs/shared/data/db/line-of-bugs.db-shm
    sudo systemctl start line-of-bugs
'
```

## Run a fetcher manually

```bash
# Fetchers write directly to SQLite via scripts/db.py:DbWriter (R5+).
# No separate seed step — DATABASE_URL points the writer at the shared DB.
ssh bawler@195.201.8.147 '
    cd /srv/line-of-bugs/current
    DATABASE_URL=/srv/line-of-bugs/shared/data/db/line-of-bugs.db \
        INAT_SCALE=2 /srv/line-of-bugs/shared/venv/bin/python scripts/fetch_inaturalist.py
'
```

## Watch logs

```bash
ssh bawler@195.201.8.147 'journalctl -u line-of-bugs -f'
ssh bawler@195.201.8.147 'journalctl -u haproxy -f'
```

## Rotate admin password

```bash
# Locally
node -e "const b=require('./node_modules/bcryptjs'); const pw='NEW_PASSWORD_HERE'; console.log(b.hashSync(pw,10))"
# Edit /srv/line-of-bugs/shared/.env on the server with the new hash
ssh bawler@195.201.8.147 'sudo systemctl restart line-of-bugs'
```
