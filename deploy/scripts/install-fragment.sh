#!/usr/bin/env bash
# deploy/scripts/install-fragment.sh — merge deploy/haproxy-fragment.cfg into
# the live /etc/haproxy/haproxy.cfg on the server.
#
# Does the safe automated part (append the BLOCK section between sentinel
# comments). Prints the manual frontend edits the engineer must apply with $EDITOR.

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

# 5. Show the manual edits the engineer must apply
echo
echo "════════════════════════════════════════════════════════"
echo "MANUAL EDITS REQUIRED — edit /etc/haproxy/haproxy.cfg now"
echo "════════════════════════════════════════════════════════"
sed -n '/FRONTEND EDITS/,$ p' "$FRAG"
echo
echo "When edits are saved, this script will validate + reload."
read -r -p "Press ENTER when manual edits are complete: " _

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
    echo "       Did you skip the manual ACL edit? Restore with:"
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
