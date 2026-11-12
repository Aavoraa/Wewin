-- Other deliveries / inwards, yarn transfers between orders and rejections (Q-071).
-- CreateEnum
CREATE TYPE "StockDocKind" AS ENUM ('OTHER_DELIVERY', 'OTHER_INWARD', 'ORDER_TRANSFER', 'REJECTION');

-- CreateTable
CREATE TABLE "stock_docs" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "kind" "StockDocKind" NOT NULL,
    "purpose" TEXT,
    "party_name" TEXT,
    "vendor_id" UUID,
    "order_id" UUID,
    "to_order_id" UUID,
    "from_process" TEXT,
    "clr_lot" TEXT,
    "delivered_by" TEXT,
    "vehicle_no" TEXT,
    "gross_kg" DECIMAL(12,3),
    "cones" INTEGER,
    "raise_debit_note" BOOLEAN NOT NULL DEFAULT false,
    "debit_note_id" UUID,
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

    CONSTRAINT "stock_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_doc_lines" (
    "id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT '',
    "lot" TEXT NOT NULL DEFAULT '',
    "mill_name" TEXT,
    "counts" TEXT,
    "bags" INTEGER,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(14,4),
    "reason" TEXT,

    CONSTRAINT "stock_doc_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_docs_doc_no_key" ON "stock_docs"("doc_no");

-- CreateIndex
CREATE INDEX "stock_docs_kind_status_doc_date_idx" ON "stock_docs"("kind", "status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_doc_lines_doc_id_idx" ON "stock_doc_lines"("doc_id");

-- CreateIndex
CREATE INDEX "stock_doc_lines_item_id_idx" ON "stock_doc_lines"("item_id");

-- AddForeignKey
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_docs" ADD CONSTRAINT "stock_docs_to_order_id_fkey" FOREIGN KEY ("to_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "stock_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed additions
ALTER TABLE stock_docs ADD CONSTRAINT stock_docs_numbered CHECK (status = 'DRAFT' OR doc_no IS NOT NULL);
ALTER TABLE stock_docs ADD CONSTRAINT stock_docs_transfer_orders CHECK (kind <> 'ORDER_TRANSFER' OR (order_id IS NOT NULL AND to_order_id IS NOT NULL AND order_id <> to_order_id));
ALTER TABLE stock_doc_lines ADD CONSTRAINT stock_doc_lines_qty_positive CHECK (qty > 0);
SELECT audit_attach('stock_docs');
SELECT audit_attach('stock_doc_lines');
INSERT INTO document_series (code, name, prefix, padding) VALUES
  ('OTHER_DELIVERY', 'Yarn/fabric delivery to others', 'ODL', 4),
  ('OTHER_INWARD', 'Yarn/fabric inward from others', 'OIN', 4),
  ('ORDER_TRANSFER', 'Yarn transfer between orders', 'OTR', 4),
  ('REJECTION', 'Rejection entry', 'REJ', 4)
ON CONFLICT (code) DO NOTHING;
INSERT INTO locations (id, code, name, kind, updated_at) VALUES
  (gen_random_uuid(), 'OTHERS', 'Others (non-job-work delivery / inward)', 'VIRTUAL', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ORDER_TRANSFER', 'Order transfer', 'VIRTUAL', CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
