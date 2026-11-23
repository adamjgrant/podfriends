# Podfriends

Find friends based on the podcasts you actually listen to.

**App:** https://adamjgrant.github.io/podfriends/

**Development, deployment, and current MVP limitations:** [docs/RUNNING.md](./docs/RUNNING.md). The zero-build frontend lives in `frontend/` and is hosted on GitHub Pages. The API, D1 database, and scheduled jobs run on Cloudflare.

Podfriends matches listeners with overlapping favorite shows into small, cozy **quartets** (group chats of up to 4 people), introduces everyone with icebreaker bios, and automatically posts new episode drops so the group can talk about what they just heard.

---

## How It Works

### 1. Sign Up & Rank Your Podcasts
- Users sign in (via Google Sign-In on the shared auth bridge).
- They search for and select the podcasts they listen to.
- They **rank their favorites** (e.g., top picks / priority order) and save their list.

### 2. Automatic Quartet Matching (≤ 4 People)
- Periodically (e.g., via a scheduled background job), Podfriends looks for compatible listeners based on shared and ranked podcasts.
- Compatible listeners are placed into a **quartet** — a dedicated group chat of **4 people or fewer** centered around their overlapping podcast(s).
- Keeping groups capped at 4 avoids noisy mega-chats and makes it easy for everyone to actually get to know each other.

### 3. Onboarding & Icebreaker Introductions
- Signup only requires signing in and choosing podcasts. **Icebreakers wait until after a match**, so they don't slow down signup.
- Once matched, members see a congratulatory screen and answer three personal icebreakers (a great day off, a favorite conversation topic, and a small joy) before seeing their matches or entering the group chat.
- Those answers are saved to their **profile** so anyone in the chat can view them anytime.
- Whenever someone is added to a quartet, the **other members in the chat are automatically notified** with a welcome/intro message sharing those biographical details.

### 4. New Episode Notifications & Discussion
- Podfriends monitors RSS feeds for the quartet's matched podcast(s).
- Whenever a **new episode is published**, a system message/notification is posted directly into the quartet's group chat (episode title, link/notes, release date) so members can jump right into discussing it together.

### 5. Email-Driven Re-Engagement
- Because matching happens asynchronously (a user may sign up and rank podcasts before any compatible listeners are available), **email notifications** bring users back at key moments:
  - **Match found**: When a user is placed into a new quartet after waiting.
  - **New member joined**: When someone new is added to their quartet (including their icebreaker bio).
  - **Activity / episode alerts**: Optional email alerts for new episode drops or missed quartet messages.

---

## Architecture & Infrastructure

Podfriends is the first project hosted on the shared **Cloudflare Worker + D1 Bridge** in this repository:

- **Front end**: Static site hosted on GitHub Pages (`https://adamjgrant.github.io`), authenticating with `Authorization: Bearer <token>` headers.
- **Backend / API**: Shared Cloudflare Worker (`https://side-project-bridge.smosa.workers.dev`) handling Google OAuth (`AUTH_DB` / `bridge-auth`) and project-scoped `/p/podfriends/*` routes.
- **Database**: Isolated Cloudflare D1 database for Podfriends data (profiles, podcast selections & rankings, quartets, messages, episode feed state).
- **Scheduled jobs, email & live chat**: Cloudflare Workers Cron Triggers for periodic matching + RSS polling; **Resend** (`RESEND_API_KEY` + `EMAIL_FROM`) for transactional email notifications; Durable Objects (or polling to start) for real-time quartet chat updates.

For details on the Podfriends implementation spec and the shared Cloudflare setup:
- [docs/PODFRIENDS_SPEC.md](./docs/PODFRIENDS_SPEC.md) — Complete Podfriends data model, matching rules, API endpoints, RSS/email flows, and defaults
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Why the shared Cloudflare Worker + D1 bridge exists and how auth/isolation work
- [docs/BRIDGE_SETUP.md](./docs/BRIDGE_SETUP.md) — Setup, pricing/limits, and 3-step guide for adding projects
