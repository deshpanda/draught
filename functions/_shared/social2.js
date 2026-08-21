// Favourites, the social layer on reviews, and tags.
//
// Three things Letterboxd has that a diary needs to stop being a spreadsheet:
// four pinned favourites that say who you are at a glance, likes and comments on
// what people *wrote* (not just on the beer), and free-form tags so an entry can
// carry the context the schema never anticipated — "with dad", "too warm",
// "birthday", "session".

import { json, bad, now, clean } from './lib.js';

export const MAX_FAVOURITES = 4;

// ---- favourites ------------------------------------------------------------

async function beerBySlug(env, brewerySlug, beerSlug) {
  return env.DB.prepare(
    `SELECT b.id, b.name FROM beers b JOIN breweries br ON br.id = b.brewery_id
     WHERE br.slug = ? AND b.slug = ?`
  ).bind(String(brewerySlug), String(beerSlug)).first();
}

export async function favourite(env, user, brewerySlug, beerSlug, on) {
  const beer = await beerBySlug(env, brewerySlug, beerSlug);
  if (!beer) return bad('No such beer.', 404);

  if (!on) {
    await env.DB.prepare('DELETE FROM favourites WHERE user_id = ? AND beer_id = ?')
      .bind(user.id, beer.id).run();
    return json({ on: false, ...(await favouritesOf(env, user.id)) });
  }

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM favourites WHERE user_id = ?')
    .bind(user.id).first();
  const already = await env.DB.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND beer_id = ?')
    .bind(user.id, beer.id).first();
  if (!already && (count?.n ?? 0) >= MAX_FAVOURITES) {
    return bad(`Favourites hold ${MAX_FAVOURITES} beers — drop one first.`, 409);
  }

  const next = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM favourites WHERE user_id = ?')
    .bind(user.id).first();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO favourites (user_id, beer_id, position) VALUES (?, ?, ?)'
  ).bind(user.id, beer.id, next?.p ?? 1).run();

  return json({ on: true, ...(await favouritesOf(env, user.id)) });
}

export async function favouritesOf(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
            br.name AS brewery, br.slug AS brewery_slug, f.position
     FROM favourites f
     JOIN beers b ON b.id = f.beer_id
     JOIN breweries br ON br.id = b.brewery_id
     WHERE f.user_id = ? ORDER BY f.position LIMIT ?`
  ).bind(userId, MAX_FAVOURITES).all();
  return { favourites: results };
}

// ---- likes and comments on a review ---------------------------------------

export async function likeReview(env, user, pourId, on) {
  const pour = await env.DB.prepare('SELECT id FROM pours WHERE id = ?').bind(Number(pourId) || 0).first();
  if (!pour) return bad('No such entry.', 404);

  if (on) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO review_likes (user_id, pour_id, created_at) VALUES (?, ?, ?)'
    ).bind(user.id, pour.id, now()).run();
  } else {
    await env.DB.prepare('DELETE FROM review_likes WHERE user_id = ? AND pour_id = ?')
      .bind(user.id, pour.id).run();
  }
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_likes WHERE pour_id = ?')
    .bind(pour.id).first();
  return json({ on, likes: c?.n ?? 0 });
}

export async function comments(env, pourId) {
  const { results } = await env.DB.prepare(
    `SELECT c.id, c.body, c.created_at, u.handle, u.name, u.avatar
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.pour_id = ? AND u.handle IS NOT NULL
     ORDER BY c.created_at LIMIT 200`
  ).bind(Number(pourId) || 0).all();
  return json({ comments: results });
}

export async function addComment(env, user, pourId, body) {
  const text = clean(body.body, 1000);
  if (!text) return bad('Say something.');
  const pour = await env.DB.prepare('SELECT id FROM pours WHERE id = ?').bind(Number(pourId) || 0).first();
  if (!pour) return bad('No such entry.', 404);

  const res = await env.DB.prepare(
    'INSERT INTO comments (pour_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
  ).bind(pour.id, user.id, text, now()).run();

  return json({
    id: res.meta.last_row_id, body: text,
    handle: user.handle, name: user.name, avatar: user.avatar,
    created_at: now(),
  }, 201);
}

// Your own comment, or nothing. There is no moderator role yet, so this is the
// only delete path — say so rather than pretending otherwise.
export async function deleteComment(env, user, id) {
  const res = await env.DB.prepare('DELETE FROM comments WHERE id = ? AND user_id = ?')
    .bind(Number(id) || 0, user.id).run();
  if (!res.meta.changes) return bad('Not your comment.', 404);
  return json({ ok: true });
}

// ---- tags ------------------------------------------------------------------

// "  With Dad , session,, TOO WARM " -> [{tag:'with dad',label:'With Dad'}, …]
export function parseTags(input) {
  const seen = new Set();
  return String(input || '')
    .split(',')
    .map((t) => clean(t, 30))
    .filter(Boolean)
    .map((label) => ({ tag: label.toLowerCase(), label }))
    .filter(({ tag }) => {
      if (seen.has(tag)) return false;
      seen.add(tag);
      return true;
    })
    .slice(0, 8);
}

export async function setTags(env, pourId, input) {
  const tags = parseTags(input);
  await env.DB.prepare('DELETE FROM pour_tags WHERE pour_id = ?').bind(pourId).run();
  if (!tags.length) return;
  await env.DB.batch(tags.map(({ tag, label }) =>
    env.DB.prepare('INSERT OR IGNORE INTO pour_tags (pour_id, tag, label) VALUES (?, ?, ?)')
      .bind(pourId, tag, label)));
}

// Tags for a set of entries, in one query rather than N.
export async function tagsFor(env, pourIds) {
  if (!pourIds.length) return {};
  const marks = pourIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT pour_id, tag, label FROM pour_tags WHERE pour_id IN (${marks})`
  ).bind(...pourIds).all();
  const out = {};
  for (const r of results) (out[r.pour_id] ||= []).push({ tag: r.tag, label: r.label });
  return out;
}

// Everything anyone tagged with this, plus who uses it most.
export async function tagPage(env, rawTag) {
  const tag = clean(rawTag, 30).toLowerCase();
  if (!tag) return bad('No such tag.', 404);

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.photo_key, p.again,
            b.name AS beer, b.slug AS beer_slug, b.style, b.abv,
            br.name AS brewery, br.slug AS brewery_slug,
            u.handle, u.name AS drinker, u.avatar
     FROM pour_tags t
     JOIN pours p ON p.id = t.pour_id
     JOIN beers b ON b.id = p.beer_id
     JOIN breweries br ON br.id = b.brewery_id
     JOIN users u ON u.id = p.user_id
     WHERE t.tag = ? AND u.handle IS NOT NULL
     ORDER BY p.drunk_on DESC, p.id DESC LIMIT 100`
  ).bind(tag).all();

  const label = await env.DB.prepare('SELECT label FROM pour_tags WHERE tag = ? LIMIT 1').bind(tag).first();
  return json({ tag, label: label?.label || tag, pours: results });
}

// The tags someone uses most — a small portrait of how they drink.
export async function topTags(env, userId, limit = 12) {
  const { results } = await env.DB.prepare(
    `SELECT t.tag, t.label, COUNT(*) AS n
     FROM pour_tags t JOIN pours p ON p.id = t.pour_id
     WHERE p.user_id = ? GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT ?`
  ).bind(userId, limit).all();
  return results;
}
