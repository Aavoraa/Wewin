-- CreateEnum
CREATE TYPE "DisposalMode" AS ENUM ('SOLD', 'SCRAPPED', 'REUSE');

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "store" TEXT NOT NULL,
    "counted_by" TEXT,
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

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "order_id" UUID,
    "lot" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "system_qty" DECIMAL(14,3) NOT NULL,
    "counted_qty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_disposals" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "mode" "DisposalMode" NOT NULL,
    "party_name" TEXT,
    "amount" DECIMAL(14,2),
    "reason" TEXT NOT NULL,
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

    CONSTRAINT "stock_disposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_disposal_lines" (
    "id" UUID NOT NULL,
    "disposal_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "stock_disposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_counts_doc_no_key" ON "stock_counts"("doc_no");

-- CreateIndex
CREATE INDEX "stock_counts_status_doc_date_idx" ON "stock_counts"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_count_lines_count_id_idx" ON "stock_count_lines"("count_id");

-- CreateIndex
CREATE INDEX "stock_count_lines_item_id_idx" ON "stock_count_lines"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_disposals_doc_no_key" ON "stock_disposals"("doc_no");

-- CreateIndex
CREATE INDEX "stock_disposals_order_id_status_idx" ON "stock_disposals"("order_id", "status");

-- CreateIndex
CREATE INDEX "stock_disposals_status_doc_date_idx" ON "stock_disposals"("status", "doc_date");

-- CreateIndex
CREATE INDEX "stock_disposal_lines_disposal_id_idx" ON "stock_disposal_lines"("disposal_id");

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_disposals" ADD CONSTRAINT "stock_disposals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_disposal_lines" ADD CONSTRAINT "stock_disposal_lines_disposal_id_fkey" FOREIGN KEY ("disposal_id") REFERENCES "stock_disposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_disposal_lines" ADD CONSTRAINT "stock_disposal_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reviewed additions (Q-080)
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_numbered CHECK (status = 'DRAFT' OR doc_no IS NOT NULL);
ALTER TABLE stock_count_lines ADD CONSTRAINT stock_count_lines_counted_nonneg CHECK (counted_qty >= 0);
ALTER TABLE stock_disposals ADD CONSTRAINT stock_disposals_numbered CHECK (status = 'DRAFT' OR doc_no IS NOT NULL);
ALTER TABLE stock_disposal_lines ADD CONSTRAINT stock_disposal_lines_qty_positive CHECK (qty > 0);
SELECT audit_attach('stock_counts');
SELECT audit_attach('stock_count_lines');
SELECT audit_attach('stock_disposals');
SELECT audit_attach('stock_disposal_lines');
INSERT INTO document_series (code, name, prefix, padding) VALUES
  ('STOCK_COUNT', 'Physical stock check', 'PSC', 4),
  ('STOCK_DISPOSAL', 'Leftover stock disposal', 'DSP', 4)
ON CONFLICT (code) DO NOTHING;
INSERT INTO locations (id, code, name, kind, updated_at) VALUES
  (gen_random_uuid(), 'STOCK_ADJUSTMENT', 'Stock adjustment (physical check)', 'VIRTUAL', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DISPOSED', 'Disposed (sold / scrapped leftovers)', 'VIRTUAL', CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
