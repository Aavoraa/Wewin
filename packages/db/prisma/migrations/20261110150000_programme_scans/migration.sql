-- Programme Entry screenshots in Scan invoices (Q-068): a programme remembers the scan it came from,
-- and "Grey fabric purchase" becomes a kilo-stage process so it can sit in a programme route with its loss %.
ALTER TABLE "fabric_programs" ADD COLUMN "source_scan_id" UUID;
CREATE UNIQUE INDEX "fabric_programs_source_scan_id_key" ON "fabric_programs"("source_scan_id");

-- Reviewed additions
ALTER TABLE fabric_programs ADD CONSTRAINT fabric_programs_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE SET NULL;
INSERT INTO processes (id, code, name, stage, default_return_days, updated_at)
VALUES (gen_random_uuid(), 'GREY_PURCHASE', 'Grey fabric purchase', 'KG', 15, CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;
