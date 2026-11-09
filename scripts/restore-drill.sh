#!/usr/bin/env bash
# Restore the newest backup into a throw-away database and compare counts with live. Never touches live data.
set -euo pipefail
set -a; . ./.env; set +a
BACKUP_DIR="${BACKUP_DIR:-/srv/backups}"
DUMP=$(ls -t "$BACKUP_DIR"/db_*.dump | head -1)
SCRATCH="${RESTORE_DRILL_DB:-nursery_restore_drill}"
BASE="${DATABASE_URL%/*}"
psql "$DATABASE_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
pg_restore --no-owner --exit-on-error --dbname "$BASE/$SCRATCH" "$DUMP"
L=$(psql "$DATABASE_URL" -Atc "select count(*) from sales")
R=$(psql "$BASE/$SCRATCH" -Atc "select count(*) from sales")
echo "$(date -Is) drill: $DUMP restored; sales live=$L restored=$R"
psql "$DATABASE_URL" -qc "DROP DATABASE $SCRATCH"
