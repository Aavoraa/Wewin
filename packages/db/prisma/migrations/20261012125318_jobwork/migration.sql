-- CreateTable
CREATE TABLE "outward_dcs" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "program_process_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_location_id" UUID NOT NULL,
    "expected_return_date" DATE,
    "purpose" TEXT NOT NULL DEFAULT 'For job work',
    "vehicle_no" TEXT,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "allowed_loss_pct" DECIMAL(7,4),
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "close_reason" TEXT,
    "final_sent_kg" DECIMAL(12,3),
    "final_received_kg" DECIMAL(12,3),
    "final_loss_kg" DECIMAL(12,3),
    "final_loss_pct" DECIMAL(9,4),
    "final_excess_kg" DECIMAL(12,3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outward_dcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outward_dc_lines" (
    "id" UUID NOT NULL,
    "dc_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "roll_id" UUID,
    "qty_kg" DECIMAL(12,3) NOT NULL,
    "rolls" INTEGER,
    "value_per_kg" DECIMAL(12,4),

    CONSTRAINT "outward_dc_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inward_dcs" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "vendor_id" UUID NOT NULL,
    "vendor_dc_no" TEXT,
    "vendor_dc_date" DATE,
    "to_location_id" UUID NOT NULL,
    "vehicle_no" TEXT,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "bill_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inward_dcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inward_dc_lines" (
    "id" UUID NOT NULL,
    "dc_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "roll_no" TEXT NOT NULL,
    "kg" DECIMAL(12,3) NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "gsm" INTEGER,
    "dia" TEXT,
    "remarks" TEXT,

    CONSTRAINT "inward_dc_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc_links" (
    "id" UUID NOT NULL,
    "inward_dc_id" UUID NOT NULL,
    "outward_dc_id" UUID NOT NULL,
    "received_kg" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "dc_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dc_consumptions" (
    "id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "outward_line_id" UUID NOT NULL,
    "kg" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "dc_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_rolls" (
    "id" UUID NOT NULL,
    "roll_no" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "lot" TEXT NOT NULL DEFAULT '',
    "colour" TEXT NOT NULL DEFAULT '',
    "gsm" INTEGER,
    "dia" TEXT,
    "kg" DECIMAL(12,3) NOT NULL,
    "order_id" UUID,
    "inward_line_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fabric_rolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outward_dcs_doc_no_key" ON "outward_dcs"("doc_no");

-- CreateIndex
CREATE INDEX "outward_dcs_status_doc_date_idx" ON "outward_dcs"("status", "doc_date");

-- CreateIndex
CREATE INDEX "outward_dcs_vendor_id_status_idx" ON "outward_dcs"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "outward_dcs_order_id_idx" ON "outward_dcs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "inward_dcs_doc_no_key" ON "inward_dcs"("doc_no");

-- CreateIndex
CREATE INDEX "inward_dcs_status_doc_date_idx" ON "inward_dcs"("status", "doc_date");

-- CreateIndex
CREATE INDEX "inward_dcs_vendor_id_status_idx" ON "inward_dcs"("vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "dc_links_inward_dc_id_outward_dc_id_key" ON "dc_links"("inward_dc_id", "outward_dc_id");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_roll_no_key" ON "fabric_rolls"("roll_no");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_rolls_inward_line_id_key" ON "fabric_rolls"("inward_line_id");

-- CreateIndex
CREATE INDEX "fabric_rolls_item_id_lot_idx" ON "fabric_rolls"("item_id", "lot");

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_program_process_id_fkey" FOREIGN KEY ("program_process_id") REFERENCES "fabric_program_processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dc_lines" ADD CONSTRAINT "outward_dc_lines_dc_id_fkey" FOREIGN KEY ("dc_id") REFERENCES "outward_dcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dc_lines" ADD CONSTRAINT "outward_dc_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dc_lines" ADD CONSTRAINT "outward_dc_lines_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_dcs" ADD CONSTRAINT "inward_dcs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_dcs" ADD CONSTRAINT "inward_dcs_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_dc_lines" ADD CONSTRAINT "inward_dc_lines_dc_id_fkey" FOREIGN KEY ("dc_id") REFERENCES "inward_dcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inward_dc_lines" ADD CONSTRAINT "inward_dc_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc_links" ADD CONSTRAINT "dc_links_inward_dc_id_fkey" FOREIGN KEY ("inward_dc_id") REFERENCES "inward_dcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc_links" ADD CONSTRAINT "dc_links_outward_dc_id_fkey" FOREIGN KEY ("outward_dc_id") REFERENCES "outward_dcs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc_consumptions" ADD CONSTRAINT "dc_consumptions_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "dc_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dc_consumptions" ADD CONSTRAINT "dc_consumptions_outward_line_id_fkey" FOREIGN KEY ("outward_line_id") REFERENCES "outward_dc_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_rolls" ADD CONSTRAINT "fabric_rolls_inward_line_id_fkey" FOREIGN KEY ("inward_line_id") REFERENCES "inward_dc_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE outward_dc_lines ADD CONSTRAINT outward_lines_qty_positive CHECK (qty_kg > 0);
ALTER TABLE outward_dc_lines ADD CONSTRAINT outward_lines_value_nonneg CHECK (value_per_kg IS NULL OR value_per_kg >= 0);
ALTER TABLE inward_dc_lines ADD CONSTRAINT inward_lines_kg_positive CHECK (kg > 0);
ALTER TABLE dc_links ADD CONSTRAINT dc_links_kg_positive CHECK (received_kg > 0);
ALTER TABLE dc_consumptions ADD CONSTRAINT dc_consumptions_kg_positive CHECK (kg > 0);
ALTER TABLE outward_dcs ADD CONSTRAINT outward_dcs_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE inward_dcs ADD CONSTRAINT inward_dcs_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE outward_dcs ADD CONSTRAINT outward_dcs_posted_has_return CHECK (status = 'DRAFT' OR expected_return_date IS NOT NULL);
-- Frozen loss figures exist exactly when the D.C. is closed.
ALTER TABLE outward_dcs ADD CONSTRAINT outward_dcs_closed_frozen CHECK ((status = 'CLOSED') = (final_loss_pct IS NOT NULL));
-- Roll references in the ledger.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_roll_fk FOREIGN KEY (roll_id) REFERENCES fabric_rolls(id) ON DELETE RESTRICT;
CREATE INDEX dc_links_outward ON dc_links (outward_dc_id);
CREATE UNIQUE INDEX inward_dc_lines_roll_no ON inward_dc_lines (dc_id, roll_no);

SELECT audit_attach('outward_dcs');
SELECT audit_attach('outward_dc_lines');
SELECT audit_attach('inward_dcs');
SELECT audit_attach('inward_dc_lines');
SELECT audit_attach('dc_links');
SELECT audit_attach('dc_consumptions');
SELECT audit_attach('fabric_rolls');
