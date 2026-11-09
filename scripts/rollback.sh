#!/usr/bin/env bash
# Roll the database back one migration (after redeploying the previous release).
#   DATABASE_URL=... scripts/rollback.sh 0003_import_export
# Always run scripts/backup.sh first; the rollback refuses to start without a backup from the last hour.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"
NAME="${1:?migration name, e.g. 0003_import_export}"
FILE="migrations/rollback/${NAME}.down.sql"
[ -f "$FILE" ] || { echo "No rollback script $FILE"; exit 1; }
BACKUP_DIR="${BACKUP_DIR:-./backups}"
if [ -z "$(find "$BACKUP_DIR" -name 'db_*.dump' -mmin -60 2>/dev/null | head -1)" ]; then
  echo "Refusing: no backup newer than 60 minutes in $BACKUP_DIR. Run scripts/backup.sh first."; exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$FILE"
echo "Rolled back $NAME."
