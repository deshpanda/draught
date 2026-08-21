-- 0006 — the social layer on writing, plus favourites and tags.

-- Four pinned beers on a profile, exactly as Letterboxd pins four films. The
-- cap is enforced in the API, not here, so the error can be a sentence rather
-- than a constraint violation.
CREATE TABLE IF NOT EXISTS favourites (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beer_id  INTEGER NOT NULL REFERENCES beers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, beer_id)
);
CREATE INDEX IF NOT EXISTS idx_fav_order ON favourites(user_id, position);

-- A like on someone's *review* — distinct from liking the beer. You can love
-- what someone wrote about a beer you hated.
CREATE TABLE IF NOT EXISTS review_likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pour_id    INTEGER NOT NULL REFERENCES pours(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pour_id)
);
CREATE INDEX IF NOT EXISTS idx_rlikes_pour ON review_likes(pour_id);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pour_id    INTEGER NOT NULL REFERENCES pours(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_pour ON comments(pour_id, created_at);

-- Free-form tags on an entry: "birthday", "session", "too warm", "with dad".
-- Stored lowercase so #Session and #session are one tag; `label` keeps the
-- first spelling anyone used, for display.
CREATE TABLE IF NOT EXISTS pour_tags (
  pour_id INTEGER NOT NULL REFERENCES pours(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  label   TEXT NOT NULL,
  PRIMARY KEY (pour_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON pour_tags(tag);
