ALTER TABLE "vendor_bills" ADD COLUMN     "is_opening" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "opening_imports" (
    "id" UUID NOT NULL,
    "doc_no" TEXT,
    "kind" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "rows" JSONB NOT NULL,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "row_count" INTEGER NOT NULL,
    "created" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "cancel_reason" TEXT,

    CONSTRAINT "opening_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_imports_doc_no_key" ON "opening_imports"("doc_no");

-- CreateIndex
CREATE INDEX "opening_imports_kind_status_idx" ON "opening_imports"("kind", "status");


-- Reviewed additions
ALTER TABLE opening_imports ADD CONSTRAINT opening_imports_number_by_status CHECK ((status = 'DRAFT') = (doc_no IS NULL));
ALTER TABLE opening_imports ADD CONSTRAINT opening_imports_kind CHECK (kind IN ('ORDERS', 'STOCK', 'VENDOR_STOCK', 'VENDOR_BALANCES'));
ALTER TABLE vendor_bills ADD CONSTRAINT vendor_bills_opening_posted CHECK (NOT is_opening OR status <> 'DRAFT');
SELECT audit_attach('opening_imports');

-- Existing databases: the OPENING virtual location and the OPN series (the seed adds them on new ones).
INSERT INTO locations (id, code, name, kind, updated_at) VALUES (gen_random_uuid(), 'OPENING', 'Opening balance (go-live import)', 'VIRTUAL', now()) ON CONFLICT (code) DO NOTHING;
INSERT INTO document_series (code, name, prefix, padding) VALUES ('OPENING', 'Opening-data import', 'OPN', 4) ON CONFLICT (code) DO NOTHING;
