// Following, and the feed it makes possible.
//
// /recent is the whole bar; /feed is your table. The feed is the retention loop
// — a shelf you only ever see your own pours on has no reason to be revisited.

import { json, bad, now } from './lib.js';

const FEED_SQL = `
  SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.photo_key,
         b.name AS beer, b.slug AS beer_slug, b.style, b.abv,
         br.name AS brewery, br.slug AS brewery_slug,
         u.handle, u.name AS drinker, u.avatar
  FROM pours p
  JOIN beers b ON b.id = p.beer_id
  JOIN breweries br ON br.id = b.brewery_id
  JOIN users u ON u.id = p.user_id
  WHERE p.user_id = ?1
     OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?1)
  ORDER BY p.drunk_on DESC, p.id DESC
  LIMIT 60`;

export async function follow(env, viewer, handle, wantFollow) {
  const target = await env.DB.prepare('SELECT id, handle FROM users WHERE handle = ?')
    .bind(String(handle).toLowerCase()).first();
  if (!target) return bad('No such drinker.', 404);
  if (target.id === viewer.id) return bad('You already know what you drink.', 400);

  if (wantFollow) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)'
    ).bind(viewer.id, target.id, now()).run();
  } else {
    await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .bind(viewer.id, target.id).run();
  }
  const counts = await followCounts(env, target.id);
  // `counts.following` is how many people *they* follow — don't let it collide
  // with the boolean for whether the viewer now follows them.
  return json({ handle: target.handle, viewerFollows: wantFollow, ...counts });
}

export async function followCounts(env, userId) {
  const row = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?1) AS followers,
            (SELECT COUNT(*) FROM follows WHERE follower_id = ?1) AS following`
  ).bind(userId).first();
  return { followers: row?.followers ?? 0, following: row?.following ?? 0 };
}

export async function viewerFollows(env, viewerId, targetId) {
  if (!viewerId || viewerId === targetId) return false;
  const row = await env.DB.prepare(
    'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?'
  ).bind(viewerId, targetId).first();
  return !!row;
}

export async function feed(env, viewer) {
  const { results } = await env.DB.prepare(FEED_SQL).bind(viewer.id).all();
  const { following } = await followCounts(env, viewer.id);
  return json({ pours: results, following });
}

// dir=following -> people they follow; dir=followers -> people who follow them
export async function people(env, handle, dir) {
  const target = await env.DB.prepare('SELECT id FROM users WHERE handle = ?')
    .bind(String(handle).toLowerCase()).first();
  if (!target) return bad('No such drinker.', 404);

  const followers = dir === 'followers';
  const sql = followers
    ? `SELECT u.handle, u.name, u.avatar FROM follows f JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = ? AND u.handle IS NOT NULL ORDER BY f.created_at DESC LIMIT 200`
    : `SELECT u.handle, u.name, u.avatar FROM follows f JOIN users u ON u.id = f.followee_id
       WHERE f.follower_id = ? AND u.handle IS NOT NULL ORDER BY f.created_at DESC LIMIT 200`;

  const { results } = await env.DB.prepare(sql).bind(target.id).all();
  return json({ dir: followers ? 'followers' : 'following', people: results });
}
