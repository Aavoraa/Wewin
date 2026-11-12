-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TrimsDocType" ADD VALUE 'RETURN';
ALTER TYPE "TrimsDocType" ADD VALUE 'REPLACEMENT';
ALTER TYPE "TrimsDocType" ADD VALUE 'TRANSFER';

-- AlterTable
ALTER TABLE "trims_doc_lines" ADD COLUMN     "colour" TEXT,
ADD COLUMN     "po_line_id" UUID,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "return_line_id" UUID,
ADD COLUMN     "size" TEXT;

-- AlterTable
ALTER TABLE "trims_docs" ADD COLUMN     "dc_date" DATE,
ADD COLUMN     "dc_no" TEXT,
ADD COLUMN     "return_doc_id" UUID,
ADD COLUMN     "to_order_id" UUID;

-- CreateTable
CREATE TABLE "spl_requests" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "requested_by" TEXT,
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

    CONSTRAINT "spl_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spl_request_lines" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "colour" TEXT,
    "size" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "spl_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spl_requests_doc_no_key" ON "spl_requests"("doc_no");

-- CreateIndex
CREATE INDEX "spl_requests_order_id_status_idx" ON "spl_requests"("order_id", "status");

-- CreateIndex
CREATE INDEX "spl_request_lines_request_id_idx" ON "spl_request_lines"("request_id");

-- CreateIndex
CREATE INDEX "trims_doc_lines_po_line_id_idx" ON "trims_doc_lines"("po_line_id");

-- CreateIndex
CREATE INDEX "trims_doc_lines_return_line_id_idx" ON "trims_doc_lines"("return_line_id");

-- AddForeignKey
ALTER TABLE "trims_docs" ADD CONSTRAINT "trims_docs_to_order_id_fkey" FOREIGN KEY ("to_order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_docs" ADD CONSTRAINT "trims_docs_return_doc_id_fkey" FOREIGN KEY ("return_doc_id") REFERENCES "trims_docs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_doc_lines" ADD CONSTRAINT "trims_doc_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_doc_lines" ADD CONSTRAINT "trims_doc_lines_return_line_id_fkey" FOREIGN KEY ("return_line_id") REFERENCES "trims_doc_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spl_requests" ADD CONSTRAINT "spl_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spl_request_lines" ADD CONSTRAINT "spl_request_lines_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "spl_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spl_request_lines" ADD CONSTRAINT "spl_request_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reviewed additions (Q-072). New enum values cannot be used as literals in the same transaction,
-- so the checks compare type::text.
ALTER TABLE trims_docs DROP CONSTRAINT trims_docs_party;
ALTER TABLE trims_docs ADD CONSTRAINT trims_docs_party CHECK (
  (type::text IN ('RECEIPT', 'RETURN') AND vendor_id IS NOT NULL)
  OR (type::text = 'REPLACEMENT' AND vendor_id IS NOT NULL AND return_doc_id IS NOT NULL)
  OR (type::text = 'ISSUE' AND order_id IS NOT NULL)
  OR (type::text = 'TRANSFER' AND order_id IS NOT NULL AND to_order_id IS NOT NULL AND order_id <> to_order_id)
);
ALTER TABLE spl_requests ADD CONSTRAINT spl_requests_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE spl_request_lines ADD CONSTRAINT spl_request_lines_qty_positive CHECK (qty > 0);
SELECT audit_attach('spl_requests');
SELECT audit_attach('spl_request_lines');
INSERT INTO document_series (code, name, prefix, padding) VALUES
  ('TRIMS_RETURN', 'Accessories purchase return', 'APR', 4),
  ('TRIMS_REPLACEMENT', 'Accessories purchase replacement inward', 'ARI', 4),
  ('TRIMS_TRANSFER', 'Accessories transfer between orders', 'ATR', 4),
  ('SPL_REQUEST', 'Accessories special request', 'SPR', 4)
ON CONFLICT (code) DO NOTHING;
