// Draught — the whole API. One catch-all, a switch, no framework.
//
//   GET    /api/me
//   POST   /api/logout
//   POST   /api/handle              { handle }
//   PATCH  /api/profile             { name, bio }
//   GET    /api/auth/:provider      -> redirect to provider
//   GET    /api/auth/:provider/callback
//   GET    /api/search/breweries?q=
//   GET    /api/search/beers?q=
//   POST   /api/pours               { brewery, beer, style, abv, rating, note, serving, venue, drunkOn }
//   DELETE /api/pours/:id
//   GET    /api/users/:handle
//   GET    /api/beers/:brewery/:beer
//   GET    /api/recent

import {
  json, bad, now, slugify, clean, isDate, HANDLE_RE, RESERVED,
  cookies, setCookie, clearCookie, randToken, timingSafeEqual,
  createSession, currentUser, destroySession, publicUser, OAUTH_COOKIE,
} from '../_shared/lib.js';

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
      const stats = await userStats(env, u.id);
      return json({ user: { ...publicUser(u), id: u.id, needsHandle: !u.handle }, stats });
    }

    if (route[0] === 'logout' && method === 'POST') {
      await destroySession(request, env);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie('dr_sess', secure) });
    }

    if (route[0] === 'handle' && method === 'POST') {
      const u = await requireUser(request, env);
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
      return json({ results: await searchBreweries(env, url.searchParams.get('q') || '') });
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
    if (route[0] === 'pours' && method === 'POST') {
      const u = await requireUser(request, env);
      if (!u.handle) return bad('Claim a handle first.', 409);
      return logPour(env, u, await request.json().catch(() => ({})));
    }

    if (route[0] === 'pours' && route[1] && method === 'DELETE') {
      const u = await requireUser(request, env);
      const res = await env.DB.prepare('DELETE FROM pours WHERE id = ? AND user_id = ?')
        .bind(Number(route[1]) || 0, u.id).run();
      if (!res.meta.changes) return bad('No such pour.', 404);
      return json({ ok: true });
    }

    // ---- public reads ----------------------------------------------------
    if (route[0] === 'users' && route[1] && method === 'GET') return profile(env, route[1]);

    if (route[0] === 'beers' && route[1] && route[2] && method === 'GET') {
      return beerPage(env, route[1], route[2]);
    }

    if (route[0] === 'recent' && method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving,
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

  const t = now();
  const brewerySlug = slugify(breweryName);
  const beerSlug = slugify(beerName);
  if (!brewerySlug || !beerSlug) return bad('Names need at least one letter or number.');

  let brewery = await env.DB.prepare('SELECT * FROM breweries WHERE slug = ?').bind(brewerySlug).first();
  if (!brewery) {
    await env.DB.prepare(
      'INSERT INTO breweries (slug, name, country, city, obdb_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(brewerySlug, breweryName, clean(body.country, 60), clean(body.city, 60), clean(body.obdbId, 60) || null, t).run();
    brewery = await env.DB.prepare('SELECT * FROM breweries WHERE slug = ?').bind(brewerySlug).first();
  }

  let beer = await env.DB.prepare('SELECT * FROM beers WHERE brewery_id = ? AND slug = ?')
    .bind(brewery.id, beerSlug).first();
  if (!beer) {
    await env.DB.prepare(
      'INSERT INTO beers (brewery_id, slug, name, style, abv, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(brewery.id, beerSlug, beerName, clean(body.style, 60), abv, user.id, t).run();
    beer = await env.DB.prepare('SELECT * FROM beers WHERE brewery_id = ? AND slug = ?')
      .bind(brewery.id, beerSlug).first();
  } else if (abv !== null && beer.abv === null) {
    // First person to know the ABV fills it in for everyone.
    await env.DB.prepare('UPDATE beers SET abv = ? WHERE id = ?').bind(abv, beer.id).run();
  }

  const res = await env.DB.prepare(
    `INSERT INTO pours (user_id, beer_id, rating, note, serving, venue, drunk_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, beer.id, rating, clean(body.note, 2000),
    clean(body.serving, 16), clean(body.venue, 80), drunkOn, t
  ).run();

  return json({
    id: res.meta.last_row_id,
    beer: { name: beer.name, slug: beer.slug, style: beer.style, abv: beer.abv ?? abv },
    brewery: { name: brewery.name, slug: brewery.slug },
    rating, drunkOn,
  }, 201);
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

async function profile(env, handle) {
  const h = String(handle).toLowerCase();
  const u = await env.DB.prepare('SELECT * FROM users WHERE handle = ?').bind(h).first();
  if (!u) return bad('No such drinker.', 404);

  const [pours, stats, styles] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.rating, p.note, p.drunk_on, p.serving, p.venue,
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
  ]);

  return json({ user: publicUser(u), stats, styles: styles.results, pours: pours.results });
}

async function beerPage(env, brewerySlug, beerSlug) {
  const beer = await env.DB.prepare(
    `SELECT b.*, br.name AS brewery, br.slug AS brewery_slug, br.country, br.city
     FROM beers b JOIN breweries br ON br.id = b.brewery_id
     WHERE br.slug = ? AND b.slug = ?`
  ).bind(String(brewerySlug), String(beerSlug)).first();
  if (!beer) return bad('No such beer.', 404);

  const [agg, pours] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS pours, COUNT(DISTINCT user_id) AS drinkers,
              ROUND(AVG(rating), 2) AS avg, COUNT(rating) AS rated
       FROM pours WHERE beer_id = ?`
    ).bind(beer.id).first(),
    env.DB.prepare(
      `SELECT p.rating, p.note, p.drunk_on, p.serving, u.handle, u.name AS drinker, u.avatar
       FROM pours p JOIN users u ON u.id = p.user_id
       WHERE p.beer_id = ? AND u.handle IS NOT NULL
       ORDER BY (p.note != '') DESC, p.drunk_on DESC, p.id DESC LIMIT 50`
    ).bind(beer.id).all(),
  ]);

  const { results: hist } = await env.DB.prepare(
    'SELECT rating, COUNT(*) AS n FROM pours WHERE beer_id = ? AND rating IS NOT NULL GROUP BY rating'
  ).bind(beer.id).all();

  return json({
    beer: {
      name: beer.name, slug: beer.slug, style: beer.style, abv: beer.abv,
      brewery: beer.brewery, brewerySlug: beer.brewery_slug, country: beer.country, city: beer.city,
    },
    stats: agg, histogram: hist, pours: pours.results,
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
    idFor: (p) => p.sub,
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) throw bad('Google would not say who you are.', 502);
      const p = await r.json();
      return { id: p.sub, name: p.name || p.given_name || 'Someone', avatar: p.picture || '' };
    },
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    scope: 'read:user',
    async profile(accessToken) {
      const r = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${accessToken}`, 'user-agent': 'draught', accept: 'application/vnd.github+json' },
      });
      if (!r.ok) throw bad('GitHub would not say who you are.', 502);
      const p = await r.json();
      return { id: String(p.id), name: p.name || p.login, avatar: p.avatar_url || '' };
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
