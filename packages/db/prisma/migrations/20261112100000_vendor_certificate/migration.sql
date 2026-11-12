-- Vendor certificate number and expiry date (Q-073).
-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "certificate_no" TEXT,
ADD COLUMN "certificate_expiry" DATE;

-- A certificate number and its expiry date are recorded together or not at all.
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_certificate_pair_chk"
  CHECK (("certificate_no" IS NULL) = ("certificate_expiry" IS NULL));
