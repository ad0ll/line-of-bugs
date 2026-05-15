# line-of-bugs deploy plan — Hetzner (195.201.8.147)

**Date:** 2026-05-15
**Target host:** `195.201.8.147` (Hetzner server-auction, Debian 13 trixie, 8 vCPU / 62 GB RAM / 436 GB disk)
**Domain:** `line-of-bugs.com` (Namecheap registrar)
**Goal:** Ship the Next.js 16 + SQLite + filesystem-image app to a shared multi-app host that already runs `ntfy`, `maw`, and `insider-streams` behind HAProxy. Be a good neighbour: localhost-only services, additive HAProxy config, no disruption to existing certs.

## TL;DR

| Decision | Choice | Why |
|---|---|---|
| Runtime | **Bare-metal systemd** (no Docker) | Single Node process + SQLite + bind-mounted images; matches existing host pattern; better-sqlite3 native binding easier without container glibc mismatch; HAProxy already does the front-door isolation. |
| Build location | **On the server** (push source → `npm ci && npm run build`) | Saves ~150 MB of node_modules per deploy; sidesteps mac→linux native-binding mismatch on `better-sqlite3`. |
| Code transport | **Git pull on server**, triggered by a thin local script | Branches/SHAs are self-describing; rollback = `git checkout`. |
| Image transport | **One-time `rsync -aHX --delete --partial --info=progress2`** for the existing 36 GB → server, then **run fetchers server-side** for growth. | Laptop never re-uploads 30 GB. After seeding, code deploy is < 30 s. |
| Static image serving | **Next.js streams them** (existing `streamImage` route) **+ HAProxy cache** (3.0 has the `cache` directive, no Nginx needed) | Keeps the deploy surface to one process; HAProxy edge-caches thumbnails in RAM. |
| TLS | **acme.sh + HTTP-01** through the existing port-8888 standalone backend, hot-reloaded via stats socket | Infra is already wired for this; DNS-01 needed only for wildcards, which we don't need. |
| Service supervision | **systemd unit** with `Restart=always`, journald logs, resource limits | What every other app on this box uses. |

---

## 1. Architecture — bare-metal, systemd-supervised

### 1.1 Layout on the server

```
/srv/line-of-bugs/                ← app root (owned by bawler:bawler)
├── current/                      ← symlink → releases/<sha>/
├── releases/
│   ├── <sha-1>/                  ← code + .next/standalone after build
│   ├── <sha-2>/
│   └── ...
├── shared/                       ← persistent across releases
│   ├── data/
│   │   ├── images/               ← 31 GB originals
│   │   ├── medium/               ← 3.9 GB 1024-edge
│   │   ├── thumbnails/           ← 1.1 GB 512-edge
│   │   ├── manifest/             ← per-source CSVs (~19 MB)
│   │   ├── db/                   ← SQLite + WAL
│   │   └── logs/                 ← fetcher logs (size-capped)
│   └── .env                      ← prod env (ADMIN_PASSWORD_HASH, SKETCHFAB_API_KEY, etc.)
└── logs/                         ← app stdout/stderr (also in journald)
```

`current/data` is a symlink to `../shared/data`. Each release `cd`s into `current/` and reads/writes via the symlink. Promote a deploy by re-pointing `current/` and `systemctl restart line-of-bugs`. Roll back by re-pointing `current/` to a previous release.

### 1.2 Why bare-metal, not Docker

The user asked the question directly, so the reasoning matters:

- **Single workload, two FS dependencies (SQLite + image dir).** Both need persistent host paths. With Docker we'd bind-mount them anyway, so the container buys us almost nothing.
- **`better-sqlite3` is a native module.** It links against the runtime's `glibc`/`libstdc++`. With Docker we'd have to either build inside the same Debian-trixie base image (extra build infra) or `npm ci` inside the container at runtime (slow startup). Native install on the host: `npm ci` once at deploy, done.
- **The host already runs 5+ apps as bare processes** (`ntfy`, `maw`, `insider-streams`, `rule34-agent`, `cdp-faucet-topup`) supervised by systemd + cron. Adding Docker introduces a *second* paradigm on the same machine for no concrete win.
- **Memory accounting & resource limits** are first-class in systemd (`MemoryMax=`, `CPUQuota=`). Docker layers another cgroup on top — fine, but redundant here.
- **Operational cost.** Docker means: keeping engine updates patched, dealing with image registries, longer cold-start, more log indirection. Pay that cost when the workload demands it (multi-host, image artifacts as the unit of deploy). This is one host, one tenant.

