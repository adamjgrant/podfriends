# Podfriends Implementation Spec

This document gives any developer or LLM everything needed to build **Podfriends** end-to-end on top of the existing Cloudflare Worker + D1 bridge in this repository.

---

## 1. Existing Infrastructure (Already Provisioned & Live)

- **Deployed Worker URL**: `https://side-project-bridge.smosa.workers.dev`
- **Auth Database (`AUTH_DB`)**: `bridge-auth` (`d7bbc1e1-f60a-4d3c-9276-8fc06adee8ee`)
- **Google OAuth**: Already configured (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET` are set in Worker secrets).
- **Allowed Front-End Origin**: `https://adamjgrant.github.io` (plus `http://localhost:3000`, `5173`, `8080`, `127.0.0.1:5500` for local dev).
- **Auth Pattern**: Better Auth `bearer()` plugin + 60-second single-use `#auth_code` exchange (`POST /api/exchange`). See [frontend-example/index.html](../frontend-example/index.html) for the working client auth pattern and [docs/ARCHITECTURE.md](./ARCHITECTURE.md) for details.

---

## 2. Concrete Technical Decisions & Defaults

| Area | Decision / Default |
| --- | --- |
| **Front-end location & stack** | `frontend/` directory in this repo. Zero-build static HTML/CSS/ES modules (deployable directly to GitHub Pages, matching `frontend-example/index.html`). |
| **Backend location** | `worker/src/projects/podfriends.ts` mounted under `/p/podfriends/*` in `worker/src/index.ts`, plus a `scheduled()` handler for Cron Triggers. |
| **Database** | New isolated D1 database `project-podfriends` bound as `PROJECT_PODFRIENDS_DB` in `worker/wrangler.jsonc` and `worker/src/projects.ts`. Migrations in `worker/migrations/project-podfriends/`. |
| **Project accessMode** | `"public"` in `worker/src/projects.ts` so any Google user can sign up and match (can be switched to `"allowlist"` during private testing). |
| **Podcast directory** | **Apple iTunes Search API** (`https://itunes.apple.com/search?media=podcast&entity=podcast&term=...`), proxied via `/p/podfriends/podcasts/search?q=...`. Free, no API key required, returns `collectionId`, `collectionName`, `artistName`, `feedUrl`, and `artworkUrl600`. |
| **Chat transport (MVP)** | **HTTP polling** (`GET /p/podfriends/quartets/:id/messages?after=...` every 4–5 seconds while the chat is open). Upgradeable to Durable Objects WebSockets later without changing the DB schema. |
| **Email delivery** | **Resend** (`https://api.resend.com/emails`) using Worker secrets `RESEND_API_KEY` and `EMAIL_FROM`. If those secrets are not set yet, log the email to `console.log` and record `status = 'logged'` in `email_log` so local/MVP testing is never blocked. |

---

## 3. Data Model (`worker/migrations/project-podfriends/0001_init.sql`)

```sql
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  icebreakers_json TEXT NOT NULL DEFAULT '{}',
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  email_notifications_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS podcasts (
  id TEXT PRIMARY KEY, -- iTunes collectionId as string
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  feed_url TEXT NOT NULL,
  artwork_url TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT,
  latest_episode_guid TEXT,
  latest_episode_published_at TEXT
);

CREATE TABLE IF NOT EXISTS user_podcasts (
  user_id TEXT NOT NULL,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL, -- 1 = top favorite
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, podcast_id)
);

CREATE TABLE IF NOT EXISTS quartets (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quartet_members (
  quartet_id TEXT NOT NULL REFERENCES quartets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  intro_posted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (quartet_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  quartet_id TEXT NOT NULL REFERENCES quartets(id) ON DELETE CASCADE,
  user_id TEXT, -- NULL for system messages
  type TEXT NOT NULL DEFAULT 'chat', -- 'chat' | 'system_intro' | 'system_episode'
  body TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_quartet_created
  ON messages (quartet_id, created_at ASC);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  podcast_id TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (podcast_id, guid)
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'match_found' | 'member_joined' | 'episode_dropped'
  subject TEXT NOT NULL,
  status TEXT NOT NULL, -- 'sent' | 'logged' | 'failed'
  created_at TEXT NOT NULL
);
```

---

## 4. Core Product Flows & Rules

### A. Onboarding & Icebreakers
Users must complete onboarding (their display name + icebreaker answers) before participating in a quartet chat. Default icebreaker questions:
1. `favorite_episode`: *"What's your all-time favorite podcast episode (and why)?"*
2. `listening_habit`: *"When and where do you usually listen?"*
3. `bio`: *"A little bit about you outside of podcasts:"*

When a user completes onboarding or joins a quartet:
- Their answers are visible on their **Profile** (and clickable from any member list in a quartet).
- A `system_intro` message is inserted into the quartet's `messages` table with their biographical details.
- Existing quartet members receive a `member_joined` email containing the new member's name and icebreakers.

### B. Quartet Matching Rules (MVP)
- **Max size**: Strictly **4 members** per quartet (`COUNT(*) <= 4`).
- **One active quartet per user** (MVP default): A user can be in 1 active quartet at a time, and can click **Leave Quartet** to re-enter the matching pool.
- **When matching runs**:
  - Periodically via Cloudflare Cron Trigger (e.g., `*/15 * * * *` in `wrangler.jsonc`).
  - Also safe to trigger on-demand right after a user saves their podcast rankings.
- **Matching algorithm**:
  1. Find eligible users (`onboarding_completed = 1`, has ≥ 1 row in `user_podcasts`, and not in any `active` quartet).
  2. First, try to place each eligible user into an existing `active` quartet that has `< 4` members for one of the user's ranked podcasts (preferring their lowest `rank` number, i.e., #1 favorite first).
  3. Next, among remaining eligible users, group 2–4 users who share a podcast (again prioritizing highest average rank) and create a new `quartets` row + `quartet_members` rows.
  4. Send `match_found` emails to newly matched users (especially important for users who signed up earlier and waited).

### C. New Episode Notifications (RSS Polling)
- In the Cron Trigger, query all `podcasts` linked to at least one `active` quartet.
- Fetch each podcast's `feed_url` (with a short timeout and conditional headers / `last_checked_at` throttling).
- Parse RSS `<item>` entries (`guid`, `title`, `link`, `pubDate`).
- On the **first** check for a podcast (when `latest_episode_guid` is `NULL`), record the current latest episode without flooding the chat with historical episodes.
- On subsequent checks, for any new episode not yet in `episodes`:
  - Insert into `episodes`.
  - Insert a `system_episode` message into every `active` quartet for that `podcast_id`.
  - Optionally send `episode_dropped` emails to members with `email_notifications_enabled = 1`.

---

## 5. API Endpoints (`/p/podfriends/*`)

All routes below inherit the `/p/:projectId/*` auth middleware in `worker/src/index.ts` (so `c.get("user")` and `c.get("projectDb")` are already populated).

- `GET /p/podfriends/me` — Returns current user, `profile`, ranked `user_podcasts`, and current active `quartet` (if any).
- `PUT /p/podfriends/profile` — Updates `display_name`, `icebreakers_json`, `email_notifications_enabled`, and sets `onboarding_completed = 1`.
- `GET /p/podfriends/podcasts/search?q=...` — Queries iTunes Search API and returns normalized podcast results.
- `PUT /p/podfriends/podcasts/rankings` — Upserts selected podcasts into `podcasts` and replaces the user's `user_podcasts` with their ordered list (`rank` 1..N). Optionally runs matching immediately.
- `GET /p/podfriends/quartets/:id` — Returns quartet details, member list (with profiles/icebreakers), and matched podcast info (must be a member).
- `GET /p/podfriends/quartets/:id/messages?after=...` — Returns chat & system messages (must be a member).
- `POST /p/podfriends/quartets/:id/messages` — Posts a new `chat` message (must be a member and `onboarding_completed = 1`).
- `POST /p/podfriends/quartets/:id/leave` — Removes the user from `quartet_members` (and archives the quartet if 0 members remain).

---

## 6. Setup Checklist for Building Podfriends

1. Create D1 database: `npx wrangler d1 create project-podfriends`
2. Add `PROJECT_PODFRIENDS_DB` to `worker/wrangler.jsonc` (`d1_databases`) and `triggers.crons` (e.g. `["*/15 * * * *"]`).
3. Create `worker/migrations/project-podfriends/0001_init.sql` and apply it with `npx wrangler d1 execute project-podfriends --remote --file=./migrations/project-podfriends/0001_init.sql`.
4. Register `"podfriends"` in `worker/src/projects.ts` (`accessMode: "public"`).
5. Implement `/p/podfriends/*` routes and `scheduled()` cron handler in `worker/`.
6. Build `frontend/` (sign-in, podcast search & drag/arrow ranking, onboarding icebreaker form, waiting-for-match state, quartet chat with member bio drawer & episode cards).
7. Deploy Worker (`npm run deploy`) and publish `frontend/` to GitHub Pages.
