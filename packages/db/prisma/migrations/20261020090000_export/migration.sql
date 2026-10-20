CREATE TABLE "export_invoices" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "buyer_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "exchange_rate" DECIMAL(12,4) NOT NULL,
    "incoterm" TEXT NOT NULL,
    "port_of_loading" TEXT NOT NULL,
    "port_of_discharge" TEXT NOT NULL,
    "final_destination" TEXT,
    "country_of_destination" TEXT NOT NULL,
    "payment_terms" TEXT,
    "under_lut" BOOLEAN NOT NULL,
    "lut_number" TEXT,
    "igst_rate_pct" DECIMAL(7,4),
    "total_pcs" INTEGER NOT NULL DEFAULT 0,
    "fob_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "inr_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_amount_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "shipment_id" UUID,
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

    CONSTRAINT "export_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "order_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "export_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_invoice_packing_lists" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "packing_list_id" UUID NOT NULL,

    CONSTRAINT "export_invoice_packing_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "buyer_id" UUID NOT NULL,
    "mode" TEXT NOT NULL,
    "shipping_bill_no" TEXT,
    "shipping_bill_date" DATE,
    "port_code" TEXT,
    "bl_awb_no" TEXT,
    "bl_awb_date" DATE,
    "carrier" TEXT,
    "vessel_flight" TEXT,
    "container_no" TEXT,
    "seal_no" TEXT,
    "forwarder" TEXT,
    "etd" DATE,
    "eta" DATE,
    "draft_invoice_ids" UUID[] DEFAULT ARRAY[]::UUID[],
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

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_receipts" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "buyer_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "amount_fc" DECIMAL(14,2) NOT NULL,
    "bank_charges_fc" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exchange_rate" DECIMAL(12,4) NOT NULL,
    "amount_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bank_reference" TEXT,
    "fira_no" TEXT,
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

    CONSTRAINT "buyer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_receipt_allocations" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount_fc" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "buyer_receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_invoices_doc_no_key" ON "export_invoices"("doc_no");

-- CreateIndex
CREATE INDEX "export_invoices_buyer_id_status_idx" ON "export_invoices"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "export_invoices_status_doc_date_idx" ON "export_invoices"("status", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "export_invoice_lines_invoice_id_order_id_colour_size_key" ON "export_invoice_lines"("invoice_id", "order_id", "colour", "size");

-- CreateIndex
CREATE INDEX "export_invoice_packing_lists_packing_list_id_idx" ON "export_invoice_packing_lists"("packing_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_invoice_packing_lists_invoice_id_packing_list_id_key" ON "export_invoice_packing_lists"("invoice_id", "packing_list_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_doc_no_key" ON "shipments"("doc_no");

-- CreateIndex
CREATE INDEX "shipments_buyer_id_status_idx" ON "shipments"("buyer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_receipts_doc_no_key" ON "buyer_receipts"("doc_no");

-- CreateIndex
CREATE INDEX "buyer_receipts_buyer_id_status_idx" ON "buyer_receipts"("buyer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_receipt_allocations_receipt_id_invoice_id_key" ON "buyer_receipt_allocations"("receipt_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "export_invoices" ADD CONSTRAINT "export_invoices_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_invoices" ADD CONSTRAINT "export_invoices_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_invoice_lines" ADD CONSTRAINT "export_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "export_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_invoice_lines" ADD CONSTRAINT "export_invoice_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_invoice_packing_lists" ADD CONSTRAINT "export_invoice_packing_lists_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "export_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_invoice_packing_lists" ADD CONSTRAINT "export_invoice_packing_lists_packing_list_id_fkey" FOREIGN KEY ("packing_list_id") REFERENCES "packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_receipts" ADD CONSTRAINT "buyer_receipts_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_receipt_allocations" ADD CONSTRAINT "buyer_receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "buyer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_receipt_allocations" ADD CONSTRAINT "buyer_receipt_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "export_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE export_invoices ADD CONSTRAINT export_invoices_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE export_invoices ADD CONSTRAINT export_invoices_rate_positive CHECK (exchange_rate > 0);
ALTER TABLE export_invoices ADD CONSTRAINT export_invoices_tax CHECK (under_lut OR igst_rate_pct IS NOT NULL);
ALTER TABLE export_invoices ADD CONSTRAINT export_invoices_amounts CHECK (fob_value >= 0 AND inr_value >= 0 AND igst_amount_inr >= 0 AND total_pcs >= 0);
ALTER TABLE export_invoice_lines ADD CONSTRAINT export_invoice_lines_positive CHECK (pcs > 0 AND unit_price >= 0 AND amount >= 0);
ALTER TABLE shipments ADD CONSTRAINT shipments_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE buyer_receipts ADD CONSTRAINT buyer_receipts_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE buyer_receipts ADD CONSTRAINT buyer_receipts_amounts CHECK (amount_fc > 0 AND bank_charges_fc >= 0 AND exchange_rate > 0 AND amount_inr >= 0);
ALTER TABLE buyer_receipt_allocations ADD CONSTRAINT buyer_receipt_allocations_positive CHECK (amount_fc > 0);
-- A packing list is invoiced at most once (mark set when the invoice posts).
ALTER TABLE packing_lists ADD CONSTRAINT packing_lists_export_invoice_fk FOREIGN KEY (export_invoice_id) REFERENCES export_invoices(id) ON DELETE RESTRICT;

SELECT audit_attach('export_invoices');
SELECT audit_attach('export_invoice_lines');
SELECT audit_attach('export_invoice_packing_lists');
SELECT audit_attach('shipments');
SELECT audit_attach('buyer_receipts');
SELECT audit_attach('buyer_receipt_allocations');
