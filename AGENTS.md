# Yaroki

Personal PWA for tracking the plants in one home: single user, Android phone, target cost $0. Live at https://yaroki.plants-tracker.workers.dev.

Setup and first-deploy steps are in `README.md`. This file holds only what an agent can't quickly learn from the code.

**Keeping this file current:** when a change makes anything here wrong, or adds context a future agent would otherwise have to rediscover, update this file in the same commit. Keep only what is strictly necessary, and delete what no longer applies.

**Comments:** write one only when it explains why, which the code can't say. Don't restate what the code does.

**Public vs private:** this repo is public. This file holds only what any contributor could use. Anything personal, machine-specific or owner-only (names, local paths, shell setup, home network, manual prod steps, old naming history) goes in the git-ignored `CLAUDE.local.md` on the owner's machine, never in a committed file or commit message. If a cloud session has no `CLAUDE.local.md`, it still must not commit such notes.

## Stack and layout

One npm package. `@cloudflare/vite-plugin` runs the frontend and the Worker together from `npm run dev`.

- `src/`: React + TypeScript frontend, vite-plugin-pwa
- `worker/`: Cloudflare Worker, serves the API (`/api/*`) and the built frontend. No Node server. Routes use Hono (`worker/routes/`), request bodies and params are checked with zod (`worker/schemas.ts`).
- `shared/`: API types and limits used by both the Worker and the app, such as `Task` and the room name length.
- `migrations/`: D1 (SQLite) schema
- Photos are in R2. D1 stores only `photo_key`.

## Status

Built: password sign-in, a settings drawer behind the header cog (sign-out, rooms add/rename/delete), plants (add from a photo, delete), AI species ID on add, room profiles (window direction, light, humidity, temperature range, draft/AC/heater flags), edited with the room location and Sensibo linking from the cog next to each room in the settings drawer's room management (`src/RoomSettings.tsx`); adding a room goes through the same screen, and a "next tasks" list on the home screen (watering only so far).

The app has one dark theme (deep green, near black), with colors as CSS variables at the top of `src/index.css`; keep new text colors at WCAG AA contrast against `--bg`, `--surface` and `--field`. The background vine is `public/vine.svg`, shown by fixed `body::before`/`::after` layers. The UI is Hebrew and right-to-left. Hebrew text lives directly in the components, there is no i18n layer. Gemini returns the plant's name in Hebrew, a smaller English name, and the species in Latin. Tapping a plant opens its page (`src/PlantPage.tsx`): only a Wikipedia reference photo of the species (looked up at identify time in `worker/wikipedia.ts`, best-effort), so the owner can check the ID; the AI description, and the plant's needs (light, humidity, temperature, watering) compared with the room by `shared/plantFit.ts`: each need is good, borderline or bad (green, orange, red, always with an icon and word too), or grey when the room has no data. Temperature and humidity use the newest reading from the last 3 days (`latest_reading` on the plant route) when there is one, else the owner's room profile. Draft/AC/heater are not compared, because plants carry no data about them. When a feature makes the AI save new data about plants, raise `ENRICH_VERSION` in `shared/api.ts` and extend `enrichPlant` in `worker/enrich.ts`: the plant page enriches an old plant when opened, and the daily cron enriches up to 5 per run, never changing the name. Identify sets the current version. Identify also gets the plant's room profile in the prompt (`describeRoom` in `worker/gemini.ts`) and saves a short Hebrew `care_notes`; it is not refreshed when the profile changes later. Humidity and temperature in the room settings form are manual only when the room has no reading from the last 3 days (`latestReading` in `worker/roomReading.ts`, also given to the AI prompt); with one, the form shows the measurement instead. Rooms outside the house hide the draft/AC/heater flags in the form and the prompt. `category` and `light_needs` are stored as English enum values, and `src/RoomPage.tsx` holds their Hebrew labels.

