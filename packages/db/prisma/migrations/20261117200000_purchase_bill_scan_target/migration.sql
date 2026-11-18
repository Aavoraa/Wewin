-- Scan invoices: a supplier invoice can be scanned into a purchase bill (Q-083).
ALTER TABLE invoice_scans DROP CONSTRAINT invoice_scans_target;
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_target CHECK (target IS NULL OR target IN ('YARN_RECEIPT', 'TRIMS_RECEIPT', 'VENDOR_BILL', 'PURCHASE_BILL', 'OUTWARD_DC', 'INWARD_DC', 'ORDER', 'PROGRAM'));
