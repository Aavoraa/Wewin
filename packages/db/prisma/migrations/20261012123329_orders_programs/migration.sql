-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "locations" DROP CONSTRAINT "locations_vendor_fk";

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "buyer_po_no" TEXT NOT NULL,
    "po_date" DATE NOT NULL,
    "ship_date" DATE,
    "style_no" TEXT NOT NULL,
    "style_name" TEXT,
    "description" TEXT,
    "garment_item_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "colours" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmed_by_id" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "colour" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,4),

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_components" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "panel_item_id" UUID NOT NULL,
    "pcs_per_garment" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_costings" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "panel_cost_per_piece" DECIMAL(12,4),
    "fob_per_piece" DECIMAL(12,4),
    "exchange_rate" DECIMAL(12,4),
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_costings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_costing_lines" (
    "id" UUID NOT NULL,
    "costing_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "head" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "consumption" DECIMAL(12,4) NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "order_costing_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_programs" (
    "id" UUID NOT NULL,
    "program_no" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "fabric_item_id" UUID NOT NULL,
    "colour" TEXT,
    "required_kg" DECIMAL(12,3) NOT NULL,
    "gsm" INTEGER,
    "dia" TEXT,
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fabric_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fabric_program_processes" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "process_id" UUID NOT NULL,
    "input_item_id" UUID NOT NULL,
    "output_item_id" UUID NOT NULL,
    "allowed_loss_pct" DECIMAL(7,4) NOT NULL,
    "material_cost_per_kg" DECIMAL(12,4),
    "planned_vendor_id" UUID,

    CONSTRAINT "fabric_program_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trims_bom_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "trim_item_id" UUID NOT NULL,
    "colour" TEXT,
    "size" TEXT,
    "qty_per_garment" DECIMAL(12,4) NOT NULL,
    "wastage_pct" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "trims_bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_buyer_id_idx" ON "orders"("buyer_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_colour_size_key" ON "order_lines"("order_id", "colour", "size");

-- CreateIndex
CREATE UNIQUE INDEX "order_components_order_id_code_key" ON "order_components"("order_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "order_costings_order_id_key" ON "order_costings"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_programs_program_no_key" ON "fabric_programs"("program_no");

-- CreateIndex
CREATE INDEX "fabric_programs_order_id_idx" ON "fabric_programs"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "fabric_program_processes_program_id_sequence_key" ON "fabric_program_processes"("program_id", "sequence");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_garment_item_id_fkey" FOREIGN KEY ("garment_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_components" ADD CONSTRAINT "order_components_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_components" ADD CONSTRAINT "order_components_panel_item_id_fkey" FOREIGN KEY ("panel_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costings" ADD CONSTRAINT "order_costings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_costing_lines" ADD CONSTRAINT "order_costing_lines_costing_id_fkey" FOREIGN KEY ("costing_id") REFERENCES "order_costings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_programs" ADD CONSTRAINT "fabric_programs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_programs" ADD CONSTRAINT "fabric_programs_fabric_item_id_fkey" FOREIGN KEY ("fabric_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_program_processes" ADD CONSTRAINT "fabric_program_processes_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "fabric_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_program_processes" ADD CONSTRAINT "fabric_program_processes_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_program_processes" ADD CONSTRAINT "fabric_program_processes_input_item_id_fkey" FOREIGN KEY ("input_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fabric_program_processes" ADD CONSTRAINT "fabric_program_processes_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_bom_lines" ADD CONSTRAINT "trims_bom_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trims_bom_lines" ADD CONSTRAINT "trims_bom_lines_trim_item_id_fkey" FOREIGN KEY ("trim_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE order_lines ADD CONSTRAINT order_lines_qty_positive CHECK (qty > 0);
ALTER TABLE order_lines ADD CONSTRAINT order_lines_price_nonneg CHECK (unit_price IS NULL OR unit_price >= 0);
ALTER TABLE order_components ADD CONSTRAINT order_components_pcs_positive CHECK (pcs_per_garment > 0);
ALTER TABLE fabric_program_processes ADD CONSTRAINT fpp_allowed_loss_range CHECK (allowed_loss_pct >= 0 AND allowed_loss_pct <= 100);
ALTER TABLE fabric_program_processes ADD CONSTRAINT fpp_cost_nonneg CHECK (material_cost_per_kg IS NULL OR material_cost_per_kg >= 0);
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_required_positive CHECK (required_kg > 0);
ALTER TABLE trims_bom_lines ADD CONSTRAINT trims_bom_qty_positive CHECK (qty_per_garment > 0 AND wastage_pct >= 0);
ALTER TABLE fabric_program_processes ADD CONSTRAINT fpp_vendor_fk FOREIGN KEY (planned_vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;
-- The stock ledger's order reference can now be enforced.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT;

SELECT audit_attach('orders');
SELECT audit_attach('order_lines');
SELECT audit_attach('order_components');
SELECT audit_attach('order_costings');
SELECT audit_attach('order_costing_lines');
SELECT audit_attach('fabric_programs');
SELECT audit_attach('fabric_program_processes');
SELECT audit_attach('trims_bom_lines');