Room climate: `room_readings` holds measured temperature and humidity per room, separate from the owner's room profile. Indoor rooms get readings from one mapped Sensibo device each (`room_sensors`, enforced by the PUT route, key `SENSIBO_API_KEY`). Rooms marked `outside_window` or `garden` get Open-Meteo weather instead (no key, location from the `home_location` row, set in the settings drawer with address search through Photon/OpenStreetMap, no key, proxied by the Worker), with two years of daily means backfilled when the room is first marked outdoor. A cron every 3 hours (`worker/readings.ts`) collects both. The room page graphs humidity above temperature, this year against last year (last year shifted onto this year's axis, left out for outdoor rooms): single readings at first, then daily, then weekly averages as data fills in (`resolution` in the climate route), and press-and-drag shows a reading. All room setup lives in settings. Sensibo takes its key as a query parameter, so `scrubBreadcrumb` keeps it out of Sentry. Three of the five account crons are used (the hourly one also does the once-a-day jobs at 06:00 UTC).

Planned:

- Pl@ntNet as an optional extra for ID accuracy
- A "Watered ✓" action on the reminder notification that updates the DB
- Weekly AI care check (fertilize, repot, pests, seasonal tips) that pushes only if action is needed
- Optional: "check my plant" photo diagnosis, Google Calendar integration

Watering reminders: an hourly cron runs `sendReminderIfTime` (`worker/reminderTime.ts`), which in the learned hour (`reminder_schedule`, Asia/Jerusalem, default 8, kept within 7–21) calls `sendDueReminders` (`worker/push.ts`) once a day. The hour is the median of recent `watered` events (daily, 06:00 UTC), and the weekly cron lets Gemini refine it from hour and weekday counts only; once the AI has set it, the median no longer overwrites it. It sends a Web Push to every row of `push_subscriptions` when `dueTaskCount` is above zero. Pushes have no payload, so nothing is encrypted and the Worker stays inside the free CPU limit; `public/push-sw.js` (pulled into the generated service worker by `importScripts` in `vite.config.ts`) fetches `/api/tasks` and builds the text. A payload would need RFC 8291 encryption, and the subscription `keys` are already stored for that. Endpoints are limited to known push services (`isPushServiceUrl`), because the Worker POSTs to them. Devices subscribe from the settings drawer (`src/PushSettings.tsx`) and unsubscribe on sign-out. The weekly AI care cron is still a stub, and nothing uses `care_notes` for it yet.

Tasks are computed from plant fields in `worker/tasks.ts`, not stored. Tapping a task card (anywhere but its buttons) opens the plant page with `?from=home`, which makes Back go to the main screen instead of the room; which lists the plant's tasks (`tasks` on the plant route) with the current and the following due date (`next_due_date`). A new task type goes in `TASK_TYPES` there, with its Hebrew labels in `src/NextTasks.tsx`. `plants.last_watered` is a `YYYY-MM-DD` date in Asia/Jerusalem, and a plant never marked as watered is due today. Marking a task done also logs a row in `events`. The count of open tasks due today or earlier (`shared/taskBadge.ts`) is set as the app icon badge (`src/appBadge.ts`, only while the app runs). A task can be skipped with a reason (`SKIP_REASONS` in `shared/api.ts`): `task_skips` keeps one row per plant and task type, and the task's due date moves to the skip's `until` (days per reason in `worker/tasks.ts`). A skip stops counting once the plant is cared for after it, and can be cancelled. A task done today stays in the list, grayed, and can be undone that day only: undo deletes today's events and sets `last_watered` back to the latest earlier event.

The logo is the word ירוקי in Varela Round (SIL OFL), outlined to SVG paths, so nothing loads a font: `public/favicon.svg`, the PNG icons in `public/`, `src/Logo.tsx` (header) and `src/devFavicon.ts` (yellow dev variant). `icon-maskable-512.png` has the word smaller to stay inside the maskable safe zone.

## Commands

