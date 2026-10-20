# Backups and restore

Targets (SCOPE, ARCHITECTURE §13): **daily backups, 30-day retention, monthly restore test**;
RPO 24 h (minutes with managed PITR), RTO 4 h.

## What is backed up

| Data | Where | How |
|---|---|---|
| Database (all documents, ledger, audit log, settings, users) | PostgreSQL | `pg_dump --format=custom`, checked with `pg_restore --list` |
| Attachments and scanned documents | `STORAGE_DIR/attachments`, `STORAGE_DIR/scans` | `tar.gz` |
| Not backed up (rebuilt automatically) | `STORAGE_DIR/exports` (report files, 7-day life), `STORAGE_DIR/ocr-cache` | — |
| Configuration | `/srv/wewin/shared/.env` | Kept in the company password manager, **not** in the backup files |

Each backup folder holds `wewin_erp.dump`, `storage.tar.gz` and `SHA256SUMS`.

## Daily backup

`ops/backup/wewin-backup.sh` — run by cron as the `wewin` user at 01:30 IST:

```bash
30 1 * * *  /srv/wewin/current/ops/backup/wewin-backup.sh >> /var/log/wewin/backup.log 2>&1
```

Settings in `/srv/wewin/shared/backup.env` (chmod 600): `DATABASE_URL` (read-only backup role),
`STORAGE_DIR`, `BACKUP_DIR=/var/backups/wewin`, `RETENTION_DAYS=30`, and `OFFSITE_REMOTE` (an rclone
remote in a different region / provider; the copy is made with `--immutable`). Off-site retention is set
on the bucket (30 days, object lock if available) so a compromised server cannot delete old backups.

With managed PostgreSQL, also enable the provider's point-in-time recovery (7+ days); the daily dump
remains the portable copy.

A backup is also taken **before every production migration** (DEPLOYMENT.md §5).

Check daily (or alert on): the log ends with `done:`; the folder size is in line with the previous days.

## Monthly restore test

On the staging server (never production), with the latest off-site backup:

```bash
rclone copy wewin-offsite:wewin-erp/<stamp> /tmp/restore/<stamp>
RESTORE_ADMIN_URL=postgresql://wewin_admin@localhost:5432/postgres \
  /srv/wewin/current/ops/backup/wewin-restore-check.sh /tmp/restore/<stamp>
```

The script verifies checksums, restores into `wewin_erp_restore_check` (it refuses any other name),
and prints sanity figures: migrations applied, users, posted documents, stock movements, **negative
balances outside virtual locations (must be 0)**, latest posting, and the number of files restored.
Record the date, backup stamp, figures and time taken in the restore log (owner: Phoenixx IT; reviewed by Wewin).

## Full restore (disaster recovery)

1. Stop the API: `pm2 stop wewin-api`.
2. Provision the database server; create the roles (DEPLOYMENT.md §2) and an empty `wewin_erp`.
3. `pg_restore --no-owner --role=wewin_owner --dbname=<wewin_erp url> wewin_erp.dump`
   (with managed PITR: restore to the chosen time instead).
4. Restore files: `tar --extract --gzip --file=storage.tar.gz --directory=/srv/wewin/shared/storage`.
5. Deploy the release that matches the backup (or newer) and run `pnpm db:deploy` — it applies only
   migrations newer than the backup.
6. Start the API, run the smoke test (DEPLOYMENT.md §5), and check stock balances and vendor ageing
   against the last printed reports.
7. Documents posted after the backup time must be re-entered from paper; the audit log of the restored
   database shows the last recorded action.

## Responsibilities

| Task | Who | When |
|---|---|---|
| Watch backup log / alert | Phoenixx IT | Daily |
| Restore test + log | Phoenixx IT | Monthly |
| Review restore log | Wewin owner | Quarterly |
| Rotate `.env` secrets, review DB roles | Phoenixx IT | Yearly, and when staff leave |
