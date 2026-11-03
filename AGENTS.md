# Yaroki

Personal PWA for tracking the plants in one home: single user, Android phone, target cost $0. Live at https://yaroki.plants-tracker.workers.dev.

Setup and first-deploy steps are in `README.md`. This file holds only what an agent can't quickly learn from the code.

**Keeping this file current:** when a change makes anything here wrong, or adds context a future agent would otherwise have to rediscover, update this file in the same commit. Keep only what is strictly necessary, and delete what no longer applies.

## Stack and layout

One npm package. `@cloudflare/vite-plugin` runs the frontend and the Worker together from `npm run dev`.

- `src/`: React + TypeScript frontend, vite-plugin-pwa
- `worker/`: Cloudflare Worker, serves the API (`/api/*`) and the built frontend. No Node server. Routes use Hono (`worker/routes/`), request bodies and params are checked with zod (`worker/schemas.ts`).
- `shared/`: API types and limits used by both the Worker and the app, such as `Task` and the room name length.
- `migrations/`: D1 (SQLite) schema
- Photos are in R2. D1 stores only `photo_key`.

## Status

Built: password sign-in, a settings drawer behind the header cog (sign-out, rooms add/rename/delete), plants (add from a photo, delete), AI species ID on add, and a "next tasks" list on the home screen (watering only so far).

The UI is Hebrew and right-to-left. Hebrew text lives directly in the components, there is no i18n layer. Gemini returns the plant's name in Hebrew, a smaller English name, and the species in Latin. `category` and `light_needs` are stored as English enum values, and `src/RoomPage.tsx` holds their Hebrew labels.

Planned:

- Pl@ntNet as an optional extra for ID accuracy
- Watering reminders by Web Push (VAPID), with a "Watered ✓" notification action that updates the DB
- Weekly AI care check (fertilize, repot, pests, seasonal tips) that pushes only if action is needed
- Optional: "check my plant" photo diagnosis, Google Calendar integration

The cron handlers in `worker/index.ts` are stubs. The `push_subscriptions` table and the `care_notes` column exist but nothing uses them yet.

Tasks are computed from plant fields in `worker/tasks.ts`, not stored. A new task type goes in `TASK_TYPES` there, with its Hebrew labels in `src/NextTasks.tsx`. `plants.last_watered` is a `YYYY-MM-DD` date in Asia/Jerusalem, and a plant never marked as watered is due today. Marking a task done also logs a row in `events`. A task done today stays in the list, grayed, and can be undone that day only: undo deletes today's events and sets `last_watered` back to the latest earlier event.

## Commands

```bash
npm run dev                # local frontend + Worker, D1 and R2 stored in .wrangler/
npm run check              # format:check + lint + build, the same checks CI runs
npm run format             # Prettier writes; oxlint warnings fail the lint
npm run deploy             # CI runs this on merge to main; by hand only in an emergency
npm run db:migrate:local
npm run db:migrate:remote
npm run cf-typegen         # after changing wrangler.jsonc
npm run db:pull-prod       # replace local D1 with prod, copy missing photos; reads prod only
```

`db:pull-prod` also runs from the dev-only button in the header's settings menu. Its route lives in `vite.config.ts` with `apply: 'serve'`, so it never ships. Keep the script's `--remote` calls read-only (`d1 export`, `r2 object get`).

Private or machine-specific notes (local paths, shell setup, owner-only steps) go in the git-ignored `CLAUDE.local.md`, never in this file or any other committed file.

In `npm run dev` the favicon is yellow instead of green (`src/main.tsx`). Prod builds keep the green one.

## Secrets and auth

