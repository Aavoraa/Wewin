# Hosting everything on Vercel

Wewin runs entirely on the Vercel project **wewin** (`https://wewin.vercel.app`):

| Part | On Vercel |
|---|---|
| Web app | Static build of `apps/web` |
| API | One Vercel function (`api/index.mjs` → `apps/api/dist/serverless.js`); every `/api/*` request goes to it |
| Database | Neon PostgreSQL, created from the project's **Storage** tab (sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`) |
| Files (attachments, scanned invoices, report exports) | Vercel Blob, private store (sets `BLOB_READ_WRITE_TOKEN`) |
| Scheduled jobs | Vercel Cron (`vercel.json` → `crons`), secured with `CRON_SECRET` |
| After-save work (stock refresh, invoice reading, Excel exports) | Runs in the same function after the response (kept alive with `waitUntil`) |

Every production build applies database migrations (`ops/vercel/build.sh`); preview builds never
touch the database. Nothing secret is committed.

## One-time setup (Vercel dashboard, project **wewin**)

1. **Storage → Create Database → Neon** (region *Singapore*), connect it to the project for
   Production and Preview.
2. **Storage → Create → Blob**, access **Private**, connect it to the project.
3. **Settings → Environment Variables** — add (Production and Preview):

   | Key | Value |
   |---|---|
   | `CRON_SECRET` | 32+ random characters (without it the scheduled jobs are refused) |
   | `SEED_OWNER_PASSWORD` | first password for `owner` (10+ characters; must be changed at first login) |
   | `ANTHROPIC_API_KEY` | optional — Claude for invoice reading and voice |
   | `SCAN_AI_PROVIDER`, `VOICE_AI_PROVIDER` | `anthropic` (only with the key above) |

   Set automatically, no action: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BLOB_READ_WRITE_TOKEN`,
   and the defaults applied by the API on Vercel (token key derived from the database credentials unless `JWT_SECRET` is set, time zone IST, secure cookies, CORS for the
   production domain, jobs inline).
4. **Deployments → latest → Redeploy.** The build log shows `applying database migrations` and
   `loading foundation data`. Open `https://wewin.vercel.app`, log in as `owner`, choose a new
   password.
5. Delete `SEED_OWNER_PASSWORD` afterwards.

Until steps 1–3 are done the site loads but login answers *The server is not set up yet* with the
missing settings named.

## Limits on Vercel (Q-061)

- **Uploads ≤ 4.5 MB** per request on Vercel functions (attachments and scans allow 10 MB on a
  server). Larger scans should be split or compressed.
- **Function time ≤ 300 s** (Hobby): long scanned invoices read by OCR may stop; AI reading is faster.
- **Cron on Hobby runs once a day within the hour** of the set time (times in `vercel.json` are UTC:
  ageing 23:30 IST = 18:00 UTC, overdue D.C.s 08:00 IST = 02:30 UTC, payments due 08:15 IST,
  scan retention 02:00 IST, export cleanup 02:15 IST).
- **Cold starts:** the first request after a quiet spell takes a few seconds.
- Neon Free: 0.5 GB; the database sleeps when idle and wakes on the next request.

For a server with a persistent disk and background workers instead, see DEPLOYMENT.md (VM) or
`render.yaml` (Render).
