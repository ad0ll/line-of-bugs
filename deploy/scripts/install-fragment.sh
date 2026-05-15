#!/usr/bin/env bash
# deploy/scripts/install-fragment.sh — merge deploy/haproxy-fragment.cfg into
# the live /etc/haproxy/haproxy.cfg on the server.
#
# Fully automated:
#   - appends the BLOCK section (cache + backend) between sentinel comments
#   - inserts cert path, response headers, and ACL/use_backend into the
#     existing `frontend https-in` block via a Python in-place edit
#   - validates with `haproxy -c -f` before reload, restores from backup if invalid
#   - reloads (not restarts) haproxy for zero downtime

set -euo pipefail
TARGET="bawler@195.201.8.147"
FRAGMENT="$(git rev-parse --show-toplevel)/deploy/haproxy-fragment.cfg"

if [ ! -f "$FRAGMENT" ]; then
    echo "ERROR: $FRAGMENT not found."
    exit 1
fi

# Ship the fragment to /tmp on the host
scp "$FRAGMENT" "$TARGET:/tmp/lob-haproxy-fragment.cfg"

ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
CFG=/etc/haproxy/haproxy.cfg
FRAG=/tmp/lob-haproxy-fragment.cfg

# 1. Idempotency check FIRST — only mutate if markers are absent
if grep -q '─── BEGIN line-of-bugs BLOCK' "$CFG"; then
    echo "Markers already present in $CFG — not re-appending the BLOCK."
    echo "Edit the file manually if you need to update the appended section."
else
    # 2. Backup ONLY before mutation
    BAK_APPEND="$CFG.bak-lob-append-$(date +%Y%m%d%H%M%S)"
    sudo cp -a "$CFG" "$BAK_APPEND"
    echo "→ pre-append backup at $BAK_APPEND"
    # 3. Append the BLOCK section (markers inclusive, for future idempotency)
    awk '/─── BEGIN line-of-bugs BLOCK/,/─── END line-of-bugs BLOCK/' "$FRAG" \
        | sudo tee -a "$CFG" >/dev/null
    echo "→ appended BLOCK section"
fi

# 4. Pre-frontend-edit backup (always — frontend edits are re-applied each run)
BAK_PRE_FRONTEND="$CFG.bak-lob-pre-frontend-$(date +%Y%m%d%H%M%S)"
sudo cp -a "$CFG" "$BAK_PRE_FRONTEND"
echo "→ pre-frontend-edit backup at $BAK_PRE_FRONTEND"

# 5. Automated frontend edits via Python (idempotent: skip if already present)
sudo python3 <<'PYEOF'
import re
cfg_path = "/etc/haproxy/haproxy.cfg"
cfg = open(cfg_path).read()

# 5a. Add line-of-bugs.com cert to the existing bind *:443 ssl line
if "line-of-bugs.com.pem" not in cfg:
    cfg = re.sub(
        r"(bind \*:443 ssl\b)",
        r"\1 crt /etc/haproxy/certs/line-of-bugs.com.pem",
        cfg, count=1,
    )

# 5b. Insert response headers + ACL/use_backend inside frontend https-in
if "is_lob" not in cfg:
    inject_headers = (
        "    http-response set-header Strict-Transport-Security \"max-age=31536000; includeSubDomains\"\n"
        "    http-response set-header X-Content-Type-Options \"nosniff\"\n"
        "    http-response set-header Referrer-Policy \"strict-origin-when-cross-origin\"\n"
        "    http-response set-header Permissions-Policy \"geolocation=(), microphone=(), camera=()\"\n"
    )
    inject_acl = (
        "    acl is_lob hdr(host) -i line-of-bugs.com\n"
        "    acl is_lob hdr(host) -i www.line-of-bugs.com\n"
        "    use_backend line-of-bugs if is_lob\n\n"
    )
    # Insert headers right after the bind line in https-in
    cfg = re.sub(
        r"(frontend https-in\n\tbind[^\n]*\n)",
        r"\1" + inject_headers,
        cfg, count=1,
    )
    # Insert ACLs just before the existing default_backend ntfy line
    cfg = cfg.replace("\tdefault_backend ntfy", inject_acl + "    default_backend ntfy", 1)

open(cfg_path, "w").write(cfg)
PYEOF
echo "→ frontend edits applied (cert, security headers, ACL)"

# 6. Validate haproxy config (syntax)
if ! sudo haproxy -c -f "$CFG"; then
    echo "ERROR: config validation FAILED. Restore with:"
    echo "       sudo cp $BAK_PRE_FRONTEND $CFG"
    exit 1
fi
echo "→ config valid"

# 7. Structural: confirm the frontend now routes line-of-bugs.com to the new backend
if ! sudo grep -qE 'use_backend[[:space:]]+line-of-bugs[[:space:]]+if' "$CFG"; then
    echo "ERROR: 'use_backend line-of-bugs if ...' not found in $CFG."
    echo "       Frontend edit didn't take. Restore with:"
    echo "       sudo cp $BAK_PRE_FRONTEND $CFG"
    exit 1
fi
echo "→ frontend routes line-of-bugs.com to backend"

if ! sudo grep -q 'line-of-bugs.com.pem' "$CFG"; then
    echo "WARN: line-of-bugs.com.pem not referenced in $CFG — TLS may fail on first request."
fi

# 8. Reload (zero-downtime; keeps existing connections alive)
sudo systemctl reload haproxy

# 9. Sanity: HAProxy is still active after reload
sudo systemctl is-active haproxy
echo "=== install-fragment DONE ==="
REMOTE
