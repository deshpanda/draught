// Draught — the whole API. One catch-all, a switch, no framework.
//
//   GET    /api/me
//   POST   /api/logout
//   POST   /api/handle              { handle }
//   PATCH  /api/profile             { name, bio }
//   GET    /api/auth/:provider      -> redirect to provider
//   GET    /api/auth/:provider/callback
//   GET    /api/search?q=              beers + breweries + people, one box
//   GET    /api/breweries/:slug       a brewery and everything logged from it
//   GET    /api/search/breweries?q=
//   GET    /api/search/beers?q=
//   POST   /api/pours               { brewery, beer, style, abv, rating, note, serving, venue, drunkOn }
//   PATCH  /api/pours/:id            edit rating/note/date/serving/venue/again
//   DELETE /api/pours/:id
//   POST   /api/mark/:kind/:brewery/:beer   kind = like | want; DELETE to undo
//   GET    /api/users/:handle/wishlist  and .../likes
//   GET    /api/styles/:name           the genre page of a beer app
//   POST   /api/fav/:brewery/:beer     four pinned beers; DELETE to unpin
//   POST   /api/pours/:id/like         like a review; DELETE to unlike
//   GET    /api/pours/:id/comments     POST to add
//   DELETE /api/comments/:id           your own only
//   GET    /api/tags/:tag              everything tagged with it
//   GET    /api/stats                  public aggregate counts
//   GET    /api/badge?metric=…         the same, as a shields.io endpoint
//   GET    /api/users/:handle
//   GET    /api/beers/:brewery/:beer
//   GET    /api/recent
//   GET    /api/feed                 people you follow, plus yourself
//   POST   /api/follow/:handle       DELETE to unfollow
//   GET    /api/users/:handle/people?dir=following|followers
//   POST   /api/upload               raw image bytes -> { key }
//   GET    /api/img/:key             immutable, year-long cache
//   GET    /api/tiles/:archive       PMTiles basemap from our own R2, Range-aware
//   GET    /api/lists                recent lists across everyone
//   POST   /api/lists                { title, description, ranked }
//   PATCH  /api/lists/:id            DELETE to remove
//   POST   /api/lists/:id/items      { brewerySlug, beerSlug, note }
//   DELETE /api/lists/:id/items/:beerId
//   PUT    /api/lists/:id/order      { order: [beerId, ...] }
//   GET    /api/users/:handle/lists  and .../lists/:slug
//   DELETE /api/account              erases everything, including R2 objects
//   GET    /api/venues/search?q=       places already logged here
//   GET    /api/places?q=&lat=&lon=  search the world (proxied OSM geocoder)
//   GET    /api/map?scope=all|following|<handle>
//
// Every write is rate limited (see _shared/ratelimit.js) — each one mints state
// other people see, so a script must not be able to flood it.

