-- SPL.Request for yarn and fabric shortages too (Q-077).
CREATE TYPE "SplKind" AS ENUM ('ACCESSORY', 'YARN', 'FABRIC');

ALTER TABLE "spl_requests" ADD COLUMN "kind" "SplKind" NOT NULL DEFAULT 'ACCESSORY';

CREATE INDEX "spl_requests_kind_idx" ON "spl_requests"("kind");
