-- Accessories Purchase Bill Entry (Q-089): accessory purchase receipts become a bill source,
-- and bills carry discount, packing & forwarding and TCS as on the desktop charges panel.
ALTER TABLE "trims_docs" ADD COLUMN "bill_id" UUID;
ALTER TABLE "trims_docs" ADD COLUMN "billed_in_full" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX "trims_docs_bill_id_idx" ON "trims_docs" ("bill_id");

ALTER TABLE "vendor_bills" DROP CONSTRAINT "vendor_bills_kind_chk";
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_kind_chk" CHECK ("kind" IN ('JOBWORK', 'PURCHASE', 'ACCESSORY'));

ALTER TABLE "vendor_bills" ADD COLUMN "discount_pct" DECIMAL(7,4);
ALTER TABLE "vendor_bills" ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD COLUMN "packing_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD COLUMN "tcs_pct" DECIMAL(7,4);
ALTER TABLE "vendor_bills" ADD COLUMN "tcs_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_charges_chk"
  CHECK ("discount_amount" >= 0 AND "packing_amount" >= 0 AND "tcs_amount" >= 0
     AND ("discount_pct" IS NULL OR ("discount_pct" >= 0 AND "discount_pct" <= 100))
     AND ("tcs_pct" IS NULL OR ("tcs_pct" >= 0 AND "tcs_pct" <= 100)));