import {
  json, bad, now, slugify, clean, isDate, HANDLE_RE, RESERVED,
  cookies, setCookie, clearCookie, randToken, timingSafeEqual,
  createSession, currentUser, destroySession, publicUser, OAUTH_COOKIE,
} from '../_shared/lib.js';
import { upload, serve as servePhoto, discard, photoKeyOk } from '../_shared/photos.js';
import { follow, followCounts, viewerFollows, feed, people } from '../_shared/social.js';
import * as lists from '../_shared/lists.js';
import { guard, actorOf } from '../_shared/ratelimit.js';
import * as venues from '../_shared/venues.js';
import * as places from '../_shared/places.js';
import * as tiles from '../_shared/tiles.js';
import * as marks from '../_shared/marks.js';
import * as s2 from '../_shared/social2.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const route = Array.isArray(params.route) ? params.route : [params.route].filter(Boolean);
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const method = request.method;

  try {
    // ---- auth ------------------------------------------------------------
    if (route[0] === 'auth') return authRoutes(route.slice(1), context, url, secure);

    if (route[0] === 'me' && method === 'GET') {
      const u = await currentUser(request, env);
      if (!u) return json({ user: null });
      const [stats, counts] = await Promise.all([userStats(env, u.id), followCounts(env, u.id)]);
      return json({
        user: { ...publicUser(u), id: u.id, needsHandle: !u.handle },
        stats: { ...stats, ...counts },
      });
    }

    if (route[0] === 'logout' && method === 'POST') {
      await destroySession(request, env);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie('dr_sess', secure) });
    }

    if (route[0] === 'handle' && method === 'POST') {
      const u = await requireUser(request, env);
      const capped = await guard(env, 'handleClaim', u.id);
      if (capped) return capped;
      const { handle } = await request.json().catch(() => ({}));
      const h = String(handle || '').toLowerCase().trim();
      if (!HANDLE_RE.test(h)) return bad('Handles are 2–20 characters: letters, numbers, underscore.');
      if (RESERVED.has(h)) return bad('That handle is reserved.');
      const taken = await env.DB.prepare('SELECT 1 FROM users WHERE handle = ? AND id != ?').bind(h, u.id).first();
      if (taken) return bad('That handle is taken.', 409);
      await env.DB.prepare('UPDATE users SET handle = ? WHERE id = ?').bind(h, u.id).run();
      return json({ handle: h });
    }

    if (route[0] === 'profile' && method === 'PATCH') {
      const u = await requireUser(request, env);
      const body = await request.json().catch(() => ({}));
      await env.DB.prepare('UPDATE users SET name = ?, bio = ? WHERE id = ?')
        .bind(clean(body.name, 60) || u.name, clean(body.bio, 240), u.id).run();
      return json({ ok: true });
    }

    // ---- search ----------------------------------------------------------
    if (route[0] === 'search' && route[1] === 'breweries' && method === 'GET') {
      // Bounded by IP because it proxies Open Brewery DB — being a good guest
      // on someone else's free API is our problem, not theirs.
      const capped = await guard(env, 'brewerySearch', actorOf(request, null));
      if (capped) return capped;
      return json({ results: await searchBreweries(env, url.searchParams.get('q') || '') });
    }

    if (route[0] === 'places' && method === 'GET') {
      // Proxied, so the geocoder never sees a viewer's IP. Bounded because its
      // public instance is a free service run by someone else.
      const capped = await guard(env, 'placeSearch', actorOf(request, null));
      if (capped) return capped;
      return places.search(env, url);
    }

    if (route[0] === 'search' && !route[1] && method === 'GET') {
      const capped = await guard(env, 'brewerySearch', actorOf(request, null));
      if (capped) return capped;
      return search(env, url.searchParams.get('q') || '');
    }

    if (route[0] === 'breweries' && route[1] && method === 'GET') {
      return breweryPage(env, route[1]);
    }

    if (route[0] === 'venues' && route[1] === 'search' && method === 'GET') {
      return venues.search(env, url.searchParams.get('q') || '');
    }

    if (route[0] === 'map' && method === 'GET') {
      return venues.map(env, await currentUser(request, env), url.searchParams.get('scope') || 'all');
    }

    if (route[0] === 'search' && route[1] === 'beers' && method === 'GET') {
      const q = clean(url.searchParams.get('q'), 60);
      if (q.length < 2) return json({ results: [] });
      const { results } = await env.DB.prepare(
        `SELECT b.name, b.slug, b.style, b.abv, br.name AS brewery, br.slug AS brewery_slug,
                COUNT(p.id) AS pours, ROUND(AVG(p.rating), 2) AS avg
         FROM beers b JOIN breweries br ON br.id = b.brewery_id
         LEFT JOIN pours p ON p.beer_id = b.id
         WHERE b.name LIKE ? OR br.name LIKE ?
         GROUP BY b.id ORDER BY pours DESC LIMIT 12`
      ).bind(`%${q}%`, `%${q}%`).all();
      return json({ results });
    }

    // ---- pours -----------------------------------------------------------
    // `!route[1]` matters: without it this swallows /pours/:id/like and
    // /pours/:id/comments and tries to log a beer from their bodies.
    if (route[0] === 'pours' && !route[1] && method === 'POST') {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a username first.', 409);
      const capped = await guard(env, 'pour', u.id);
      if (capped) return capped;
      return logPour(env, u, await request.json().catch(() => ({})));
    }

    if (route[0] === 'pours' && route[1] && method === 'PATCH') {
      const u = await requireUser(request, env);
      return editPour(env, u, route[1], await request.json().catch(() => ({})));
    }

    if (route[0] === 'pours' && route[1] && method === 'DELETE') {
      const u = await requireUser(request, env);
      return deletePour(env, u, route[1]);
    }

    // ---- photos ----------------------------------------------------------
    if (route[0] === 'upload' && method === 'POST') {
      const u = await requireUser(request, env);
      const capped = await guard(env, 'upload', u.id);
      if (capped) return capped;
      return upload(request, env);
    }
    if (route[0] === 'img' && route[1] && method === 'GET') return servePhoto(route[1], env);

    // The basemap archive. Range requests are the whole point — see tiles.js.
    if (route[0] === 'tiles' && route[1] && (method === 'GET' || method === 'HEAD')) {
      return tiles.serve(route[1], request, env);
    }

    // ---- following -------------------------------------------------------
    if (route[0] === 'follow' && route[1] && (method === 'POST' || method === 'DELETE')) {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a handle first.', 409);
      const capped = await guard(env, 'followAct', u.id);
      if (capped) return capped;
      return follow(env, u, route[1], method === 'POST');
    }

    if (route[0] === 'mark' && route[1] && route[2] && route[3]
        && (method === 'POST' || method === 'DELETE')) {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a username first.', 409);
      const capped = await guard(env, 'followAct', u.id);
      if (capped) return capped;
      return marks.toggle(env, u, route[1], route[2], route[3], method === 'POST');
    }

    if (route[0] === 'fav' && route[1] && route[2] && (method === 'POST' || method === 'DELETE')) {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a username first.', 409);
      return s2.favourite(env, u, route[1], route[2], method === 'POST');
    }

    if (route[0] === 'pours' && route[1] && route[2] === 'like'
        && (method === 'POST' || method === 'DELETE')) {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a username first.', 409);
      const capped = await guard(env, 'followAct', u.id);
      if (capped) return capped;
      return s2.likeReview(env, u, route[1], method === 'POST');
    }

    if (route[0] === 'pours' && route[1] && route[2] === 'comments') {
      if (method === 'GET') return s2.comments(env, route[1]);
      if (method === 'POST') {
        const u = await requireUser(request, env);
        if (!u.handle) return bad('Claim a username first.', 409);
        const capped = await guard(env, 'listItem', u.id);
        if (capped) return capped;
        return s2.addComment(env, u, route[1], await request.json().catch(() => ({})));
      }
    }

    if (route[0] === 'comments' && route[1] && method === 'DELETE') {
      const u = await requireUser(request, env);
      return s2.deleteComment(env, u, route[1]);
    }

    // HEAD too: these are the endpoints uptime monitors and image proxies probe.
    const read = method === 'GET' || method === 'HEAD';
    if (route[0] === 'stats' && read) return stats(env);
    if (route[0] === 'badge' && read) return badge(env, url.searchParams.get('metric'));

    if (route[0] === 'tags' && route[1] && method === 'GET') {
      return s2.tagPage(env, decodeURIComponent(route[1]));
    }

    if (route[0] === 'styles' && route[1] && method === 'GET') {
      return marks.stylePage(env, decodeURIComponent(route[1]));
    }

    if (route[0] === 'feed' && method === 'GET') {
      const u = await requireUser(request, env);
      return feed(env, u);
    }

    // ---- lists -----------------------------------------------------------
    if (route[0] === 'lists' && !route[1] && method === 'GET') return lists.recent(env);

    if (route[0] === 'lists' && !route[1] && method === 'POST') {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a handle first.', 409);
      const capped = await guard(env, 'listCreate', u.id);
      if (capped) return capped;
      return lists.create(env, u, await request.json().catch(() => ({})));
    }

    if (route[0] === 'lists' && route[1]) {
      const u = await requireUser(request, env);
      const id = route[1];
      if (!route[2] && method === 'PATCH') return lists.update(env, u, id, await request.json().catch(() => ({})));
      if (!route[2] && method === 'DELETE') return lists.destroy(env, u, id);
      if (route[2] === 'items' && !route[3] && method === 'POST') {
        const capped = await guard(env, 'listItem', u.id);
        if (capped) return capped;
        return lists.addItem(env, u, id, await request.json().catch(() => ({})));
      }
      if (route[2] === 'items' && route[3] && method === 'DELETE') {
        return lists.removeItem(env, u, id, route[3]);
      }
      if (route[2] === 'order' && method === 'PUT') {
        const body = await request.json().catch(() => ({}));
        return lists.reorder(env, u, id, body.order);
      }
      return bad('No such list route.', 404);
    }

    // ---- public reads ----------------------------------------------------
    if (route[0] === 'users' && route[1] && route[2] === 'lists' && route[3] && method === 'GET') {
      return lists.one(env, route[1], route[3]);
    }
    if (route[0] === 'users' && route[1] && route[2] === 'lists' && method === 'GET') {
      return lists.ofUser(env, route[1]);
    }
    if (route[0] === 'users' && route[1] && route[2] === 'wishlist' && method === 'GET') {
      return marks.wishlistOf(env, route[1]);
    }
    if (route[0] === 'users' && route[1] && route[2] === 'likes' && method === 'GET') {
      return marks.likesOf(env, route[1]);
    }
    if (route[0] === 'users' && route[1] && route[2] === 'people' && method === 'GET') {
      return people(env, route[1], url.searchParams.get('dir'));
    }
    if (route[0] === 'users' && route[1] && !route[2] && method === 'GET') {
      return profile(env, route[1], await currentUser(request, env));
    }

    if (route[0] === 'beers' && route[1] && route[2] && method === 'GET') {
      return beerPage(env, route[1], route[2], await currentUser(request, env));
    }

    if (route[0] === 'recent' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.photo_key,
                b.name AS beer, b.slug AS beer_slug, b.style,
                br.name AS brewery, br.slug AS brewery_slug,
                u.handle, u.name AS drinker, u.avatar
         FROM pours p
         JOIN beers b ON b.id = p.beer_id
         JOIN breweries br ON br.id = b.brewery_id
         JOIN users u ON u.id = p.user_id
         WHERE u.handle IS NOT NULL
         ORDER BY p.drunk_on DESC, p.id DESC LIMIT 40`
      ).all();
      return json({ pours: results });
    }

    if (route[0] === 'account' && method === 'DELETE') {
      const u = await requireUser(request, env);
      return eraseAccount(env, u, secure);
    }

    return bad('No such endpoint.', 404);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('draught api', err && err.stack);
    return bad('Something poured wrong.', 500);
  }
}

async function requireUser(request, env) {
  const u = await currentUser(request, env);
  if (!u) throw bad('Sign in first.', 401);
  return u;
}

// ---- logging a pour --------------------------------------------------------
// Creates the brewery and the beer if this is the first time anyone has logged
// them. Dedup is by slug, so "Cloudwater" and "cloudwater " are one brewery.

async function logPour(env, user, body) {
  // Set by the caller below when this pour would create canonical rows.
  let mintedSomething = false;
  const breweryName = clean(body.brewery, 80);
  const beerName = clean(body.beer, 100);
  if (!breweryName) return bad('Which brewery?');
  if (!beerName) return bad('Which beer?');

  const drunkOn = isDate(body.drunkOn) ? body.drunkOn : new Date().toISOString().slice(0, 10);
  const rating = body.rating == null || body.rating === '' ? null : Math.round(Number(body.rating));
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 10)) {
    return bad('Ratings run 1–10 (half-stars).');
  }
  const abv = body.abv == null || body.abv === '' ? null : Number(body.abv);
  if (abv !== null && (!Number.isFinite(abv) || abv < 0 || abv > 70)) return bad('That ABV is not a beer.');

  const photoKey = body.photoKey ? String(body.photoKey) : null;
  if (!photoKeyOk(photoKey)) return bad('That photo reference is not one of ours.');

  const t = now();
  const brewerySlug = slugify(breweryName);
  const beerSlug = slugify(beerName);
  if (!brewerySlug || !beerSlug) return bad('Names need at least one letter or number.');

  let brewery = await env.DB.prepare('SELECT * FROM breweries WHERE slug = ?').bind(brewerySlug).first();
  if (!brewery) {
    // Creating shared records is capped harder than logging against existing
    // ones: a typo here becomes a page every other drinker has to look at.
    const capped = await guard(env, 'newBeer', user.id);
    if (capped) return capped;
    mintedSomething = true;
    await env.DB.prepare(
      'INSERT INTO breweries (slug, name, country, city, obdb_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(brewerySlug, breweryName, clean(body.country, 60), clean(body.city, 60), clean(body.obdbId, 60) || null, t).run();
    brewery = await env.DB.prepare('SELECT * FROM breweries WHERE slug = ?').bind(brewerySlug).first();
  }

  let beer = await env.DB.prepare('SELECT * FROM beers WHERE brewery_id = ? AND slug = ?')
    .bind(brewery.id, beerSlug).first();
  if (!beer) {
    if (!mintedSomething) {
      const capped = await guard(env, 'newBeer', user.id);
      if (capped) return capped;
    }
    await env.DB.prepare(
      'INSERT INTO beers (brewery_id, slug, name, style, abv, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(brewery.id, beerSlug, beerName, clean(body.style, 60), abv, user.id, t).run();
    beer = await env.DB.prepare('SELECT * FROM beers WHERE brewery_id = ? AND slug = ?')
      .bind(brewery.id, beerSlug).first();
  } else if (abv !== null && beer.abv === null) {
    // First person to know the ABV fills it in for everyone.
    await env.DB.prepare('UPDATE beers SET abv = ? WHERE id = ?').bind(abv, beer.id).run();
  }

  // Same courtesy for the brewery's home: whoever knows it first fills it in,
  // and nobody overwrites what's already there. Without this a brewery created
  // early with no country never gains one, and it silently vanishes from the
  // map's origin tally forever.
  const country = clean(body.country, 60);
  const city = clean(body.city, 60);
  if ((country && !brewery.country) || (city && !brewery.city)) {
    await env.DB.prepare(
      `UPDATE breweries SET country = CASE WHEN country = '' THEN ? ELSE country END,
                            city    = CASE WHEN city    = '' THEN ? ELSE city    END
       WHERE id = ?`
    ).bind(country, city, brewery.id).run();
  }

  // A named venue becomes a shared, pinnable place. Falls back to plain text if
  // it can't be resolved, so a pour is never lost to a venue problem.
  let venue = null;
  try { venue = await venues.resolve(env, user, body); } catch { venue = null; }

  const res = await env.DB.prepare(
    `INSERT INTO pours (user_id, beer_id, rating, note, serving, venue, venue_id, geo_private,
                        drunk_on, photo_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, beer.id, rating, clean(body.note, 2000),
    clean(body.serving, 16), clean(body.venueName ?? body.venue, 80),
    venue?.id ?? null, body.geoPrivate ? 1 : 0,
    drunkOn, photoKey, t
  ).run();

  // The first photo anyone takes becomes the beer's face everywhere else. The
  // NULL guard in the WHERE clause makes concurrent first-pours race-safe.
  if (photoKey && !beer.photo_key) {
    await env.DB.prepare('UPDATE beers SET photo_key = ? WHERE id = ? AND photo_key IS NULL')
      .bind(photoKey, beer.id).run();
  }

  if (body.tags !== undefined) await s2.setTags(env, res.meta.last_row_id, body.tags);

  return json({
    id: res.meta.last_row_id,
    beer: { name: beer.name, slug: beer.slug, style: beer.style, abv: beer.abv ?? abv },
    brewery: { name: brewery.name, slug: brewery.slug },
    rating, drunkOn, photoKey,
  }, 201);
}