```bash
npm run dev                # local frontend + Worker, D1 and R2 stored in .wrangler/
npm run check              # format:check + lint + build + test, the same checks CI runs
npm test                   # Vitest inside the Workers runtime, see below
npm run format             # Prettier writes; oxlint warnings fail the lint
npm run deploy             # CI runs this on merge to main; by hand only in an emergency
npm run db:migrate:local
npm run db:migrate:remote
npm run cf-typegen         # after changing wrangler.jsonc
npm run db:pull-prod       # replace local D1 with prod, copy missing photos; reads prod only
```

`db:pull-prod` also runs from the dev-only button in the header's settings menu. Its route lives in `vite.config.ts` with `apply: 'serve'`, so it never ships. Keep the script's `--remote` calls read-only (`d1 export`, `r2 object get`).

In `npm run dev` the favicon is yellow instead of green (`src/main.tsx`). Prod builds keep the green one.

## Tests

`test/` runs with Vitest and `@cloudflare/vitest-plugin`, inside workerd with a local D1, R2 and rate limiter from `wrangler.jsonc` (`vitest.config.ts`). Migrations are applied once per file and `test/setup.ts` empties the tables before each test. Call the Worker through `api()` in `test/helpers.ts`.

- A new API route must be added to the route guard list in `test/auth.test.ts`.
- Gemini is always mocked. A mocked `fetch` used by a route must build its `Response` inside `mockImplementation`, because a Worker can't read a body made in another request.
- Fake timers move `Date` only. D1's `datetime('now')` keeps the real time, so tests that log events use the real clock.
- `import.meta.env.DEV` is true under Vitest, so the 20-character password rule isn't tested.

## Secrets and auth

- Never commit a secret to any file. Production uses `npx wrangler secret put <NAME>`, local dev uses the git-ignored `.dev.vars`. `.dev.vars.example` lists the names with empty values.
- `APP_PASSWORD` gates every API route except `/api/health` and `/api/login`. New routes are mounted after `requireSession` in `worker/index.ts`, which is what makes them need a session.
- Login refuses to work if `APP_PASSWORD` is under 20 characters (503). Signed-in devices keep working. `npm run dev` skips this check.
- Login is guarded by the Cloudflare rate limit (10/min per IP, per location) and the 20-character rule. There is no lockout on purpose: a lockout lets anyone lock the owner out.
- Each sign-in creates a random token. The cookie holds it, and the `sessions` table holds only its SHA-256 hash, valid for 365 days. Sign-out deletes this device's row, "sign out everywhere" (`/api/logout-all`) deletes all rows. Changing `APP_PASSWORD` does not sign anyone out. A missing `APP_PASSWORD` locks the API, even for signed-in devices.
- Sentry is off until it has a DSN: `SENTRY_DSN` (Worker secret) for the API and cron, `VITE_SENTRY_DSN` (build-time env var) for the app. `shared/sentry.ts` keeps IPs, cookies, headers and bodies out of reports, because they hold the session token and the password. The Worker needs the `nodejs_als` flag for it. `Sentry.ErrorBoundary` in `src/main.tsx` shows `src/ErrorFallback.tsx` instead of a blank screen, with or without a DSN.
- `GEMINI_API_KEY` powers plant ID. Without it the identify route returns 503 and the rest of the app still works. `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (made with `scripts/generate-vapid.mjs`) enable push; without them the push routes return 503 and the cron skips reminders.

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
- Security headers: the static app's come from `public/_headers` (Content-Security-Policy included), API responses get Hono's `secureHeaders` in `worker/index.ts`. A new outside domain the app calls must be added to `connect-src` there, and one it loads images from to `img-src` (Wikimedia is there for reference photos). `npm run dev` doesn't apply `_headers`, `vite preview` does.
- Photos must reach the API as `image/webp`. `src/photo.ts` resizes to 1024px on the client. Photo keys are immutable and cached for a year, so a replaced photo needs a new key.
