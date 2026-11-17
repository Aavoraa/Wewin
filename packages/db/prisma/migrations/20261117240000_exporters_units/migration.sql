-- Exporter / Unit (Q-085): exporters (companies) with units; every document, stock movement and
-- number series belongs to a unit. Existing data becomes the first exporter's main unit.
CREATE TABLE "exporters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "legal_name" TEXT NOT NULL,
  "trade_name" TEXT,
  "address_line1" TEXT NOT NULL,
  "address_line2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "state_code" TEXT NOT NULL,
  "pincode" TEXT NOT NULL,
  "gstin" TEXT NOT NULL,
  "pan" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "iec" TEXT,
  "lut_number" TEXT,
  "lut_valid_from" DATE,
  "lut_valid_to" DATE,
  "bank_name" TEXT,
  "bank_account" TEXT,
  "bank_ifsc" TEXT,
  "is_placeholder" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exporters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "exporters_code_key" ON "exporters"("code");

CREATE TABLE "units" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "exporter_id" UUID NOT NULL,
  "doc_prefix" TEXT NOT NULL DEFAULT '',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "units_exporter_id_fkey" FOREIGN KEY ("exporter_id") REFERENCES "exporters"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "units_code_key" ON "units"("code");
CREATE UNIQUE INDEX "units_doc_prefix_key" ON "units"("doc_prefix");