**When to revisit:** if we add a second app dependency (Redis, sidecar worker, OCR pipeline, etc.) or move to multi-host, switch to docker-compose.

### 1.3 systemd unit

`/etc/systemd/system/line-of-bugs.service`:

```ini
[Unit]
Description=line-of-bugs Next.js app
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=bawler
Group=bawler
WorkingDirectory=/srv/line-of-bugs/current
EnvironmentFile=/srv/line-of-bugs/shared/.env
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=3

# Resource bounds — leave plenty of headroom for the shared host
MemoryMax=4G
MemoryHigh=3G
CPUQuota=400%
TasksMax=512

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/line-of-bugs/shared
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
LockPersonality=true

# Logs go to journald (rotated centrally) + an app log dir for fetcher scripts
StandardOutput=journal
StandardError=journal
SyslogIdentifier=line-of-bugs

[Install]
WantedBy=multi-user.target
```

Two things this unit deliberately does:

1. Binds to `127.0.0.1:3000` — HAProxy is the only thing reaching it.
2. `ReadWritePaths=/srv/line-of-bugs/shared` only — the release directory is read-only at runtime; writes go to `shared/data/db` (reports table) and nowhere else.

### 1.4 Next.js build configuration

Add to `next.config.ts`:

```typescript
const config: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  cacheComponents: true,
  output: "standalone",
  outputFileTracingIncludes: {
    // better-sqlite3 ships a prebuilt .node binding that file-tracing
    // sometimes misses (the runtime require is dynamic). Include it
    // explicitly so the standalone copy is self-contained.
    "/*": ["node_modules/better-sqlite3/build/Release/*.node"],
  },
  images: { unoptimized: true },
};
```

`output: 'standalone'` is the current Next.js 16 recommendation for self-hosting — verified against the Next.js docs as of 2026-05-15. The build emits `.next/standalone/server.js` plus a minimal `node_modules/`. Static assets remain in `.next/static/` and `public/` and must be copied alongside (the standalone bundle does NOT include them).

### 1.5 Files added in this work

```
deploy/line-of-bugs.service          ← systemd unit (copy to /etc/systemd/system/)
deploy/haproxy.cfg.fragment           ← additions to /etc/haproxy/haproxy.cfg
deploy/scripts/setup-server.sh        ← one-time server bootstrap (idempotent)
deploy/scripts/deploy.sh              ← code-only deploy (the common path)
deploy/scripts/seed-images.sh         ← one-time data rsync from laptop
deploy/scripts/issue-cert.sh          ← one-time acme.sh + haproxy deploy hook
deploy/README.md                      ← runbook (issue, deploy, rollback, restore)
next.config.ts                        ← add output: 'standalone' + tracing includes
app/api/healthz/route.ts              ← liveness endpoint for HAProxy + smoke tests
```

No Dockerfile, no docker-compose, no Ansible. The setup script + systemd unit + HAProxy fragment is the entire infrastructure.

---

## 2. Bandwidth-efficient deploy

### 2.1 The two transports

| What | Source of truth | Transport | Frequency |
|---|---|---|---|
| **App code** (TS, components, lib, scripts) | git on laptop | `git push` → server `git pull` | Every deploy |
| **Built artifact** (`.next/standalone`, `.next/static`, `public/`) | built on server | (no transport — built in place) | Every deploy |
| **node_modules** | built on server | (no transport — `npm ci`) | When `package-lock.json` changes |
| **Image dataset** (images/medium/thumbnails) | server (after seed) | rsync ONCE laptop→server; afterwards fetchers run on server | Once (seed), then incrementally on-server |
| **Manifest CSVs** | server (after seed) | git OR rsync (small) | When fetchers run |
| **SQLite DB** | server (lives in `shared/`) | n/a, never synced | Server-resident |
| **Secrets** (.env) | scp once, then in `shared/` | one-time scp | When secrets change |

