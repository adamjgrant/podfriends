# Running Podfriends

## Hosting

- Frontend: https://adamjgrant.github.io/podfriends/
- API: https://side-project-bridge.smosa.workers.dev
- Static frontend source: `frontend/`, with no build step or server dependency.
- GitHub Pages publishes the `gh-pages` branch. Cloudflare only runs the backend.
- Database: `project-podfriends`, isolated from shared auth and Notes.
- Matching and RSS checks run every 15 minutes. Matching also runs after profile/ranking saves.

This uses GitHub Pages and the existing Cloudflare free-plan infrastructure. No other host is required. Free-plan limits still apply.

## Local frontend

```sh
python3 -m http.server 8080 --directory frontend
```

Open http://localhost:8080. This connects to the deployed API and uses real Google authentication and production data.

## Backend checks and deployment

```sh
cd worker
npm ci
npm run typecheck
npm test
npx wrangler d1 migrations apply project-podfriends --remote
npm run deploy
```

Use `WRANGLER_LOG_PATH=/tmp/podfriends-wrangler.log` if the default Wrangler log directory is not writable.

For an isolated backend, run `npx wrangler d1 migrations apply project-podfriends --local`, apply the auth and Notes migrations locally too, supply auth secrets in ignored `worker/.dev.vars`, and run `npm run dev`. Change the frontend API constant to the local Worker URL for that session. Google OAuth would need a registered local callback; automated API tests do not need Google credentials.

## Publish frontend updates

After committing changes on `main`:

```sh
git subtree push --prefix frontend origin gh-pages
```

The repository must have GitHub Pages configured to publish the root of `gh-pages`.

When changing DOM elements required by `app.js`, bump `PAGE_VERSION` in `frontend/bootstrap.js` and the matching `data-app-version` and script `?v=` in `frontend/index.html`. The startup guard detects cached old HTML, reloads it once with a cache-busting query while preserving the OAuth hash, and refuses to initialize mismatched markup. Do not remove this guard: mismatched cached HTML previously crashed before the auth-code exchange and created a sign-in loop.

## Implemented

- Google OAuth through a first-party `/api/login` navigation (no third-party state cookie dependency), then the existing bridge's single-use bearer-token exchange
- Fast signup: Google sign-in, favorite podcasts, then a waiting screen. Matching does not require icebreakers. Once matched, a congratulatory icebreaker form unlocks the group; the API withholds quartet details and messages until it is complete. Existing completed profiles go straight to their group.
- Match notifications are tracked separately from introductions. Incomplete profiles receive only a generic match announcement; introductions and member alerts happen after icebreakers are completed.
- Three general conversation starters about a day off, a favorite topic, and a small joy. Legacy answers keep their original labels until edited.
- iTunes directory search and up to 20 ranked podcasts. If the Worker lookup fails, the frontend retries the same public directory directly with CORS, without sending credentials. This is the same free source used by `smosa-image-gallery/crawlers/itunes_podcast_crawler.py`.
- Matching by shared shows and ranking, with SQLite triggers enforcing four members and one active group per user
- Quartet chat with incremental five-second polling and member bios
- Leave quartet and return to matching
- RSS/Atom polling, initial-history suppression, and idempotent episode cards
- Match/member email hooks and delivery status records

## Known MVP limitations

- Resend is not configured. Email events are recorded as `logged`, not delivered. The frontend discloses this. To enable delivery, configure `RESEND_API_KEY` and a verified `EMAIL_FROM` with `wrangler secret put`, then update the frontend email notice.
- An actual Google login requires the user to complete consent. Live checks verify the Google redirect, state-cookie creation, invalid callback rejection, and authenticated API protection, not the complete Google callback flow.
- GitHub reports Pages deployment status `built`. Browser smoke testing was blocked by the local Chrome launch environment, and outbound requests to the Pages domain timed out from the agent environment. Visual rendering and the full login flow still need a user-browser check.
- Chat loads the newest 100 messages initially; older-history browsing is not implemented.
- Matching processes 100 candidates per run; feed polling processes 10 feeds, oldest checked first. Larger adoption will require queues and capacity planning.
- Leaving can result in matching into the same group again. There is no block/report, account deletion UI, moderation, or per-user rate limiting yet. Treat this as a small MVP, not a fully hardened public social network.
- RSS processing supports common RSS and Atom feeds. Invalid feeds are skipped and retried later; conditional HTTP caching is not implemented yet.
- Optional episode/missed-chat emails are not implemented.

## Tests

`worker/tests/podfriends.test.ts` exercises the real Hono routes and matching SQL against in-memory SQLite. It covers onboarding, rankings, a six-person matching pool, database capacity invariants, membership restrictions, sending and polling messages, leaving, feed first-run suppression, episode deduplication, and URL/XML validation. It does not impersonate or modify any real user.

`worker/tests/frontend-auth.test.ts` runs the bundled frontend in JSDOM to test saved-session restoration, one-time callback exchange, stale-page recovery without redirect loops, and expired-session handling. Search and setup tests cover the directory fallback and sequential onboarding.
