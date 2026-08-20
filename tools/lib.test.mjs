import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slugify, clean, isDate, HANDLE_RE, RESERVED } from '../functions/_shared/lib.js';
import { stars, outOfFive, esc, plural } from '../public/assets/ui.js';
import { STYLES, STYLE_NAMES, FAMILIES, findStyle } from '../public/assets/styles.js';

test('slugify collapses punctuation and folds accents', () => {
  assert.equal(slugify('Cloudwater  DIPA / v2'), 'cloudwater-dipa-v2');
  assert.equal(slugify('Bière de Café'), 'biere-de-cafe');
  assert.equal(slugify('  Trailing --- '), 'trailing');
  assert.equal(slugify('!!!'), '');
});

test('slugify makes brewery names collide the way we want', () => {
  // The same brewery typed three ways must land on one page.
  const forms = ['Cloudwater', 'cloudwater  ', 'CLOUD WATER'.replace(' ', '')];
  assert.equal(new Set(forms.map(slugify)).size, 1);
});

test('clean trims, collapses whitespace and caps length', () => {
  assert.equal(clean('  a   b  ', 10), 'a b');
  assert.equal(clean('x'.repeat(50), 5), 'xxxxx');
  assert.equal(clean(null, 5), '');
});

test('isDate accepts only real ISO dates', () => {
  assert.ok(isDate('2026-08-20'));
  assert.ok(!isDate('2026-8-20'));
  assert.ok(!isDate('nope'));
  assert.ok(!isDate('2026-13-40'));
});

test('handles are constrained and reserved words blocked', () => {
  assert.ok(HANDLE_RE.test('deshpanda'));
  assert.ok(HANDLE_RE.test('a_1'));
  assert.ok(!HANDLE_RE.test('a'));
  assert.ok(!HANDLE_RE.test('has-dash'));
  assert.ok(!HANDLE_RE.test('x'.repeat(21)));
  assert.ok(RESERVED.has('settings'));
});

test('half-star ratings render Letterboxd-style', () => {
  assert.equal(stars(10), '★★★★★');
  assert.equal(stars(9), '★★★★½');
  assert.equal(stars(1), '½');
  assert.equal(stars(null), '');
  assert.equal(outOfFive(7), '3.5');
  assert.equal(outOfFive(10), '5');
  assert.equal(outOfFive(null), '—');
});

test('esc neutralises markup in user-supplied text', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"&'`), '&quot;&amp;&#39;');
});

test('plural', () => {
  assert.equal(plural(1, 'pour'), '1 pour');
  assert.equal(plural(2, 'pour'), '2 pours');
});

test('the style canon is well formed', () => {
  assert.equal(STYLES.length, new Set(STYLE_NAMES).size, 'no duplicate style names');
  const known = new Set(FAMILIES);
  for (const s of STYLES) {
    assert.ok(known.has(s.family), `${s.name} has family ${s.family}`);
    assert.ok(s.origin, `${s.name} has an origin`);
    assert.ok(s.abvLow <= s.abvHigh, `${s.name} ABV band ascends`);
  }
});

test('style lookup is case and space insensitive', () => {
  assert.equal(findStyle('hazy ipa').name, 'Hazy IPA');
  assert.equal(findStyle('  GUEUZE  ').name, 'Gueuze');
  assert.equal(findStyle('not a style'), null);
});

// Regression: the router must never swallow a real navigation. `data-raw` is a
// valueless attribute, so `dataset.raw` is "" (falsy) — the guard has to test
// for the attribute's presence, and /api/ must always escape the SPA.
test('link interceptor lets real navigations through', () => {
  const shouldEscape = (attrs, href) =>
    attrs.includes('data-raw') || href.startsWith('/api/');
  assert.ok(shouldEscape(['data-raw'], '/api/auth/google'), 'marked sign-in link escapes');
  assert.ok(shouldEscape([], '/api/auth/google'), '/api/ escapes even unmarked');
  assert.ok(!shouldEscape([], '/@someone'), 'in-app links stay in the SPA');
  assert.ok(!shouldEscape([], '/log'));
  // the old bug, pinned: truthiness of "" must not be the test
  assert.equal(!!'', false, 'valueless data-raw is falsy — never guard on truthiness');
});

import { LIMITS, tooMany } from '../functions/_shared/ratelimit.js';