### 2.2 The deploy script (the common case, < 30 s)

`deploy/scripts/deploy.sh` (run from laptop):

```bash
#!/usr/bin/env bash
set -euo pipefail
REF="${1:-HEAD}"
SHA=$(git rev-parse --short "$REF")

# Push refs first so the server can fetch by SHA
git push origin "$REF"

ssh bawler@195.201.8.147 bash -s "$SHA" <<'REMOTE'
set -euo pipefail
SHA="$1"
APP=/srv/line-of-bugs
REL="$APP/releases/$SHA"

# 1. Stage release directory if new
if [ ! -d "$REL" ]; then
  git clone --depth 1 --branch main /srv/line-of-bugs.git "$REL"
  cd "$REL"
  git fetch --depth 1 origin "$SHA"
  git checkout -q "$SHA"
else
  cd "$REL"
fi

# 2. Link shared paths into the release
ln -sfn "$APP/shared/data" "$REL/data"
ln -sfn "$APP/shared/.env" "$REL/.env"

# 3. Install + build (only what changed)
npm ci --omit=dev=false --prefer-offline --no-audit --no-fund
npm run build

# 4. Run migrations
npm run db:migrate

# 5. Atomically promote + restart
ln -sfn "$REL" "$APP/current"
sudo systemctl restart line-of-bugs

# 6. Keep the last 5 releases for fast rollback
ls -1dt "$APP/releases"/* | tail -n +6 | xargs -r rm -rf
REMOTE

# 7. Local-side post-deploy smoke
./deploy/scripts/smoke.sh https://line-of-bugs.com
```

Notes:
- The server holds a bare git mirror at `/srv/line-of-bugs.git` (set up once by `setup-server.sh`); the laptop pushes to *origin* (GitHub or wherever) AND ssh-pushes to the server's bare mirror. Two-line setup, then `git clone` per release is local-only and very fast.
- **Why not just rsync the built artifact from laptop?** Because the built artifact contains `better-sqlite3` binaries compiled for the laptop's OS. Building server-side eliminates that whole class of bug.
- **What if `npm ci` is slow?** With `~/.npm` cache warm and `--prefer-offline`, second deploy is ~10 s. First deploy ~90 s.
- **Total bandwidth per deploy:** roughly the git delta — usually a few KB of source, occasionally 100 KB if package-lock changed. The 31 GB of images is never touched.

### 2.3 The image seed (one time only)

`deploy/scripts/seed-images.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
TARGET="bawler@195.201.8.147"
SRC="$(pwd)/data"
DST="/srv/line-of-bugs/shared/data"

ssh "$TARGET" "mkdir -p $DST/{images,medium,thumbnails,manifest,db,logs}"

# Resumable, sparse, preserves permissions, shows progress
rsync -aHXP --delete --info=progress2 \
  --exclude='TEMP-*' --exclude='*.tmp' \
  "$SRC/images/"     "$TARGET:$DST/images/"
rsync -aHXP --info=progress2 \
  "$SRC/medium/"     "$TARGET:$DST/medium/"
rsync -aHXP --info=progress2 \
  "$SRC/thumbnails/" "$TARGET:$DST/thumbnails/"
rsync -aHXP --info=progress2 \
  "$SRC/manifest/"   "$TARGET:$DST/manifest/"
rsync -aHXP --info=progress2 \
  "$SRC/db/"         "$TARGET:$DST/db/"
```

Runs once. With a typical home upload pipe (50 Mbps), 36 GB ≈ 1.6 h. If interrupted, rerun: rsync resumes by file-checksum.

### 2.4 Future growth: manual server-side fetcher runs

The dataset is **curated, not continuously ingested** — there's no scheduled fetcher. When we want to grow it, run the fetcher scripts (`scripts/fetch_inaturalist.py`, `scripts/fetch_bugwood.py`, etc.) directly on the server, on demand:

```bash
ssh bawler@195.201.8.147 \
  'cd /srv/line-of-bugs/current && INAT_SCALE=2 .venv/bin/python scripts/fetch_inaturalist.py'
```

That way the server's gigabit pipe does the work, not the laptop's home connection. After a fetch run, `npm run db:seed` upserts the new manifest rows. **No cron involved** — explicit, manual, repeatable.

**Server-side `.venv` setup** is a one-time step in `setup-server.sh`:

```bash
cd /srv/line-of-bugs/current
python3 -m venv .venv
.venv/bin/pip install requests Pillow csv-parse # whatever scripts/requirements.txt lists
```

---

## 3. HAProxy plan

### 3.1 Current state on the host (probed 2026-05-15)

```
HAProxy 3.0.11 (LTS until Q2 2029), OpenSSL 3.5.5, with QUIC + cache + PROMEX
Existing frontends: http-in (:80), https-in (:443 SSL with 3 certs)
Existing backends: acme-standalone (:8888), maw-agent (:3147), ntfy (:8090)
Default backend: ntfy
ACME flow: HTTP-01 via /.well-known/acme-challenge → acme-standalone
```

### 3.2 Additions for line-of-bugs

Append to `/etc/haproxy/haproxy.cfg`:

```
# ─── line-of-bugs cache (RAM, total 256 MB; thumbnails fit easily, medium partially) ───
cache lob-static
    total-max-size 256
    max-object-size 2097152      # 2 MB per object (covers medium-tier JPEGs)
    max-age 2592000              # 30 days; assets are content-hashed elsewhere or immutable

# ─── line-of-bugs backend ───
backend line-of-bugs
    option httpchk GET /api/healthz
    http-check expect status 200
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-For %[src]
    server next 127.0.0.1:3000 check inter 5s fall 3 rise 2
    # Edge-cache thumbs/medium responses (Next.js sets Cache-Control public,immutable)
    http-request cache-use lob-static if { path_beg /api/thumb/ /api/medium/ }
    http-response cache-store lob-static
    # Compression on for text-ish responses
    compression algo gzip
    compression type text/html text/plain text/css text/javascript application/javascript application/json image/svg+xml
```

And in the `https-in` frontend, add the cert to the `bind` line + a host ACL:

```
frontend https-in
    bind *:443 ssl \
        crt /etc/haproxy/certs/api.insider-streams.com.pem \
        crt /etc/haproxy/certs/api.veil.moe.pem \
        crt /etc/haproxy/certs/api.maw.finance.pem \
        crt /etc/haproxy/certs/line-of-bugs.com.pem \
        alpn h2,http/1.1
    # Common security headers, applied to all backends from this frontend
    http-response set-header Strict-Transport-Security "max-age=31536000; includeSubDomains"
    http-response set-header X-Content-Type-Options "nosniff"
    http-response set-header Referrer-Policy "strict-origin-when-cross-origin"
    http-response set-header Permissions-Policy "geolocation=(), microphone=(), camera=()"
    # … existing ACLs …
    acl is_lob hdr(host) -i line-of-bugs.com
    acl is_lob hdr(host) -i www.line-of-bugs.com
    use_backend line-of-bugs if is_lob
    # … existing default_backend ntfy …
```

A few design notes:

- **HTTP/2 via `alpn h2,http/1.1`** — Next.js doesn't speak h2 directly, but HAProxy negotiates h2 with the client and downgrades to http/1.1 to Next.js. Gallery thumbnail multiplexing benefits a lot.
- **`http-request cache-use` only for image routes** because the Next.js HTML pages are dynamic (subject to filters, user state). We rely on Next.js's built-in cache for the rendering layer; HAProxy caches the bytes-from-disk layer.
- **`option httpchk` + `inter 5s`** — HAProxy will mark the backend down if `/api/healthz` fails 3× in a row, return 503 to clients with the existing `errorfile 503` template, and keep retrying every 5 s.
- **CSP** is intentionally NOT set at HAProxy because we want it scoped per-app and tunable from Next.js. Set it via `next.config.ts` headers() or a response header. (See §6 for the proposed policy.)
- **Existing `http-in` ACME flow already works for new domains** — no changes needed there. The HTTP-01 challenge will reach the `acme-standalone` backend as it does today.