// Editing an entry. Only the fields a person can reasonably change afterwards:
// the beer identity itself is deliberately fixed, because a pour is a record of
// a specific thing you drank — changing which beer it was is a new entry, not an
// edit, and silently moving it would corrupt another beer's aggregate.
async function editPour(env, user, rawId, body) {
  const id = Number(rawId) || 0;
  const pour = await env.DB.prepare('SELECT * FROM pours WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!pour) return bad('No such entry.', 404);

  const rating = body.rating === '' || body.rating == null
    ? null : Math.round(Number(body.rating));
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 10)) {
    return bad('Ratings run 1–10 (half-stars).');
  }
  const drunkOn = isDate(body.drunkOn) ? body.drunkOn : pour.drunk_on;
  const photoKey = body.photoKey === undefined ? pour.photo_key
    : (body.photoKey ? String(body.photoKey) : null);
  if (!photoKeyOk(photoKey)) return bad('That photo reference is not one of ours.');

  await env.DB.prepare(
    `UPDATE pours SET rating = ?, note = ?, serving = ?, venue = ?, drunk_on = ?,
                      again = ?, photo_key = ?, geo_private = ?, edited_at = ?
     WHERE id = ? AND user_id = ?`
  ).bind(
    rating,
    clean(body.note ?? pour.note, 2000),
    clean(body.serving ?? pour.serving, 16),
    clean(body.venue ?? pour.venue, 80),
    drunkOn,
    body.again ? 1 : 0,
    photoKey,
    body.geoPrivate ? 1 : 0,
    now(), id, user.id
  ).run();

  // A newly attached photo can still become the beer's face if it has none.
  if (photoKey && photoKey !== pour.photo_key) {
    await env.DB.prepare('UPDATE beers SET photo_key = ? WHERE id = ? AND photo_key IS NULL')
      .bind(photoKey, pour.beer_id).run();
  }

  if (body.tags !== undefined) await s2.setTags(env, id, body.tags);

  return json({ ok: true, id, rating, drunkOn });
}

