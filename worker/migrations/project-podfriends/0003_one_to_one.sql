-- Preserve legacy group history; all new matches are private pairs.
ALTER TABLE quartets ADD COLUMN kind TEXT NOT NULL DEFAULT 'group';
ALTER TABLE quartets ADD COLUMN pair_key TEXT;
ALTER TABLE quartets ADD COLUMN match_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quartets ADD COLUMN shared_podcasts_json TEXT NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX unique_chat_pair ON quartets(pair_key) WHERE pair_key IS NOT NULL;
DROP TRIGGER one_active_quartet;
DROP TRIGGER quartet_capacity;
CREATE TRIGGER chat_capacity BEFORE INSERT ON quartet_members
WHEN (SELECT COUNT(*) FROM quartet_members WHERE quartet_id=NEW.quartet_id) >=
  (SELECT CASE WHEN kind='pair' THEN 2 ELSE 4 END FROM quartets WHERE id=NEW.quartet_id)
BEGIN SELECT RAISE(ABORT, 'Chat is full'); END;
CREATE TRIGGER active_chat_limit BEFORE INSERT ON quartet_members
WHEN (SELECT COUNT(*) FROM quartet_members m JOIN quartets q ON q.id=m.quartet_id
      WHERE m.user_id=NEW.user_id AND q.status='active' AND q.kind='pair') >= 5
BEGIN SELECT RAISE(ABORT, 'Active chat limit reached'); END;
CREATE INDEX idx_members_user ON quartet_members(user_id);