- Never commit a secret to any file. Production uses `npx wrangler secret put <NAME>`, local dev uses the git-ignored `.dev.vars`. `.dev.vars.example` lists the names with empty values.
- `APP_PASSWORD` gates every API route except `/api/health` and `/api/login`. New routes are mounted after `requireSession` in `worker/index.ts`, which is what makes them need a session.
- Login refuses to work if `APP_PASSWORD` is under 20 characters (503). Signed-in devices keep working. `npm run dev` skips this check.
- Login is guarded by the Cloudflare rate limit (10/min per IP, per location) and the 20-character rule. There is no lockout on purpose: a lockout lets anyone lock the owner out.
- Each sign-in creates a random token. The cookie holds it, and the `sessions` table holds only its SHA-256 hash, valid for 365 days. Sign-out deletes this device's row, "sign out everywhere" (`/api/logout-all`) deletes all rows. Changing `APP_PASSWORD` does not sign anyone out. A missing `APP_PASSWORD` locks the API, even for signed-in devices.
- Sentry is off until it has a DSN: `SENTRY_DSN` (Worker secret) for the API and cron, `VITE_SENTRY_DSN` (build-time env var) for the app. `shared/sentry.ts` keeps IPs, cookies, headers and bodies out of reports, because they hold the session token and the password. The Worker needs the `nodejs_als` flag for it. `Sentry.ErrorBoundary` in `src/main.tsx` shows `src/ErrorFallback.tsx` instead of a blank screen, with or without a DSN.
- `GEMINI_API_KEY` powers plant ID. Without it the identify route returns 503 and the rest of the app still works. `VAPID_PRIVATE_KEY` is reserved for push.

## Free-tier limits

- Workers: 10 ms CPU per request or cron run (I/O wait doesn't count), 100k requests/day. Push encryption may exceed the CPU limit, which would need Workers Paid ($5/mo). Don't move to anything paid without asking the owner.
- D1: 100k row writes and 5M reads per day.
- R2: free 10 GB. `MAX_PHOTO_BYTES` × `MAX_PLANTS` in `worker/limits.ts` is what keeps it under that, so raising either breaks the guarantee.
- Cron Triggers: 5 per Cloudflare account.

- Gemini: the model is `gemini-3.5-flash-lite`, because `gemini-3.8-flash` took over 25 s on a plant photo. The free tier is used in `worker/gemini.ts`, and Google may use free-tier prompts, photos included, to improve its products. Current free-tier quotas are shown in AI Studio, not in the docs.

## Gotchas

- Cron runs in UTC and the user is in Asia/Jerusalem, which shifts between UTC+2 and UTC+3.
- Cron strings in `wrangler.jsonc` must match the constants in `worker/index.ts` exactly.
- Cloudflare rejects `0` as a day of the week. Use `SUN`.
- Never rebuild `plants` with `DROP TABLE` in a migration: it cascades and deletes `events`. Use column swaps, as in `migrations/0002_rooms.sql`.
- CI applies migrations right before each deploy (`.github/workflows/ci.yml`), so a migration must work with the code that is live until the deploy finishes: add columns and tables first, remove them in a later change.
- Adding a plant and identifying it are two requests (`POST /api/rooms/:id/plants`, then `POST /api/plants/:id/identify`), so a Gemini failure never loses the photo and the UI can offer a retry.
- Base64-encoding a photo for Gemini must use the native `Uint8Array.toBase64()`. A JS loop took about 5 ms for a typical photo and 45 ms at `MAX_PHOTO_BYTES`, over the CPU limit.
- Deleting a plant or room removes its R2 photos first, so a failed delete can be retried without orphaning anything. `plants.room_id` is `ON DELETE SET NULL`, so deleting a room must delete its plants explicitly.
- Security headers: the static app's come from `public/_headers` (Content-Security-Policy included), API responses get Hono's `secureHeaders` in `worker/index.ts`. A new outside domain the app calls must be added to `connect-src` there. `npm run dev` doesn't apply `_headers`, `vite preview` does.
- Photos must reach the API as `image/webp`. `src/photo.ts` resizes to 1024px on the client. Photo keys are immutable and cached for a year, so a replaced photo needs a new key.
