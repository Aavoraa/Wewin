-- Bills passing: 1st and 2nd audit of posted vendor bills (Q-078).
-- CreateEnum
CREATE TYPE "BillAuditStatus" AS ENUM ('PENDING', 'PASSED', 'HELD');

-- AlterTable
ALTER TABLE "vendor_bills"
  ADD COLUMN "audit1_status" "BillAuditStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "audit1_by_id" UUID,
  ADD COLUMN "audit1_at" TIMESTAMPTZ(3),
  ADD COLUMN "audit1_note" TEXT,
  ADD COLUMN "audit2_status" "BillAuditStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "audit2_by_id" UUID,
  ADD COLUMN "audit2_at" TIMESTAMPTZ(3),
  ADD COLUMN "audit2_note" TEXT;

-- The 2nd audit only follows a passed 1st audit.
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_audit_order_chk"
  CHECK ("audit2_status" = 'PENDING' OR "audit1_status" = 'PASSED');

CREATE INDEX "vendor_bills_audit_idx" ON "vendor_bills" ("status", "audit1_status", "audit2_status");
