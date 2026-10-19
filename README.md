# GDGOC IET DAVV Interview Evaluation System

Offline-first interview evaluation platform for GDGOC IET DAVV recruitment.
Judges evaluate candidates on interview panels; the app works fully offline and
synchronizes evaluations when connectivity returns.

## Repository layout

```
/
├── frontend/          # React + TypeScript + Vite PWA (deployed to Vercel as static site)
├── backend/           # Node.js + TypeScript Express REST API (deployed to Vercel Functions)
├── supabase/          # SQL migrations, RLS policies, database functions
└── docs/              # Deployment, offline testing, limitations
```

## Quick start (local development)

Prerequisites: Node.js 20+, npm 10+, a free [Supabase](https://supabase.com) project, Git.

### 1. Database

Create a Supabase project, then apply migrations (SQL editor or CLI):

```bash
supabase link --project-ref <your-project-ref>
supabase db push   # applies supabase/migrations/*.sql
```

Or paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run it.

### 2. Backend

```bash
cd backend
cp .env.example .env        # fill in values (placeholders below)
npm install
npm run dev                 # http://localhost:4000
npm test                    # automated tests (no live DB required)
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173 (proxies /api to backend)
```

### 4. Registration & first admin

Registration requires a **panel code** — only invited people can create
accounts. The code field accepts either:

- a **panel code** (Admin → Panels → "New code"): the account becomes a judge
  of that panel; or
- the **admin invite code** (`ADMIN_SECRET_CODE` env): the account becomes an
  admin.

A wrong code destroys the just-created account, so nobody can squat emails.
Panel codes are permanent (reusable like passwords) and can be rotated later
from Admin → Panels → "Rotate". The invite-code field looks identical to the
panel-code field on the form; wrong admin codes are silently ignored.

Alternatively, promote an existing account from the admin UI
(Admin → Judges → change role) or via SQL:

```sql
update public.profiles set role = 'admin' where id = '<auth-user-uuid>';
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for separate Vercel deployments of
frontend and backend plus Supabase configuration, and
[docs/OFFLINE_TESTING.md](docs/OFFLINE_TESTING.md) for the offline/sync test
procedure. Free-tier limitations are listed in [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

## Security model (summary)

- All API requests carry a Supabase Auth JWT; the backend verifies the JWT
  cryptographically and loads the user's role from the database. Roles sent by
  the frontend are never trusted.
- Panel verification codes are stored as salted hashes; they never appear in
  frontend code or unauthenticated responses. Repeated wrong attempts lock a
  code temporarily.
- Judges can only read candidates and submit evaluations for panels they
  belong to. Enforced server-side and by Postgres RLS.
- The Supabase service-role key exists only in backend environment variables.
- Aggregates (averages, counts) are computed by PostgreSQL, never by the browser.

## License

MIT — built for GDGOC IET DAVV.
