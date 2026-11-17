-- Debit note posting to Tally (Q-084).
ALTER TABLE "debit_notes"
  ADD COLUMN "tally_exported_at" TIMESTAMPTZ(3),
  ADD COLUMN "tally_exported_by_id" UUID,
  ADD COLUMN "tally_cancel_exported_at" TIMESTAMPTZ(3);
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_tally_cancel_chk" CHECK ("tally_cancel_exported_at" IS NULL OR "tally_exported_at" IS NOT NULL);
CREATE INDEX "debit_notes_tally_idx" ON "debit_notes" ("status", "tally_exported_at");
ALTER TABLE "vendors" ADD COLUMN "tally_ledger_name" TEXT;
