-- Outward D.C. management approval (Q-048): approver, time and note on the draft.
-- AlterTable
ALTER TABLE "outward_dcs" ADD COLUMN     "approval_note" TEXT,
ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "approved_by_id" UUID;

-- AddForeignKey
ALTER TABLE "outward_dcs" ADD CONSTRAINT "outward_dcs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
