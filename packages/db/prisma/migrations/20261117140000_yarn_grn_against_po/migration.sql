-- Yarn GRN against PO: yarn receipt lines remember the yarn PO line they receive (Q-080).
ALTER TABLE "yarn_receipt_lines" ADD COLUMN "po_line_id" UUID;
ALTER TABLE "yarn_receipt_lines" ADD CONSTRAINT "yarn_receipt_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "yarn_receipt_lines_po_line_id_idx" ON "yarn_receipt_lines" ("po_line_id");
