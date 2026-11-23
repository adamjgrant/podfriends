# Podfriends

Find your people through the podcasts you love.

**App:** https://adamjgrant.github.io/podfriends/

## The flow

1. **Sign in with Google and pick your shows.** Search, add favorites, and put the most important ones first. No icebreakers during signup.
2. **Get matched by podcast compatibility.** The matcher compares the whole ranked list, giving top choices more weight. Each match is a private one-to-one conversation. A person can have multiple conversations, with up to five active matches in this MVP.
3. **Introduce yourself after matching.** Answer three personal icebreakers before seeing your matches or entering chat. You only need to do this once.
4. **Start a conversation.** An inbox shows your connections and shared shows. New episodes from shared feeds are posted into the relevant chats.

Ending a conversation closes it for both people without affecting their other chats. The same pair is not automatically matched again.

## Hosting

- **Frontend:** Zero-build static HTML, CSS, and JavaScript in `frontend/`, published to GitHub Pages via the `main` branch workflow.
- **Backend:** Shared Cloudflare Worker at `https://side-project-bridge.smosa.workers.dev`.
- **Data:** Shared Google auth database plus an isolated `project-podfriends` D1 database.
- **Jobs:** Cloudflare Cron for matching and RSS polling every 15 minutes; matching also runs after preferences are saved.
- **Email:** Resend hooks exist but delivery is not configured. Matching and chat do not require email.

No additional frontend hosting service is required. The existing Notes project remains isolated and available.

## Development

```sh
cd worker
npm ci
npm test
npm run typecheck
```

For the frontend: `python3 -m http.server 8080 --directory frontend`. Local frontend requests use the live API unless you change the API URL.

## Documentation

- [Running, deployment, and limitations](docs/RUNNING.md)
- [Current product and API specification](docs/PODFRIENDS_SPEC.md)
- [Interaction audit and redesign](docs/UX_AUDIT.md)
- [Shared backend architecture](docs/ARCHITECTURE.md)
- [Shared backend setup](docs/BRIDGE_SETUP.md)
