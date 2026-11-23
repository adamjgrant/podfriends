# Interaction audit and redesign

## Scope

Audited the actual frontend, API behavior, saved-session startup, search, selection, ranking, matching, introductions, chat, and leaving. The existing podcast-wall landing artwork was preserved. Product direction changed during the audit from quartets to multiple private one-to-one conversations.

## Findings and changes

| Finding | Change |
| --- | --- |
| Adding a show only produced a distant alert, with no visible selection state | Cards change to a selected background and a checked Added button. The favorites count and tray update immediately. |
| Favorites were buried below up to 20 results | Persistent desktop selection tray, plus a mobile review shortcut. |
| Users had to submit every query manually | Debounced search-as-you-type, explicit submit still supported, query suggestions, clear button, session query cache. |
| Slow search responses could replace more recent results | Request-generation checks reject stale results, including during the debounce period. |
| Loading, errors, empty results, and successful selection all used the same banner | Skeleton results, contextual search status, inline retry guidance, selected-card feedback, and dismissible action toasts. |
| An accidental removal was irreversible | Undo restores both the show and its previous position. |
| Ranking controls were unexplained and always active | Visible rank numbers, top-pick labeling, drag reorder, keyboard/touch arrow controls, disabled boundary controls, focus restoration. |
| Reloading lost a selection in progress | Per-account local drafts restore unfinished favorites only when based on the same saved ranking. |
| Save allowed selection edits during a network request | Selection locks while saving. A saving label replaces the call to action until the operation finishes. |
| Mobile users had to scroll through all results to continue | A sticky selection-count/review button brings them to the favorites tray. |
| Waiting offered little reassurance or useful context | Real saved artwork and a three-stage progress explanation, without fabricated matches or countdowns. |
| Incoming matches could interrupt podcast editing | The waiting screen transitions to icebreakers; active editing instead gets an actionable match-ready notification. |
| Post-match icebreakers felt like a generic form | Clear introduction context, answer progress, short-answer guidance, improved field spacing and focus states. |
| The app assumed one room and one shared podcast | Multi-conversation inbox with real shared-show summaries, weighted compatibility matching, private two-member chats. |
| New messages could be missed while reading older ones | New-messages shortcut without forced scrolling. Concurrent polls no longer duplicate rendered messages. |
| Leaving used a browser confirm box with group-specific copy | Accessible confirmation dialog explains that the conversation ends for both people, other chats remain, and the pair will not be re-created. |
| Motion/focus/accessibility were afterthoughts | Reduced-motion support, live announcements, pressed states, named controls, form focus styling, tab-heading focus, native dialog keyboard support. |

## Verification

Automated JSDOM tests cover visible selected states, counts, reordering, undo, draft recovery, stale search suppression, failure/retry, saving locks, startup/session handling, and post-match onboarding gates. SQLite integration tests cover multiple pair chats, two-person capacity, duplicate prevention, privacy, ending conversations, introductions, and feed deduplication. TypeScript is checked separately.

A rendered desktop/mobile browser pass is still needed: this agent environment previously blocked launching Chrome. DOM tests do not prove layout or screen-reader behavior.

## Remaining work, not disguised as finished

- Email delivery still requires Resend configuration. The UI discloses this rather than promising alerts.
- Unread counts across devices, push notifications, older message history, and message retry queues are not implemented.
- User reporting, blocking, account deletion, and stronger abuse controls are required before broad promotion.
- Icebreaker drafts are not persisted across reloads; favorites drafts are.
- Matching currently considers a bounded 200-profile pool and allows five active pair chats per person. A scalable fair scheduling strategy is needed beyond the MVP.
- Ended chat history is retained in the database but not exposed as a history browser.
