# Podfriends current implementation

## Product

Podfriends introduces listeners in **private one-to-one chats**, not four-person rooms. A listener can have several distinct conversations. Signup is Google sign-in followed by ranked podcast selection. Personal icebreakers are deferred until the first match, and completed only once.

## Matching

`worker/src/projects/matching.ts` compares ranked podcast lists using weighted Jaccard similarity:

- Each show has weight `1 / rank`.
- The numerator sums the smaller weight for every shared show.
- The denominator sums the larger weight across the union of both lists.
- The score is rounded to 0 through 100; no overlap means no match.
- Candidates are processed highest score first, then most shared shows, then a deterministic pair key.
- Every new conversation has exactly two members. A unique sorted pair key prevents duplicate chats, including recreating an ended conversation.
- Each person may have up to five active pair chats. This MVP considers the oldest 200 profiles with selections; larger populations need fair queueing and pagination.
- Scores and shared shows are snapshots at introduction. Existing conversations are not replaced when a more compatible person arrives.
- Saving rankings creates a draft profile from the Google display name. Icebreakers are not a prerequisite for matching.

The five-chat limit is also enforced by a database trigger, and pair creation plus both memberships runs in a transactional D1 batch.

## Access and introductions

`GET /me` exposes `match_found` and `needs_icebreakers`. Until icebreakers are complete, it returns no chat identities, member profiles, or message history. Chat endpoints independently enforce membership and completed onboarding.

Questions:

- `day_off`: What's your idea of a great day off?
- `talk_for_hours`: What's something you could happily talk about for hours?
- `small_joy`: What's a small thing that always makes your day?

Historical answers retain their original labels. Finishing a profile posts one introduction per chat. Match announcements are separate from introductions, so users can be notified before completing their profile. Incomplete profiles do not receive other members' introduction emails.

## Storage and compatibility

Migrations live in `worker/migrations/project-podfriends/`:

1. `0001_init.sql`: profiles, podcasts, selections, historical quartet tables, messages, episodes, email log.
2. `0002_deferred_icebreakers.sql`: tracks match announcements separately from posted intros.
3. `0003_one_to_one.sql`: adds `kind`, `pair_key`, `match_score`, `shared_podcasts_json`, unique pair constraint, two-person capacity, and multiple-chat support. Removes the one-active-quartet invariant.

The physical names `quartets`, `quartet_members`, `quartet_id`, and the `/quartets/:id` API paths are retained for compatibility. They now represent conversations. Legacy group rows retain `kind='group'`; new matches use `kind='pair'`. No history is dropped. At rollout the live database had no groups, profiles, or messages to migrate.

## API

All routes are under `/p/podfriends` and require the shared bridge's authenticated bearer session.

- `GET /me`: own profile, ranked podcasts, `match_found`, `needs_icebreakers`, and `chats` ordered by score. Each visible chat includes partner summary and shared shows. The legacy `quartet` property mirrors the first visible chat for old clients.
- `PUT /profile`: validate and save display name, three answers, and email preference; complete onboarding and trigger introductions.
- `GET /podcasts/search?q=...`: public iTunes directory proxy with timeout and cache hints. The static frontend falls back to direct credential-free CORS requests if the proxy fails.
- `PUT /podcasts/rankings`: save up to 20 ordered shows and optional email preference; create a draft profile if needed and enqueue matching.
- `GET /quartets/:id`: conversation information and completed member profiles, membership/onboarding required.
- `GET /quartets/:id/messages?after=<message-id>`: newest 100 initially; stable timestamp/ID cursor thereafter.
- `POST /quartets/:id/messages`: chat messages, 1 to 4000 characters.
- `POST /quartets/:id/leave`: close a pair chat for both users, leaving their other conversations unaffected. Historical group rows retain their old leave behavior.

## Feeds and email

Cron runs every 15 minutes. RSS/Atom is polled for all shows shared by active pairs, not just one primary show. Initial history is recorded without flooding chats. Deterministic episode-message IDs prevent duplicate posts.

Resend secrets are optional. Without them, email events are recorded as `logged`, not sent. The frontend states this explicitly. Optional missed-message and episode emails remain unimplemented.

## Frontend

Plain HTML/CSS/ES modules hosted on GitHub Pages. No frontend server or build required. `podcast-picker.js` owns contextual search, selected cards, ranking, undo, local drafts, request ordering, and busy states. `bootstrap.js` prevents mismatched cached markup from breaking auth. Version the bootstrap and entry script when changing required DOM elements.

See `UX_AUDIT.md` for the interaction audit and `RUNNING.md` for deployment instructions and limitations.
