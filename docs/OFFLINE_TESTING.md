# Offline installation & synchronization test procedure

Manual test — run before every recruitment event. Budget ~15 minutes.

## Prerequisites

- A deployed (or locally running) frontend + backend + Supabase.
- Two judge accounts (J1, J2) verified on the same panel, one admin account.
- At least two candidates on that panel.
- A device to take offline (laptop or phone). Chrome/Edge recommended.

## Part A — Prepare the device (online)

1. Sign in as **J1** on the test device.
2. Home → **Prepare / re-check** → *Prepare for offline interviews*.
3. Confirm the page reports: *Ready for offline interviews* with a nonzero
   cached-candidate count. If it does not, the device is NOT ready — do not
   proceed (the app must never claim readiness early).

## Part B — Go offline

4. Enable airplane mode (or DevTools → Network → Offline). The header badge
   must switch to **Offline** within a few seconds.
5. Close the tab completely and reopen the app URL.
   - The app shell must load (service worker cache).
   - The candidate list must appear from IndexedDB with search/filter working.
6. Open a candidate → select the round → enter criterion scores + feedback →
   **Submit evaluation** (button reads "Save evaluation (offline)").
   - Expect: green "Saved on this device" confirmation.
   - Expect: Home/Sync badge shows `1 to sync`.
7. Submit a second evaluation for a different candidate. Optionally force-quit
   the browser between submissions to prove durability.
8. On **My Evaluations**, both items must be listed as *Pending* with scores.

## Part C — Restore connectivity

9. Disable airplane mode. The badge switches to **Online**; sync starts
   automatically (startup/online/visibility triggers). You can also press
   **Synchronize now** on the Sync page.
10. Expect the sync report: "All 2 evaluation(s) synchronized"; pending count 0;
    items move to *Recently synchronized*.
11. Sign in as the **admin** on another device → Results:
    - Each candidate shows exactly one evaluation from J1 with the same score
      entered offline.
    - Averages and evaluation counts match the individual ratings.

## Part D — Idempotency & retry

12. Re-submit the same offline item (Sync → Synchronize now) after it already
    synced: no duplicate must appear in admin Results or `/evaluations/mine`.
13. Go offline again, submit one more evaluation, restore connectivity but
    immediately block the backend (e.g. temporarily clear `VITE_API_URL` or use
    DevTools to fail the `/api/sync/evaluations` request once):
    - The item must return to *Pending/Failed* with the error shown.
    - Fix connectivity → Synchronize now → item syncs; nothing was lost.

## Part E — Conflicts

14. As J1, submit an evaluation online for candidate X (round with
    "allow edits" OFF). Then, still as J1, create a local copy:
    go offline, open candidate X, change the score, "Save to device only".
15. Restore connectivity. The sync result must be a **Conflict** — the local
    copy is preserved, the server record is not overwritten, and the server
    record is viewable in the conflict card.
16. Discard the local copy → item disappears; admin Results still show the
    original score only.

## Part F — Revocation & shared devices

17. As admin, remove J1 from the panel. As J1 (online), submitting or syncing
    must fail with "You are not assigned to this candidate's panel".
18. Log out on the test device with queued items — confirm the warning, then
    verify IndexedDB is empty (DevTools → Application → IndexedDB →
    `gdgoc-offline`) and the app returns to the login screen.
19. Sign in as J2 on the same device: J2 must NOT see J1's cached candidates
    until J2 prepares their own offline data.

## Part G — Session expiry

20. Set `VITE_OFFLINE_SESSION_HOURS=0.001` (~3.6 s), prepare, go offline, wait,
    reopen: the app must demand sign-in instead of silently allowing access.

Record results of each step in the release checklist for the event.
