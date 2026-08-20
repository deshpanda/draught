-- 0004 — venues and the map.
--
-- A venue is a *place*, canonical and shared like a brewery, so two people
-- drinking at the same bar land on the same dot. Coordinates are optional and
-- deliberately coarse (4 dp, ~11m).
--
-- No foreign key on created_by: `beers.created_by` has one with no ON DELETE
-- action, which blocked account deletion outright until it was nulled first.
-- Not repeating that.

CREATE TABLE IF NOT EXISTS venues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  lat        REAL,
  lon        REAL,
  city       TEXT NOT NULL DEFAULT '',
  country    TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venues_geo ON venues(lat, lon);

ALTER TABLE pours ADD COLUMN venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL;
-- 1 = logged for the drinker's own eyes; never appears on a public map.
ALTER TABLE pours ADD COLUMN geo_private INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_pours_venue ON pours(venue_id);
