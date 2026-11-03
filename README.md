# Yaroki

Personal PWA for tracking the plants in my home.

- `src/`: React + TypeScript frontend (Vite, vite-plugin-pwa)
- `worker/`: Cloudflare Worker backend, serves the API and the built frontend
- `migrations/`: D1 (SQLite) schema
- `wrangler.jsonc`: Worker config with the D1 and R2 bindings and cron triggers

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars # then set APP_PASSWORD
npm run db:migrate:local
npm run dev
```

`npm run dev` runs the frontend and the Worker together, with local D1 and R2 stored in `.wrangler/`.

After changing `wrangler.jsonc`, run `npm run cf-typegen` to refresh `worker-configuration.d.ts`.

## Secrets

Copy `.dev.vars.example` to `.dev.vars` for local dev. In production use `npx wrangler secret put <NAME>`. Never commit either value.

Plant identification needs `GEMINI_API_KEY`, a free key from [Google AI Studio](https://aistudio.google.com/apikey).

## Sign-in

`APP_PASSWORD` protects every API route except `/api/health` and `/api/login`. If it is unset, nobody can sign in. Changing it signs out every device.

## Deploying

```bash
npx wrangler login
npm run deploy
npm run db:migrate:remote
npx wrangler secret put APP_PASSWORD
npx wrangler secret put GEMINI_API_KEY
```

The first deploy creates the D1 database and R2 bucket from the bindings in `wrangler.jsonc`.