### 3.3 Apply procedure

```bash
ssh bawler@195.201.8.147
sudo cp /etc/haproxy/haproxy.cfg /etc/haproxy/haproxy.cfg.bak-pre-lob-$(date +%Y%m%d%H%M)
sudo nano /etc/haproxy/haproxy.cfg   # add the fragment above
sudo haproxy -c -f /etc/haproxy/haproxy.cfg   # syntax check
sudo systemctl reload haproxy        # reload, not restart — keeps connections
```

`reload` (not `restart`) keeps in-flight connections alive while the new config takes effect — zero-downtime, idempotent.

---

## 4. DNS + TLS

### 4.1 Namecheap DNS records

In Namecheap → Domain List → Manage `line-of-bugs.com` → Advanced DNS, set:

| Type | Host | Value | TTL |
|---|---|---|---|
| `A` | `@` | `195.201.8.147` | 5 min |
| `A` | `www` | `195.201.8.147` | 5 min |
| `CAA` | `@` | `0 issue "letsencrypt.org"` | 1 hour |
| `CAA` | `@` | `0 issuewild ";"` | 1 hour |

Remove any default Namecheap parking records (URL Redirect, CNAME for `www` to parkingpage.namecheap.com, etc.) — they take precedence over A records.

**Why those choices:**
- 5-min TTL during initial setup so DNS changes propagate fast while you're verifying. Bump to 1 hour after cutover.
- `CAA` records restrict who can issue certs for the domain to Let's Encrypt only — defends against unauthorized issuance.
- `0 issuewild ";"` says "no wildcards." We're not using them.
- No IPv6 / `AAAA` because the server only listens on IPv4 (probe confirmed `0.0.0.0:443`, no `::` listener for HAProxy). If we later add IPv6, add AAAA records.

**Optional but recommended:**

| Type | Host | Value | Purpose |
|---|---|---|---|
| `TXT` | `@` | `v=spf1 -all` | Reject mail from this domain |
| `TXT` | `_dmarc` | `v=DMARC1; p=reject; rua=mailto:postmaster@…` | DMARC reject policy |
| `MX` | `@` | (none, or `0 .`) | No mail server |

These prevent the domain from being abused for phishing.

### 4.2 Cert via acme.sh (HTTP-01 + HAProxy deploy hook)

acme.sh is already installed and runs a daily cron at 16:12 for renewals. To add `line-of-bugs.com`:

```bash
# As bawler, on the server
~/.acme.sh/acme.sh --issue \
    --standalone --httpport 8888 \
    -d line-of-bugs.com -d www.line-of-bugs.com \
    --server letsencrypt

# Configure the HAProxy deploy hook (concatenates fullchain+key into one PEM,
# copies to /etc/haproxy/certs/, hot-reloads via stats socket — no restart)
export DEPLOY_HAPROXY_PEM_PATH=/etc/haproxy/certs
export DEPLOY_HAPROXY_HOT_UPDATE=yes
export DEPLOY_HAPROXY_STATS_SOCKET=UNIX:/run/haproxy/admin.sock

~/.acme.sh/acme.sh --deploy -d line-of-bugs.com --deploy-hook haproxy
```

The deploy hook persists the env vars in acme.sh's account config, so future renewals reload HAProxy automatically. **No daily cron change is needed** — the existing `12 16 * * * acme.sh --cron` already handles renewal + redeployment.

**Verification after issuance:**

```bash
echo | openssl s_client -connect line-of-bugs.com:443 -servername line-of-bugs.com 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates
```

Should show subject `CN=line-of-bugs.com`, issuer Let's Encrypt R10/R11, valid 90 days.

### 4.3 Why HTTP-01 over DNS-01

| Aspect | HTTP-01 | DNS-01 (Namecheap API) |
|---|---|---|
| Setup friction | Zero — infra already wired | Need Namecheap API access (requires IP whitelist + manual approval, takes hours) |
| Wildcard support | No | Yes |
| Works behind CDN | Only if you control HTTP path | Yes |
| Rate limits | Standard LE | Standard LE |
| Renewal cost | None — fully automatic via existing cron | Same |

