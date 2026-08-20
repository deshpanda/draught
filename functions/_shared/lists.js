// Lists — "Top 10 stouts of 2026". The feature that turns a log into a library.
//
// A list belongs to one person, holds canonical beers (never their pours), and
// is either ranked (positions shown) or just a collection.

import { json, bad, now, slugify, clean } from './lib.js';

const MAX_ITEMS = 250;

export async function create(env, user, body) {
  const title = clean(body.title, 80);
  if (!title) return bad('Give the list a title.');
  const base = slugify(title);
  if (!base) return bad('That title needs at least one letter or number.');

  // Same title twice shouldn't 409 — quietly take the next free slug.
  let slug = base;
  for (let n = 2; n <= 50; n++) {
    const taken = await env.DB.prepare('SELECT 1 FROM lists WHERE user_id = ? AND slug = ?')
      .bind(user.id, slug).first();
    if (!taken) break;
    slug = `${base}-${n}`;
  }

  const t = now();
  const res = await env.DB.prepare(
    `INSERT INTO lists (user_id, slug, title, description, ranked, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, slug, title, clean(body.description, 1000), body.ranked ? 1 : 0, t, t).run();

  return json({ id: res.meta.last_row_id, slug, title, ranked: !!body.ranked }, 201);
}

export async function update(env, user, id, body) {
  const list = await owned(env, user, id);
  if (!list.ok) return list.err;
  await env.DB.prepare('UPDATE lists SET title = ?, description = ?, ranked = ?, updated_at = ? WHERE id = ?')
    .bind(
      clean(body.title, 80) || list.row.title,
      clean(body.description, 1000),
      body.ranked ? 1 : 0,
      now(), list.row.id
    ).run();
  return json({ ok: true });
}

export async function destroy(env, user, id) {
  const list = await owned(env, user, id);
  if (!list.ok) return list.err;
  // list_items cascades, but delete it explicitly so the intent is on the page.
  await env.DB.prepare('DELETE FROM list_items WHERE list_id = ?').bind(list.row.id).run();
  await env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(list.row.id).run();
  return json({ ok: true });
}

export async function addItem(env, user, id, body) {
  const list = await owned(env, user, id);
  if (!list.ok) return list.err;

  const beer = await env.DB.prepare(
    `SELECT b.id FROM beers b JOIN breweries br ON br.id = b.brewery_id
     WHERE br.slug = ? AND b.slug = ?`
  ).bind(String(body.brewerySlug || ''), String(body.beerSlug || '')).first();
  if (!beer) return bad('No such beer — log it first.', 404);

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?')
    .bind(list.row.id).first();
  if ((count?.n ?? 0) >= MAX_ITEMS) return bad(`Lists hold ${MAX_ITEMS} beers.`, 409);

  const next = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM list_items WHERE list_id = ?')
    .bind(list.row.id).first();

  const res = await env.DB.prepare(
    'INSERT OR IGNORE INTO list_items (list_id, beer_id, position, note) VALUES (?, ?, ?, ?)'
  ).bind(list.row.id, beer.id, next?.p ?? 1, clean(body.note, 500)).run();

  if (!res.meta.changes) return bad('That beer is already on the list.', 409);
  await touch(env, list.row.id);
  return json({ ok: true, position: next?.p ?? 1 }, 201);
}

export async function removeItem(env, user, id, beerId) {
  const list = await owned(env, user, id);
  if (!list.ok) return list.err;
  const res = await env.DB.prepare('DELETE FROM list_items WHERE list_id = ? AND beer_id = ?')
    .bind(list.row.id, Number(beerId) || 0).run();
  if (!res.meta.changes) return bad('Not on this list.', 404);
  await touch(env, list.row.id);
  return json({ ok: true });
}

// Reorder by handing back the full beer-id order, which is how a drag-and-drop
// UI thinks. Anything omitted keeps its relative place at the end.
export async function reorder(env, user, id, order) {
  const list = await owned(env, user, id);
  if (!list.ok) return list.err;
  if (!Array.isArray(order)) return bad('Send an array of beer ids.');

  const stmts = order.slice(0, MAX_ITEMS).map((beerId, i) =>
    env.DB.prepare('UPDATE list_items SET position = ? WHERE list_id = ? AND beer_id = ?')
      .bind(i + 1, list.row.id, Number(beerId) || 0)
  );
  if (stmts.length) await env.DB.batch(stmts);
  await touch(env, list.row.id);
  return json({ ok: true });
}

export async function ofUser(env, handle) {
  const u = await env.DB.prepare('SELECT id, handle FROM users WHERE handle = ?')
    .bind(String(handle).toLowerCase()).first();
  if (!u) return bad('No such drinker.', 404);

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.slug, l.title, l.description, l.ranked, l.updated_at,
            COUNT(li.beer_id) AS items,
            (SELECT b.photo_key FROM list_items x JOIN beers b ON b.id = x.beer_id
             WHERE x.list_id = l.id AND b.photo_key IS NOT NULL
             ORDER BY x.position LIMIT 1) AS cover
     FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
     WHERE l.user_id = ?
     GROUP BY l.id ORDER BY l.updated_at DESC LIMIT 100`
  ).bind(u.id).all();

  return json({ handle: u.handle, lists: results });
}

export async function one(env, handle, slug) {
  const row = await env.DB.prepare(
    `SELECT l.*, u.handle, u.name AS owner_name, u.avatar
     FROM lists l JOIN users u ON u.id = l.user_id
     WHERE u.handle = ? AND l.slug = ?`
  ).bind(String(handle).toLowerCase(), String(slug)).first();
  if (!row) return bad('No such list.', 404);

  const { results: items } = await env.DB.prepare(
    `SELECT li.position, li.note, b.id AS beer_id, b.name AS beer, b.slug AS beer_slug,
            b.style, b.abv, b.photo_key,
            br.name AS brewery, br.slug AS brewery_slug,
            ROUND(AVG(p.rating), 2) AS avg, COUNT(p.id) AS pours
     FROM list_items li
     JOIN beers b ON b.id = li.beer_id
     JOIN breweries br ON br.id = b.brewery_id
     LEFT JOIN pours p ON p.beer_id = b.id
     WHERE li.list_id = ?
     GROUP BY li.beer_id ORDER BY li.position`
  ).bind(row.id).all();

  return json({
    list: {
      id: row.id, slug: row.slug, title: row.title, description: row.description,
      ranked: !!row.ranked, updatedAt: row.updated_at,
      owner: { handle: row.handle, name: row.owner_name, avatar: row.avatar },
    },
    items,
  });
}

// Discovery: the most recently touched non-empty lists across everyone.
export async function recent(env) {
  const { results } = await env.DB.prepare(
    `SELECT l.slug, l.title, l.ranked, l.updated_at, u.handle, u.name AS owner_name,
            COUNT(li.beer_id) AS items
     FROM lists l JOIN users u ON u.id = l.user_id
     JOIN list_items li ON li.list_id = l.id
     WHERE u.handle IS NOT NULL
     GROUP BY l.id ORDER BY l.updated_at DESC LIMIT 40`
  ).all();
  return json({ lists: results });
}

async function owned(env, user, id) {
  const row = await env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(Number(id) || 0).first();
  if (!row) return { ok: false, err: bad('No such list.', 404) };
  if (row.user_id !== user.id) return { ok: false, err: bad('That is not your list.', 403) };
  return { ok: true, row };
}

const touch = (env, id) =>
  env.DB.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(now(), id).run();
