#!/usr/bin/env bash
# deploy/scripts/seed-images.sh — one-time rsync of data/ from laptop → server.
# Resumable: if interrupted, rerun and rsync picks up where it left off.

set -euo pipefail
TARGET="bawler@195.201.8.147"
DST="/srv/line-of-bugs/shared/data"
LOCAL_DATA="$(git rev-parse --show-toplevel)/data"

if [ ! -d "$LOCAL_DATA/images" ]; then
    echo "ERROR: $LOCAL_DATA/images doesn't exist. Run fetchers first."
    exit 1
fi

ssh "$TARGET" "mkdir -p $DST/{images,medium,thumbnails,manifest,db,db/backups,logs}"

# --partial: keep partial files for resume
# --info=progress2: single-line total progress (not per-file spam)
# --exclude TEMP-*: skip local audit-only directories
COMMON_FLAGS=(-aHX --partial --info=progress2 --exclude='TEMP-*' --exclude='*.tmp' --exclude='*-shm' --exclude='*-wal')

echo "→ images (largest, ~31 GB)"
rsync "${COMMON_FLAGS[@]}" --delete "$LOCAL_DATA/images/" "$TARGET:$DST/images/"

echo "→ medium (~3.9 GB)"
rsync "${COMMON_FLAGS[@]}" --delete "$LOCAL_DATA/medium/" "$TARGET:$DST/medium/"

echo "→ thumbnails (~1.1 GB)"
rsync "${COMMON_FLAGS[@]}" --delete "$LOCAL_DATA/thumbnails/" "$TARGET:$DST/thumbnails/"

echo "→ manifest (~19 MB)"
rsync "${COMMON_FLAGS[@]}" "$LOCAL_DATA/manifest/" "$TARGET:$DST/manifest/"

echo "→ db (small — 7 MB)"
rsync "${COMMON_FLAGS[@]}" "$LOCAL_DATA/db/" "$TARGET:$DST/db/"

echo "=== seed-images DONE ==="
ssh "$TARGET" "du -sh $DST/* | sort -h"
