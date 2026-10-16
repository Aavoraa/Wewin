-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('QUEUED', 'PROCESSING', 'NEEDS_REVIEW', 'READY', 'APPLIED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "AliasStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');


-- AlterTable
ALTER TABLE "trims_docs" ADD COLUMN     "source_scan_id" UUID;

-- AlterTable
ALTER TABLE "vendor_bills" ADD COLUMN     "source_scan_id" UUID;

-- AlterTable
ALTER TABLE "yarn_receipts" ADD COLUMN     "source_scan_id" UUID;

-- CreateTable
CREATE TABLE "invoice_scans" (
    "id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "page_count" INTEGER,
    "status" "ScanStatus" NOT NULL DEFAULT 'QUEUED',
    "target" TEXT,
    "classification" TEXT,
    "extractor" TEXT,
    "text_source" TEXT,
    "extraction" JSONB,
    "layout" JSONB,
    "review" JSONB,
    "validation" JSONB,
    "vendor_id" UUID,
    "vendor_invoice_no" TEXT,
    "invoice_date" DATE,
    "total_amount" DECIMAL(14,2),
    "applied_doc_type" TEXT,
    "applied_doc_id" UUID,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "processed_at" TIMESTAMPTZ(3),
    "applied_at" TIMESTAMPTZ(3),
    "discarded_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_scan_events" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "before" JSONB,
    "after" JSONB,
    "note" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_item_aliases" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "norm_description" TEXT NOT NULL,
    "sample_description" TEXT NOT NULL,
    "item_id" UUID NOT NULL,
    "status" "AliasStatus" NOT NULL DEFAULT 'PROPOSED',
    "times_confirmed" INTEGER NOT NULL DEFAULT 1,
    "proposed_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendor_item_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_scans_file_key_key" ON "invoice_scans"("file_key");

-- CreateIndex
CREATE INDEX "invoice_scans_status_created_at_idx" ON "invoice_scans"("status", "created_at");

-- CreateIndex
CREATE INDEX "invoice_scans_vendor_id_vendor_invoice_no_idx" ON "invoice_scans"("vendor_id", "vendor_invoice_no");

-- CreateIndex
CREATE INDEX "invoice_scans_sha256_idx" ON "invoice_scans"("sha256");

-- CreateIndex
CREATE INDEX "invoice_scan_events_scan_id_created_at_idx" ON "invoice_scan_events"("scan_id", "created_at");

-- CreateIndex
CREATE INDEX "vendor_item_aliases_vendor_id_status_idx" ON "vendor_item_aliases"("vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_item_aliases_vendor_id_norm_description_item_id_key" ON "vendor_item_aliases"("vendor_id", "norm_description", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "trims_docs_source_scan_id_key" ON "trims_docs"("source_scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bills_source_scan_id_key" ON "vendor_bills"("source_scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "yarn_receipts_source_scan_id_key" ON "yarn_receipts"("source_scan_id");

-- AddForeignKey
ALTER TABLE "invoice_scan_events" ADD CONSTRAINT "invoice_scan_events_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "invoice_scans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_size CHECK (size_bytes > 0 AND size_bytes <= 10485760);
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_target CHECK (target IS NULL OR target IN ('YARN_RECEIPT', 'TRIMS_RECEIPT', 'VENDOR_BILL'));
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_applied CHECK ((status = 'APPLIED') = (applied_doc_id IS NOT NULL));
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;
ALTER TABLE invoice_scans ADD CONSTRAINT invoice_scans_uploader_fk FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE vendor_item_aliases ADD CONSTRAINT vendor_item_aliases_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE;
ALTER TABLE vendor_item_aliases ADD CONSTRAINT vendor_item_aliases_item_fk FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE;
ALTER TABLE yarn_receipts ADD CONSTRAINT yarn_receipts_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;
ALTER TABLE trims_docs ADD CONSTRAINT trims_docs_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;
ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_scan_fk FOREIGN KEY (source_scan_id) REFERENCES invoice_scans(id) ON DELETE RESTRICT;

-- The scan history is evidence: never edited or deleted.
CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON invoice_scan_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Row audit keeps the scan's state changes but not the invoice content itself (extraction, word layout,
-- review JSON): field-level corrections are recorded in invoice_scan_events instead.
CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_req  text;
  v_old  jsonb;
  v_new  jsonb;
  v_ref  jsonb;
  v_id   text;
BEGIN
  v_user := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_req  := NULLIF(current_setting('app.request_id', true), '');
  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD) - ARRAY['password_hash', 'extraction', 'layout', 'review', 'validation']; END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW) - ARRAY['password_hash', 'extraction', 'layout', 'review', 'validation']; END IF;
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NEW;
  END IF;
  v_ref := COALESCE(v_new, v_old);
  v_id := COALESCE(
    v_ref->>'id',
    v_ref->>'key',
    v_ref->>'code',
    concat_ws(':', v_ref->>'role_id', v_ref->>'user_id', v_ref->>'permission_key')
  );
  INSERT INTO audit_log (user_id, request_id, table_name, record_id, action, old_data, new_data)
  VALUES (v_user, v_req, TG_TABLE_NAME, v_id, TG_OP, v_old, v_new);
  RETURN COALESCE(NEW, OLD);
END $$;

SELECT audit_attach('invoice_scans');
SELECT audit_attach('vendor_item_aliases');
