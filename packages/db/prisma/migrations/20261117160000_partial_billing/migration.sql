-- Bill the rest later (Q-081): a document can be billed in parts; billed_in_full is false while some is left.
ALTER TABLE "inward_dcs" ADD COLUMN "billed_in_full" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "panel_dcs" ADD COLUMN "billed_in_full" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "yarn_receipts" ADD COLUMN "billed_in_full" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "stock_docs" ADD COLUMN "billed_in_full" BOOLEAN NOT NULL DEFAULT true;
