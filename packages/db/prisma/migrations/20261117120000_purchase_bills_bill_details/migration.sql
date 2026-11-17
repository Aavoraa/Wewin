-- Purchase bills and bill-entry details from the desktop Bills Entry screens (Q-079).
-- AlterTable: vendor bills
ALTER TABLE "vendor_bills"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'JOBWORK',
  ADD COLUMN "process_id" UUID,
  ADD COLUMN "add_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "less_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "gst_rate_pct" DECIMAL(6,3);
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_kind_chk" CHECK ("kind" IN ('JOBWORK', 'PURCHASE'));
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_add_less_chk" CHECK ("add_amount" >= 0 AND "less_amount" >= 0);
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "vendor_bills_kind_idx" ON "vendor_bills" ("kind", "status");

-- AlterTable: bill lines
ALTER TABLE "vendor_bill_lines" ALTER COLUMN "process_id" DROP NOT NULL;
ALTER TABLE "vendor_bill_lines"
  ADD COLUMN "bill_qty" DECIMAL(12,3),
  ADD COLUMN "bill_pcs" INTEGER;
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_bill_qty_chk" CHECK ("bill_qty" IS NULL OR ("bill_qty" > 0 AND "bill_qty" <= "billable_qty"));
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_bill_pcs_chk" CHECK ("bill_pcs" IS NULL OR "bill_pcs" >= 0);

-- Purchase documents remember the bill that covers them
ALTER TABLE "yarn_receipts" ADD COLUMN "bill_id" UUID;
ALTER TABLE "stock_docs" ADD COLUMN "bill_id" UUID;
CREATE INDEX "yarn_receipts_bill_id_idx" ON "yarn_receipts" ("bill_id");
CREATE INDEX "stock_docs_bill_id_idx" ON "stock_docs" ("bill_id");
