-- Programme entry fields from the desktop software (Q-067): portion, print colour, fabric
-- description and type, grey GSM, gauge, loop length, UOM, metres-to-kg, collar/cuff, measurement
-- mode and unit, tubular/single, process template, yarn mix and size-wise measurements.
ALTER TABLE "fabric_programs"
  ADD COLUMN "portion" TEXT,
  ADD COLUMN "print_colour" TEXT,
  ADD COLUMN "fabric_description" TEXT,
  ADD COLUMN "fabric_type" TEXT,
  ADD COLUMN "grey_gsm" INTEGER,
  ADD COLUMN "gauge" TEXT,
  ADD COLUMN "loop_length" TEXT,
  ADD COLUMN "uom" TEXT NOT NULL DEFAULT 'Kgs',
  ADD COLUMN "mtr_to_kg" DECIMAL(12,4),
  ADD COLUMN "collar_cuff_reqd" INTEGER,
  ADD COLUMN "with_measurement" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "measure_unit" TEXT NOT NULL DEFAULT 'CM',
  ADD COLUMN "tub_single" TEXT,
  ADD COLUMN "process_template" TEXT,
  ADD COLUMN "yarn_mix" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "size_specs" JSONB NOT NULL DEFAULT '[]';

-- Reviewed additions
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_uom_check CHECK (uom IN ('Kgs', 'Mtrs'));
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_measure_unit_check CHECK (measure_unit IN ('CM', 'INCH'));
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_json_arrays CHECK (jsonb_typeof(yarn_mix) = 'array' AND jsonb_typeof(size_specs) = 'array');
