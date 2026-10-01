#!/bin/sh
set -eu
# Run from deployment directory with Docker Compose and .env loaded.
DEST=${1:-./backups}
mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T postgres pg_dump -U seo -d seo -Fc > "$DEST/seo-$STAMP.dump"
find "$DEST" -type f -name 'seo-*.dump' -mtime +30 -delete
