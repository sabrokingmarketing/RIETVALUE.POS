#!/usr/bin/env bash
# Nightly backup: database (custom-format dump) + uploaded photos, kept for 30 days.
#   DATABASE_URL=... UPLOAD_DIR=./uploads BACKUP_DIR=./backups scripts/backup.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
STAMP="$(TZ=Africa/Johannesburg date +%Y-%m-%d_%H%M)"
mkdir -p "$BACKUP_DIR"
pg_dump --format=custom --no-owner --file "$BACKUP_DIR/db_$STAMP.dump" "$DATABASE_URL"
tar -czf "$BACKUP_DIR/photos_$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
pg_restore --list "$BACKUP_DIR/db_$STAMP.dump" > /dev/null   # verify the dump is readable
find "$BACKUP_DIR" -type f -mtime +30 -delete
echo "Backup written: $BACKUP_DIR/db_$STAMP.dump and photos_$STAMP.tar.gz"
