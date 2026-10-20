#!/usr/bin/env bash
# Daily backup of Wewin ERP: database (pg_dump custom format) + file storage (attachments, scans).
# Cron (as the wewin user): 30 1 * * *  /srv/wewin/current/ops/backup/wewin-backup.sh >> /var/log/wewin/backup.log 2>&1
#
# Reads from the environment (or /srv/wewin/shared/backup.env):
#   DATABASE_URL     connection string of the production database (read-only role is enough)
#   STORAGE_DIR      the API's STORAGE_DIR (attachments/, scans/; exports/ and ocr-cache/ are skipped)
#   BACKUP_DIR       local backup folder, e.g. /var/backups/wewin
#   RETENTION_DAYS   default 30
#   OFFSITE_REMOTE   optional rclone remote:path for the off-site copy, e.g. wewin-offsite:wewin-erp
set -euo pipefail

[ -f /srv/wewin/shared/backup.env ] && set -a && . /srv/wewin/shared/backup.env && set +a
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${STORAGE_DIR:?STORAGE_DIR is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

stamp="$(TZ=Asia/Kolkata date +%Y-%m-%d_%H%M)"
dir="$BACKUP_DIR/$stamp"
mkdir -p "$dir"
chmod 700 "$BACKUP_DIR" "$dir"

echo "[$stamp] database dump"
pg_dump --format=custom --compress=6 --no-owner --file="$dir/wewin_erp.dump" "$DATABASE_URL"
# Fail loudly if the dump cannot be read back.
pg_restore --list "$dir/wewin_erp.dump" > /dev/null

echo "[$stamp] file storage"
tar --create --gzip --file="$dir/storage.tar.gz" --directory="$STORAGE_DIR" \
  --exclude='./exports' --exclude='./ocr-cache' --exclude='./test' .

( cd "$dir" && sha256sum wewin_erp.dump storage.tar.gz > SHA256SUMS )

if [ -n "${OFFSITE_REMOTE:-}" ]; then
  echo "[$stamp] off-site copy → $OFFSITE_REMOTE/$stamp"
  rclone copy "$dir" "$OFFSITE_REMOTE/$stamp" --immutable
fi

echo "[$stamp] removing local backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
echo "[$stamp] done: $(du -sh "$dir" | cut -f1)"
