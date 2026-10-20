#!/usr/bin/env bash
# Monthly restore test: restores a backup into a SCRATCH database and runs sanity checks.
# Never points at production — the target database name must end in _restore_check.
#
#   ops/backup/wewin-restore-check.sh /var/backups/wewin/2026-10-20_0130
#
# Environment: RESTORE_ADMIN_URL = connection to the maintenance DB (postgres) on the restore server,
#              e.g. postgresql://wewin_admin@localhost:5432/postgres
set -euo pipefail

src="${1:?usage: wewin-restore-check.sh <backup folder>}"
: "${RESTORE_ADMIN_URL:?RESTORE_ADMIN_URL is required}"
target="${RESTORE_DB:-wewin_erp_restore_check}"
case "$target" in *_restore_check) ;; *) echo "Refusing: target database must end in _restore_check" >&2; exit 2 ;; esac

( cd "$src" && sha256sum --check SHA256SUMS )

base="${RESTORE_ADMIN_URL%/*}"
psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$target\";" -c "CREATE DATABASE \"$target\";"
pg_restore --no-owner --exit-on-error --dbname="$base/$target" "$src/wewin_erp.dump"

echo "Sanity checks on $target:"
psql "$base/$target" -v ON_ERROR_STOP=1 -At <<'SQL'
SELECT 'migrations applied: ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT 'users: ' || count(*) FROM users;
SELECT 'posted documents in audit log: ' || count(*) FROM audit_log WHERE action = 'POST';
SELECT 'stock movements: ' || count(*) FROM stock_movements;
-- Ledger invariant (D-05): no store or vendor location holds a negative balance of any item.
SELECT 'negative balances outside virtual locations (must be 0): ' || count(*) FROM (
  SELECT m.item_id, l.id
  FROM locations l
  JOIN (
    SELECT item_id, to_location_id AS loc, qty FROM stock_movements
    UNION ALL
    SELECT item_id, from_location_id, -qty FROM stock_movements
  ) m ON m.loc = l.id
  WHERE l.kind <> 'VIRTUAL'
  GROUP BY m.item_id, l.id
  HAVING sum(m.qty) < 0
) x;
SELECT 'latest posting: ' || coalesce(max(posted_at)::text, 'none') FROM stock_movements;
SQL

mkdir -p "/tmp/$target-files"
tar --extract --gzip --file="$src/storage.tar.gz" --directory="/tmp/$target-files"
echo "files restored: $(find "/tmp/$target-files" -type f | wc -l) (in /tmp/$target-files)"
echo "Restore check OK — record the date and figures in the restore log, then drop $target and the temp folder."
