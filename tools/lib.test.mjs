import { test } from 'node:test';
import assert from 'node:assert/strict';
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
