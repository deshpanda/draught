// Venues, and the map they feed.
//
// The privacy line here is deliberate. Publishing "who drank where" is the
// feature; publishing *someone's home address* is not, and "where I drink most"
// is very often home. So:
//
//   1. Coordinates are rounded to ~11m before storage — enough to place a bar,
//      not a flat within a building.
//   2. Venues whose names read as somewhere private ("home", "my flat") never
//      get coordinates at all, however they were captured.
//   3. Any pour can be marked geo_private: it keeps its venue for the drinker
//      and is excluded from every public map query.

import { json, bad, now, slugify, clean } from './lib.js';

const DP = 4;
const round = (n) => Math.round(Number(n) * 10 ** DP) / 10 ** DP;

// Latitude is clamped to the map's own range (Antarctica is clipped off it).
const validLat = (n) => Number.isFinite(+n) && +n <= 85.04 && +n >= -60;
const validLon = (n) => Number.isFinite(+n) && +n >= -180 && +n <= 180;

// Names that mean "not a public place". Matched on the whole name, so a real
// bar called "The Homestead" is unaffected.
const PRIVATE_NAME = /^(home|house|my (home|house|place|flat|room|apartment|apt|garden|balcony|sofa|couch|kitchen|desk)|flat|apartment|apt|hostel|dorm|dormitory|airbnb|hotel room|bed|in bed|the sofa|the couch|work|office|desk)$/i;

export const looksPrivate = (name) => PRIVATE_NAME.test(String(name || '').trim());

// Resolve a venue by name, creating it the first time anyone drinks there.
// Returns { id } or null when no venue was named.
export async function resolve(env, user, body) {
  const name = clean(body.venueName ?? body.venue, 80);
  if (!name) return null;

  const slug = slugify(name);
  if (!slug) return null;

  const priv = looksPrivate(name);
  let lat = !priv && validLat(body.lat) ? round(body.lat) : null;
  let lon = !priv && validLon(body.lon) ? round(body.lon) : null;
  if (lat === null || lon === null) { lat = null; lon = null; }

  const existing = await env.DB.prepare('SELECT * FROM venues WHERE slug = ?').bind(slug).first();
  if (existing) {
    // First person to pin it fills the coordinates in for everyone; nobody
    // overwrites a pin that already exists.
    if (lat !== null && existing.lat === null) {
      await env.DB.prepare('UPDATE venues SET lat = ?, lon = ? WHERE id = ? AND lat IS NULL')
        .bind(lat, lon, existing.id).run();
    }
    return { id: existing.id };
  }

  const res = await env.DB.prepare(
    `INSERT INTO venues (slug, name, lat, lon, city, country, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    slug, name, lat, lon,
    // Deliberately NOT body.city/body.country — those describe the brewery.
    // Conflating them would label a Belgian bar as an Indian brewery's city.
    clean(body.venueCity, 60), clean(body.venueCountry, 60), user.id, now()
  ).run();
  return { id: res.meta.last_row_id };
}

export async function search(env, rawQuery) {
  const q = clean(rawQuery, 60);
  if (q.length < 2) return json({ results: [] });
  const { results } = await env.DB.prepare(
    `SELECT v.name, v.slug, v.city, v.country, v.lat, v.lon, COUNT(p.id) AS pours
     FROM venues v LEFT JOIN pours p ON p.venue_id = v.id
     WHERE v.name LIKE ? GROUP BY v.id ORDER BY pours DESC LIMIT 10`
  ).bind(`%${q}%`).all();
  return json({ results });
}

// scope: 'all' | 'following' | a handle. Only ever returns pinned, non-private
// pours from drinkers who have claimed a handle.
export async function map(env, viewer, scope) {
  let where = '';
  const binds = [];

  if (scope === 'following') {
    if (!viewer) return bad('Sign in to see your people on the map.', 401);
    where = `AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))`;
    binds.push(viewer.id, viewer.id);
  } else if (scope && scope !== 'all') {
    const u = await env.DB.prepare('SELECT id FROM users WHERE handle = ?')
      .bind(String(scope).toLowerCase()).first();
    if (!u) return bad('No such drinker.', 404);
    where = 'AND p.user_id = ?';
    binds.push(u.id);
  }

  const { results: venues } = await env.DB.prepare(
    `SELECT v.slug, v.name, v.city, v.country, v.lat, v.lon,
            COUNT(p.id) AS pours,
            COUNT(DISTINCT p.user_id) AS drinkers,
            ROUND(AVG(p.rating), 2) AS avg,
            GROUP_CONCAT(DISTINCT u.handle) AS handles
     FROM venues v
     JOIN pours p ON p.venue_id = v.id
     JOIN users u ON u.id = p.user_id
     WHERE v.lat IS NOT NULL AND p.geo_private = 0 AND u.handle IS NOT NULL ${where}
     GROUP BY v.id ORDER BY pours DESC LIMIT 500`
  ).bind(...binds).all();

  // Country tallies come from the brewery, not the venue — "where the beer is
  // from" is a different and more interesting question than "where I drank it",
  // and it works even for pours with no venue at all.
  const { results: origins } = await env.DB.prepare(
    `SELECT br.country, COUNT(p.id) AS pours
     FROM pours p JOIN beers b ON b.id = p.beer_id JOIN breweries br ON br.id = b.brewery_id
     JOIN users u ON u.id = p.user_id
     WHERE br.country != '' AND u.handle IS NOT NULL ${where}
     GROUP BY br.country ORDER BY pours DESC`
  ).bind(...binds).all();

  return json({
    venues: venues.map((v) => ({ ...v, handles: v.handles ? v.handles.split(',') : [] })),
    origins,
  });
}
