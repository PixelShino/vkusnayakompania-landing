#!/usr/bin/env bash
# Nightly backup of the Directus database and uploads, 14 days kept.
# Ночной бэкап базы Directus и загрузок, хранится 14 дней.
set -euo pipefail

DIR=/srv/vkus/site/directus
OUT=/srv/backups
STAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$OUT"
docker compose -f "$DIR/docker-compose.yml" --env-file "$DIR/.env" \
  exec -T database pg_dump -U directus directus | gzip > "$OUT/db-$STAMP.sql.gz"
tar -czf "$OUT/uploads-$STAMP.tar.gz" -C "$DIR" uploads
find "$OUT" -type f -mtime +14 -delete
echo "бэкап $STAMP"