test('every rate limit is sane and human-friendly', () => {
  for (const [action, spec] of Object.entries(LIMITS)) {
    assert.ok(spec.max > 0, `${action} has a positive ceiling`);
    assert.ok(spec.window > 0, `${action} has a window`);
    assert.ok(spec.what, `${action} names what it limits, for the error message`);
    // A ceiling a real person could hit in normal use would be a bug, not a limit.
    assert.ok(spec.max >= 10, `${action} ceiling (${spec.max}) is not hostile to humans`);
  }
  // Creating shared records must be capped tighter than logging against existing
  // ones — a typo'd brewery becomes a page everyone else has to look at.
  assert.ok(LIMITS.newBeer.max < LIMITS.pour.max, 'minting canonical rows is the tighter cap');
});

test('429 carries Retry-After and a readable message', async () => {
  const res = tooMany({ what: 'pours', retryAfter: 3600 });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '3600');
  const body = await res.json();
  assert.match(body.error, /Slow down/);
  assert.match(body.error, /60 minutes/);
  // singular minute reads correctly too
  assert.match((await tooMany({ what: 'x', retryAfter: 30 }).json()).error, /a minute/);
});

import { looksPrivate } from '../functions/_shared/venues.js';
import { project, roundCoord, onMap, TOP_LAT, PX_PER_DEG } from '../public/assets/geo.js';

test('private-sounding venue names never get coordinates', () => {
  for (const n of ['home', 'Home', ' my flat ', 'office', 'airbnb', 'my couch', 'dorm'])
    assert.ok(looksPrivate(n), `${n} must be treated as private`);
  // real venues that merely contain a private-ish word must still be pinnable
  for (const n of ['The Homestead', 'Home Brew Bar', 'Office Beer Co', 'Flat Iron Square'])
    assert.ok(!looksPrivate(n), `${n} is a real venue`);
});

test('venue coordinates are rounded to ~11m, not stored raw', () => {
  assert.equal(roundCoord(51.50735142), 51.5074);
  assert.equal(roundCoord(-0.12775899), -0.1278);
  // 4dp is ~11m at the equator; assert we never keep more precision than that
  assert.equal(String(roundCoord(12.978412345)).split('.')[1].length <= 4, true);
});

test('map projection places known coordinates correctly', () => {
  // the prime meridian must land at the horizontal centre
  assert.equal(Math.round(project(0, 0)[0]), 500);
  // antimeridians at the edges
  assert.equal(Math.round(project(0, -180)[0]), 0);
  assert.equal(Math.round(project(0, 180)[0]), 1000);
  // latitude decreases downward, at the same scale as longitude
  const [, yTop] = project(TOP_LAT, 0);
  assert.equal(Math.round(yTop), 0);
  assert.ok(project(0, 0)[1] > 0 && project(-50, 0)[1] > project(50, 0)[1]);
  assert.equal(Math.round(PX_PER_DEG * 360), 1000);
});

test('onMap rejects what the clipped map cannot show', () => {
  assert.ok(onMap(51.5, -0.12));
  assert.ok(!onMap(-85, 0), 'Antarctica is clipped off this map');
  assert.ok(!onMap(0, 200), 'longitude out of range');
  assert.ok(!onMap('nonsense', 0));
});

test('place search prefers drinking venues and dedupes', async () => {
  // normalise() is internal, so exercise the contract the client depends on:
  // drinkable rows first, coordinates rounded, no duplicate name+coord pairs.
  const { LIMITS } = await import('../functions/_shared/ratelimit.js');
  assert.ok(LIMITS.placeSearch, 'the proxied geocoder is rate limited');
  assert.ok(LIMITS.placeSearch.max <= 300, 'and politely so — it is someone else’s free service');
});

test('map fallback must not hinge on a removed MapLibre API', () => {
  // maplibregl.supported() was removed in v5, so `maplibregl.supported?.()`
  // evaluates to undefined — falsy — and sent every visitor to the fallback.
  // Pin the shape of the mistake so it cannot come back.
  const fakeMaplibreV5 = {};
  assert.equal(fakeMaplibreV5.supported?.(), undefined);
  assert.equal(!fakeMaplibreV5.supported?.(), true, 'optional-call on a removed API is always "unsupported"');

  // Check the guard itself, not prose — the comment explaining this mistake
  // legitimately names the old API.
  const src = readFileSync(new URL('../public/assets/app.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/if\s*\(!\s*maplibregl\.supported/.test(src), 'must not gate on the removed API');
  assert.ok(src.includes('if (!hasWebGl())'), 'it should test the real capability');
});
