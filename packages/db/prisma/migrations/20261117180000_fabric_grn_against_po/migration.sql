-- Fabric (and yarn) GRN against PO on inward from others (Q-082).
ALTER TABLE "stock_doc_lines" ADD COLUMN "po_line_id" UUID;
ALTER TABLE "stock_doc_lines" ADD CONSTRAINT "stock_doc_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "stock_doc_lines_po_line_id_idx" ON "stock_doc_lines" ("po_line_id");
