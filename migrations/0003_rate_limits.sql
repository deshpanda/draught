-- 0003 — rate limiting.
-- Fixed-window counters. One row per (action, actor) bucket, rewritten in place,
-- so this table stays roughly as large as the number of active actors.

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
