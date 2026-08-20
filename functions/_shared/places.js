// Searching the world for a place to pin, via Photon (photon.komoot.io).
//
// Why Photon and not the obvious choices:
//   * Nominatim, OSM's main geocoder, *explicitly forbids* autocomplete in its
//     usage policy. Photon exists for exactly this and is built on the same data.
//   * Google Places would be better at business search, but it needs a billing
//     account with a card on file, and its script would be a third party running
//     on every page — which the privacy page promises there isn't.
//
// Requests are proxied rather than made from the browser, so Photon only ever
// sees this Worker: no viewer IP, no viewer identity. Results are cached for a
// day and the endpoint is rate limited, because Photon's public instance is a
// free service run by someone else and asks for ~1 request/second.

import { json, clean } from './lib.js';

const ENDPOINT = 'https://photon.komoot.io/api/';
const UA = 'draught (+https://ondraught.pages.dev)';

// Somewhere you might actually drink, ranked ahead of everything else.
const DRINKING = new Set([
  'pub', 'bar', 'biergarten', 'brewery', 'nightclub', 'wine_bar', 'taproom',
  'restaurant', 'cafe', 'food_court', 'social_facility', 'hotel',
]);

export async function search(env, url) {
  const q = clean(url.searchParams.get('q'), 80);
  if (q.length < 2) return json({ results: [] });

  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const biased = Number.isFinite(lat) && Number.isFinite(lon);

  const upstream = new URL(ENDPOINT);
  upstream.searchParams.set('q', q);
  upstream.searchParams.set('limit', '10');
  upstream.searchParams.set('lang', 'en');
  if (biased) {
    // Nudges results toward the searcher without excluding anywhere else.
    upstream.searchParams.set('lat', lat.toFixed(3));
    upstream.searchParams.set('lon', lon.toFixed(3));
  }

  // Cache on the normalised upstream URL, so the same search from different
  // people costs Photon one request a day rather than one per keystroke.
  const cacheKey = new Request(upstream.toString(), { method: 'GET' });
  const cache = caches.default;
  let res = await cache.match(cacheKey);

  if (!res) {
    try {
      const fresh = await fetch(upstream.toString(), {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!fresh.ok) return json({ results: [], degraded: true });
      res = new Response(await fresh.text(), {
        headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=86400' },
      });
      await cache.put(cacheKey, res.clone());
    } catch {
      // Photon slow or down: the venue field still accepts free text, and
      // "Pin this spot" still works. Never block a pour on a geocoder.
      return json({ results: [], degraded: true });
    }
  }

  const data = await res.json().catch(() => ({}));
  return json({ results: normalise(data.features || []) });
}

function normalise(features) {
  const out = features.map((f) => {
    const p = f.properties || {};
    const [lon, lat] = f.geometry?.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    // Photon returns unnamed rows for plain addresses; build something sensible.
    const name = p.name
      || [p.housenumber, p.street].filter(Boolean).join(' ')
      || p.city || p.state || '';
    if (!name) return null;

    const where = [p.street && p.name ? p.street : null, p.city || p.county, p.state, p.country]
      .filter(Boolean);

    return {
      name,
      kind: p.osm_value || p.osm_key || '',
      where: [...new Set(where)].slice(0, 3).join(', '),
      city: p.city || p.county || '',
      country: p.country || '',
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      drinkable: DRINKING.has(p.osm_value),
    };
  }).filter(Boolean);

  // Pubs and bars first — this is a beer app, not a gazetteer.
  out.sort((a, b) => Number(b.drinkable) - Number(a.drinkable));

  // Two OSM nodes for the same bar shouldn't produce two identical rows.
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.name.toLowerCase()}|${r.lat}|${r.lon}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
}