// Removing a pour has to consider its photo. If that shot happens to be the one
// representing the beer, dropping the object would leave a broken image on a
// page that isn't even ours — so hand the role to another drinker's photo first,
// and only bin the object once nothing points at it.
async function deletePour(env, user, rawId) {
  const id = Number(rawId) || 0;
  const pour = await env.DB.prepare('SELECT id, beer_id, photo_key FROM pours WHERE id = ? AND user_id = ?')
    .bind(id, user.id).first();
  if (!pour) return bad('No such pour.', 404);

  await env.DB.prepare('DELETE FROM pours WHERE id = ?').bind(pour.id).run();

  if (!pour.photo_key) return json({ ok: true });

  const beer = await env.DB.prepare('SELECT photo_key FROM beers WHERE id = ?').bind(pour.beer_id).first();
  if (beer?.photo_key === pour.photo_key) {
    const heir = await env.DB.prepare(
      `SELECT photo_key FROM pours WHERE beer_id = ? AND photo_key IS NOT NULL
       ORDER BY created_at LIMIT 1`
    ).bind(pour.beer_id).first();
    await env.DB.prepare('UPDATE beers SET photo_key = ? WHERE id = ?')
      .bind(heir?.photo_key ?? null, pour.beer_id).run();
  }

  const stillUsed = await env.DB.prepare('SELECT 1 FROM pours WHERE photo_key = ? LIMIT 1')
    .bind(pour.photo_key).first();
  const stillCover = await env.DB.prepare('SELECT 1 FROM beers WHERE photo_key = ? LIMIT 1')
    .bind(pour.photo_key).first();
  if (!stillUsed && !stillCover) await discard(env, pour.photo_key);

  return json({ ok: true });
}

