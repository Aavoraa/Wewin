# Cloud hosting: Vercel (web) + Render (API) + Neon (PostgreSQL)

The web app is already on Vercel (`https://wewin.vercel.app`, see DEPLOYMENT.md §7). This puts the
API and its database online so login and data work. All secrets are typed by the account owner
into the providers' dashboards; nothing secret is committed.

## 1. Database — Neon

1. Sign up at neon.tech and create a project: name `wewin`, PostgreSQL 17, region
   **AWS Asia Pacific (Singapore)**.
2. On the project dashboard, **Connect** → turn **Connection pooling off** (the API's job queue
   needs a direct connection) → copy the connection string. It looks like
   `postgresql://<user>:<password>@ep-…​.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

Free plan: 0.5 GB storage; the database sleeps when idle and wakes on the next request.

## 2. API — Render

1. Sign up at render.com with GitHub and allow access to the **Aavoraa/Wewin** repository.
2. **New → Blueprint** → choose Aavoraa/Wewin → Render reads `render.yaml` and shows one service,
   `wewin-api` (Singapore, Starter instance with a 5 GB disk for attachments and scans).
3. Fill the three secret values it asks for:
   - `DATABASE_URL` — the Neon connection string from step 1.
   - `SEED_OWNER_PASSWORD` — a first password for the `owner` login (at least 10 characters).
     You must change it at the first login.
   - `ANTHROPIC_API_KEY` — optional; enables Claude for invoice reading and voice. Leave empty to
     use local OCR only (voice then understands only "open <screen>").
4. **Apply.** The first build takes a few minutes. The start command applies the database
   migrations, creates the owner login and starts the API. The service page shows its address,
   e.g. `https://wewin-api.onrender.com`; `https://wewin-api.onrender.com/api/health` must answer
   `{"ok":true}`.
5. After the first successful login, delete `SEED_OWNER_PASSWORD` in the service's
   **Environment** tab.

Cost: the Starter instance and disk are paid (about US$7/month plus $0.25/GB for the disk). A Free
instance also works for a trial if the `plan` and `disk` lines are removed from `render.yaml`, but
it sleeps after 15 minutes idle (the first request then takes about a minute) and uploaded files
are lost on every restart.

## 3. Connect Vercel to the API

1. Vercel → project **wewin** → **Settings → Environment Variables** → add
   `API_ORIGIN` = the Render address from step 2 (e.g. `https://wewin-api.onrender.com`, no path),
   for Production and Preview.
2. **Deployments** → latest deployment → **Redeploy**.
3. Open `https://wewin.vercel.app`, log in as `owner` with the first password, set a new password.

## Notes

- `CORS_ORIGIN` in `render.yaml` is `https://wewin.vercel.app`. If the Vercel domain changes (custom
  domain), update it in Render's Environment tab.
- Backups: Neon keeps point-in-time history (7 days on Free, longer on paid plans). Attachments on
  the Render disk are covered by Render's daily disk snapshots on paid plans.
- Demo data: set `SEED_DEMO=true` before the first start to load the demo masters, or run the
  opening-data import (Settings › Opening data) for real balances.