We don't need wildcards (no subdomains besides `www`), and the HTTP-01 plumbing is already battle-tested for the three existing domains. **No reason to introduce DNS-01.**

---

## 5. Security review + hardening

### 5.1 What's already good

Probed 2026-05-15:
- ✅ `PermitRootLogin no` (effective via `/etc/ssh/sshd_config.d/*.conf` override)
- ✅ `PasswordAuthentication no`, `PubkeyAuthentication yes`, `MaxAuthTries 3`
- ✅ UFW enabled, only 22 / 80 / 443 / 3147 open
- ✅ fail2ban running with sshd jail (active bans on 4 IPs at probe time)
- ✅ `unattended-upgrades` installed and enabled
- ✅ NTP synced (`systemd-timesyncd`)
- ✅ HAProxy already enforces TLS 1.2 min, modern ciphers, no-tls-tickets
- ✅ acme.sh DNS CAA records will defend against unauthorized issuance once added

### 5.2 What's missing or weak

| Severity | Issue | Fix |
|---|---|---|
| **Medium** | Kernel 6.12.86 installed but running 6.12.63 (uptime 100 days). Pending CVE patches not active. | Schedule a reboot window. Suggest immediately after the cert is verified and HAProxy reload tested — that's already a known-good state. |
| **Medium** | `journalctl --disk-usage` reports 4 GB. Will grow unbounded without limits. | Set `SystemMaxUse=1G` and `MaxRetentionSec=1month` in `/etc/systemd/journald.conf.d/limits.conf`. |
| **Low** | No SSH `AllowGroups`. `bawler` is the only human user, but a future user would default to having shell access. | Add `AllowGroups ssh-users` to sshd config, put `bawler` in `ssh-users`. |
| **Low** | Port 3147 open through UFW for legacy maw-agent. Listening on `0.0.0.0:3147`. | If maw-agent doesn't need public access, change its bind to `127.0.0.1:3147` and drop the UFW rule. (Out of scope here — flag for maw owner.) |
| **Low** | No process-level sandboxing for existing apps (`ntfy`, `maw`, etc.). | Out of scope. line-of-bugs gets `ProtectSystem=strict` via its unit. |
| **Low** | bawler has NOPASSWD sudo ALL. Convenient but broad. | Acceptable for solo admin — flag for awareness, no action recommended. |

### 5.3 App-level hardening (we own these)

| Concern | Mitigation in this plan |
|---|---|
| Admin auth | `proxy.ts` enforces Basic Auth on `/admin/*` and `/api/admin/*`, compares with bcrypt hash from env. ✓ already in place. Plan note: rotate `ADMIN_PASSWORD_HASH` post-deploy; the current `.env.local` hash will be reused on first deploy but should be regenerated for production. |
| Path traversal on `/api/img/*`, `/api/thumb/*`, `/api/medium/*` | `safeBasename()` strips non-`[a-z0-9_.-]` and rejects post-cleanup `..`. ✓ verified in `lib/streaming.ts`. |
| Report-body size | `lib/report-categories.ts` enforces 250-char limit at app layer (`ReportCategoryChips`). Verify the API route also rejects oversized bodies. |
| Report spam | No rate-limiting today. Add HAProxy stick-table for `/api/reports` if abuse appears. Document, don't pre-build. |
| Secrets in repo | `.env.local` is gitignored; `ADMIN_PASSWORD_HASH` and `SKETCHFAB_API_KEY` are NOT in commits. ✓ verified. Server uses `/srv/line-of-bugs/shared/.env` mode 600. |
| CSP | Add to `next.config.ts`: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'`. Tune `'unsafe-inline'` away after auditing inline styles. |
| Backup | SQLite is small (~7 MB). Daily snapshot via cron: `sqlite3 /srv/line-of-bugs/shared/data/db/line-of-bugs.db ".backup /srv/line-of-bugs/shared/data/db/backups/$(date +\%Y\%m\%d).db"`. Retain 30 days. |

### 5.4 Compliance: image attribution