// Erase everything. A privacy policy that promises deletion needs a delete that
// actually works, including the R2 objects — those outlive the database rows
// otherwise, and "we deleted your account" would be a lie about the photos.
//
// Canonical breweries and beers deliberately survive: other people's pours point
// at them, and removing a beer because one drinker left would vandalise their
// shelves. What goes is everything personal — identity, pours, notes, photos,
// follows, lists.
async function eraseAccount(env, user, secure) {
  // Collect the photo keys first — after the delete there is nothing left to
  // ask, and the R2 objects would be orphaned with no way to find them.
  const { results: photos } = await env.DB.prepare(
    'SELECT photo_key FROM pours WHERE user_id = ? AND photo_key IS NOT NULL'
  ).bind(user.id).all();
  const keys = photos.map((r) => r.photo_key);

  // The destructive half is one atomic batch, so a failure leaves the account
  // wholly intact rather than half-erased.
  //
  // `beers.created_by` has no ON DELETE action, so a user who ever created a
  // beer cannot be deleted while it points at them — null it first. That is the
  // right outcome anyway: once someone leaves, nothing should still attribute a
  // beer to them.
  await env.DB.batch([
    env.DB.prepare('UPDATE beers SET created_by = NULL WHERE created_by = ?').bind(user.id),
    env.DB.prepare('UPDATE venues SET created_by = NULL WHERE created_by = ?').bind(user.id),
    env.DB.prepare('DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE user_id = ?)').bind(user.id),
    env.DB.prepare('DELETE FROM lists WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?').bind(user.id, user.id),
    env.DB.prepare('DELETE FROM wishlist WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM likes WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM favourites WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM review_likes WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM comments WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM pour_tags WHERE pour_id IN (SELECT id FROM pours WHERE user_id = ?)').bind(user.id),
    env.DB.prepare('DELETE FROM pours WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    env.DB.prepare('DELETE FROM rate_limits WHERE bucket LIKE ?').bind(`%:${user.id}`),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);

  // Now the fixups, which are idempotent: any beer still wearing one of this
  // user's photos as its cover gets handed a surviving drinker's shot instead,
  // and only genuinely unreferenced objects are binned. Canonical beers and
  // breweries stay — other people's pours point at them, and deleting a beer
  // because one drinker left would vandalise their shelves.
  for (const key of keys) {
    const cover = await env.DB.prepare('SELECT id FROM beers WHERE photo_key = ?').bind(key).first();
    if (cover) {
      const heir = await env.DB.prepare(
        `SELECT photo_key FROM pours WHERE beer_id = ? AND photo_key IS NOT NULL
         ORDER BY created_at LIMIT 1`
      ).bind(cover.id).first();
      await env.DB.prepare('UPDATE beers SET photo_key = ? WHERE id = ?')
        .bind(heir?.photo_key ?? null, cover.id).run();
    }

    const stillPoured = await env.DB.prepare('SELECT 1 FROM pours WHERE photo_key = ? LIMIT 1').bind(key).first();
    const stillCover = await env.DB.prepare('SELECT 1 FROM beers WHERE photo_key = ? LIMIT 1').bind(key).first();
    if (!stillPoured && !stillCover) await discard(env, key);
  }

  return json({ ok: true, erased: { pours: keys.length } }, 200, {
    'set-cookie': clearCookie('dr_sess', secure),
  });
}

// ---- public reads ----------------------------------------------------------

async function userStats(env, userId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS pours, COUNT(DISTINCT p.beer_id) AS beers,
            COUNT(DISTINCT b.brewery_id) AS breweries,
            COUNT(DISTINCT NULLIF(b.style, '')) AS styles,
            ROUND(AVG(p.rating), 2) AS avg
     FROM pours p JOIN beers b ON b.id = p.beer_id WHERE p.user_id = ?`
  ).bind(userId).first();
  return row || { pours: 0, beers: 0, breweries: 0, styles: 0, avg: null };
}

async function profile(env, handle, viewer) {
  const h = String(handle).toLowerCase();
  const u = await env.DB.prepare('SELECT * FROM users WHERE handle = ?').bind(h).first();
  if (!u) return bad('No such drinker.', 404);

  const [pours, stats, styles, counts, follows, listCount, marked, favs, tags] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.venue, p.photo_key,
              p.again, p.geo_private, p.edited_at,
              b.name AS beer, b.slug AS beer_slug, b.style, b.abv,
              br.name AS brewery, br.slug AS brewery_slug
       FROM pours p JOIN beers b ON b.id = p.beer_id JOIN breweries br ON br.id = b.brewery_id
       WHERE p.user_id = ? ORDER BY p.drunk_on DESC, p.id DESC LIMIT 500`
    ).bind(u.id).all(),
    userStats(env, u.id),
    env.DB.prepare(
      `SELECT b.style, COUNT(*) AS n, ROUND(AVG(p.rating), 2) AS avg
       FROM pours p JOIN beers b ON b.id = p.beer_id
       WHERE p.user_id = ? AND b.style != '' GROUP BY b.style ORDER BY n DESC LIMIT 20`
    ).bind(u.id).all(),
    followCounts(env, u.id),
    viewerFollows(env, viewer?.id, u.id),
    env.DB.prepare('SELECT COUNT(*) AS n FROM lists WHERE user_id = ?').bind(u.id).first(),
    env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM wishlist WHERE user_id = ?1) AS wants,
              (SELECT COUNT(*) FROM likes WHERE user_id = ?1) AS likes`
    ).bind(u.id).first(),
    s2.favouritesOf(env, u.id),
    s2.topTags(env, u.id),
  ]);

  const tagMap = await s2.tagsFor(env, pours.results.map((p) => p.id));
  for (const p of pours.results) p.tags = tagMap[p.id] || [];

  return json({
    user: publicUser(u),
    stats: { ...stats, ...counts, lists: listCount?.n ?? 0,
             wants: marked?.wants ?? 0, likes: marked?.likes ?? 0 },
    viewerFollows: follows,
    isSelf: !!viewer && viewer.id === u.id,
    styles: styles.results,
    favourites: favs.favourites,
    tags,
    pours: pours.results,
  });
}

async function beerPage(env, brewerySlug, beerSlug, viewer) {
  const beer = await env.DB.prepare(
    `SELECT b.*, br.name AS brewery, br.slug AS brewery_slug, br.country, br.city
     FROM beers b JOIN breweries br ON br.id = b.brewery_id
     WHERE br.slug = ? AND b.slug = ?`
  ).bind(String(brewerySlug), String(beerSlug)).first();
  if (!beer) return bad('No such beer.', 404);

  const viewerMarks = await marks.forViewer(env, viewer?.id, beer.id);
  const markCounts = await marks.counts(env, beer.id);

  const [agg, pours] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS pours, COUNT(DISTINCT user_id) AS drinkers,
              ROUND(AVG(rating), 2) AS avg, COUNT(rating) AS rated
       FROM pours WHERE beer_id = ?`
    ).bind(beer.id).first(),
    env.DB.prepare(
      `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.photo_key, p.again,
              u.handle, u.name AS drinker, u.avatar,
              (SELECT COUNT(*) FROM review_likes rl WHERE rl.pour_id = p.id) AS likes,
              (SELECT COUNT(*) FROM comments c WHERE c.pour_id = p.id) AS comments,
              EXISTS(SELECT 1 FROM review_likes rl2
                     WHERE rl2.pour_id = p.id AND rl2.user_id = ?2) AS liked
       FROM pours p JOIN users u ON u.id = p.user_id
       WHERE p.beer_id = ?1 AND u.handle IS NOT NULL
       ORDER BY (p.note != '') DESC, p.drunk_on DESC, p.id DESC LIMIT 50`
    ).bind(beer.id, viewer?.id ?? '').all(),
  ]);

  const { results: hist } = await env.DB.prepare(
    'SELECT rating, COUNT(*) AS n FROM pours WHERE beer_id = ? AND rating IS NOT NULL GROUP BY rating'
  ).bind(beer.id).all();

  return json({
    beer: {
      id: beer.id, name: beer.name, slug: beer.slug, style: beer.style, abv: beer.abv,
      photoKey: beer.photo_key,
      brewery: beer.brewery, brewerySlug: beer.brewery_slug, country: beer.country, city: beer.city,
    },
    stats: { ...agg, ...markCounts },
    viewer: viewerMarks,
    histogram: hist, pours: pours.results,
  });
}

