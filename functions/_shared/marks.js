// The two judgements a rating cannot carry.
//
// Letterboxd keeps three independent things about a film: the rating (how good),
// the heart (whether you love it), and the watchlist (whether you mean to see
// it). They are genuinely separate — a beer can be a technically excellent 4.5
// you never want again, or a scrappy 3 you order every single week.
//
// Both tables are (user_id, beer_id) with the pair as the primary key, so
// toggling is idempotent and double-taps cannot create duplicates.

import { json, bad, now } from './lib.js';

const TABLES = { like: 'likes', want: 'wishlist' };

async function beerBySlug(env, brewerySlug, beerSlug) {
  return env.DB.prepare(
    `SELECT b.id, b.name FROM beers b JOIN breweries br ON br.id = b.brewery_id
     WHERE br.slug = ? AND b.slug = ?`
  ).bind(String(brewerySlug), String(beerSlug)).first();
}

export async function toggle(env, user, kind, brewerySlug, beerSlug, on) {
  const table = TABLES[kind];
  if (!table) return bad('Unknown mark.', 404);

  const beer = await beerBySlug(env, brewerySlug, beerSlug);
  if (!beer) return bad('No such beer.', 404);

  if (on) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO ${table} (user_id, beer_id, created_at) VALUES (?, ?, ?)`
    ).bind(user.id, beer.id, now()).run();
  } else {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ? AND beer_id = ?`)
      .bind(user.id, beer.id).run();
  }

  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE beer_id = ?`)
    .bind(beer.id).first();
  return json({ kind, on, count: count?.n ?? 0 });
}

// What this viewer has marked on this beer, for rendering the buttons pressed.
export async function forViewer(env, viewerId, beerId) {
  if (!viewerId) return { liked: false, wants: false };
  const row = await env.DB.prepare(
    `SELECT EXISTS(SELECT 1 FROM likes WHERE user_id = ?1 AND beer_id = ?2) AS liked,
            EXISTS(SELECT 1 FROM wishlist WHERE user_id = ?1 AND beer_id = ?2) AS wants`
  ).bind(viewerId, beerId).first();
  return { liked: !!row?.liked, wants: !!row?.wants };
}

export async function counts(env, beerId) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM likes WHERE beer_id = ?1) AS likes,
            (SELECT COUNT(*) FROM wishlist WHERE beer_id = ?1) AS wants`
  ).bind(beerId).first();
  return { likes: row?.likes ?? 0, wants: row?.wants ?? 0 };
}

// Someone's want-to-try list, newest intent first.
export async function wishlistOf(env, handle) {
  const u = await env.DB.prepare('SELECT id, handle FROM users WHERE handle = ?')
    .bind(String(handle).toLowerCase()).first();
  if (!u) return bad('No such drinker.', 404);

  const { results } = await env.DB.prepare(
    `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
            br.name AS brewery, br.slug AS brewery_slug,
            ROUND(AVG(p.rating), 2) AS avg, COUNT(p.id) AS pours
     FROM wishlist w
     JOIN beers b ON b.id = w.beer_id
     JOIN breweries br ON br.id = b.brewery_id
     LEFT JOIN pours p ON p.beer_id = b.id
     WHERE w.user_id = ?
     GROUP BY b.id ORDER BY w.created_at DESC LIMIT 300`
  ).bind(u.id).all();

  return json({ handle: u.handle, beers: results });
}

// Beers someone has hearted.
export async function likesOf(env, handle) {
  const u = await env.DB.prepare('SELECT id, handle FROM users WHERE handle = ?')
    .bind(String(handle).toLowerCase()).first();
  if (!u) return bad('No such drinker.', 404);

  const { results } = await env.DB.prepare(
    `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
            br.name AS brewery, br.slug AS brewery_slug,
            ROUND(AVG(p.rating), 2) AS avg, COUNT(p.id) AS pours
     FROM likes l
     JOIN beers b ON b.id = l.beer_id
     JOIN breweries br ON br.id = b.brewery_id
     LEFT JOIN pours p ON p.beer_id = b.id
     WHERE l.user_id = ?
     GROUP BY b.id ORDER BY l.created_at DESC LIMIT 300`
  ).bind(u.id).all();

  return json({ handle: u.handle, beers: results });
}

// A style page — the genre page of a beer app. The 117-style canon was dead
// text everywhere until this existed.
export async function stylePage(env, styleName) {
  const name = String(styleName || '').trim();
  if (!name) return bad('No such style.', 404);

  const [beers, stats] = await Promise.all([
    env.DB.prepare(
      `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
              br.name AS brewery, br.slug AS brewery_slug,
              COUNT(p.id) AS pours, ROUND(AVG(p.rating), 2) AS avg
       FROM beers b JOIN breweries br ON br.id = b.brewery_id
       LEFT JOIN pours p ON p.beer_id = b.id
       WHERE b.style = ? COLLATE NOCASE
       GROUP BY b.id ORDER BY pours DESC, avg DESC LIMIT 200`
    ).bind(name).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT b.id) AS beers, COUNT(p.id) AS pours,
              COUNT(DISTINCT p.user_id) AS drinkers, ROUND(AVG(p.rating), 2) AS avg
       FROM beers b LEFT JOIN pours p ON p.beer_id = b.id
       WHERE b.style = ? COLLATE NOCASE`
    ).bind(name).first(),
  ]);

  return json({ style: name, stats, beers: beers.results });
}
