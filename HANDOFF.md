# CLI Agent Handoff: Shared Backend for Side Projects

This folder (`/Users/adam/repos/podfriends`) contains a shared Cloudflare Worker ("bridge") + Cloudflare D1 backend for static GitHub Pages front ends.

## Confirmed Decisions & Constraints
- **Cloudflare Plan**: Existing **Cloudflare Free** plan ($0/mo; 10 D1 databases max = 1 shared auth DB + up to 9 project DBs; upgrade to $5/mo Workers Paid only when passing 10 databases).
- **Auth Providers**: **Google Sign-In** + optional **Email & Password** (with optional Resend email). **Sign in with Apple is NOT used** (no Apple Developer Program).
- **Session Strategy**: `Authorization: Bearer <token>` headers via Better Auth's `bearer()` plugin + a 60-second single-use `#auth_code` URL hash exchange (`POST /api/exchange`) so `github.io` front ends work with `workers.dev` without third-party cookies. Cookie support remains intact for future custom subdomains.
- **Database Layout**: One shared `AUTH_DB` (`bridge-auth`) for Better Auth tables + `project_members` + `auth_exchange_codes`, and one isolated D1 database per side project (starting with `project-notes`).

## Current Files Already Present
- `README.md` — Architecture, pricing/limits, setup, and 3-step add-project guide
- `worker/package.json` — Dependencies (`better-auth`, `hono`, `jose`, `wrangler`, `typescript`, `@cloudflare/workers-types`)
- `worker/tsconfig.json` — TypeScript config
- `worker/wrangler.jsonc` — Worker + D1 bindings (`AUTH_DB`, `PROJECT_NOTES_DB`)
- `worker/src/index.ts` — Hono app, per-project CORS, `/api/exchange`, `/api/auth/*`, and `/p/:projectId/notes` CRUD routes
- `worker/migrations/auth/0001_init.sql` — Better Auth + `project_members` + `auth_exchange_codes` schema
- `worker/migrations/project-notes/0001_init.sql` — Example `notes` table schema

## Missing Files to Create First
1. `worker/src/projects.ts` — Project registry (`PROJECTS` map with `id`, `dbBinding`, `allowedOrigins`, `accessMode: "owner_only" | "allowlist" | "public"`, `allowedEmails`) and `getAllAllowedOrigins()`.
2. `worker/src/auth.ts` — `createAuth(env, request)` returning a per-request `betterAuth({ database: env.AUTH_DB, baseURL: new URL(request.url).origin, basePath: "/api/auth", trustedOrigins: getAllAllowedOrigins(), socialProviders: { google }, emailAndPassword, plugins: [bearer()] })`.
3. `frontend-example/index.html` — Static single-file HTML/JS page for GitHub Pages that signs in with Google, exchanges `#auth_code` at `POST /api/exchange`, stores the Bearer token in `localStorage`, and reads/writes `/p/notes/notes`.

## Execution Checklist for CLI Agent
1. **Create the 3 missing files** (`worker/src/projects.ts`, `worker/src/auth.ts`, `frontend-example/index.html`) and verify `worker/src/index.ts` imports match.
2. **Install & typecheck**:
   ```bash
   cd /Users/adam/repos/podfriends/worker
   npm install
   npm run typecheck
   ```
3. **Ask the user for**:
   - Their email address (for `OWNER_EMAILS` in `wrangler.jsonc`)
   - Their GitHub Pages origin (e.g. `https://USERNAME.github.io`) for `allowedOrigins` in `worker/src/projects.ts`
4. **Authenticate & provision D1 databases**:
   ```bash
   npx wrangler login
   npx wrangler d1 create bridge-auth
   npx wrangler d1 create project-notes
   ```
   Put both returned `database_id` values into `worker/wrangler.jsonc`.
5. **Apply D1 migrations**:
   ```bash
   npx wrangler d1 execute bridge-auth --remote --file=./migrations/auth/0001_init.sql
   npx wrangler d1 execute project-notes --remote --file=./migrations/project-notes/0001_init.sql
   ```
6. **Set auth secret & deploy**:
   ```bash
   openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
   npm run deploy
   ```
   Record the deployed `https://side-project-bridge.<subdomain>.workers.dev` URL.
7. **Walk the user through Google Cloud Console OAuth setup** (one step at a time):
   - Authorized redirect URI: `https://<YOUR-WORKER-URL>/api/auth/callback/google`
   - Save `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` via `npx wrangler secret put`.
8. **Wire & test the example front end**:
   - Set `WORKER_URL` in `frontend-example/index.html` to the deployed Worker URL and test sign-in + note creation/deletion on GitHub Pages.
