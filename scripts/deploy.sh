#!/usr/bin/env bash
# Plain-Node deployment on the server (see README → Deploy). Run from the app directory as the app user.
#   scripts/deploy.sh v2.0.0
set -euo pipefail
TAG="${1:?release tag, e.g. v2.0.0}"
set -a; . ./.env; set +a
export NODE_ENV=production
echo "1/6 Fetching $TAG"; git fetch --tags --quiet && git checkout --quiet "$TAG"
echo "2/6 Installing dependencies"; npm ci --no-audit --no-fund
echo "3/6 Backing up the database and photos"; BACKUP_DIR="${BACKUP_DIR:-./backups}" scripts/backup.sh
echo "4/6 Building"; npm run build
echo "5/6 Applying migrations"; npm run db:migrate
echo "6/6 Restarting"; sudo systemctl restart nursery-pos
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null; then echo "Healthy. Deployed $TAG."; exit 0; fi
  sleep 2
done
echo "Health check failed. Roll back: git checkout <previous tag> && npm ci && npm run build && sudo systemctl restart nursery-pos"; exit 1
