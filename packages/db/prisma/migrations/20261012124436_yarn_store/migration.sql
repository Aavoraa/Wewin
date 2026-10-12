-- DropForeignKey
ALTER TABLE "fabric_program_processes" DROP CONSTRAINT "fpp_vendor_fk";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_order_fk";

-- CreateTable
CREATE TABLE "yarn_receipts" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID,
    "supplier_invoice_no" TEXT,
    "supplier_invoice_date" DATE,
    "vehicle_no" TEXT,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "yarn_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yarn_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot" TEXT NOT NULL,
    "bags" INTEGER,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "rate_per_kg" DECIMAL(12,4),

    CONSTRAINT "yarn_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yarn_receipts_doc_no_key" ON "yarn_receipts"("doc_no");

-- CreateIndex
CREATE INDEX "yarn_receipts_status_doc_date_idx" ON "yarn_receipts"("status", "doc_date");

-- CreateIndex
CREATE INDEX "yarn_receipts_vendor_id_idx" ON "yarn_receipts"("vendor_id");

-- CreateIndex
CREATE INDEX "yarn_receipt_lines_item_id_idx" ON "yarn_receipt_lines"("item_id");

-- AddForeignKey
ALTER TABLE "yarn_receipts" ADD CONSTRAINT "yarn_receipts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_receipts" ADD CONSTRAINT "yarn_receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_receipt_lines" ADD CONSTRAINT "yarn_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "yarn_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_receipt_lines" ADD CONSTRAINT "yarn_receipt_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE yarn_receipt_lines ADD CONSTRAINT yarn_receipt_lines_qty_positive CHECK (qty_kg > 0);
ALTER TABLE yarn_receipt_lines ADD CONSTRAINT yarn_receipt_lines_rate_nonneg CHECK (rate_per_kg IS NULL OR rate_per_kg >= 0);
ALTER TABLE yarn_receipt_lines ADD CONSTRAINT yarn_receipt_lines_bags_nonneg CHECK (bags IS NULL OR bags >= 0);
-- A posted document always has its number; drafts never do.
ALTER TABLE yarn_receipts ADD CONSTRAINT yarn_receipts_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
SELECT audit_attach('yarn_receipts');
SELECT audit_attach('yarn_receipt_lines');