// Public aggregate counts. Nothing here identifies anyone — they are the four
// numbers you'd put on a README, and they are cached at the edge because a
// badge in a README gets fetched by every visitor's proxy.
const STATS_SQL = `
  SELECT (SELECT COUNT(*) FROM users WHERE handle IS NOT NULL) AS drinkers,
         (SELECT COUNT(*) FROM pours)                          AS logged,
         (SELECT COUNT(*) FROM beers)                          AS beers,
         (SELECT COUNT(*) FROM breweries)                      AS breweries`;

const CACHE = { 'cache-control': 'public, max-age=60, s-maxage=600' };

async function stats(env) {
  const row = await env.DB.prepare(STATS_SQL).first();
  return json({
    drinkers: row?.drinkers ?? 0,
    logged: row?.logged ?? 0,
    beers: row?.beers ?? 0,
    breweries: row?.breweries ?? 0,
  }, 200, CACHE);
}

// shields.io endpoint format: https://shields.io/badges/endpoint-badge
const BADGES = {
  drinkers: 'drinkers',
  logged: 'beers logged',
  beers: 'distinct beers',
  breweries: 'breweries',
};

async function badge(env, metric) {
  const key = BADGES[metric] ? metric : 'logged';
  const row = await env.DB.prepare(STATS_SQL).first();
  return json({
    schemaVersion: 1,
    label: BADGES[key],
    message: String(row?.[key] ?? 0),
    color: 'e5a33e',
    // shields will not poll faster than this, so it is also our floor.
    cacheSeconds: 600,
  }, 200, CACHE);
}

