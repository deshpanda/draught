// Serving the basemap out of our own R2 bucket.
//
// PMTiles is a single-file tile archive read with HTTP range requests: the
// client fetches the header, then the directory, then only the handful of tiles
// on screen. That is why a 178 MB world basemap costs a visitor a few hundred KB
// — and why this endpoint MUST honour Range, or MapLibre will try to pull the
// whole archive on every page load.
//
// The point of hosting it ourselves: no tile server sees our visitors. A
// commercial basemap would put every pan and zoom in someone else's logs.

import { bad } from './lib.js';

// Only the archives we publish, so this can never be pointed at another object.
const ALLOWED = /^(world|city-[a-z0-9-]{2,32})\.pmtiles$/;

export async function serve(name, request, env) {
  if (!env.TILES) return bad('Tiles are not configured on this deployment.', 503);
  if (!ALLOWED.test(String(name))) return bad('No such tile archive.', 404);

  const range = parseRange(request.headers.get('range'));

  // A HEAD is how PMTiles probes for size support before ranging.
  if (request.method === 'HEAD') {
    const head = await env.TILES.head(name);
    if (!head) return bad('No such tile archive.', 404);
    return new Response(null, { headers: baseHeaders(head.size, head.etag) });
  }

  const obj = await env.TILES.get(name, range ? { range } : undefined);
  if (!obj) return bad('No such tile archive.', 404);

  const headers = baseHeaders(obj.size, obj.etag);

  if (range && obj.range) {
    const start = obj.range.offset ?? 0;
    const len = obj.range.length ?? obj.size - start;
    headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
    headers.set('content-length', String(len));
    return new Response(obj.body, { status: 206, headers });
  }

  return new Response(obj.body, { headers });
}

function baseHeaders(size, etag) {
  return new Headers({
    'content-type': 'application/octet-stream',
    'accept-ranges': 'bytes',
    // The archive is replaced by name only when we rebuild it, so let browsers
    // and the edge hold on to it. Tiles are the bulk of the map's bytes.
    'cache-control': 'public, max-age=604800',
    ...(etag ? { etag } : {}),
    ...(size != null ? { 'content-length': String(size) } : {}),
  });
}

// `bytes=start-end`, `bytes=start-`, and `bytes=-suffix` all appear in the wild.
function parseRange(header) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') return { suffix: Number(b) };
  const offset = Number(a);
  if (b === '') return { offset };
  return { offset, length: Number(b) - offset + 1 };
}
