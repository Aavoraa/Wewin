-- CreateEnum
CREATE TYPE "PanelDcType" AS ENUM ('OUT', 'IN');

-- CreateEnum
CREATE TYPE "TrimsDocType" AS ENUM ('RECEIPT', 'ISSUE');

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_roll_fk";

-- DropIndex
DROP INDEX "dc_links_outward";

-- DropIndex
DROP INDEX "inward_dc_lines_roll_no";

-- CreateTable
CREATE TABLE "cut_lays" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "plies" INTEGER,
    "marker_length" DECIMAL(8,3),
    "pcs_per_bundle" INTEGER,
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

    CONSTRAINT "cut_lays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_lay_rolls" (
    "id" UUID NOT NULL,
    "lay_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "roll_id" UUID NOT NULL,
    "kg_used" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "cut_lay_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cut_bundles" (
    "id" UUID NOT NULL,
    "lay_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bundle_no" TEXT,
    "order_id" UUID NOT NULL,
    "component_code" TEXT NOT NULL,
    "panel_item_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,

    CONSTRAINT "cut_bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_dcs" (
    "id" UUID NOT NULL,
    "type" "PanelDcType" NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "expected_return_date" DATE,
    "vendor_dc_no" TEXT,
    "vehicle_no" TEXT,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "close_reason" TEXT,
    "bill_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "panel_dcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_dc_lines" (
    "id" UUID NOT NULL,
    "dc_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bundle_id" UUID NOT NULL,
    "panel_item_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL DEFAULT 0,
    "out_line_id" UUID,
    "good_pcs" INTEGER NOT NULL DEFAULT 0,
    "rejected_pcs" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "panel_dc_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recut_slips" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "panel_dc_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recut_slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recut_slip_lines" (
    "id" UUID NOT NULL,
    "slip_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "component_code" TEXT NOT NULL,
    "panel_item_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,

    CONSTRAINT "recut_slip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sewing_issues" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "sewing_line" TEXT NOT NULL,
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

    CONSTRAINT "sewing_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sewing_issue_lines" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "bundle_id" UUID NOT NULL,
    "pcs" INTEGER NOT NULL,

    CONSTRAINT "sewing_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sewing_entries" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "sewing_line" TEXT NOT NULL,
    "shift" TEXT,
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

    CONSTRAINT "sewing_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sewing_entry_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,

    CONSTRAINT "sewing_entry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cartons" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "carton_seq" INTEGER,
    "gross_kg" DECIMAL(8,3),
    "net_kg" DECIMAL(8,3),
    "length_cm" DECIMAL(6,1),
    "width_cm" DECIMAL(6,1),
    "height_cm" DECIMAL(6,1),
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "packing_list_id" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cartons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carton_lines" (
    "id" UUID NOT NULL,
    "carton_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "pcs" INTEGER NOT NULL,

    CONSTRAINT "carton_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packing_lists" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "order_id" UUID NOT NULL,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "export_invoice_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packing_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trims_docs" (
    "id" UUID NOT NULL,
    "type" "TrimsDocType" NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID,
    "order_id" UUID,
    "supplier_invoice_no" TEXT,
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

    CONSTRAINT "trims_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trims_doc_lines" (
    "id" UUID NOT NULL,
    "doc_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(12,3) NOT NULL,
    "rate" DECIMAL(12,4),

    CONSTRAINT "trims_doc_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cut_lays_doc_no_key" ON "cut_lays"("doc_no");

-- CreateIndex
CREATE INDEX "cut_lays_order_id_idx" ON "cut_lays"("order_id");

-- CreateIndex
CREATE INDEX "cut_lays_status_doc_date_idx" ON "cut_lays"("status", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "cut_lay_rolls_lay_id_roll_id_key" ON "cut_lay_rolls"("lay_id", "roll_id");

-- CreateIndex
CREATE UNIQUE INDEX "cut_bundles_bundle_no_key" ON "cut_bundles"("bundle_no");

-- CreateIndex
CREATE INDEX "cut_bundles_order_id_colour_size_idx" ON "cut_bundles"("order_id", "colour", "size");

-- CreateIndex
CREATE UNIQUE INDEX "panel_dcs_doc_no_key" ON "panel_dcs"("doc_no");

-- CreateIndex
CREATE INDEX "panel_dcs_type_status_doc_date_idx" ON "panel_dcs"("type", "status", "doc_date");

-- CreateIndex
CREATE INDEX "panel_dcs_vendor_id_type_status_idx" ON "panel_dcs"("vendor_id", "type", "status");

-- CreateIndex
CREATE INDEX "panel_dc_lines_out_line_id_idx" ON "panel_dc_lines"("out_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "recut_slips_doc_no_key" ON "recut_slips"("doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "sewing_issues_doc_no_key" ON "sewing_issues"("doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "sewing_entries_doc_no_key" ON "sewing_entries"("doc_no");

-- CreateIndex
CREATE INDEX "sewing_entries_order_id_doc_date_idx" ON "sewing_entries"("order_id", "doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "cartons_doc_no_key" ON "cartons"("doc_no");

-- CreateIndex
CREATE INDEX "cartons_order_id_status_idx" ON "cartons"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cartons_order_id_carton_seq_key" ON "cartons"("order_id", "carton_seq");

-- CreateIndex
CREATE UNIQUE INDEX "carton_lines_carton_id_colour_size_key" ON "carton_lines"("carton_id", "colour", "size");

-- CreateIndex
CREATE UNIQUE INDEX "packing_lists_doc_no_key" ON "packing_lists"("doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "trims_docs_doc_no_key" ON "trims_docs"("doc_no");

-- CreateIndex
CREATE INDEX "trims_docs_type_status_doc_date_idx" ON "trims_docs"("type", "status", "doc_date");

-- AddForeignKey
ALTER TABLE "cut_lays" ADD CONSTRAINT "cut_lays_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_lay_rolls" ADD CONSTRAINT "cut_lay_rolls_lay_id_fkey" FOREIGN KEY ("lay_id") REFERENCES "cut_lays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_lay_rolls" ADD CONSTRAINT "cut_lay_rolls_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_lay_id_fkey" FOREIGN KEY ("lay_id") REFERENCES "cut_lays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cut_bundles" ADD CONSTRAINT "cut_bundles_panel_item_id_fkey" FOREIGN KEY ("panel_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dcs" ADD CONSTRAINT "panel_dcs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dcs" ADD CONSTRAINT "panel_dcs_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dcs" ADD CONSTRAINT "panel_dcs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dc_lines" ADD CONSTRAINT "panel_dc_lines_dc_id_fkey" FOREIGN KEY ("dc_id") REFERENCES "panel_dcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dc_lines" ADD CONSTRAINT "panel_dc_lines_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "cut_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dc_lines" ADD CONSTRAINT "panel_dc_lines_panel_item_id_fkey" FOREIGN KEY ("panel_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_dc_lines" ADD CONSTRAINT "panel_dc_lines_out_line_id_fkey" FOREIGN KEY ("out_line_id") REFERENCES "panel_dc_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recut_slips" ADD CONSTRAINT "recut_slips_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recut_slip_lines" ADD CONSTRAINT "recut_slip_lines_slip_id_fkey" FOREIGN KEY ("slip_id") REFERENCES "recut_slips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recut_slip_lines" ADD CONSTRAINT "recut_slip_lines_panel_item_id_fkey" FOREIGN KEY ("panel_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sewing_issues" ADD CONSTRAINT "sewing_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sewing_issue_lines" ADD CONSTRAINT "sewing_issue_lines_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "sewing_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sewing_issue_lines" ADD CONSTRAINT "sewing_issue_lines_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "cut_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sewing_entries" ADD CONSTRAINT "sewing_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sewing_entry_lines" ADD CONSTRAINT "sewing_entry_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "sewing_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartons" ADD CONSTRAINT "cartons_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cartons" ADD CONSTRAINT "cartons_packing_list_id_fkey" FOREIGN KEY ("packing_list_id") REFERENCES "packing_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carton_lines" ADD CONSTRAINT "carton_lines_carton_id_fkey" FOREIGN KEY ("carton_id") REFERENCES "cartons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packing_lists" ADD CONSTRAINT "packing_lists_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_docs" ADD CONSTRAINT "trims_docs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_docs" ADD CONSTRAINT "trims_docs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_doc_lines" ADD CONSTRAINT "trims_doc_lines_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "trims_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_doc_lines" ADD CONSTRAINT "trims_doc_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE cut_lay_rolls ADD CONSTRAINT cut_lay_rolls_kg_positive CHECK (kg_used > 0);
ALTER TABLE cut_bundles ADD CONSTRAINT cut_bundles_pcs_positive CHECK (pcs > 0);
ALTER TABLE panel_dc_lines ADD CONSTRAINT panel_lines_nonneg CHECK (pcs >= 0 AND good_pcs >= 0 AND rejected_pcs >= 0);
ALTER TABLE recut_slip_lines ADD CONSTRAINT recut_lines_pcs_positive CHECK (pcs > 0);
ALTER TABLE sewing_issue_lines ADD CONSTRAINT sewing_issue_pcs_positive CHECK (pcs > 0);
ALTER TABLE sewing_entry_lines ADD CONSTRAINT sewing_entry_pcs_positive CHECK (pcs > 0);
ALTER TABLE carton_lines ADD CONSTRAINT carton_lines_pcs_positive CHECK (pcs > 0);
ALTER TABLE trims_doc_lines ADD CONSTRAINT trims_lines_qty_positive CHECK (qty > 0 AND (rate IS NULL OR rate >= 0));
ALTER TABLE trims_docs ADD CONSTRAINT trims_docs_party CHECK ((type = 'RECEIPT' AND vendor_id IS NOT NULL) OR (type = 'ISSUE' AND order_id IS NOT NULL));
ALTER TABLE cut_lays ADD CONSTRAINT cut_lays_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE panel_dcs ADD CONSTRAINT panel_dcs_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE sewing_issues ADD CONSTRAINT sewing_issues_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE sewing_entries ADD CONSTRAINT sewing_entries_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE cartons ADD CONSTRAINT cartons_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE packing_lists ADD CONSTRAINT packing_lists_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE trims_docs ADD CONSTRAINT trims_docs_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE recut_slips ADD CONSTRAINT recut_slips_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
-- Ledger references for bundles and cartons.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_bundle_fk FOREIGN KEY (bundle_id) REFERENCES cut_bundles(id) ON DELETE RESTRICT;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_carton_fk FOREIGN KEY (carton_id) REFERENCES cartons(id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_carton ON stock_movements (carton_id);
CREATE INDEX panel_dc_lines_bundle ON panel_dc_lines (bundle_id);

SELECT audit_attach('cut_lays');
SELECT audit_attach('cut_lay_rolls');
SELECT audit_attach('cut_bundles');
SELECT audit_attach('panel_dcs');
SELECT audit_attach('panel_dc_lines');
SELECT audit_attach('recut_slips');
SELECT audit_attach('recut_slip_lines');
SELECT audit_attach('sewing_issues');
SELECT audit_attach('sewing_issue_lines');
SELECT audit_attach('sewing_entries');
SELECT audit_attach('sewing_entry_lines');
SELECT audit_attach('cartons');
SELECT audit_attach('carton_lines');
SELECT audit_attach('packing_lists');
SELECT audit_attach('trims_docs');
SELECT audit_attach('trims_doc_lines');
