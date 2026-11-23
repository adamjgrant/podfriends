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

-- Database-enforced matching invariants, including concurrent cron/API runs.
CREATE TRIGGER quartet_capacity BEFORE INSERT ON quartet_members
WHEN (SELECT COUNT(*) FROM quartet_members WHERE quartet_id=NEW.quartet_id) >= 4
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER one_active_quartet BEFORE INSERT ON quartet_members
WHEN EXISTS (SELECT 1 FROM quartet_members m JOIN quartets q ON q.id=m.quartet_id WHERE m.user_id=NEW.user_id AND q.status='active')
BEGIN SELECT RAISE(IGNORE); END;
CREATE UNIQUE INDEX unique_intro ON messages(quartet_id,user_id) WHERE type='system_intro';
