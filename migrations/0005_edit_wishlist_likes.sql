-- 0005 — editing an entry, plus the two Letterboxd verbs Draught was missing.
--
-- Letterboxd separates three independent judgements about a film: a *rating*
-- (how good), a *like* (the heart — whether you love it, regardless of score),
-- and the *watchlist* (intent to see it). Draught only had the rating. A beer
-- can be a technically-excellent 4.5 you never want again, or a scrappy 3 you
-- order every week, and one number cannot carry both.

-- "Rewatch", for beer.
ALTER TABLE pours ADD COLUMN again INTEGER NOT NULL DEFAULT 0;
-- When the entry was last edited; NULL means never touched since logging.
ALTER TABLE pours ADD COLUMN edited_at INTEGER;

-- Want to try. The watchlist.
CREATE TABLE IF NOT EXISTS wishlist (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beer_id    INTEGER NOT NULL REFERENCES beers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, beer_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_beer ON wishlist(beer_id);

-- The heart. Independent of the score, exactly as on Letterboxd.
CREATE TABLE IF NOT EXISTS likes (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  beer_id    INTEGER NOT NULL REFERENCES beers(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, beer_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_beer ON likes(beer_id);
