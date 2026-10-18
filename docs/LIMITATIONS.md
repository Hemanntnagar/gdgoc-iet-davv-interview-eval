# Free-tier limitations & manual setup

## Supabase (free tier)

- **500 MB database, ~5 GB egress/month, 50k monthly active users** — far above
  a club recruitment round, but not unlimited.
- **Edge function invocations** are not used; the backend runs on Vercel.
- **Auth email confirmations**: with confirmations on, judges need inbox access
  during registration. For walk-in interviews, admins can temporarily disable
  confirmations in Supabase Auth settings (re-enable afterwards).
- **No scheduled backups on free tier** — export the Results CSVs after the
  event as the record copy. Consider `supabase db dump` weekly.
- RLS is enabled on all tables as defense in depth. The backend uses the
  service-role key (bypasses RLS) but re-implements every permission check in
  application code; automated tests cover judge/admin separation.

## Vercel (free tier)

- Backend functions: **10 s default execution limit** and shared-instance cold
  starts (~200–500 ms). The sync endpoint processes ≤ 20 evaluations per batch,
  which comfortably fits.
- Free tier is **hobby/personal use only** — fine for a university club, not
  for commercial resale.
- In-memory rate limiting and the in-memory failed-verification tracker reset
  when a serverless instance recycles. Durable per-code lockout counters live
  in the database and survive restarts.
- Two Vercel projects (frontend, backend) are required because the backend needs
  Node runtime functions and the frontend is a static PWA.

## Offline / PWA constraints

- **Background Sync** is not relied upon (Chromium-only); the app synchronizes
  on startup, on the `online` event, on tab visibility and via a manual button.
- **iOS Safari**: the service worker and IndexedDB work, but iOS may evict
  storage under pressure; the "Offline readiness" panel shows the actual cached
  counts so judges can re-prepare.
- **Offline sessions are not fresh authentication.** A cached session proves the
  device was signed in within the last `VITE_OFFLINE_SESSION_HOURS` (default 12).
  On shared or potentially compromised devices this is a real risk: the cached
  candidate list and queued evaluations live in the browser's IndexedDB until
  logout wipes them. Use **Log out** (which clears local data) between judges on
  shared devices, keep the expiry short, and prefer one device per judge.
- Server-side revalidation happens at sync time: revoked panel access or
  deactivated accounts block uploads even if a local session is still valid.

## Manual setup steps (cannot be automated for free)

1. Create the Supabase project and run the migration SQL (one paste).
2. Create two Vercel projects and set environment variables (documented in
   [DEPLOYMENT.md](DEPLOYMENT.md)).
3. Promote the first admin via SQL (or later admins via the UI).
4. Distribute panel verification codes to judges out-of-band (they are shown
   once at creation; the app never lists plaintext codes again).
5. Export results CSVs after the event as an archival copy.

## Deliberately not included

- SMS/WhatsApp notifications (paid or third-party).
- Paid AI scoring/feedback analysis.
- Multi-tenant support beyond a single club.
- Judges cannot export the full dataset; only admins can, and exports are
  written to the audit trail.
