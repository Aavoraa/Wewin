-- Purchase orders: yarn, fabric and accessories (Q-066).
-- CreateEnum
CREATE TYPE "PoKind" AS ENUM ('YARN', 'FABRIC', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "PoPurpose" AS ENUM ('ORDER', 'GENERAL');

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "kind" "PoKind" NOT NULL,
    "purpose" "PoPurpose" NOT NULL DEFAULT 'ORDER',
    "vendor_id" UUID NOT NULL,
    "order_id" UUID,
    "req_no" TEXT,
    "accessory_type" TEXT,
    "delivery_date" DATE,
    "delivery_at" TEXT,
    "payment_terms" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "freight_paid_by" TEXT,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "inter_state" BOOLEAN NOT NULL DEFAULT false,
    "packing_forwarding" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "duty_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tax_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "tcs_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "duty_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tcs_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approval_note" TEXT,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "close_reason" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "order_id" UUID,
    "colour" TEXT,
    "size" TEXT,
    "mill_name" TEXT,
    "bags" INTEGER,
    "counts" TEXT,
    "gsm" INTEGER,
    "gauge" TEXT,
    "loop_length" TEXT,
    "dia" TEXT,
    "design" TEXT,
    "description" TEXT,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "alt_qty" DECIMAL(14,3),
    "rate" DECIMAL(14,4) NOT NULL,
    "per" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "amount" DECIMAL(14,2) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_doc_no_key" ON "purchase_orders"("doc_no");

-- CreateIndex
CREATE INDEX "purchase_orders_kind_status_doc_date_idx" ON "purchase_orders"("kind", "status", "doc_date");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_order_id_idx" ON "purchase_orders"("order_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_po_id_idx" ON "purchase_order_lines"("po_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_item_id_idx" ON "purchase_order_lines"("item_id");

-- CreateIndex
CREATE INDEX "purchase_order_lines_order_id_idx" ON "purchase_order_lines"("order_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed additions
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_numbered CHECK (status = 'DRAFT' OR doc_no IS NOT NULL);
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_amounts_nonneg CHECK (
  packing_forwarding >= 0 AND duty_pct >= 0 AND tax_pct >= 0 AND tcs_pct >= 0 AND gross_amount >= 0 AND net_amount >= 0
);
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_qty_positive CHECK (qty > 0 AND rate >= 0 AND per > 0 AND amount >= 0);
SELECT audit_attach('purchase_orders');
SELECT audit_attach('purchase_order_lines');
-- Existing databases: the PO series (the seed adds them on new ones).
INSERT INTO document_series (code, name, prefix, padding) VALUES
  ('PO_YARN', 'Yarn purchase order', 'YP', 4),
  ('PO_FABRIC', 'Fabric purchase order', 'FP', 4),
  ('PO_ACCESSORY', 'Accessories purchase order', 'ACPO', 4)
ON CONFLICT (code) DO NOTHING;
