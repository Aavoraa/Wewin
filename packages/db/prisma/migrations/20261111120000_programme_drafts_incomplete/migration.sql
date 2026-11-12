-- A draft programme may be incomplete (Q-070): a Programme Entry screenshot is saved straight away;
-- the finished fabric item, required kg and process input / output items are filled before approval.
ALTER TABLE "fabric_programs" ALTER COLUMN "fabric_item_id" DROP NOT NULL, ALTER COLUMN "required_kg" DROP NOT NULL;
ALTER TABLE "fabric_program_processes" ALTER COLUMN "input_item_id" DROP NOT NULL, ALTER COLUMN "output_item_id" DROP NOT NULL;

-- Reviewed additions: only a draft may be incomplete.
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_complete_unless_draft CHECK (status IN ('DRAFT', 'CANCELLED') OR (fabric_item_id IS NOT NULL AND required_kg IS NOT NULL AND required_kg > 0));
