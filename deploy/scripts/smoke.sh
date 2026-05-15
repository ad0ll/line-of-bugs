#!/usr/bin/env bash
# deploy/scripts/smoke.sh — post-deploy verification.
# Usage:
#     ./deploy/scripts/smoke.sh https://line-of-bugs.com
#     ./deploy/scripts/smoke.sh http://127.0.0.1:3000  # (server-local, no TLS)

set -euo pipefail
BASE="${1:-https://line-of-bugs.com}"
PASS=0
FAIL=0

check() {
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        printf "  \e[32m✓\e[0m %s\n" "$label"; PASS=$((PASS+1))
    else
        printf "  \e[31m✗\e[0m %s\n" "$label"; FAIL=$((FAIL+1))
    fi
}

echo "smoke against $BASE"

# 1. TLS cert sanity (only for https)
if [[ "$BASE" == https://* ]]; then
    HOST="${BASE#https://}"; HOST="${HOST%%/*}"
    check "tls handshake + cert valid" \
        bash -c "echo | openssl s_client -connect $HOST:443 -servername $HOST 2>/dev/null | openssl x509 -noout -dates"
fi

# 2. Liveness
check "/api/healthz returns 200 ok:true" \
    bash -c "curl -fsS '$BASE/api/healthz' | grep -q '\"ok\":true'"

# 3. Homepage
check "/ returns 200" curl -fsS -o /dev/null "$BASE/"

# 4. Gallery
check "/gallery returns 200" curl -fsS -o /dev/null "$BASE/gallery"

# 5. Sample thumbnail (pick any from the manifest on the server, basename only)
SAMPLE=$(ssh bawler@195.201.8.147 \
    'ls /srv/line-of-bugs/shared/data/thumbnails | head -1' 2>/dev/null || echo "")
if [ -n "$SAMPLE" ]; then
    check "/api/thumb/$SAMPLE returns 200" curl -fsS -o /dev/null "$BASE/api/thumb/$SAMPLE"
    # Cache HIT on second fetch — HAProxy adds Age: header when serving from cache
    AGE=$(curl -sSI "$BASE/api/thumb/$SAMPLE" | awk -F'[: ]+' '/^[Aa]ge/ {print $2}' | head -1)
    if [ -n "$AGE" ] && [ "$AGE" -ge 0 ]; then
        printf "  \e[32m✓\e[0m haproxy cache HIT (Age: %ss)\n" "$AGE"; PASS=$((PASS+1))
    else
        # First request to this thumb may MISS. Re-fetch to populate, try again.
        curl -sSI "$BASE/api/thumb/$SAMPLE" >/dev/null
        sleep 1
        AGE=$(curl -sSI "$BASE/api/thumb/$SAMPLE" | awk -F'[: ]+' '/^[Aa]ge/ {print $2}' | head -1)
        if [ -n "$AGE" ]; then
            printf "  \e[32m✓\e[0m haproxy cache HIT after warm-up (Age: %ss)\n" "$AGE"; PASS=$((PASS+1))
        else
            printf "  \e[33m!\e[0m haproxy cache MISS — investigate cache-store directive\n"
        fi
    fi
fi

# 6. Admin gate returns 401 without auth
ADMIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin")
if [ "$ADMIN_STATUS" = "401" ]; then
    printf "  \e[32m✓\e[0m /admin returns 401 without auth\n"; PASS=$((PASS+1))
else
    printf "  \e[31m✗\e[0m /admin returned %s (expected 401)\n" "$ADMIN_STATUS"; FAIL=$((FAIL+1))
fi

# 7. Session start API
check "/api/session/start returns sessionId" \
    bash -c "curl -fsS -X POST '$BASE/api/session/start' -H 'content-type: application/json' -d '{\"intervalSec\":60,\"subjectType\":\"both\",\"repeatMode\":\"default\"}' | grep -Eq '\"sessionId\":\"[a-f0-9-]+\"'"

# 8. Security headers present
for h in strict-transport-security content-security-policy x-content-type-options referrer-policy; do
    check "$h header present" \
        bash -c "curl -sSI '$BASE/' | grep -iq '^$h:'"
done

echo
echo "smoke: $PASS passed, $FAIL failed"
exit $FAIL
