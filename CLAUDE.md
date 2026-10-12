# Wewin ERP — rules for code changes

Read docs/ARCHITECTURE.md and docs/SCOPE.md before changing a module. Open business questions live in
docs/OPEN-QUESTIONS.md — never invent a business rule; add a question and a conservative, configurable default.

- TypeScript strict. pnpm monorepo: apps/api, apps/web, packages/db, packages/shared, packages/config.
- Kg and money: Prisma Decimal + decimal.js (`D()` from @wewin/shared). Never JS number for business maths.
- Only apps/api/src/core/ledger writes stock_movements. Posting runs inside withTx() (SERIALIZABLE).
- Every write goes through withTx() so the audit trigger records the acting user.
- Posted documents are never edited or deleted; cancel creates reversals via ledger.reverse().
- Module layout: routes → controller → service → repo. Cross-module calls go through services. No Prisma outside repos.
- Zod schemas live in packages/shared and are used by both API and forms.
- Every route has requirePermission(). Every post/cancel/close/approve writes audit.log() with the reason.
- Document numbers come only from core/numbering inside the posting transaction.
- Write Vitest tests for pure logic and Supertest tests for posting (create → post → movements → cancel → reversal, permission denied, double post).
- Run `pnpm lint && pnpm typecheck && pnpm test` before saying a task is done.
- Track progress in docs/IMPLEMENTATION-PLAN.md and automation status in docs/AUTOMATION-PLAN.md.
