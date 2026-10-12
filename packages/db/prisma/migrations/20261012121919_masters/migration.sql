-- CreateEnum
CREATE TYPE "ProcessStage" AS ENUM ('KG', 'PCS');

-- CreateTable
CREATE TABLE "processes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "ProcessStage" NOT NULL,
    "default_return_days" INTEGER NOT NULL DEFAULT 15,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" TEXT,
    "pincode" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "credit_days" INTEGER NOT NULL DEFAULT 0,
    "tds_applicable" BOOLEAN NOT NULL DEFAULT false,
    "tds_rate_pct" DECIMAL(6,3),
    "debit_note_gst_applicable" BOOLEAN NOT NULL DEFAULT false,
    "debit_note_gst_rate_pct" DECIMAL(6,3),
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_ifsc" TEXT,
    "whatsapp_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_processes" (
    "vendor_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,

    CONSTRAINT "vendor_processes_pkey" PRIMARY KEY ("vendor_id","process_id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payment_terms" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processes_code_key" ON "processes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_code_key" ON "vendors"("code");

-- CreateIndex
CREATE INDEX "vendors_name_idx" ON "vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_code_key" ON "buyers"("code");

-- CreateIndex
CREATE INDEX "buyers_name_idx" ON "buyers"("name");

-- AddForeignKey
ALTER TABLE "vendor_processes" ADD CONSTRAINT "vendor_processes_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_processes" ADD CONSTRAINT "vendor_processes_process_id_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════ Hand-written SQL (reviewed) ════════════════════════
-- A vendor's stock location points back at the vendor.
ALTER TABLE locations ADD CONSTRAINT locations_vendor_fk FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;
SELECT audit_attach('processes');
SELECT audit_attach('vendors');
SELECT audit_attach('vendor_processes');
SELECT audit_attach('buyers');
