-- Outward / inward D.C.s can be created from a scanned document (docs/INVOICE-SCANNING.md).
-- AlterTable
ALTER TABLE "outward_dcs" ADD COLUMN     "source_scan_id" UUID;

-- AlterTable
ALTER TABLE "inward_dcs" ADD COLUMN     "source_scan_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "outward_dcs_source_scan_id_key" ON "outward_dcs"("source_scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "inward_dcs_source_scan_id_key" ON "inward_dcs"("source_scan_id");

-- Same rule as the other scan targets: a draft points at the scan it came from.
ALTER TABLE outward_dcs ADD CONSTRAINT outward_dcs_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;
ALTER TABLE inward_dcs ADD CONSTRAINT inward_dcs_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;
