-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('NEFT', 'RTGS', 'CHEQUE', 'UPI', 'CASH', 'ADJUSTMENT');

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_bundle_fk";

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_carton_fk";

-- DropIndex
DROP INDEX "panel_dc_lines_bundle";

-- DropIndex
DROP INDEX "stock_movements_carton";

-- CreateTable
CREATE TABLE "rate_contracts" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "item_id" UUID,
    "order_id" UUID,
    "unit" "Unit" NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "remarks" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bills" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "order_id" UUID,
    "vendor_invoice_no" TEXT NOT NULL,
    "vendor_invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "taxable_amount" DECIMAL(14,2) NOT NULL,
    "cgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expected_taxable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "variance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "within_tolerance" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approval_note" TEXT,
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

    CONSTRAINT "vendor_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_lines" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "source_doc_no" TEXT NOT NULL,
    "source_date" DATE NOT NULL,
    "process_id" UUID NOT NULL,
    "item_id" UUID,
    "billable_qty" DECIMAL(12,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "rate" DECIMAL(12,4),
    "rate_contract_id" UUID,
    "expected_amount" DECIMAL(14,2),
    "invoiced_amount" DECIMAL(14,2),

    CONSTRAINT "vendor_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debit_notes" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "bill_id" UUID,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "taxable_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gst_rate_pct" DECIMAL(6,3),
    "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debit_note_lines" (
    "id" UUID NOT NULL,
    "note_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "origin_type" TEXT,
    "origin_id" UUID,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "debit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_vouchers" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "bank_account" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "use_advance" BOOLEAN NOT NULL DEFAULT false,
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

    CONSTRAINT "payment_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ageing_snapshots" (
    "id" UUID NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "bill_doc_no" TEXT NOT NULL,
    "age_from" DATE NOT NULL,
    "age_days" INTEGER NOT NULL,
    "bucket" TEXT NOT NULL,
    "outstanding" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ageing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_contracts_vendor_id_process_id_effective_from_idx" ON "rate_contracts"("vendor_id", "process_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_doc_no_key" ON "vendor_bills"("doc_no");

-- CreateIndex
CREATE INDEX "vendor_bills_vendor_id_status_idx" ON "vendor_bills"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "vendor_bill_lines_source_type_source_id_idx" ON "vendor_bill_lines"("source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "debit_notes_doc_no_key" ON "debit_notes"("doc_no");

-- CreateIndex
CREATE INDEX "debit_notes_vendor_id_status_idx" ON "debit_notes"("vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_vouchers_doc_no_key" ON "payment_vouchers"("doc_no");

-- CreateIndex
CREATE INDEX "payment_vouchers_vendor_id_status_idx" ON "payment_vouchers"("vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_bill_id_key" ON "payment_allocations"("payment_id", "bill_id");

-- CreateIndex
CREATE INDEX "ageing_snapshots_snapshot_date_vendor_id_idx" ON "ageing_snapshots"("snapshot_date", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ageing_snapshots_snapshot_date_bill_id_key" ON "ageing_snapshots"("snapshot_date", "bill_id");

-- AddForeignKey
ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_contracts" ADD CONSTRAINT "rate_contracts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bills" ADD CONSTRAINT "vendor_bills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_lines" ADD CONSTRAINT "vendor_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_lines" ADD CONSTRAINT "debit_note_lines_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_vouchers" ADD CONSTRAINT "payment_vouchers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "vendor_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE rate_contracts ADD CONSTRAINT rate_contracts_rate_nonneg CHECK (rate >= 0);
ALTER TABLE rate_contracts ADD CONSTRAINT rate_contracts_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_amounts CHECK (taxable_amount >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0);
ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
-- The same vendor invoice can be entered only once (cancelled bills excepted).
CREATE UNIQUE INDEX vendor_bills_invoice_once ON vendor_bills (vendor_id, lower(vendor_invoice_no)) WHERE status <> 'CANCELLED';
ALTER TABLE vendor_bill_lines ADD CONSTRAINT vendor_bill_lines_qty CHECK (billable_qty > 0);
ALTER TABLE debit_notes ADD CONSTRAINT debit_notes_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE debit_note_lines ADD CONSTRAINT debit_note_lines_amount CHECK (amount >= 0 AND qty >= 0 AND rate >= 0);
-- One active debit per business event and reason: re-processing can never debit twice.
CREATE UNIQUE INDEX debit_note_lines_once ON debit_note_lines (origin_type, origin_id, reason) WHERE active AND origin_id IS NOT NULL;
ALTER TABLE payment_vouchers ADD CONSTRAINT payment_vouchers_amounts CHECK (amount >= 0 AND tds_amount >= 0);
ALTER TABLE payment_vouchers ADD CONSTRAINT payment_vouchers_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_positive CHECK (amount > 0);
-- Billing marks on source documents.
ALTER TABLE inward_dcs ADD CONSTRAINT inward_dcs_bill_fk FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE RESTRICT;
ALTER TABLE panel_dcs ADD CONSTRAINT panel_dcs_bill_fk FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE RESTRICT;

SELECT audit_attach('rate_contracts');
SELECT audit_attach('vendor_bills');
SELECT audit_attach('vendor_bill_lines');
SELECT audit_attach('debit_notes');
SELECT audit_attach('debit_note_lines');
SELECT audit_attach('payment_vouchers');
SELECT audit_attach('payment_allocations');
