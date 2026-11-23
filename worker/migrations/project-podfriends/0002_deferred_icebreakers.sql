-- Match announcements happen before icebreakers; introductions happen afterwards.
ALTER TABLE quartet_members ADD COLUMN match_notified INTEGER NOT NULL DEFAULT 0;
UPDATE quartet_members SET match_notified = 1 WHERE intro_posted = 1;
