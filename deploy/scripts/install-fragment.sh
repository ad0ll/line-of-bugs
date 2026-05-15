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

# Ship the fragment via stdin to avoid an scp
scp "$FRAGMENT" "$TARGET:/tmp/lob-haproxy-fragment.cfg"

ssh "$TARGET" bash -s <<'REMOTE'
set -euo pipefail
CFG=/etc/haproxy/haproxy.cfg
BAK="$CFG.bak-lob-$(date +%Y%m%d%H%M%S)"
FRAG=/tmp/lob-haproxy-fragment.cfg

# 1. Backup
sudo cp -a "$CFG" "$BAK"
echo "→ backup at $BAK"

# 2. Idempotency: if our markers already exist, refuse to append twice
if grep -q '─── BEGIN line-of-bugs BLOCK' "$CFG"; then
    echo "Markers already present in $CFG — not re-appending the BLOCK."
    echo "Edit the file manually if you need to update the appended section."
else
    # 3. Extract the BLOCK content (between BEGIN/END BLOCK markers in the fragment)
    awk '/─── BEGIN line-of-bugs BLOCK/,/─── END line-of-bugs BLOCK/' "$FRAG" \
        | sudo tee -a "$CFG" >/dev/null
    echo "→ appended BLOCK section"
fi

# 4. Show the manual edits the engineer must apply
echo
echo "════════════════════════════════════════════════════════"
echo "MANUAL EDITS REQUIRED — edit /etc/haproxy/haproxy.cfg now"
echo "════════════════════════════════════════════════════════"
sed -n '/FRONTEND EDITS/,$ p' "$FRAG"
echo
echo "When edits are saved, this script will validate + reload."
read -r -p "Press ENTER when manual edits are complete: " _

# 5. Validate the config
if sudo haproxy -c -f "$CFG"; then
    echo "→ config valid"
else
    echo "ERROR: config validation FAILED. Restore with:"
    echo "       sudo cp $BAK $CFG"
    exit 1
fi

# 6. Reload (zero-downtime; keeps existing connections alive)
sudo systemctl reload haproxy

# 7. Sanity: HAProxy is still active after reload
sudo systemctl is-active haproxy
echo "=== install-fragment DONE ==="
REMOTE