// One box, three kinds of answer. Beers rank first because that is what people
// are usually looking for; a bare handle match jumps to the top of people.
async function search(env, rawQuery) {
  const q = clean(rawQuery, 60);
  if (q.length < 2) return json({ beers: [], breweries: [], people: [] });
  const like = `%${q}%`;

  const [beers, breweries, people] = await Promise.all([
    env.DB.prepare(
      `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
              br.name AS brewery, br.slug AS brewery_slug,
              COUNT(p.id) AS pours, ROUND(AVG(p.rating), 2) AS avg
       FROM beers b JOIN breweries br ON br.id = b.brewery_id
       LEFT JOIN pours p ON p.beer_id = b.id
       WHERE b.name LIKE ? OR br.name LIKE ?
       GROUP BY b.id ORDER BY pours DESC, b.name LIMIT 20`
    ).bind(like, like).all(),
    env.DB.prepare(
      `SELECT br.name, br.slug, br.country, br.city, COUNT(DISTINCT b.id) AS beers
       FROM breweries br LEFT JOIN beers b ON b.brewery_id = br.id
       WHERE br.name LIKE ? GROUP BY br.id ORDER BY beers DESC LIMIT 10`
    ).bind(like).all(),
    env.DB.prepare(
      `SELECT u.handle, u.name, u.avatar, COUNT(p.id) AS pours
       FROM users u LEFT JOIN pours p ON p.user_id = u.id
       WHERE u.handle IS NOT NULL AND (u.handle LIKE ? OR u.name LIKE ?)
       GROUP BY u.id ORDER BY (u.handle = ?) DESC, pours DESC LIMIT 10`
    ).bind(like, like, q.toLowerCase()).all(),
  ]);

  return json({ q, beers: beers.results, breweries: breweries.results, people: people.results });
}

