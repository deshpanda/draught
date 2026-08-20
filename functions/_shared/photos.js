// Label photos, on R2.
//
// The client downscales and re-encodes to JPEG on a canvas before uploading,
// which keeps objects small *and* strips EXIF — including GPS coordinates that
// phone cameras bury in every shot. Server-side we still police type and size,
// because the client is not the boundary.

import { json, bad } from './lib.js';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 3_000_000;                 // generous; downscaled shots run ~150–400 KB
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Keys are random, so an object at a given key never changes — safe to cache
// forever. Kept flat (`<uuid>.jpg`) so the serve route stays one segment.
const KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export async function upload(request, env) {
  if (!env.PHOTOS) return bad('Photo storage is not configured on this deployment.', 503);

  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED.has(type)) return bad('Photos must be JPEG, PNG or WebP.', 415);

  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) return bad('That photo is too large (3 MB max).', 413);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return bad('Empty upload.');
  if (bytes.length > MAX_BYTES) return bad('That photo is too large (3 MB max).', 413);
  if (!looksLikeImage(bytes, type)) return bad('That file is not the image type it claims to be.', 415);

  const key = `${crypto.randomUUID()}.${EXT[type]}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  return json({ key }, 201);
}

export async function serve(key, env) {
  if (!env.PHOTOS) return bad('Photo storage is not configured.', 503);
  if (!KEY_RE.test(String(key))) return bad('No such photo.', 404);

  const obj = await env.PHOTOS.get(String(key));
  if (!obj) return bad('No such photo.', 404);

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'etag': obj.httpEtag,
    },
  });
}

// Best effort: a leaked object costs a fraction of a cent, a failed delete
// must never block the pour being removed.
export async function discard(env, key) {
  if (!env.PHOTOS || !key || !KEY_RE.test(key)) return;
  try { await env.PHOTOS.delete(key); } catch { /* it can age out */ }
}

// Magic-number check, so a renamed executable can't be stored as an image.
function looksLikeImage(b, type) {
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === 'image/png') {
    return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  }
  if (type === 'image/webp') {
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 // RIFF
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50; // WEBP
  }
  return false;
}

export const photoKeyOk = (k) => k == null || k === '' || KEY_RE.test(String(k));
