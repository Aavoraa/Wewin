-- Cutting-lay manager approval (Q-062) and quality checks (Q-063).

-- CreateEnum
CREATE TYPE "QcKind" AS ENUM ('FABRIC_ROLL', 'INLINE', 'FINAL');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASS', 'HOLD', 'REJECT');

-- AlterTable
ALTER TABLE "cut_lays" ADD COLUMN     "approval_note" TEXT,
ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_id" UUID;

-- CreateTable
CREATE TABLE "qc_inspections" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "doc_date" DATE NOT NULL,
    "kind" "QcKind" NOT NULL,
    "order_id" UUID,
    "sewing_line" TEXT,
    "inspector" TEXT,
    "remarks" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "approval_note" TEXT,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspection_lines" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "roll_id" UUID,
    "bundle_id" UUID,
    "colour" TEXT,
    "size" TEXT,
    "operator" TEXT,
    "result" "QcResult",
    "gsm" INTEGER,
    "defect_points" INTEGER,
    "checked_pcs" INTEGER,
    "passed_pcs" INTEGER,
    "rejected_pcs" INTEGER,
    "defects" JSONB NOT NULL DEFAULT '[]',
    "remarks" TEXT,

    CONSTRAINT "qc_inspection_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_inspections_doc_no_key" ON "qc_inspections"("doc_no");

-- CreateIndex
CREATE INDEX "qc_inspections_kind_status_doc_date_idx" ON "qc_inspections"("kind", "status", "doc_date");

-- CreateIndex
CREATE INDEX "qc_inspections_order_id_idx" ON "qc_inspections"("order_id");

-- CreateIndex
CREATE INDEX "qc_inspection_lines_roll_id_idx" ON "qc_inspection_lines"("roll_id");

-- CreateIndex
CREATE INDEX "qc_inspection_lines_bundle_id_idx" ON "qc_inspection_lines"("bundle_id");

-- AddForeignKey
ALTER TABLE "cut_lays" ADD CONSTRAINT "cut_lays_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspections" ADD CONSTRAINT "qc_inspections_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspection_lines" ADD CONSTRAINT "qc_inspection_lines_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "qc_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspection_lines" ADD CONSTRAINT "qc_inspection_lines_roll_id_fkey" FOREIGN KEY ("roll_id") REFERENCES "fabric_rolls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspection_lines" ADD CONSTRAINT "qc_inspection_lines_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "cut_bundles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reviewed additions
ALTER TABLE qc_inspections ADD CONSTRAINT qc_inspections_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE qc_inspections ADD CONSTRAINT qc_inspections_order_needed CHECK (kind = 'FABRIC_ROLL' OR order_id IS NOT NULL);
ALTER TABLE qc_inspection_lines ADD CONSTRAINT qc_lines_pcs_nonneg CHECK (
  COALESCE(checked_pcs, 0) >= 0 AND COALESCE(passed_pcs, 0) >= 0 AND COALESCE(rejected_pcs, 0) >= 0
);
SELECT audit_attach('qc_inspections');
SELECT audit_attach('qc_inspection_lines');

-- Existing databases: the QC series (the seed adds it on new ones).
INSERT INTO document_series (code, name, prefix, padding) VALUES ('QC_INSPECTION', 'Quality check', 'QC', 4) ON CONFLICT (code) DO NOTHING;