CREATE TABLE "user_units" (
  "user_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  CONSTRAINT "user_units_pkey" PRIMARY KEY ("user_id", "unit_id"),
  CONSTRAINT "user_units_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_units_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The first exporter is the company settings as they are; its main unit keeps the existing numbers.
INSERT INTO "exporters" ("id", "code", "legal_name", "trade_name", "address_line1", "address_line2", "city", "state", "state_code", "pincode", "gstin", "pan", "phone", "email", "iec",
  "lut_number", "lut_valid_from", "lut_valid_to", "bank_name", "bank_account", "bank_ifsc", "is_placeholder")
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'WEWIN', "legal_name", "trade_name", "address_line1", "address_line2", "city", "state", "state_code", "pincode", "gstin", "pan", "phone", "email", "iec",
  "lut_number", "lut_valid_from", "lut_valid_to", "bank_name", "bank_account", "bank_ifsc", "is_placeholder"
FROM "company_settings" WHERE "id" = 1;
INSERT INTO "exporters" ("id", "code", "legal_name", "address_line1", "city", "state", "state_code", "pincode", "gstin", "is_placeholder")
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'WEWIN', 'Wewin Knit Fashions', 'Address to be configured', 'Tiruppur', 'Tamil Nadu', '33', '641601', '33AAAAA0000A1Z5', true
WHERE NOT EXISTS (SELECT 1 FROM "exporters");
INSERT INTO "units" ("id", "code", "name", "exporter_id", "doc_prefix")
SELECT '00000000-0000-4000-8000-000000000001'::uuid, 'MAIN', COALESCE(e."trade_name", e."legal_name"), e."id", '' FROM "exporters" e WHERE e."id" = '00000000-0000-4000-8000-000000000001'::uuid;

ALTER TABLE "sessions" ADD COLUMN "unit_id" UUID;

ALTER TABLE "orders" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "orders_unit_id_idx" ON "orders"("unit_id");
ALTER TABLE "fabric_programs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "fabric_programs_unit_id_idx" ON "fabric_programs"("unit_id");
ALTER TABLE "yarn_programs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "yarn_programs_unit_id_idx" ON "yarn_programs"("unit_id");
ALTER TABLE "yarn_receipts" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "yarn_receipts_unit_id_idx" ON "yarn_receipts"("unit_id");
ALTER TABLE "outward_dcs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "outward_dcs_unit_id_idx" ON "outward_dcs"("unit_id");
ALTER TABLE "inward_dcs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "inward_dcs_unit_id_idx" ON "inward_dcs"("unit_id");
ALTER TABLE "fabric_rolls" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "fabric_rolls_unit_id_idx" ON "fabric_rolls"("unit_id");
ALTER TABLE "cut_lays" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "cut_lays_unit_id_idx" ON "cut_lays"("unit_id");
ALTER TABLE "cut_bundles" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "cut_bundles_unit_id_idx" ON "cut_bundles"("unit_id");
ALTER TABLE "panel_dcs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "panel_dcs_unit_id_idx" ON "panel_dcs"("unit_id");
ALTER TABLE "recut_slips" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "recut_slips_unit_id_idx" ON "recut_slips"("unit_id");
ALTER TABLE "sewing_issues" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "sewing_issues_unit_id_idx" ON "sewing_issues"("unit_id");
ALTER TABLE "sewing_entries" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "sewing_entries_unit_id_idx" ON "sewing_entries"("unit_id");
ALTER TABLE "cartons" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "cartons_unit_id_idx" ON "cartons"("unit_id");
ALTER TABLE "packing_lists" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "packing_lists_unit_id_idx" ON "packing_lists"("unit_id");
ALTER TABLE "trims_docs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "trims_docs_unit_id_idx" ON "trims_docs"("unit_id");
ALTER TABLE "vendor_bills" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "vendor_bills_unit_id_idx" ON "vendor_bills"("unit_id");
ALTER TABLE "debit_notes" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "debit_notes_unit_id_idx" ON "debit_notes"("unit_id");
ALTER TABLE "payment_vouchers" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "payment_vouchers_unit_id_idx" ON "payment_vouchers"("unit_id");
ALTER TABLE "ageing_snapshots" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "ageing_snapshots_unit_id_idx" ON "ageing_snapshots"("unit_id");
ALTER TABLE "invoice_scans" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "invoice_scans_unit_id_idx" ON "invoice_scans"("unit_id");
ALTER TABLE "export_invoices" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "export_invoices_unit_id_idx" ON "export_invoices"("unit_id");
ALTER TABLE "shipments" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "shipments_unit_id_idx" ON "shipments"("unit_id");
ALTER TABLE "buyer_receipts" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "buyer_receipts_unit_id_idx" ON "buyer_receipts"("unit_id");
ALTER TABLE "opening_imports" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "opening_imports_unit_id_idx" ON "opening_imports"("unit_id");
ALTER TABLE "qc_inspections" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "qc_inspections_unit_id_idx" ON "qc_inspections"("unit_id");
ALTER TABLE "purchase_orders" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "purchase_orders_unit_id_idx" ON "purchase_orders"("unit_id");
ALTER TABLE "stock_docs" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "stock_docs_unit_id_idx" ON "stock_docs"("unit_id");
ALTER TABLE "spl_requests" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "spl_requests_unit_id_idx" ON "spl_requests"("unit_id");
ALTER TABLE "stock_movements" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "stock_movements_unit_id_idx" ON "stock_movements"("unit_id");
ALTER TABLE "alerts" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "alerts_unit_id_idx" ON "alerts"("unit_id");
ALTER TABLE "report_exports" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
CREATE INDEX "report_exports_unit_id_idx" ON "report_exports"("unit_id");

-- Number series per unit
ALTER TABLE "number_series" ADD COLUMN "unit_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid REFERENCES "units"("id") ON DELETE RESTRICT;
DROP INDEX IF EXISTS "number_series_series_code_fy_code_key";
CREATE UNIQUE INDEX "number_series_series_code_fy_code_unit_id_key" ON "number_series"("series_code", "fy_code", "unit_id");

-- Stock balances per unit: the cache groups by the unit as well.
DROP MATERIALIZED VIEW IF EXISTS stock_balances;
CREATE MATERIALIZED VIEW stock_balances AS
SELECT m.unit_id,
       m.item_id,
       m.location_id,
       m.lot,
       m.colour,
       m.size,
       COALESCE(m.order_id, '00000000-0000-0000-0000-000000000000'::uuid) AS order_key,
       m.order_id,
       m.unit,
       SUM(m.q)::numeric(14, 3) AS qty,
       MAX(m.posted_at) AS last_movement_at
FROM (
  SELECT unit_id, item_id, to_location_id AS location_id, lot, colour, size, order_id, unit, qty AS q, posted_at
  FROM stock_movements
  UNION ALL
  SELECT unit_id, item_id, from_location_id AS location_id, lot, colour, size, order_id, unit, -qty AS q, posted_at
  FROM stock_movements
) m
GROUP BY m.unit_id, m.item_id, m.location_id, m.lot, m.colour, m.size, m.order_id, m.unit
HAVING SUM(m.q) <> 0;
CREATE UNIQUE INDEX stock_balances_key ON stock_balances (unit_id, item_id, location_id, lot, colour, size, order_key, unit);
CREATE INDEX stock_balances_location ON stock_balances (unit_id, location_id);
