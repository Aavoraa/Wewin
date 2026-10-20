-- Orders can be created from a scanned buyer PO (docs/INVOICE-SCANNING.md, Q-050).
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "source_scan_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "orders_source_scan_id_key" ON "orders"("source_scan_id");

ALTER TABLE orders ADD CONSTRAINT orders_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;

-- A scan may now become a buyer order.
ALTER TABLE invoice_scans DROP CONSTRAINT invoice_scans_target;
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_target CHECK (target IS NULL OR target IN ('YARN_RECEIPT', 'TRIMS_RECEIPT', 'VENDOR_BILL', 'OUTWARD_DC', 'INWARD_DC', 'ORDER'));
