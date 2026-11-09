#!/usr/bin/env bash
# Restore a backup into an EMPTY database (never over the live one without a fresh backup first).
#   RESTORE_DATABASE_URL=postgres://.../nursery_restore scripts/restore.sh backups/db_2026-11-09_2300.dump [backups/photos_....tar.gz]
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point at an empty database}"
DUMP="${1:?path to db_*.dump}"
PHOTOS="${2:-}"
TABLES=$(psql "$RESTORE_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")
if [ "$TABLES" != "0" ]; then echo "Refusing: target database is not empty ($TABLES tables)"; exit 1; fi
pg_restore --no-owner --exit-on-error --dbname "$RESTORE_DATABASE_URL" "$DUMP"
if [ -n "$PHOTOS" ]; then mkdir -p "${UPLOAD_DIR:-./uploads}"; tar -xzf "$PHOTOS" -C "$(dirname "${UPLOAD_DIR:-./uploads}")"; fi
psql "$RESTORE_DATABASE_URL" -Atc "select 'sales: ' || count(*) from sales; select 'variants: ' || count(*) from variants; select 'last migration: ' || max(version) from schema_migrations;"
echo "Restore complete. Point DATABASE_URL at this database and restart the app."
