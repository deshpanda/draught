-- 0002 — label photos, following, and lists.
-- Applied on top of schema.sql. Safe to re-run.

-- ---- photos ---------------------------------------------------------------
-- A pour carries the photo the drinker took. A beer carries the one that
-- represents it everywhere else (first one uploaded wins, until someone
-- replaces it deliberately).
ALTER TABLE pours ADD COLUMN photo_key TEXT;
ALTER TABLE beers ADD COLUMN photo_key TEXT;

-- ---- following ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
-- "who do I follow" and "who follows me" are both hot reads.
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- ---- lists ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ranked      INTEGER NOT NULL DEFAULT 0,   -- 1 = show positions, it's a ranking
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS list_items (
  list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  beer_id  INTEGER NOT NULL REFERENCES beers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (list_id, beer_id)
);
CREATE INDEX IF NOT EXISTS idx_list_items_order ON list_items(list_id, position);