// A brewery page. Brewery names appear all over the app and led nowhere.
async function breweryPage(env, slug) {
  const br = await env.DB.prepare('SELECT * FROM breweries WHERE slug = ?').bind(String(slug)).first();
  if (!br) return bad('No such brewery.', 404);

  const [beers, stats] = await Promise.all([
    env.DB.prepare(
      `SELECT b.name, b.slug, b.style, b.abv, b.photo_key,
              COUNT(p.id) AS pours, COUNT(DISTINCT p.user_id) AS drinkers,
              ROUND(AVG(p.rating), 2) AS avg
       FROM beers b LEFT JOIN pours p ON p.beer_id = b.id
       WHERE b.brewery_id = ?
       GROUP BY b.id ORDER BY pours DESC, b.name LIMIT 200`
    ).bind(br.id).all(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT b.id) AS beers, COUNT(p.id) AS pours,
              COUNT(DISTINCT p.user_id) AS drinkers, ROUND(AVG(p.rating), 2) AS avg
       FROM beers b LEFT JOIN pours p ON p.beer_id = b.id WHERE b.brewery_id = ?`
    ).bind(br.id).first(),
  ]);

  return json({
    brewery: { name: br.name, slug: br.slug, country: br.country, city: br.city },
    stats, beers: beers.results,
  });
}

// Local beers we already know about, then Open Brewery DB for everything else.
// OBDB is free, keyless and CORS-open; we proxy it so the client stays same-origin.
async function searchBreweries(env, rawQuery) {
  const q = clean(rawQuery, 60);
  if (q.length < 2) return [];

  const { results: local } = await env.DB.prepare(
    `SELECT br.name AS name, br.slug AS slug, br.country AS country, br.city AS city,
            COUNT(b.id) AS beers
     FROM breweries br LEFT JOIN beers b ON b.brewery_id = br.id
     WHERE br.name LIKE ? GROUP BY br.id ORDER BY beers DESC LIMIT 6`
  ).bind(`%${q}%`).all();

  const seen = new Set(local.map((b) => b.slug));
  const out = local.map((b) => ({ ...b, source: 'draught' }));

  try {
    const res = await fetch(
      `https://api.openbrewerydb.org/v1/breweries/search?query=${encodeURIComponent(q)}&per_page=8`,
      { headers: { 'user-agent': 'draught (+https://draught.pages.dev)' }, signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      for (const b of await res.json()) {
        const slug = slugify(b.name);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        out.push({
          name: b.name, slug, country: b.country || '', city: b.city || '',
          obdbId: b.id, beers: 0, source: 'obdb',
        });
      }
    }
  } catch {
    // OBDB down or slow — local results still stand, and free text always works.
  }
  return out.slice(0, 12);
}

// ---- OAuth -----------------------------------------------------------------

const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw bad('Google would not say who you are.', 502);
      const p = await r.json();
      return { id: p.sub, name: p.name || p.given_name || 'Someone', avatar: p.picture || '' };
    },
  },
};

function creds(env, provider) {
  const id = env[`${provider.toUpperCase()}_CLIENT_ID`];
  const secret = env[`${provider.toUpperCase()}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
}

async function authRoutes(rest, context, url, secure) {
  const { request, env } = context;
  const provider = rest[0];

  // Local-only shortcut so the app can be built without OAuth apps registered.
  if (provider === 'dev') {
    if (env.DEV_LOGIN !== '1') return bad('Not enabled.', 404);
    const name = clean(url.searchParams.get('as'), 40) || 'Local Drinker';
    const user = await upsertUser(env, 'dev', slugify(name) || 'dev', { name, avatar: '' });
    const cookie = await createSession(env, user.id, secure);
    return redirect(user.handle ? '/' : '/welcome', cookie);
  }

  if (!PROVIDERS[provider]) return bad('Unknown sign-in provider.', 404);
  const c = creds(env, provider);
  if (!c) return bad(`${provider} sign-in is not configured on this deployment.`, 503);
  const spec = PROVIDERS[provider];
  const redirectUri = `${url.origin}/api/auth/${provider}/callback`;

  // Step 1 — hand the browser to the provider, remembering a state nonce.
  if (!rest[1]) {
    const state = randToken(16);
    const authorize = new URL(spec.authorize);
    authorize.searchParams.set('client_id', c.id);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', spec.scope);
    authorize.searchParams.set('state', state);
    return redirect(authorize.toString(), setCookie(OAUTH_COOKIE, `${provider}:${state}`, { maxAge: 600, secure }));
  }

  // Step 2 — the provider hands the browser back.
  if (rest[1] !== 'callback') return bad('Unknown auth route.', 404);

  const stored = cookies(request)[OAUTH_COOKIE] || '';
  const [storedProvider, storedState] = stored.split(':');
  const state = url.searchParams.get('state') || '';
  if (storedProvider !== provider || !storedState || !timingSafeEqual(storedState, state)) {
    return bad('Sign-in expired or was tampered with. Try again.', 400);
  }
  const code = url.searchParams.get('code');
  if (!code) return bad(url.searchParams.get('error') || 'No code returned.', 400);

  const tokenRes = await fetch(spec.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'draught' },
    body: new URLSearchParams({
      client_id: c.id, client_secret: c.secret, code,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) return bad('Could not complete sign-in.', 502);

  const p = await spec.profile(token.access_token);
  const user = await upsertUser(env, provider, p.id, p);
  const sessionCookie = await createSession(env, user.id, secure);
  return redirect(user.handle ? '/' : '/welcome', sessionCookie, clearCookie(OAUTH_COOKIE, secure));
}

function redirect(location, ...setCookies) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const c of setCookies) if (c) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

async function upsertUser(env, provider, providerId, p) {
  const found = await env.DB.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?')
    .bind(provider, providerId).first();
  if (found) {
    // Keep the display name and avatar fresh, but never touch a chosen handle.
    await env.DB.prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?')
      .bind(clean(p.name, 60) || found.name, clean(p.avatar, 300), found.id).run();
    return found;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO users (id, handle, name, avatar, provider, provider_id, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)'
  ).bind(id, clean(p.name, 60) || 'Someone', clean(p.avatar, 300), provider, providerId, now()).run();
  return await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}
