# Plants Tracker

Personal PWA for tracking the plants in one home: single user, Android phone, target cost $0. Live at https://plants-tracker.plants-tracker.workers.dev.

Setup and first-deploy steps are in `README.md`. This file holds only what an agent can't quickly learn from the code.

**Keeping this file current:** when a change makes anything here wrong, or adds context a future agent would otherwise have to rediscover, update this file in the same commit. Keep only what is strictly necessary, and delete what no longer applies.

## Stack and layout

One npm package. `@cloudflare/vite-plugin` runs the frontend and the Worker together from `npm run dev`.

- `src/`: React + TypeScript frontend, vite-plugin-pwa
- `worker/`: Cloudflare Worker, serves the API (`/api/*`) and the built frontend. No Node server.
- `migrations/`: D1 (SQLite) schema
- Photos are in R2. D1 stores only `photo_key`.

## Status

Built: password sign-in, rooms, adding a plant to a room from just a photo.

Planned:

- AI species ID and categorization on add: Gemini free tier (Flash / Flash-Lite), structured JSON output. Free-tier prompts may be used by Google. Pl@ntNet is an optional extra for accuracy.
- Watering reminders by Web Push (VAPID), with a "Watered ✓" notification action that updates the DB
- Weekly AI care check (fertilize, repot, pests, seasonal tips) that pushes only if action is needed
- Optional: "check my plant" photo diagnosis, Google Calendar integration

The cron handlers in `worker/index.ts` are stubs. The `events` and `push_subscriptions` tables and the AI columns on `plants` exist but nothing uses them yet.

## Commands

```bash
npm run dev                # local frontend + Worker, D1 and R2 stored in .wrangler/
npm run build && npm run lint   # the only checks; there are no tests
npm run deploy             # manual, pushing to GitHub does not deploy
npm run db:migrate:local
npm run db:migrate:remote
npm run cf-typegen         # after changing wrangler.jsonc
```

On Idan's Mac, Node comes from fnm and is missing from non-interactive shells. Prefix commands with `export PATH="$HOME/.local/share/fnm/node-versions/v26.13.0/installation/bin:$PATH"`.

The phone can't reach the Mac over home Wi-Fi, so phone testing goes through the deployed URL.

## Secrets and auth

- Never commit a secret to any file. Production uses `npx wrangler secret put <NAME>`, local dev uses the git-ignored `.dev.vars`. `.dev.vars.example` lists the names with empty values.
- `APP_PASSWORD` gates every API route except `/api/health` and `/api/login`. New routes go below the sign-in check in `worker/index.ts`.
- A missing `APP_PASSWORD` must keep the API locked. Changing it signs out every device, because the session token is derived from it.
- `GEMINI_API_KEY` and `VAPID_PRIVATE_KEY` are reserved for the planned features.

## Free-tier limits

- Workers: 10 ms CPU per request or cron run (I/O wait doesn't count), 100k requests/day. Push encryption may exceed the CPU limit, which would need Workers Paid ($5/mo). Don't move to anything paid without asking Idan.
- D1: 100k row writes and 5M reads per day.
- R2: free 10 GB. `MAX_PHOTO_BYTES` × `MAX_PLANTS` in `worker/index.ts` is what keeps it under that, so raising either breaks the guarantee.
- Cron Triggers: 5 per Cloudflare account.

## Gotchas

- Cron runs in UTC and the user is in Asia/Jerusalem, which shifts between UTC+2 and UTC+3.
- Cron strings in `wrangler.jsonc` must match the constants in `worker/index.ts` exactly.
- Cloudflare rejects `0` as a day of the week. Use `SUN`.
- Never rebuild `plants` with `DROP TABLE` in a migration: it cascades and deletes `events`. Use column swaps, as in `migrations/0002_rooms.sql`.
- Migrations don't run on deploy. Run `db:migrate:remote` yourself, before deploying code that needs the new schema.
- Photos must reach the API as `image/webp`. `src/photo.ts` resizes to 1024px on the client. Photo keys are immutable and cached for a year, so a replaced photo needs a new key.
