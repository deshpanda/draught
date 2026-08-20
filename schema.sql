-- Draught — D1 schema.
-- One rule: a "pour" is the unit of record. Beers and breweries are canonical
-- and shared; pours belong to people. Everything else is derived.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- uuid
  handle      TEXT UNIQUE,               -- null until claimed; lowercase [a-z0-9_]{2,20}
  name        TEXT NOT NULL DEFAULT '',
  avatar      TEXT NOT NULL DEFAULT '',
  bio         TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL,             -- 'google' (or 'dev' locally)
  provider_id TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- opaque 256-bit token, hashed
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS breweries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  country    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  obdb_id    TEXT,                       -- Open Brewery DB id when matched
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS beers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  brewery_id INTEGER NOT NULL REFERENCES breweries(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  style      TEXT NOT NULL DEFAULT '',   -- a BJCP style name, free text tolerated
  abv        REAL,
  created_by TEXT REFERENCES users(id),
  photo_key  TEXT,                        -- the shot that represents this beer
  created_at INTEGER NOT NULL,
  UNIQUE (brewery_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_beers_style ON beers(style);

CREATE TABLE IF NOT EXISTS pours (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beer_id    INTEGER NOT NULL REFERENCES beers(id) ON DELETE CASCADE,
  rating     INTEGER,                    -- 1..10 == half-stars, Letterboxd-style; null = logged, unrated
  note       TEXT NOT NULL DEFAULT '',
  serving    TEXT NOT NULL DEFAULT '',   -- draught | can | bottle | cask
  venue      TEXT NOT NULL DEFAULT '',
  drunk_on   TEXT NOT NULL,              -- YYYY-MM-DD, the drinker's local date
  photo_key  TEXT,                        -- R2 object key for the drinker's shot
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pours_user ON pours(user_id, drunk_on DESC);
CREATE INDEX IF NOT EXISTS idx_pours_beer ON pours(beer_id);
CREATE INDEX IF NOT EXISTS idx_pours_recent ON pours(created_at DESC);

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
