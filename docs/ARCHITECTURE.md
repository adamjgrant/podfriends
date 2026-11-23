# Why This Exists: Shared Cloudflare Backend for Side Projects

## The Problem

Static hosting like **GitHub Pages** (`https://<username>.github.io/<repo>`) is free, fast, and zero-maintenance for front-end HTML/JS/React apps — **until a side project needs**:

1. **User login** (Google Sign-In, etc.)
2. **Persistent storage** (a real SQL database instead of `localStorage`)
3. **Access control** (keeping a personal tool private to just you, or a small group of friends)

Spinning up a separate backend server, database, and OAuth app for every weekend project creates unnecessary boilerplate, credentials to manage, and monthly hosting bills.

## The Solution: One Shared "Bridge" Worker + Isolated D1 Databases

This repository implements a **single shared Cloudflare Worker** (`side-project-bridge`) that acts as the backend API and auth gateway for **all** of your static GitHub Pages side projects:

```text
GitHub Pages Front End A (notes)  ──┐
GitHub Pages Front End B (app2)   ──┼──▶  Cloudflare Worker ("bridge")
GitHub Pages Front End C (app3)   ──┘       ├── AUTH_DB (bridge-auth: users, sessions, memberships)
                                            ├── PROJECT_NOTES_DB (project-notes)
                                            └── PROJECT_APP2_DB  (project-app2)
```

### Core Design Principles

1. **Set up auth once, reuse everywhere (`bridge-auth`)**
   - A single shared D1 database (`AUTH_DB` / `bridge-auth`) holds Better Auth tables (`user`, `session`, `account`, `verification`), per-project memberships (`project_members`), and short-lived OAuth exchange codes (`auth_exchange_codes`).
   - You only configure **Google Cloud Console OAuth** once, pointing at `https://<your-worker>.workers.dev/api/auth/callback/google`.

2. **Isolated data per project (`project-*` D1 databases)**
   - Every side project gets its own separate Cloudflare D1 (SQLite) database and `/p/:projectId/*` route prefix.
   - Project A can never query Project B's tables, and deleting or migrating one project never affects another.

3. **Per-project access control (`owner_only`, `allowlist`, `public`)**
   - Even though user accounts live in one auth database, each project in `worker/src/projects.ts` enforces its own `accessMode`:
     - `owner_only`: Only emails listed in `OWNER_EMAILS` (`wrangler.jsonc`) can access the project's routes.
     - `allowlist`: `OWNER_EMAILS` plus specific `allowedEmails` on that project.
     - `public`: Any signed-in user can use the project (their rows are still scoped by `user_id`).

4. **Cross-origin auth without third-party cookies**
   - GitHub Pages (`*.github.io`) and Cloudflare Workers (`*.workers.dev`) are different sites, and modern browsers block third-party cookies between them.
   - After Google OAuth completes on the Worker, the Worker generates a **60-second, single-use `#auth_code`** in the redirect URL hash.
   - The front end exchanges `#auth_code` via `POST /api/exchange` for a Bearer token, stores it in `localStorage`, and sends `Authorization: Bearer <token>` on API requests.
   - Cookie-based auth remains enabled automatically if you later host both front end and Worker on subdomains of a custom domain.

5. **Strict per-project CORS**
   - Every `/p/:projectId/*` route checks the `Origin` header against that specific project's `allowedOrigins` list in `worker/src/projects.ts`, so one project's front end cannot call another project's API.

## Why Cloudflare Workers + D1?

- **$0/month to start**: Cloudflare Free includes 100,000 Worker requests/day and up to **10 D1 databases** (1 shared auth DB + 9 side projects).
- **Cheap to scale**: Upgrading to **Workers Paid ($5/month)** raises the D1 limit to **1,000,000 databases** (100,000 included), so you can host dozens of side projects for a flat $5/month.
- **Zero cold starts & single deploy**: No containers or servers to patch; adding a new project is just creating a D1 database, adding a binding, and running `npm run deploy`.

## When to Move Beyond D1

D1 is SQLite at the edge — great for personal tools, CRUD apps, and small-to-medium projects, with a few known constraints:
- Single-threaded writes per database
- 500 MB max per DB on Free (10 GB on Paid)
- No built-in WebSocket push out of the box

If a specific project outgrows D1, you can add **Durable Objects** (live/realtime state), **R2** (file/blob storage), or **Queues** (heavy write buffering), or move just that one project's routes to an external Postgres database (like Neon) without touching any of your other projects.
