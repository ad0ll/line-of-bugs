#!/usr/bin/env bash
# deploy/scripts/issue-cert.sh — issue line-of-bugs.com cert via existing
# acme.sh HTTP-01 flow and wire up the haproxy deploy hook.
#
# Prerequisites:
#   - Namecheap A records for @ and www point to 195.201.8.147 (Task C1).
#   - acme.sh already configured on the server (it is — managing 3 other domains).
#   - The acme-standalone backend already exists in haproxy.cfg (it does).

set -euo pipefail
TARGET="bawler@195.201.8.147"

ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
DOMAIN=line-of-bugs.com
ACME=$HOME/.acme.sh/acme.sh

# 1. Sanity-check DNS resolves to this host (fail fast if not propagated yet)
RESOLVED=$(dig +short "$DOMAIN" @8.8.8.8 | head -1)
if [ "$RESOLVED" != "195.201.8.147" ]; then
    echo "ERROR: $DOMAIN resolves to '$RESOLVED' (expected 195.201.8.147)."
    echo "       Wait for DNS propagation, then rerun."
    exit 1
fi

# 2. Issue the cert (LE production, HTTP-01 via existing standalone backend on :8888)
"$ACME" --issue \
    --standalone --httpport 8888 \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --server letsencrypt

# 3. Configure the HAProxy deploy hook with hot-reload via stats socket
# (Setting these env vars persists them in acme.sh's account config for future
# automatic renewals via the existing 12 16 * * * cron.)
export DEPLOY_HAPROXY_PEM_PATH=/etc/haproxy/certs
export DEPLOY_HAPROXY_HOT_UPDATE=yes
export DEPLOY_HAPROXY_STATS_SOCKET="UNIX:/run/haproxy/admin.sock"

# Make sure the certs dir is writable by bawler (root owns it by default)
sudo install -d -o bawler -g haproxy -m 750 /etc/haproxy/certs 2>/dev/null || true

"$ACME" --deploy -d "$DOMAIN" --deploy-hook haproxy

# 4. Verify the PEM landed in place
ls -la /etc/haproxy/certs/line-of-bugs.com.pem
REMOTE