Every image has license + attribution columns. Surface them in the UI (already done in session footer chip). For deletes, log the deletion (image_id, report_id, admin user, timestamp) — `reports` already records this via `resolvedAction='image-deleted'` + `resolvedAt`. ✓

---

## 6. Verification + performance

### 6.1 Pre-deploy gates (run from laptop before deploy.sh)

```bash
npm run test          # vitest unit — must be green
npm run test:e2e      # playwright — must be green
npx tsc --noEmit      # type-check
npm run build         # local dry-run to catch obvious build errors
```

### 6.2 Post-deploy smoke (`deploy/scripts/smoke.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
BASE="${1:-https://line-of-bugs.com}"

# 1. TLS handshake + cert validity
echo | openssl s_client -connect "${BASE#https://}:443" -servername "${BASE#https://}" 2>/dev/null \
    | openssl x509 -noout -subject -dates

# 2. Liveness
curl -fsS "$BASE/api/healthz" | grep -q '"ok":true'

# 3. Homepage renders
curl -fsS -o /dev/null -w "home %{http_code} %{time_total}s\n" "$BASE/"

# 4. Gallery first page
curl -fsS -o /dev/null -w "gallery %{http_code} %{time_total}s\n" "$BASE/gallery"

# 5. Sample thumbnail (pick first row from manifest)
SAMPLE=$(ssh bawler@195.201.8.147 'head -2 /srv/line-of-bugs/shared/data/manifest/inaturalist.csv | tail -1 | cut -d, -f7' | xargs basename)
curl -fsS -o /dev/null -w "thumb %{http_code} %{time_total}s %{size_download}b\n" "$BASE/api/thumb/$SAMPLE"

# 6. HAProxy cache HIT on second fetch of the same thumb
for i in 1 2; do
  curl -sSI "$BASE/api/thumb/$SAMPLE" | grep -iE '^(x-cache|age):'
done

# 7. Admin gate returns 401 without auth
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin")" = "401"

# 8. Session start API
curl -fsS -X POST "$BASE/api/session/start" \
  -H 'content-type: application/json' \
  -d '{"intervalSec":60,"subjectType":"both","repeatMode":"default"}' \
  | jq '.images | length' | grep -q '^[1-9][0-9]*$'

echo "smoke OK"
```

`/api/healthz` does not exist yet; add it as part of this work. Spec:

```typescript
// app/api/healthz/route.ts
import { db } from "@/db";

export async function GET() {
  // Verify DB read works (covers WAL state + file perms in one call)
  const row = db.prepare("SELECT COUNT(*) as c FROM images").get() as { c: number };
  return Response.json({ ok: true, images: row.c, ts: new Date().toISOString() });
}
```

### 6.3 Performance measurement

| Metric | Tool | Baseline target |
|---|---|---|
| Time-to-first-byte (`/`) | `curl -w '%{time_starttransfer}'` | < 100 ms (cold), < 30 ms (warm) |
| Gallery page render | wrk, `wrk -t4 -c50 -d30s` | > 200 req/s, p95 < 200 ms |
| Thumbnail fetch | wrk on `/api/thumb/<name>` | > 500 req/s, p95 < 20 ms (cache hit) |
| Lighthouse score | `lhci collect --url=https://line-of-bugs.com` | Perf 85+, A11y 95+, BP 95+ |
| Image bytes-on-wire | Chrome DevTools network panel on gallery scroll | Thumbnails ~30 KB each, medium ~150 KB |
| SQLite query latency | `EXPLAIN QUERY PLAN` + EXPLAIN ANALYZE timings | < 5 ms on `searchGallery` for typical filters |
| Memory steady state | `systemctl status line-of-bugs` + `pmap` | < 500 MB RSS after warmup |

Baseline these once on day 1; rerun after big changes (image count growth, schema migrations).

### 6.4 Observability

- **Logs:** `journalctl -u line-of-bugs -f` (app), `journalctl -u haproxy -f` (proxy). Tag-search by SyslogIdentifier.
- **HAProxy stats:** the `PROMEX` feature is compiled in. Expose with a stats listener bound to localhost:9101, then scrape with Prometheus if/when we add one. Not building Prom now — just noting that the door is open.
- **App errors:** Next.js logs to stdout; journald captures them. For first month, monitor with `journalctl -u line-of-bugs --since='1 hour ago' | grep -iE 'error|warn'`. Add Sentry if errors become hard to triage.

