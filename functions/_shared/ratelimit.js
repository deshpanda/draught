// Fixed-window rate limiting on D1.
//
// Not because Draught expects an attack, but because every write here mints
// *shared* state: a typo'd brewery becomes a page everyone else sees, and an
// upload costs storage. A human logging beer never comes near these ceilings;
// a script hits them immediately.
//
// One UPSERT with RETURNING does the whole thing atomically — read-then-write
// would race with itself under concurrency and let bursts through.

import { now } from './lib.js';

export const LIMITS = {
  pour:        { max: 40,  window: 3600, what: 'pours' },
  newBeer:     { max: 25,  window: 3600, what: 'new beers or breweries' },
  upload:      { max: 30,  window: 3600, what: 'photo uploads' },
  listCreate:  { max: 15,  window: 3600, what: 'new lists' },
  listItem:    { max: 120, window: 3600, what: 'list changes' },
  followAct:   { max: 100, window: 3600, what: 'follows' },
  handleClaim: { max: 10,  window: 3600, what: 'handle attempts' },
  brewerySearch: { max: 300, window: 3600, what: 'brewery searches' },
  placeSearch:   { max: 300, window: 3600, what: 'place searches' },
};

const UPSERT = `
  INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
  ON CONFLICT(bucket) DO UPDATE SET
    window_start = CASE WHEN ?2 - rate_limits.window_start >= ?3 THEN ?2 ELSE rate_limits.window_start END,
    count        = CASE WHEN ?2 - rate_limits.window_start >= ?3 THEN 1 ELSE rate_limits.count + 1 END
  RETURNING count, window_start`;

// Returns { ok } or { ok: false, retryAfter, what }.
export async function check(env, action, actor) {
  const spec = LIMITS[action];
  if (!spec) return { ok: true };
  const bucket = `${action}:${actor || 'anon'}`;
  const t = now();

  let row;
  try {
    row = await env.DB.prepare(UPSERT).bind(bucket, t, spec.window).first();
  } catch {
    // A limiter that breaks must not take the feature with it.
    return { ok: true };
  }
  if (!row || row.count <= spec.max) return { ok: true };

  return {
    ok: false,
    what: spec.what,
    retryAfter: Math.max(1, spec.window - (t - row.window_start)),
  };
}

// Prefer the signed-in user; fall back to Cloudflare's client IP so anonymous
// endpoints are still bounded.
export const actorOf = (request, user) =>
  user?.id || request.headers.get('cf-connecting-ip') || 'unknown';

export function tooMany({ what, retryAfter }) {
  const mins = Math.ceil(retryAfter / 60);
  return new Response(
    JSON.stringify({
      error: `Slow down — that's a lot of ${what} in one go. Try again in ${
        mins <= 1 ? 'a minute' : `${mins} minutes`
      }.`,
    }),
    {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(retryAfter),
      },
    }
  );
}

// Convenience: check and return the 429 in one line at the call site.
export async function guard(env, action, actor) {
  const verdict = await check(env, action, actor);
  return verdict.ok ? null : tooMany(verdict);
}
