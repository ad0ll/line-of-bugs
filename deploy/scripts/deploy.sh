#!/usr/bin/env bash
# deploy/scripts/deploy.sh — the everyday code deploy.
# Usage:
#     ./deploy/scripts/deploy.sh                # deploy current HEAD
#     ./deploy/scripts/deploy.sh main           # deploy main branch tip
#     ./deploy/scripts/deploy.sh --rollback <sha>

set -euo pipefail
TARGET="bawler@195.201.8.147"
APP=/srv/line-of-bugs

if [ "${1:-}" = "--rollback" ]; then
    SHA="${2:?usage: --rollback <sha>}"
    ssh "$TARGET" "
        set -euo pipefail
        test -d $APP/releases/$SHA
        ln -sfn $APP/releases/$SHA $APP/current
        sudo systemctl restart line-of-bugs
        echo 'rolled back to $SHA'
    "
    "$(dirname "$0")/smoke.sh" https://line-of-bugs.com
    exit 0
fi

REF="${1:-HEAD}"
SHA=$(git rev-parse --short "$REF")
FULL_SHA=$(git rev-parse "$REF")

echo "→ push origin $REF"
git push origin "$REF"

ssh "$TARGET" bash -s "$FULL_SHA" "$SHA" <<'REMOTE'
set -euo pipefail
FULL_SHA="$1"
SHA="$2"
APP=/srv/line-of-bugs
REL="$APP/releases/$SHA"

# 1. Stage release directory if new
if [ ! -d "$REL" ]; then
    git clone --depth 1 https://github.com/ad0ll/line-of-bugs.git "$REL"
    cd "$REL"
    git fetch --depth 1 origin "$FULL_SHA"
    git checkout -q "$FULL_SHA"
else
    cd "$REL"
fi

# 2. Link shared paths into the release
ln -sfn "$APP/shared/data" "$REL/data"
ln -sfn "$APP/shared/.env" "$REL/.env"

# 3. Install + build
npm ci --prefer-offline --no-audit --no-fund
npm run build

# 4. Run migrations (drizzle-kit migrate is idempotent, no-op if nothing pending)
DATABASE_URL="$APP/shared/data/db/line-of-bugs.db" npm run db:migrate

# 5. Atomic promote + restart
ln -sfn "$REL" "$APP/current"
sudo systemctl restart line-of-bugs

# 6. Keep the last 5 releases for fast rollback (excluding scaffold + current)
ls -1dt "$APP/releases"/*/ \
    | grep -v 'scaffold' \
    | tail -n +6 \
    | xargs -r rm -rf

echo "=== deploy $SHA DONE ==="
REMOTE

# 7. Local-side post-deploy smoke
"$(dirname "$0")/smoke.sh" https://line-of-bugs.com