### 6.5 Rollback

Rolling back is `ln -sfn /srv/line-of-bugs/releases/<prev-sha> /srv/line-of-bugs/current && sudo systemctl restart line-of-bugs`. The script exposes this as `deploy.sh --rollback <sha>`.

If the schema migrated and the rollback would need to *undo* it, that's not free — Drizzle migrations are forward-only. Document in the PR description if a migration is destructive; otherwise rollback is a 2-second symlink flip.

---

## Decision log (justification for the non-obvious calls)

1. **Bare-metal over Docker** — see §1.2. Single workload, persistent state, native module, established host pattern.
2. **Server-side build over local build** — eliminates the macOS→linux native-binding mismatch and saves ~150 MB of node_modules per deploy. Build cost on this server is negligible (~30 s warm).
3. **HAProxy cache over Nginx** — HAProxy 3.0 has the cache module compiled in. Adding Nginx would be a second reverse proxy for no incremental benefit at this scale.
4. **HTTP-01 over DNS-01** — the existing acme-standalone backend at port 8888 already handles HTTP-01 for three other domains. Adding a fourth is one command.
5. **Symlinked releases over in-place git checkout** — clean rollback story; previous releases preserved on disk for 5 builds.
6. **Image dataset stays on the server** — laptop never re-uploads the 36 GB. Future growth runs fetchers server-side. Initial seed is a one-time rsync.
7. **No CDN** — line-of-bugs is a school/educational tool with modest expected traffic. HAProxy + browser cache + immutable filenames gets us 95% of CDN value without the operational cost. Revisit if traffic patterns demand it.

---

## Open questions (need user confirmation before execution)

1. **`www` vs apex canonical form** — recommend canonicalising on apex (`line-of-bugs.com`). The HAProxy ACL already covers both; we just need to pick which one redirects to which. Default: `www` → `301` → apex.
2. **Initial admin password.** The current `ADMIN_PASSWORD_HASH` in `.env.local` is the dev hash. Should I generate a fresh production hash, hand you the cleartext securely, and rotate the local one? Or are you happy to keep this for v1?
3. **Backup retention.** 30-day rolling SQLite backups + the manifest CSVs (which are reproducible from fetcher runs anyway) — acceptable? Or do you want an off-host destination?
4. **Image dataset growth cadence.** The `INAT_SCALE=8.5` background run just landed +24k images. Are we expecting more growth runs server-side, and if so on what trigger (manual / weekly cron)?
5. **Deploy authorization.** Right now `deploy.sh` runs as `bawler` who has NOPASSWD sudo. Is that fine, or should we narrow to just `systemctl restart line-of-bugs`?
6. **GitHub or self-hosted git origin?** The deploy script assumes `git push origin <ref>` works. If the repo isn't on GitHub yet, we'll either push to the server's bare mirror directly (simpler) or set up a GitHub remote (better team workflow).

---

## Execution sequencing (when we're ready to ship)

1. Add DNS records at Namecheap (5-min TTL); wait for propagation (`dig +short line-of-bugs.com @8.8.8.8`).
2. Run `setup-server.sh` to create `/srv/line-of-bugs/{shared,releases,line-of-bugs.git}`, install Python venv, write systemd unit, install HAProxy fragment.
3. Run `seed-images.sh` to rsync the 36 GB dataset. (~1.6 h on 50 Mbps up; can run overnight.)
4. Run `issue-cert.sh` to mint the TLS cert and install the HAProxy deploy hook.
5. Verify HAProxy syntax (`haproxy -c`), reload, confirm cert serving (openssl s_client).
6. First deploy: `deploy.sh main`.
7. Run `smoke.sh https://line-of-bugs.com`.
8. Bump DNS TTL to 1 h.
9. Schedule reboot window for the kernel update (6.12.86 awaiting activation).

Total wall time on a clean run: ~2 h, almost all of it the image seed.
