-- Draught — D1 schema.
-- One rule: a "pour" is the unit of record. Beers and breweries are canonical
-- and shared; pours belong to people. Everything else is derived.

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- uuid
  handle      TEXT UNIQUE,               -- null until claimed; lowercase [a-z0-9_]{2,20}
  name        TEXT NOT NULL DEFAULT '',
  avatar      TEXT NOT NULL DEFAULT '',
  bio         TEXT NOT NULL DEFAULT '',
  provider    TEXT NOT NULL,             -- 'google' | 'github'
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
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pours_user ON pours(user_id, drunk_on DESC);
CREATE INDEX IF NOT EXISTS idx_pours_beer ON pours(beer_id);
CREATE INDEX IF NOT EXISTS idx_pours_recent ON pours(created_at DESC);
