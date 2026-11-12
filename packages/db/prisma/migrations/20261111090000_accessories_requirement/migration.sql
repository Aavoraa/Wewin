-- Accessories Requirement Entry as in the desktop software (Q-069): accessory groups on items, and
-- Country / Gar.Define / Sizewise / ColourWise / Consumption on requirement (trims BOM) lines.
ALTER TABLE "items" ADD COLUMN "trim_group" TEXT;
ALTER TABLE "trims_bom_lines"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "gar_define" TEXT,
  ADD COLUMN "sizewise" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "colourwise" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consumption" TEXT NOT NULL DEFAULT 'Flat';
