-- Real-browser diagnostics: failed actions and uncaught errors reported by the frontend.
CREATE TABLE IF NOT EXISTS client_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_client_events_created ON client_events(created_at);
-- Match emails are on by default; existing draft profiles adopt the new default.
UPDATE profiles SET email_notifications_enabled = 1 WHERE onboarding_completed = 0;
