-- Tax type and taxable % on vendor bills (desktop "Tax Type" + "100", Q-087). Blank tax type = by supplier state.
ALTER TABLE "vendor_bills" ADD COLUMN "tax_type" TEXT;
ALTER TABLE "vendor_bills" ADD COLUMN "taxable_pct" DECIMAL(7,4) NOT NULL DEFAULT 100;
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_tax_type_check" CHECK ("tax_type" IS NULL OR "tax_type" IN ('GST', 'IGST', 'NONE'));
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_taxable_pct_check" CHECK ("taxable_pct" > 0 AND "taxable_pct" <= 100);
