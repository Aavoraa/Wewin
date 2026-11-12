-- Program Defined (Q-076): yarn process programmes, and outward D.C.s sent under one.

-- AlterTable
ALTER TABLE "outward_dcs" ADD COLUMN     "yarn_program_id" UUID,
ALTER COLUMN "program_process_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "yarn_programs" (
    "id" UUID NOT NULL,
    "program_no" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "output_item_id" UUID NOT NULL,
    "output_colour" TEXT,
    "required_kg" DECIMAL(12,3),
    "allowed_loss_pct" DECIMAL(7,4) NOT NULL,
    "material_cost_per_kg" DECIMAL(12,4),
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "yarn_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yarn_program_inputs" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "item_id" UUID NOT NULL,
    "colour" TEXT,
    "mix_pct" DECIMAL(7,4) NOT NULL,

    CONSTRAINT "yarn_program_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "yarn_programs_program_no_key" ON "yarn_programs"("program_no");

-- CreateIndex
CREATE INDEX "yarn_programs_order_id_idx" ON "yarn_programs"("order_id");

-- CreateIndex
CREATE INDEX "yarn_programs_process_id_status_idx" ON "yarn_programs"("process_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "yarn_program_inputs_program_id_line_no_key" ON "yarn_program_inputs"("program_id", "line_no");

-- AddForeignKey
ALTER TABLE "yarn_programs" ADD CONSTRAINT "yarn_programs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_programs" ADD CONSTRAINT "yarn_programs_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_programs" ADD CONSTRAINT "yarn_programs_output_item_id_fkey" FOREIGN KEY ("output_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_program_inputs" ADD CONSTRAINT "yarn_program_inputs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "yarn_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yarn_program_inputs" ADD CONSTRAINT "yarn_program_inputs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_yarn_program_id_fkey" FOREIGN KEY ("yarn_program_id") REFERENCES "yarn_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reviewed additions (Q-076)
-- An outward D.C. goes under exactly one programme: a fabric programme step or a yarn programme.
ALTER TABLE outward_dcs ADD CONSTRAINT outward_dcs_one_program CHECK (num_nonnulls(program_process_id, yarn_program_id) = 1);
ALTER TABLE yarn_programs ADD CONSTRAINT yarn_programs_loss_range CHECK (allowed_loss_pct >= 0 AND allowed_loss_pct < 100);
ALTER TABLE yarn_programs ADD CONSTRAINT yarn_programs_required_positive CHECK (required_kg IS NULL OR required_kg > 0);
ALTER TABLE yarn_programs ADD CONSTRAINT yarn_programs_cost_nonneg CHECK (material_cost_per_kg IS NULL OR material_cost_per_kg >= 0);
ALTER TABLE yarn_programs ADD CONSTRAINT yarn_programs_approved_stamp CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL);
ALTER TABLE yarn_program_inputs ADD CONSTRAINT yarn_program_inputs_mix_range CHECK (mix_pct > 0 AND mix_pct <= 100);
CREATE INDEX outward_dcs_yarn_program_id_idx ON outward_dcs (yarn_program_id);
SELECT audit_attach('yarn_programs');
SELECT audit_attach('yarn_program_inputs');
