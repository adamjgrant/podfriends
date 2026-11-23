# Shared Backend Setup (Cloudflare Workers + D1)

A single Cloudflare Worker ("bridge") that sits between your static front ends (on GitHub Pages) and one Cloudflare D1 database per side project.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full explanation of why this setup exists, cross-origin Bearer token auth, security model, and scaling trade-offs.

## Folder Contents

- `docs/ARCHITECTURE.md` — Detailed explanation of why this setup exists and how all the pieces fit together
- `worker/` — The Cloudflare Worker (`Hono` + `Better Auth` + `D1`)
  - `src/projects.ts` — Register each side project, its D1 database, its allowed front-end origins (CORS), and who can sign in (`owner_only`, `allowlist`, or `public`)
  - `src/auth.ts` — Better Auth setup (Google Sign-In, optional Email/Password + Resend, Bearer header tokens + cookie support)
  - `src/index.ts` — API routes, per-project CORS, OAuth one-time code exchange, and example `notes` CRUD routes
  - `migrations/auth/0001_init.sql` — Shared identity & membership tables (`AUTH_DB`)
  - `migrations/project-notes/0001_init.sql` — Example project table (`notes`)
- `frontend-example/index.html` — Single-file static front end for GitHub Pages

## Pricing & Limits (Checked Nov 2026)

| Resource | Cloudflare Free ($0/mo) | Workers Paid ($5/mo min) |
| --- | --- | --- |
| Workers Requests | 100,000 / day | 10M / month included |
| Workers CPU Time | 10 ms / request | 30M CPU ms / month included |
| D1 Databases / Account | **10 max** | **1,000,000 max (100,000 included)** |
| D1 Max Database Size | 500 MB | 10 GB |
| D1 Total Storage | 5 GB | 1 TB |
| D1 Rows Read / Written | 5M read & 100k written / day | 25B read & 50M written / month |

- **20-project note**: Free tier covers up to 9 projects (1 shared auth DB + 9 project DBs = 10 D1 databases). At 10+ projects, upgrade to the $5/month Workers Paid plan (no extra per-database fee up to 100,000 databases).
- **Known D1 limits**: Single-threaded writes (one write at a time per DB), 10 GB hard cap per DB (500 MB on Free), and no built-in live push to open screens. If a project hits these, use Cloudflare add-ons first (Durable Objects for live updates, R2 for files, Queues for heavy writes) or move just that project to Postgres (e.g. Neon).

## Setup & Deploy Steps

1. In `worker/`, install dependencies and log in to Cloudflare:
   ```bash
   cd worker
   npm install
   npx wrangler login
   ```
2. Create the shared auth DB and the example notes DB:
   ```bash
   npx wrangler d1 create bridge-auth
   npx wrangler d1 create project-notes
   ```
3. Paste both `database_id` values into `worker/wrangler.jsonc`, and set `OWNER_EMAILS` to your email.
4. Apply the SQL schemas:
   ```bash
   npx wrangler d1 execute bridge-auth --remote --file=./migrations/auth/0001_init.sql
   npx wrangler d1 execute project-notes --remote --file=./migrations/project-notes/0001_init.sql
   ```
5. Generate and save `BETTER_AUTH_SECRET`:
   ```bash
   openssl rand -base64 32
   npx wrangler secret put BETTER_AUTH_SECRET
   ```
6. Update `allowedOrigins` in `worker/src/projects.ts` with your GitHub Pages origin (`https://YOUR-USERNAME.github.io`), then deploy:
   ```bash
   npm run deploy
   ```
7. Add Google OAuth secrets when ready:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   (Optional, only when enabling email/password with `ENABLE_EMAIL_PASSWORD = "true"`):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   ```

## How to Add a New Side Project (3 Steps)

1. Create its D1 database and apply its schema:
   ```bash
   npx wrangler d1 create project-mynewapp
   npx wrangler d1 execute project-mynewapp --remote --file=./migrations/project-notes/0001_init.sql
   ```
2. Add the D1 binding to `worker/wrangler.jsonc` (`d1_databases`) and `ProjectBindings` in `worker/src/projects.ts`.
3. Add one entry to `PROJECTS` in `worker/src/projects.ts` (`allowedOrigins` + `accessMode`), then run `npm run deploy`.
