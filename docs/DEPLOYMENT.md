# Deployment guide

Two independent Vercel projects + one Supabase project. Everything below fits
inside free-tier allowances for a university club's recruitment week, but see
[LIMITATIONS.md](LIMITATIONS.md).

## 1. Supabase

1. Create a free project at https://supabase.com (choose a region near your users).
2. Open **SQL Editor** and run the contents of `supabase/migrations/0001_init.sql`
   (or use the Supabase CLI: `supabase link` + `supabase db push`).
3. **Authentication → Providers → Email**: keep email/password enabled. For a
   short recruitment window, disabling "Confirm email" removes the confirmation
   step (document this decision; re-enable afterwards).
4. **Settings → API**: note the Project URL, `anon` key and `service_role` key.
5. The service-role key must ONLY be set on the backend Vercel project.

### Promoting the first administrator

Registration always creates judges. After the first admin account exists:

```sql
update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
```

Find the UUID in **Authentication → Users**. Later admins can be promoted from
the Admin → Judges screen.

## 2. Backend (Vercel Functions)

Repo root for this Vercel project: `backend/`.

1. New Vercel project → import the repo → set **Root Directory** to `backend`.
2. Framework preset: **Other** (no build command needed; `api/index.ts` is
   compiled by the `@vercel/node` runtime declared in `backend/vercel.json`).
3. Environment variables (Production + Preview + Development):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | service-role key (secret) |
   | `CODE_PEPPER` | long random string, e.g. output of `openssl rand -hex 32` |
   | `CORS_ORIGIN` | your frontend URL, e.g. `https://gdgoc-frontend.vercel.app` |
   | `VERIFY_ATTEMPT_LOCKOUT_MINUTES` | optional, default `10` |

4. Deploy. Health check: `https://<backend-url>/api/health`.

Routing note: `backend/vercel.json` maps `/api/*` to the single Express app in
`api/index.ts`, which is the supported pattern for Express on Vercel Functions
(Node runtime). Webhooks/SSE are not used, so the default function timeout is
sufficient.

## 3. Frontend (Vercel static)

Repo root for this Vercel project: `frontend/`.

1. New Vercel project → import the same repo → **Root Directory** = `frontend`.
2. Framework preset: **Vite** (build `npm run build`, output `dist`).
3. Environment variables:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | anon key (safe for the client) |
   | `VITE_API_URL` | `https://<backend-url>` (no trailing slash) |
   | `VITE_OFFLINE_SESSION_HOURS` | optional, default `12` |

4. Deploy. `frontend/vercel.json` rewrites all routes to `index.html` for the
   SPA router, and `vite-plugin-pwa` emits `sw.js` + `manifest.webmanifest`.

### Supabase CORS

Supabase Auth (used by the frontend for sign-in) allows all origins by default
on the free tier. The backend is called with `fetch` from the frontend origin —
set `CORS_ORIGIN` on the backend to the exact frontend URL.

## 4. Post-deploy smoke checklist

1. Register a judge account → sign in → verify a panel code.
2. Admin promotes that judge down/up; create a panel code; rotate it.
3. Import 2–3 candidates via CSV; evaluate one; check the Results table average.
4. Export summary + detailed CSV and open them in a spreadsheet.
5. Run the offline procedure in [OFFLINE_TESTING.md](OFFLINE_TESTING.md).

## Local development

```bash
# backend
cd backend && cp .env.example .env && npm install && npm run dev

# frontend (separate terminal)
cd frontend && cp .env.example .env && npm install && npm run dev
```

Vite proxies `/api` to `http://localhost:4000` in development, so
`VITE_API_URL` can stay empty locally.
