// Draught — the whole client. History routing, seven views, no framework.

import { api, uploadPhoto, imgUrl } from './api.js';
import { STYLES, FAMILIES, findStyle } from './styles.js';
import {
  esc, stars, outOfFive, fmtDate, today, plural,
  tile, blockHead, pourRow, starRail, bindStarRail, bindAutocomplete,
  prepPhoto, photoImg, followBtn, bindFollow, listCard, askLocation, mapSvg,
  beerRow, COMMON_STYLES, favouriteSlots,
} from './ui.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const state = { me: null, stats: null };

const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

// ---- routing ---------------------------------------------------------------

function parse(pathname) {
  const path = decodeURIComponent(pathname).replace(/\/+$/, '') || '/';
  if (path === '/') return { view: 'home' };
  if (path === '/welcome') return { view: 'welcome' };
  if (path === '/log') return { view: 'log' };
  if (path === '/recent') return { view: 'recent' };
  if (path === '/feed') return { view: 'feed' };
  if (path === '/lists') return { view: 'allLists' };
  if (path === '/settings') return { view: 'settings' };
  if (path === '/privacy') return { view: 'privacy' };
  if (path === '/map') return { view: 'map' };
  if (path === '/search') return { view: 'search' };
  const tg = path.match(/^\/tag\/(.+)$/);
  if (tg) return { view: 'tag', name: decodeURIComponent(tg[1]) };
  const st = path.match(/^\/style\/(.+)$/);
  if (st) return { view: 'style', name: decodeURIComponent(st[1]) };
  const shelf = path.match(/^\/@([^/]+)\/(wishlist|likes)$/);
  if (shelf) return { view: 'shelf', handle: shelf[1].toLowerCase(), kind: shelf[2] };
  const brew = path.match(/^\/brewery\/([^/]+)$/);
  if (brew) return { view: 'brewery', slug: brew[1] };

  const list = path.match(/^\/@([^/]+)\/list\/([^/]+)$/);
  if (list) return { view: 'list', handle: list[1].toLowerCase(), slug: list[2] };
  const userLists = path.match(/^\/@([^/]+)\/lists$/);
  if (userLists) return { view: 'userLists', handle: userLists[1].toLowerCase() };
  const folk = path.match(/^\/@([^/]+)\/(followers|following)$/);
  if (folk) return { view: 'people', handle: folk[1].toLowerCase(), dir: folk[2] };

  if (path.startsWith('/@')) return { view: 'profile', handle: path.slice(2).toLowerCase() };
  const beer = path.match(/^\/b\/([^/]+)\/([^/]+)$/);
  if (beer) return { view: 'beer', brewery: beer[1], beer: beer[2] };
  return { view: 'missing' };
}

export function go(href, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', href);
  else history.pushState({}, '', href);
  render();
}

// Intercept in-app links so the SPA never reloads.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
  // `data-raw` is valueless, so dataset.raw is "" — check the attribute, not its
  // truthiness. Anything under /api/ is a real navigation whatever it's marked.
  if (a.hasAttribute('data-raw') || a.getAttribute('href').startsWith('/api/')) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href !== location.pathname + location.search) go(href);
});
addEventListener('popstate', () => render());

// ---- chrome ----------------------------------------------------------------

function renderNav() {
  const here = location.pathname;
  const on = (p) => (here === p ? ' class="on"' : '');
  if (!state.me) {
    nav.innerHTML = `<a href="/recent"${on('/recent')}>Everyone</a>
      <a href="/lists"${on('/lists')}>Lists</a>
      <a href="/map"${on('/map')}>Map</a>
      <form class="navsearch" id="navSearch" role="search">
        <input type="search" name="q" placeholder="Search beers, breweries, people"
          aria-label="Search" value="${esc(new URLSearchParams(location.search).get('q') || '')}">
      </form>
      <a class="cta" href="/api/auth/google" data-raw>Sign in</a>`;
    return;
  }
  const h = state.me.handle;
  nav.innerHTML = `
    <a href="/feed"${on('/feed')}>Following</a>
    <a href="/recent"${on('/recent')}>Everyone</a>
    <a href="/lists"${on('/lists')}>Lists</a>
    <a href="/map"${on('/map')}>Map</a>
    ${h ? `<span class="menu">
      <button class="me" id="meBtn" aria-expanded="false" aria-haspopup="true">${
        state.me.avatar
          ? `<img class="avatar" src="${esc(state.me.avatar)}" alt="" referrerpolicy="no-referrer">`
          : ''}${esc(h)} <span class="caret">▾</span></button>
      <span class="menu-pop" id="mePop" hidden>
        <a href="/@${esc(h)}">Your profile</a>
        <a href="/@${esc(h)}/lists">Your lists</a>
        <a href="/settings">Settings</a>
        <button id="signout">Sign out</button>
      </span>
    </span>` : ''}
    <form class="navsearch" id="navSearch" role="search">
      <input type="search" name="q" placeholder="Search beers, breweries, people"
        aria-label="Search" value="${esc(new URLSearchParams(location.search).get('q') || '')}">
    </form>
    <a class="cta" href="/log">+ Log</a>`;

  // Account menu. Sign out has to be reachable in one click from anywhere —
  // burying it on the settings page behind "Edit profile" made it unfindable.
  nav.querySelector('#navSearch')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) go(`/search?q=${encodeURIComponent(q)}`);
  });

  const btn = nav.querySelector('#meBtn');
  const pop = nav.querySelector('#mePop');
  if (btn && pop) {
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    pop.addEventListener('click', (e) => e.stopPropagation());
    nav.querySelector('#signout').addEventListener('click', async () => {
      close();
      await api.logout().catch(() => {});
      state.me = null; state.stats = null;
      go('/');
    });
  }
}

const loading = () => { app.innerHTML = '<p class="loading">pouring…</p>'; };
const oops = (msg) => {
  app.innerHTML = `<div class="wrap"><div class="empty"><p>${esc(msg)}</p>
    <a class="btn" href="/">Go home</a></div></div>`;
};

// ---- views -----------------------------------------------------------------

function viewLanding() {
  app.innerHTML = `<div class="wrap"><section class="gate"><div class="gate-inner">
    <p class="glass">🍺</p>
    <h1>Draught</h1>
    <p class="tag">Letterboxd, for beer</p>
    <p class="pitch">Keep a diary of the beer you drink. Rate it, write a review,
      make lists, and follow people whose taste you trust.</p>
    <div class="signin">
      <a class="btn btn-amber btn-lg" href="/api/auth/google" data-raw>Sign in with Google</a>
    </div>
    ${isLocal ? '<p class="fine"><a href="/api/auth/dev?as=Local%20Drinker" data-raw>dev sign-in</a> (localhost only)</p>' : ''}
    <p class="fine">Free. No ads, no badges, no streaks.<br>
      Your username and the beers you log are public. Nothing else is.</p>

    <div class="threeup">
      <div><h4>Rate and review</h4>
        <p>Half stars, a date, a photo, and room to say what it actually tasted
          like. The review is the point.</p></div>
      <div><h4>One page per beer</h4>
        <p>Everyone's ratings and reviews gather on the same page, so you can see
          what a beer is really like before you buy it.</p></div>
      <div><h4>Follow people</h4>
        <p>See what your friends are drinking. 117 beer styles tracked, so your
          profile shows what you actually go for.</p></div>
    </div>
  </div></section></div>`;
}

async function viewHome() {
  if (!state.me) return viewLanding();
  if (!state.me.handle) return go('/welcome', { replace: true });
  return go('/feed', { replace: true });
}

function viewWelcome() {
  if (!state.me) return viewLanding();
  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Pick a username</h2>
      <p>It's your address here — <code>draught/@you</code> — and it's the only
        part of your account anyone else sees. Letters, numbers, underscore.</p></section>
    <section class="block"><div class="panel" style="max-width:440px">
      <form id="hform">
        <div class="field">
          <label for="handle">Handle</label>
          <input id="handle" name="handle" autocomplete="off" autocapitalize="none"
            spellcheck="false" placeholder="hopsworth" maxlength="20" required>
          <p class="hint">2–20 characters.</p>
        </div>
        <button class="btn btn-amber" type="submit">Claim it</button>
        <p class="msg" id="msg"></p>
      </form>
    </div></section></div>`;

  const form = app.querySelector('#hform');
  const msg = app.querySelector('#msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const handle = form.handle.value.trim().toLowerCase();
    msg.className = 'msg'; msg.textContent = 'claiming…';
    try {
      await api.claimHandle(handle);
      state.me.handle = handle;
      state.me.needsHandle = false;
      renderNav();
      go(`/@${handle}`, { replace: true });
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });
  app.querySelector('#handle').focus();
}

// Type-to-filter over all 117 styles, with the dozen people actually reach for
// as one-tap chips. The old control was a 117-option <select> — technically
// complete and genuinely unusable on a phone.
function styleField() {
  return `<div class="field">
    <label for="style">Type of beer</label>
    <input id="style" name="style" list="stylelist" autocomplete="off"
      placeholder="Start typing — IPA, stout, lager…" maxlength="60">
    <datalist id="stylelist">${
      STYLES.map((s) => `<option value="${esc(s.name)}">${esc(s.family)}</option>`).join('')}</datalist>
    <div class="chips quickstyles" id="quickStyles">${
      COMMON_STYLES.map((nm) => `<button type="button" class="chip" data-style="${esc(nm)}">${esc(nm)}</button>`).join('')}</div>
    <p class="hint" id="abvHint">Pick one, or type anything. ${STYLES.length} styles known.</p>
  </div>`;
}

function viewLog() {
  if (!state.me) return viewLanding();
  if (!state.me.handle) return go('/welcome', { replace: true });

  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Log a beer</h2></section>
    <section class="block"><div class="panel" style="max-width:620px">
      <form id="pform" autocomplete="off">
        <div class="field">
          <label for="brewery">Brewery</label>
          <input id="brewery" name="brewery" required maxlength="80" placeholder="Cloudwater">
          <div class="ac" id="acBrewery"></div>
          <p class="hint">Start typing — we'll look it up. Anything you type also works.</p>
        </div>
        <div class="field">
          <label for="beer">Beer</label>
          <input id="beer" name="beer" required maxlength="100" placeholder="Small DIPA">
          <div class="ac" id="acBeer"></div>
        </div>
        ${styleField()}
        <div class="row two">
          <div class="field">
            <label for="abv">Strength (ABV %)</label>
            <input id="abv" name="abv" type="number" step="0.1" min="0" max="70" placeholder="6.5">
          </div>
          <div class="field">
            <label for="drunkOn">When</label>
            <input id="drunkOn" name="drunkOn" type="date" value="${today()}" max="${today()}">
          </div>
        </div>
        <div class="field">
          <label>Rating</label>
          ${starRail(null)}
          <p class="hint">Optional — logging without a rating is fine.</p>
        </div>
        <div class="field">
          <label for="photo">Photo</label>
          <input id="photo" name="photo" type="file" accept="image/*" capture="environment">
          <div id="shot" class="shot"></div>
          <p class="hint" id="photoHint">Optional. Resized in your browser before upload — which also
            strips the location data your phone hides in the file.</p>
        </div>
        <div class="field">
          <label for="note">Notes</label>
          <textarea id="note" name="note" maxlength="2000"
            placeholder="What did it taste like? Would you have it again?"></textarea>
        </div>
        <div class="field">
          <label>How did it come?</label>
          <div class="chips serving" id="servingChips">
            ${['draught', 'can', 'bottle', 'cask'].map((v) =>
              `<button type="button" class="chip" data-serving="${v}">${v}</button>`).join('')}
          </div>
          <input type="hidden" id="serving" name="serving" value="">
        </div>
        <div class="field">
          <label for="venue">Where</label>
          <input id="venue" name="venue" maxlength="80"
            placeholder="Search a bar, or type any name" autocomplete="off">
          <div class="ac" id="acVenue"></div>
        </div>
        <div class="field">
          <label for="tags">Tags</label>
          <input id="tags" name="tags" maxlength="200" autocomplete="off"
            placeholder="with dad, session, too warm">
          <p class="hint">Comma separated, up to 8. Anything you'd want to find later.</p>
        </div>
        <label class="rank-toggle" style="margin-bottom:14px">
          <input type="checkbox" id="again"> I've had this before
        </label>
        <div class="field">
          <div class="geo">
            <button type="button" class="btn" id="pin">Pin this spot</button>
            <span class="geo-state" id="geoState">no location attached</span>
          </div>
          <label class="rank-toggle geo-off"><input type="checkbox" id="geoPrivate"> keep off the map</label>
          <p class="hint">Search the venue above to place it on the map, or use
            <strong>Pin this spot</strong> for somewhere the map has never heard of.
            A venue's location is public and permanent once set, so everyone sees the
            same dot. Places named like somewhere private — “home”, “my flat” — never
            get coordinates, whatever you pin.</p>
        </div>
        <button class="btn btn-amber btn-lg" type="submit" id="submit">Log it</button>
        <p class="msg" id="msg"></p>
      </form>
    </div></section></div>`;

  const form = app.querySelector('#pform');
  const msg = app.querySelector('#msg');
  bindStarRail(app);

  // Arriving from a beer page: bring the beer with you. Landing on an empty
  // form after clicking "Log this beer" is a small betrayal.
  const pre = new URLSearchParams(location.search);
  if (pre.get('brewery')) form.brewery.value = pre.get('brewery');
  if (pre.get('beer')) form.beer.value = pre.get('beer');
  if (pre.get('style')) form.style.value = pre.get('style');
  if (pre.get('abv')) form.abv.value = pre.get('abv');
  if (pre.get('style')) setTimeout(() => app.querySelector('#style')
    ?.dispatchEvent(new Event('input', { bubbles: true })), 0);
  if (pre.get('beer')) {
    form.brewery.dataset.pickedValue = form.brewery.value;
    setTimeout(() => form.querySelector('#rail')?.scrollIntoView({ block: 'center' }), 60);
  }

  // Prepare (and upload) the photo as soon as it's chosen, so submitting the
  // form is instant rather than waiting on a phone-sized file.
  let photoKey = null;
  const shot = app.querySelector('#shot');
  const photoHint = app.querySelector('#photoHint');
  form.photo.addEventListener('change', async () => {
    const file = form.photo.files?.[0];
    photoKey = null; shot.innerHTML = '';
    if (!file) return;
    photoHint.textContent = 'preparing…';
    try {
      const { blob, width, height } = await prepPhoto(file);
      shot.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`;
      photoHint.textContent = `uploading… (${width}×${height}, ${Math.round(blob.size / 1024)} KB)`;
      photoKey = await uploadPhoto(blob);
      photoHint.textContent = 'photo ready — EXIF stripped.';
    } catch (err) {
      photoHint.textContent = err.message;
      form.photo.value = '';
    }
  });

  // Naming a style tells us its usual strength and where it comes from. Never
  // overwrite a typed ABV — the bottle in their hand beats the style guide.
  const styleSel = form.style;
  const abv = form.abv;
  const abvHint = app.querySelector('#abvHint');
  const describeStyle = () => {
    const st = findStyle(styleSel.value);
    abvHint.textContent = st
      ? `${st.family} · ${st.origin} · usually ${st.abvLow}–${st.abvHigh}%`
      : `Pick one, or type anything. ${STYLES.length} styles known.`;
    app.querySelectorAll('#quickStyles .chip').forEach((c) =>
      c.classList.toggle('chip-on', c.dataset.style === styleSel.value));
  };
  styleSel.addEventListener('input', describeStyle);
  styleSel.addEventListener('change', describeStyle);
  app.querySelector('#quickStyles').addEventListener('click', (e) => {
    const c = e.target.closest('button[data-style]');
    if (!c) return;
    styleSel.value = c.dataset.style === styleSel.value ? '' : c.dataset.style;
    describeStyle();
  });

  // Serving is four options; chips beat a dropdown on a phone.
  const servingInput = app.querySelector('#serving');
  app.querySelector('#servingChips').addEventListener('click', (e) => {
    const c = e.target.closest('button[data-serving]');
    if (!c) return;
    const same = servingInput.value === c.dataset.serving;
    servingInput.value = same ? '' : c.dataset.serving;
    app.querySelectorAll('#servingChips .chip').forEach((x) =>
      x.classList.toggle('chip-on', !same && x === c));
  });

  // The venue field searches two things at once: places people here have
  // already drunk (so a bar keeps one dot), then the whole world via the
  // geocoder. Known venues come first — matching an existing one is always
  // better than minting a near-duplicate.
  let pinned = null;
  let near = null;          // biases the world search toward you, if allowed
  const geoState = app.querySelector('#geoState');

  const setPin = (loc, label) => {
    pinned = loc;
    geoState.textContent = label;
    geoState.classList.toggle('on', !!loc);
  };

  // Picking a suggestion attaches hidden geography to the field. If the name is
  // then edited by hand it is a different place, so that geography has to go —
  // otherwise a typed-in venue silently inherits the last suggestion's city and
  // coordinates. `pickedValue` marks the text a pick actually produced.
  const forgetOnEdit = (el, clear) => {
    el.addEventListener('input', () => {
      if (el.value !== el.dataset.pickedValue) clear();
    });
  };
  forgetOnEdit(form.venue, () => {
    delete form.venue.dataset.city;
    delete form.venue.dataset.country;
    if (pinned) setPin(null, 'no location attached');
  });
  forgetOnEdit(form.brewery, () => {
    delete form.brewery.dataset.country;
    delete form.brewery.dataset.city;
    delete form.brewery.dataset.obdbId;
  });

  bindAutocomplete(
    form.venue, app.querySelector('#acVenue'),
    async (q) => {
      const [mine, world] = await Promise.all([
        api.searchVenues(q).then((r) => r.results).catch(() => []),
        api.places(q, near).then((r) => r.results).catch(() => []),
      ]);
      const known = mine.map((v) => ({
        label: v.name,
        sub: `⌂ ${[v.city, v.country, v.pours ? plural(v.pours, 'pour') : ''].filter(Boolean).join(' · ')}`,
        raw: { ...v, known: true },
      }));
      // Drop world results that are already a known venue by name.
      const seen = new Set(mine.map((v) => v.name.toLowerCase()));
      const found = world
        .filter((p) => !seen.has(p.name.toLowerCase()))
        .map((p) => ({
          label: p.name,
          sub: [p.kind, p.where].filter(Boolean).join(' · '),
          raw: p,
        }));
      return [...known, ...found];
    },
    (pick) => {
      const v = pick.raw;
      form.venue.value = pick.label;
      form.venue.dataset.pickedValue = pick.label;
      if (v.known) {
        delete form.venue.dataset.city;
        delete form.venue.dataset.country;
        setPin(null, v.lat != null ? 'already on the map' : 'no location on this venue yet');
        return;
      }
      // A searched place brings its own coordinates and address.
      setPin({ lat: v.lat, lon: v.lon }, `${v.name}${v.city ? `, ${v.city}` : ''}`);
      form.venue.dataset.city = v.city || '';
      form.venue.dataset.country = v.country || '';
    }
  );

  // Still available, for the bar OSM has never heard of.
  app.querySelector('#pin').addEventListener('click', async () => {
    geoState.textContent = 'asking your device…';
    const loc = await askLocation();
    if (!loc) {
      setPin(null, 'location unavailable — search for the place instead');
      return;
    }
    setPin(loc, `pinned here: ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}`);
    near = loc;   // and bias future searches toward it
  });

  bindAutocomplete(
    form.brewery, app.querySelector('#acBrewery'),
    async (q) => (await api.searchBreweries(q)).results.map((b) => ({
      label: b.name,
      sub: [b.city, b.country, b.beers ? plural(b.beers, 'beer') : ''].filter(Boolean).join(' · '),
      raw: b,
    })),
    (pick) => {
      form.brewery.value = pick.label;
      form.brewery.dataset.pickedValue = pick.label;
      form.brewery.dataset.country = pick.raw.country || '';
      form.brewery.dataset.city = pick.raw.city || '';
      form.brewery.dataset.obdbId = pick.raw.obdbId || '';
      form.beer.focus();
    }
  );

  // Beer typeahead across everything already logged — picking one fills style+ABV.
  bindAutocomplete(
    form.beer, app.querySelector('#acBeer'),
    async (q) => (await api.searchBeers(q)).results.map((b) => ({
      label: b.name,
      sub: [b.brewery, b.style, b.abv ? `${b.abv}%` : ''].filter(Boolean).join(' · '),
      raw: b,
    })),
    (pick) => {
      const b = pick.raw;
      form.beer.value = b.name;
      if (b.brewery) form.brewery.value = b.brewery;
      if (b.style) styleSel.value = b.style;
      if (b.abv != null && !abv.value) abv.value = b.abv;
      styleSel.dispatchEvent(new Event('change'));
    }
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = app.querySelector('#submit');
    btn.disabled = true;
    msg.className = 'msg'; msg.textContent = 'logging…';
    try {
      const res = await api.pour({
        brewery: form.brewery.value,
        country: form.brewery.dataset.country || '',
        city: form.brewery.dataset.city || '',
        obdbId: form.brewery.dataset.obdbId || '',
        beer: form.beer.value,
        style: styleSel.value,
        abv: abv.value,
        rating: form.rating.value,
        photoKey,
        note: form.note.value,
        serving: servingInput.value,
        again: app.querySelector('#again').checked,
        tags: app.querySelector('#tags').value,
        venueName: form.venue.value,
        lat: pinned?.lat, lon: pinned?.lon,
        venueCity: form.venue.dataset.city || '',
        venueCountry: form.venue.dataset.country || '',
        geoPrivate: app.querySelector('#geoPrivate').checked,
        drunkOn: form.drunkOn.value,
      });
      go(`/b/${res.brewery.slug}/${res.beer.slug}`);
    } catch (err) {
      btn.disabled = false;
      msg.className = 'msg err';
      msg.textContent = err.message;
    }
  });

  form.brewery.focus();
}

async function viewProfile(handle) {
  loading();
  let data;
  try { data = await api.profile(handle); } catch (err) { return oops(err.message); }
  const { user, stats, styles, pours, viewerFollows, favourites = [], tags = [] } = data;
  const mine = data.isSelf || state.me?.handle === user.handle;

  const avatar = user.avatar
    ? `<img src="${esc(user.avatar)}" alt="" referrerpolicy="no-referrer">`
    : '<img alt="" src="/assets/favicon.svg">';

  app.innerHTML = `<div class="wrap">
    <section class="phead">
      ${avatar}
      <div>
        <h2>${esc(user.name || user.handle)}</h2>
        <span class="at">@${esc(user.handle)}</span>
        ${user.bio ? `<p class="bio">${esc(user.bio)}</p>` : ''}
        <p class="social">
          <a href="/@${esc(user.handle)}/followers">${plural(stats.followers ?? 0, 'follower')}</a>
          · <a href="/@${esc(user.handle)}/following">${stats.following ?? 0} following</a>
          · <a href="/@${esc(user.handle)}/lists">${plural(stats.lists ?? 0, 'list')}</a>
          · <a href="/@${esc(user.handle)}/wishlist">${stats.wants ?? 0} to try</a>
          · <a href="/@${esc(user.handle)}/likes">${stats.likes ?? 0} liked</a>
        </p>
      </div>
      <span class="phead-act">
        ${mine
          ? '<a class="btn" href="/settings">Edit profile</a>'
          : (state.me ? followBtn(user.handle, viewerFollows) : '')}
      </span>
    </section>

    ${favourites.length || mine ? `<section class="block">
      ${blockHead('Favourites', mine ? 'four beers, pinned' : '')}
      ${favouriteSlots(favourites, mine)}
    </section>` : ''}

    <div class="tiles">
      ${tile('logged', stats.pours ?? 0)}
      ${tile('beers', stats.beers ?? 0)}
      ${tile('breweries', stats.breweries ?? 0)}
      ${tile('styles', stats.styles ?? 0)}
      ${tile('average', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.avg ? 'out of 5' : 'nothing rated yet')}
    </div>

    ${pours.some((p) => p.photo_key) ? `<section class="block">
      ${blockHead('Photos')}
      <div class="wall">${pours.filter((p) => p.photo_key).slice(0, 24).map((p) =>
        `<a class="wtile" href="/b/${encodeURIComponent(p.brewery_slug)}/${encodeURIComponent(p.beer_slug)}"
          title="${esc(p.beer)} — ${esc(p.brewery)}">${photoImg(p.photo_key)}</a>`).join('')}</div>
    </section>` : ''}

    ${tags.length ? `<section class="block">
      ${blockHead('Tags')}
      <div class="chips">${tags.map((t) =>
        `<a class="chip" href="/tag/${encodeURIComponent(t.tag)}">${esc(t.label)}<span class="n">${t.n}</span></a>`).join('')}</div>
    </section>` : ''}

    ${styles.length ? `<section class="block">
      ${blockHead('Styles', `${styles.length} of 117`)}
      <div class="chips">${styles.map((s) =>
        `<a class="chip" href="/style/${encodeURIComponent(s.style)}">${esc(s.style)}<span class="n">${s.n}</span></a>`).join('')}</div>
    </section>` : ''}

    <section class="block">
      ${blockHead('Diary', pours.length ? plural(pours.length, 'entry', 'entries') : '')}
      ${pours.length
        ? `<ul class="pours" id="ledger">${pours.map((p) => pourRow(p, { mine })).join('')}</ul>`
        : `<div class="empty"><p>${mine ? 'Nothing logged yet.' : 'Nothing logged yet.'}</p>
            ${mine ? '<a class="btn btn-amber" href="/log">Log your first beer</a>' : ''}</div>`}
    </section>
  </div>`;

  bindFollow(app, api, (res) => {
    const el = app.querySelector('.social a');
    if (el) el.textContent = plural(res.followers, 'follower');
  });

  if (mine) {
    app.querySelector('#ledger')?.addEventListener('click', async (e) => {
      const del = e.target.closest('button[data-kill]');
      if (del) {
        if (!confirm('Delete this entry?')) return;
        del.disabled = true;
        try {
          await api.unpour(del.dataset.kill);
          del.closest('li').remove();
        } catch { del.disabled = false; }
        return;
      }
      const ed = e.target.closest('button[data-edit]');
      if (ed) openEditor(ed, pours.find((x) => String(x.id) === ed.dataset.edit), handle);
    });
  }
}

// Edit an entry in place. The beer itself is not editable: a pour records a
// specific thing you drank, and quietly moving it to another beer would corrupt
// that beer's average for everyone else. Wrong beer means delete and re-log.
function openEditor(btn, p, handle) {
  const li = btn.closest('li');
  if (li.nextElementSibling?.classList.contains('editrow')) {
    li.nextElementSibling.remove();
    return;
  }
  const row = document.createElement('li');
  row.className = 'editrow';
  row.innerHTML = `<div class="panel">
    <p class="hint" style="margin:0 0 12px">Editing <strong>${esc(p.beer)}</strong> · ${esc(p.brewery)}
      — the beer can't be changed; delete and re-log if it's wrong.</p>
    <div class="field">
      <label>Rating</label>
      ${starRail(p.rating)}
    </div>
    <div class="field">
      <label for="enote">Review</label>
      <textarea id="enote" maxlength="2000">${esc(p.note || '')}</textarea>
    </div>
    <div class="row two">
      <div class="field"><label for="edate">When</label>
        <input id="edate" type="date" value="${esc(p.drunk_on)}" max="${today()}"></div>
      <div class="field"><label for="evenue">Where</label>
        <input id="evenue" maxlength="80" value="${esc(p.venue || '')}"></div>
    </div>
    <div class="field">
      <label>How did it come?</label>
      <div class="chips serving" id="eserv">${['draught','can','bottle','cask'].map((v) =>
        `<button type="button" class="chip${p.serving === v ? ' chip-on' : ''}" data-serving="${v}">${v}</button>`).join('')}</div>
      <input type="hidden" id="eservval" value="${esc(p.serving || '')}">
    </div>
    <div class="field">
      <label for="etags">Tags</label>
      <input id="etags" maxlength="200" autocomplete="off"
        value="${esc((p.tags || []).map((t) => t.label).join(', '))}" placeholder="with dad, session">
    </div>
    <label class="rank-toggle"><input type="checkbox" id="eagain"${p.again ? ' checked' : ''}> I've had this before</label>
    <div class="beer-acts" style="margin-top:14px">
      <button class="btn btn-amber" id="esave">Save changes</button>
      <button class="btn" id="ecancel">Cancel</button>
    </div>
    <p class="msg" id="emsg"></p>
  </div>`;
  li.after(row);
  bindStarRail(row);

  const sv = row.querySelector('#eservval');
  row.querySelector('#eserv').addEventListener('click', (e) => {
    const c = e.target.closest('button[data-serving]');
    if (!c) return;
    const same = sv.value === c.dataset.serving;
    sv.value = same ? '' : c.dataset.serving;
    row.querySelectorAll('#eserv .chip').forEach((x) => x.classList.toggle('chip-on', !same && x === c));
  });

  row.querySelector('#ecancel').addEventListener('click', () => row.remove());
  row.querySelector('#esave').addEventListener('click', async () => {
    const msg = row.querySelector('#emsg');
    msg.className = 'msg'; msg.textContent = 'saving…';
    try {
      await api.editPour(p.id, {
        rating: row.querySelector('#rating').value,
        note: row.querySelector('#enote').value,
        drunkOn: row.querySelector('#edate').value,
        venue: row.querySelector('#evenue').value,
        serving: sv.value,
        again: row.querySelector('#eagain').checked,
        tags: row.querySelector('#etags').value,
      });
      go(`/@${handle}`);
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  });
}

async function viewBeer(brewerySlug, beerSlug) {
  loading();
  let data;
  try { data = await api.beer(brewerySlug, beerSlug); } catch (err) { return oops(err.message); }
  const { beer, stats, histogram, pours } = data;

  const counts = Array.from({ length: 10 }, (_, i) =>
    histogram.find((h) => h.rating === i + 1)?.n || 0);
  const peak = Math.max(1, ...counts);
  const style = findStyle(beer.style);

  app.innerHTML = `<div class="wrap">
    ${beer.photoKey ? `<div class="hero-shot">${photoImg(beer.photoKey)}</div>` : ''}
    <section class="hero">
      <p class="kicker"><a href="/brewery/${esc(beer.brewerySlug)}">${esc(beer.brewery)}</a>${
        beer.country ? ` · ${esc(beer.country)}` : ''}</p>
      <h2>${esc(beer.name)}</h2>
      <p>${beer.style
          ? `<a href="/style/${encodeURIComponent(beer.style)}">${esc(beer.style)}</a>`
          : 'Type of beer not recorded'}${beer.abv ? ` · ${esc(String(beer.abv))}% ABV` : ''}
        ${style ? `<br><span class="head-note">${esc(style.family)} · ${esc(style.origin)} · usually ${style.abvLow}–${style.abvHigh}%</span>` : ''}</p>
    </section>

    <div class="tiles">
      ${tile('average', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.rated ? `${plural(stats.rated, 'rating')}` : 'no ratings yet')}
      ${tile('logged', stats.pours ?? 0)}
      ${tile('people', stats.drinkers ?? 0)}
      ${tile('likes', stats.likes ?? 0)}
      ${tile('want to try', stats.wants ?? 0)}
    </div>

    ${stats.rated ? `<section class="block">
      ${blockHead('Ratings')}
      <div class="panel">
        <div class="hist">${counts.map((n, i) =>
          `<div class="col${n ? '' : ' nil'}" style="height:${Math.round((n / peak) * 100)}%"
            title="${outOfFive(i + 1)}★ — ${plural(n, 'pour')}"></div>`).join('')}</div>
        <div class="hist-axis"><span>0.5★</span><span>2.5★</span><span>5★</span></div>
      </div>
    </section>` : ''}

    <section class="block">
      ${blockHead('Reviews', pours.length ? plural(pours.length, 'entry', 'entries') : '')}
      ${pours.length
        ? `<ul class="pours reviews">${pours.map((p) => `${pourRow({
            ...p, beer: beer.name, beer_slug: beer.slug,
            brewery: beer.brewery, brewery_slug: beer.brewerySlug,
          }, { who: true })}
          <li class="revfoot" data-pour="${p.id}">
            <button class="revlike${p.liked ? ' on' : ''}" data-like="${p.id}" data-on="${p.liked ? '1' : '0'}"
              ${state.me?.handle ? '' : 'disabled'}>
              <span class="ic">${p.liked ? '♥' : '♡'}</span> <span class="ct">${p.likes || 0}</span>
            </button>
            <button class="revcom" data-comments="${p.id}">${
              p.comments ? plural(p.comments, 'comment') : 'Comment'}</button>
            <span class="thread" id="thread-${p.id}" hidden></span>
          </li>`).join('')}</ul>`
        : '<div class="empty"><p>No reviews yet.</p></div>'}
    </section>

    <div class="beer-acts">
      ${state.me ? `<a class="btn btn-amber" href="/log?brewery=${
        encodeURIComponent(beer.brewery)}&beer=${encodeURIComponent(beer.name)}&style=${
        encodeURIComponent(beer.style || '')}${beer.abv ? `&abv=${beer.abv}` : ''}">Log this beer</a>` : ''}
      ${state.me?.handle ? `
        <button class="btn mark${data.viewer.liked ? ' on' : ''}" id="likeBtn"
          data-on="${data.viewer.liked ? '1' : '0'}">
          <span class="ic">${data.viewer.liked ? '♥' : '♡'}</span> <span class="lbl">${
            data.viewer.liked ? 'Liked' : 'Like'}</span></button>
        <button class="btn mark${data.viewer.wants ? ' on' : ''}" id="wantBtn"
          data-on="${data.viewer.wants ? '1' : '0'}">
          <span class="ic">${data.viewer.wants ? '✓' : '+'}</span> <span class="lbl">${
            data.viewer.wants ? 'On your list' : 'Want to try'}</span></button>
        <button class="btn" id="addList">Add to a list</button>
        <button class="btn" id="favBtn">Pin to favourites</button>` : ''}
    </div>
    <p class="msg" id="actMsg"></p>
    <div id="listPicker"></div>
  </div>`;

  app.querySelector('#addList')?.addEventListener('click', () =>
    openListPicker(app.querySelector('#listPicker'), beer));

  // A rating says how good it was. The heart says whether you love it. The list
  // says you mean to try it. Three different questions, so three controls.
  const bindMark = (id, kind, on_, off_) => {
    const b = app.querySelector(id);
    b?.addEventListener('click', async () => {
      const on = b.dataset.on === '1';
      b.disabled = true;
      try {
        await api.mark(kind, beer.brewerySlug, beer.slug, !on);
        b.dataset.on = on ? '0' : '1';
        b.classList.toggle('on', !on);
        b.querySelector('.ic').textContent = on ? off_[0] : on_[0];
        b.querySelector('.lbl').textContent = on ? off_[1] : on_[1];
      } catch (err) { say(err.message, true); } finally { b.disabled = false; }
    });
  };
  bindMark('#likeBtn', 'like', ['♥', 'Liked'], ['♡', 'Like']);
  bindMark('#wantBtn', 'want', ['✓', 'On your list'], ['+', 'Want to try']);

  app.querySelector('#favBtn')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const res = await api.fav(beer.brewerySlug, beer.slug, true);
      b.textContent = `Pinned (${res.favourites.length}/4)`;
      b.classList.add('on');
      say(`Pinned to your favourites (${res.favourites.length} of 4).`);
    } catch (err) { say(err.message, true); } finally { b.disabled = false; }
  });

  bindReviewSocial(app, data.pours);
}

// Beer-page feedback in the page, not a browser dialog. The favourites cap
// returns a 409 with a real sentence in it, and an alert() either interrupts or
// — in some contexts — is swallowed entirely, so the click looks like a no-op.
function say(text, isError = false) {
  const el = document.getElementById('actMsg');
  if (!el) return;
  el.className = `msg ${isError ? 'err' : 'ok'}`;
  el.textContent = text;
}

// Pick an existing list or make one on the spot — a beer you want to remember
// shouldn't require a detour through another page first.
async function openListPicker(host, beer) {
  host.innerHTML = '<p class="loading">fetching your lists…</p>';
  let mine = [];
  try { mine = (await api.lists(state.me.handle)).lists; } catch { /* new drinker, no lists */ }

  host.innerHTML = `<div class="panel picker">
    <h4>Add “${esc(beer.name)}” to</h4>
    ${mine.length ? `<div class="chips">${mine.map((l) =>
      `<button class="chip" data-list="${l.id}">${esc(l.title)}<span class="n">${l.items}</span></button>`
    ).join('')}</div>` : '<p class="hint">No lists yet — name one below.</p>'}
    <form id="newList" class="picker-new">
      <input id="ltitle" placeholder="New list — e.g. Best stouts of 2026" maxlength="80" required>
      <button class="btn btn-amber" type="submit">Create &amp; add</button>
    </form>
    <p class="msg" id="pmsg"></p>
  </div>`;

  const pmsg = host.querySelector('#pmsg');
  const attach = async (listId) => {
    pmsg.className = 'msg'; pmsg.textContent = 'adding…';
    try {
      await api.addToList(listId, { brewerySlug: beer.brewerySlug, beerSlug: beer.slug });
      pmsg.className = 'msg ok'; pmsg.textContent = 'added.';
    } catch (err) { pmsg.className = 'msg err'; pmsg.textContent = err.message; }
  };

  host.querySelector('.chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-list]');
    if (b) attach(Number(b.dataset.list));
  });
  host.querySelector('#newList').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = host.querySelector('#ltitle').value.trim();
    if (!title) return;
    pmsg.className = 'msg'; pmsg.textContent = 'creating…';
    try {
      const list = await api.createList({ title });
      await attach(list.id);
    } catch (err) { pmsg.className = 'msg err'; pmsg.textContent = err.message; }
  });
}

async function viewRecent() {
  loading();
  let data;
  try { data = await api.recent(); } catch (err) { return oops(err.message); }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Everyone</h2>
      <p>The last forty beers logged on Draught.</p></section>
    <section class="block">
      ${data.pours.length
        ? `<ul class="pours">${data.pours.map((p) => pourRow(p, { who: true })).join('')}</ul>`
        : `<div class="empty"><p>Nothing logged yet. Be the first.</p>
            ${state.me ? '<a class="btn btn-amber" href="/log">Log a beer</a>' : ''}</div>`}
    </section>
  </div>`;
}

function viewSettings() {
  if (!state.me) return viewLanding();
  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Settings</h2></section>
    <section class="block"><div class="panel" style="max-width:520px">
      <form id="sform">
        <div class="field">
          <label for="name">Display name</label>
          <input id="name" name="name" maxlength="60" value="${esc(state.me.name || '')}">
        </div>
        <div class="field">
          <label for="bio">Bio</label>
          <textarea id="bio" name="bio" maxlength="240">${esc(state.me.bio || '')}</textarea>
          <p class="hint">240 characters. Shown on your profile.</p>
        </div>
        <div class="field">
          <label>Handle</label>
          <input value="@${esc(state.me.handle || '')}" disabled>
          <p class="hint">Handles are permanent for now.</p>
        </div>
        <button class="btn btn-amber" type="submit">Save</button>
        <p class="msg" id="msg"></p>
      </form>
    </div></section>

    <section class="block">
      ${blockHead('Account')}
      <div class="panel" style="max-width:520px">
        <p class="hint" style="margin:0 0 12px">Signed in as <strong>@${esc(state.me.handle || '')}</strong>.</p>
        <button class="btn" id="signout">Sign out</button>
      </div>
    </section>

    <section class="block">
      ${blockHead('Delete account')}
      <div class="panel danger" style="max-width:520px">
        <p>Deleting your account removes your handle, pours, notes, photos, lists and
          follows — the photo files as well, not just the rows. It cannot be undone.</p>
        <p class="hint">Breweries and beers stay, because other people's pours point at
          them. <a href="/privacy">What Draught knows</a>.</p>
        <button class="btn btn-danger" id="nuke">Delete my account</button>
        <p class="msg" id="dmsg"></p>
      </div>
    </section></div>`;

  const form = app.querySelector('#sform');
  const msg = app.querySelector('#msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'msg'; msg.textContent = 'saving…';
    try {
      await api.saveProfile({ name: form.name.value, bio: form.bio.value });
      state.me.name = form.name.value.trim();
      state.me.bio = form.bio.value.trim();
      msg.className = 'msg ok'; msg.textContent = 'saved.';
    } catch (err) {
      msg.className = 'msg err'; msg.textContent = err.message;
    }
  });

  // Deliberate friction: typing the handle is the difference between a misclick
  // and a decision, and this one erases photos that cannot come back.
  app.querySelector('#signout')?.addEventListener('click', async () => {
    await api.logout().catch(() => {});
    state.me = null; state.stats = null;
    go('/');
  });

  app.querySelector('#nuke')?.addEventListener('click', async () => {
    const dmsg = app.querySelector('#dmsg');
    const typed = prompt(`This erases everything. Type your handle (${state.me.handle}) to confirm.`);
    if (typed !== state.me.handle) {
      if (typed !== null) {
        dmsg.className = 'msg err';
        dmsg.textContent = "That didn't match — nothing was deleted.";
      }
      return;
    }
    dmsg.className = 'msg'; dmsg.textContent = 'erasing…';
    try {
      await api.deleteAccount();
      state.me = null; state.stats = null;
      go('/');
    } catch (err) { dmsg.className = 'msg err'; dmsg.textContent = err.message; }
  });
}

async function viewFeed() {
  if (!state.me) return viewLanding();
  if (!state.me.handle) return go('/welcome', { replace: true });
  loading();
  let data;
  try { data = await api.feed(); } catch (err) { return oops(err.message); }

  const empty = !data.pours.length;
  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Following</h2>
      <p>${data.following
        ? `Beers logged by the ${plural(data.following, 'person', 'people')} you follow, and by you.`
        : 'Follow someone and the beers they log will show up here.'}</p></section>
    <section class="block">
      ${empty
        ? `<div class="empty">
            <p>${data.following ? 'Nothing new yet.' : 'You are not following anyone yet.'}</p>
            <a class="btn btn-amber" href="/recent">See what everyone's drinking</a>
            <a class="btn" href="/log">Log a beer</a>
          </div>`
        : `<ul class="pours">${data.pours.map((p) => pourRow(p, { who: true })).join('')}</ul>`}
    </section>
  </div>`;
}

async function viewPeople(handle, dir) {
  loading();
  let data;
  try { data = await api.people(handle, dir); } catch (err) { return oops(err.message); }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">@${esc(handle)}</p>
      <h2>${dir === 'followers' ? 'Followers' : 'Following'}</h2></section>
    <section class="block">
      ${data.people.length
        ? `<div class="folk">${data.people.map((u) => `
            <a class="fcard" href="/@${esc(u.handle)}">
              ${u.avatar
                ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">`
                : '<img src="/assets/favicon.svg" alt="">'}
              <span><span class="fn">${esc(u.name || u.handle)}</span>
              <span class="fh">@${esc(u.handle)}</span></span>
            </a>`).join('')}</div>`
        : `<div class="empty"><p>Nobody yet.</p></div>`}
    </section>
  </div>`;
}

async function viewUserLists(handle) {
  loading();
  let data;
  try { data = await api.lists(handle); } catch (err) { return oops(err.message); }
  const mine = state.me?.handle === data.handle;

  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">@${esc(data.handle)}</p>
      <h2>Lists</h2></section>
    ${mine ? `<section class="block"><form id="newList" class="picker-new">
        <input id="ltitle" placeholder="New list — e.g. Best stouts of 2026" maxlength="80" required>
        <label class="rank-toggle"><input type="checkbox" id="lranked"> ranked</label>
        <button class="btn btn-amber" type="submit">Create</button>
      </form><p class="msg" id="msg"></p></section>` : ''}
    <section class="block">
      ${data.lists.length
        ? `<div class="lists">${data.lists.map((l) => listCard(l, data.handle)).join('')}</div>`
        : `<div class="empty"><p>${mine ? 'No lists yet.' : 'No lists here.'}</p></div>`}
    </section>
  </div>`;

  app.querySelector('#newList')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = app.querySelector('#msg');
    msg.className = 'msg'; msg.textContent = 'creating…';
    try {
      const list = await api.createList({
        title: app.querySelector('#ltitle').value,
        ranked: app.querySelector('#lranked').checked,
      });
      go(`/@${data.handle}/list/${list.slug}`);
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  });
}

async function viewList(handle, slug) {
  loading();
  let data;
  try { data = await api.list(handle, slug); } catch (err) { return oops(err.message); }
  const { list, items } = data;
  const mine = state.me?.handle === list.owner.handle;

  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <p class="kicker"><a href="/@${esc(list.owner.handle)}">@${esc(list.owner.handle)}</a>${
        list.ranked ? ' · ranked' : ''}</p>
      <h2>${esc(list.title)}</h2>
      ${list.description ? `<p>${esc(list.description)}</p>` : ''}
    </section>
    <section class="block">
      ${blockHead('Beers', plural(items.length, 'beer'))}
      ${items.length
        ? `<ol class="litems${list.ranked ? ' ranked' : ''}" id="litems">${items.map((it, i) => `
            <li>
              ${list.ranked ? `<span class="pos">${i + 1}</span>` : ''}
              <a class="ithumb" href="/b/${encodeURIComponent(it.brewery_slug)}/${encodeURIComponent(it.beer_slug)}">${
                it.photo_key ? photoImg(it.photo_key) : '<span class="ithumb-none">▤</span>'}</a>
              <span class="it">
                <a class="beer" href="/b/${encodeURIComponent(it.brewery_slug)}/${encodeURIComponent(it.beer_slug)}">${esc(it.beer)}</a>
                <span class="by">· ${esc(it.brewery)}</span>
                <span class="meta">${esc([it.style, it.abv ? `${it.abv}%` : ''].filter(Boolean).join(' · '))}</span>
                ${it.note ? `<span class="inote">${esc(it.note)}</span>` : ''}
              </span>
              <span class="r"><span class="stars">${stars(it.avg ? Math.round(it.avg) : null)}</span>
              ${mine ? `<span class="rowacts">${list.ranked ? `
                  <button class="kill" data-up="${it.beer_id}"${i === 0 ? ' disabled' : ''} title="Move up">↑</button>
                  <button class="kill" data-down="${it.beer_id}"${i === items.length - 1 ? ' disabled' : ''} title="Move down">↓</button>` : ''}
                <button class="kill" data-drop="${it.beer_id}">remove</button></span>` : ''}</span>
            </li>`).join('')}</ol>`
        : `<div class="empty"><p>Nothing on this list yet.</p>
            ${mine ? '<p class="hint">Open any beer and choose “Add to a list”.</p>' : ''}</div>`}
    </section>
    ${mine ? `<div class="beer-acts">
      <button class="btn" id="editList">Edit list</button>
      <button class="btn btn-danger" id="delList">Delete list</button>
    </div>
    <div id="editPanel" hidden>
      <div class="panel" style="max-width:520px;margin-top:14px">
        <div class="field">
          <label for="etitle">Title</label>
          <input id="etitle" maxlength="80" value="${esc(list.title)}">
        </div>
        <div class="field">
          <label for="edesc">Description</label>
          <textarea id="edesc" maxlength="1000">${esc(list.description || '')}</textarea>
        </div>
        <label class="rank-toggle"><input type="checkbox" id="eranked"${list.ranked ? ' checked' : ''}> Ranked list</label>
        <p class="hint">A ranked list shows positions, and you can reorder it above.</p>
        <button class="btn btn-amber" id="saveList" style="margin-top:12px">Save</button>
        <p class="msg" id="emsg"></p>
      </div>
    </div>` : ''}
  </div>`;

  if (!mine) return;

  app.querySelector('#litems')?.addEventListener('click', async (e) => {
    const drop = e.target.closest('button[data-drop]');
    if (drop) {
      drop.disabled = true;
      try {
        await api.removeFromList(list.id, drop.dataset.drop);
        drop.closest('li').remove();
      } catch { drop.disabled = false; }
      return;
    }
    // Reordering a ranked list: swap with the neighbour and send the whole
    // order, which is what the endpoint expects.
    const move = e.target.closest('button[data-up], button[data-down]');
    if (!move) return;
    const up = move.hasAttribute('data-up');
    const id = Number(up ? move.dataset.up : move.dataset.down);
    const order = items.map((it) => it.beer_id);
    const at = order.indexOf(id);
    const to = up ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    move.disabled = true;
    try {
      await api.reorderList(list.id, order);
      viewList(handle, slug);            // redraw with the new positions
    } catch (err) { move.disabled = false; alert(err.message); }
  });

  const editBtn = app.querySelector('#editList');
  const panel = app.querySelector('#editPanel');
  editBtn?.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    editBtn.textContent = panel.hidden ? 'Edit list' : 'Cancel';
  });
  app.querySelector('#saveList')?.addEventListener('click', async () => {
    const emsg = app.querySelector('#emsg');
    emsg.className = 'msg'; emsg.textContent = 'saving…';
    try {
      await api.updateList(list.id, {
        title: app.querySelector('#etitle').value,
        description: app.querySelector('#edesc').value,
        ranked: app.querySelector('#eranked').checked,
      });
      viewList(handle, slug);
    } catch (err) { emsg.className = 'msg err'; emsg.textContent = err.message; }
  });
  app.querySelector('#delList')?.addEventListener('click', async () => {
    if (!confirm(`Delete “${list.title}”? The beers stay, the list goes.`)) return;
    try {
      await api.deleteList(list.id);
      go(`/@${list.owner.handle}/lists`);
    } catch (err) { alert(err.message); }
  });
}

async function viewAllLists() {
  loading();
  let data;
  try { data = await api.recentLists(); } catch (err) { return oops(err.message); }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Lists</h2>
      <p>Collections and rankings from everyone on Draught.</p></section>
    <section class="block">
      ${data.lists.length
        ? `<div class="lists">${data.lists.map((l) => `
            <a class="lcard" href="/@${esc(l.handle)}/list/${esc(l.slug)}">
              <span class="lcover"><span class="lcover-none">▤</span></span>
              <span class="lmeta">
                <span class="lt">${esc(l.title)}${l.ranked ? '<span class="rank">ranked</span>' : ''}</span>
                <span class="ln">${plural(l.items, 'beer')} · @${esc(l.handle)}</span>
              </span></a>`).join('')}</div>`
        : `<div class="empty"><p>No lists yet. Make the first one.</p>
            ${state.me?.handle ? `<a class="btn btn-amber" href="/@${esc(state.me.handle)}/lists">Start a list</a>` : ''}</div>`}
    </section>
  </div>`;
}

function viewPrivacy() {
  app.innerHTML = `<div class="wrap prose">
    <section class="hero"><h2>Privacy</h2>
      <p>Written to be read, not to be survived. If anything below is unclear,
        that's a bug in the writing — say so.</p></section>

    <section class="block">
      ${blockHead('the short version')}
      <p>Draught stores the beer you log and the handle you chose. It never learns
        your email address, never sets a tracking cookie, and runs no analytics.
        Your pours are public, because a shared record per beer is the entire point.</p>
    </section>

    <section class="block">
      ${blockHead('what is stored')}
      <table class="tbl">
        <tr><th>Your account</th><td>A handle, a display name, an avatar URL, and an
          optional bio. Plus an opaque account id from Google — <strong>not your email
          address</strong>, which Draught neither asks for nor keeps.</td></tr>
        <tr><th>Your pours</th><td>Beer, brewery, style, ABV, your half-star rating,
          your notes, the date, the serving, the venue if you typed one, and any photo
          you attached.</td></tr>
        <tr><th>Lists and follows</th><td>List titles, descriptions, the beers on them,
          and who you follow.</td></tr>
        <tr><th>Your session</th><td>One cookie, <code>dr_sess</code>. It is
          <code>HttpOnly</code> and <code>SameSite=Lax</code>, holds a random token and
          nothing about you, and only its hash is stored server-side. There are no other
          cookies of any kind.</td></tr>
      </table>
    </section>

    <section class="block">
      ${blockHead('what is public')}
      <p>Your handle, display name, avatar, bio, pours, notes, photos, lists, and who
        you follow — all visible to anyone, signed in or not, at
        <code>/@yourhandle</code>. Assume anything you log can be read by anyone and
        indexed by search engines. There is no private mode; if that doesn't suit you,
        Draught is the wrong tool.</p>
    </section>

    <section class="block">
      ${blockHead('where you drank')}
      <p>Attaching a venue is optional, and pinning its coordinates is a separate,
        deliberate tap. What that publishes:</p>
      <table class="tbl">
        <tr><th>Venues are shared</th><td>A venue is a public place, like a brewery —
          pin it once and everyone logging there gets the same dot. Its coordinates are
          public and permanent.</td></tr>
        <tr><th>Coarse on purpose</th><td>Coordinates are rounded to about 11 metres
          before they are stored. Enough to place a bar on a street; not a flat within
          a building.</td></tr>
        <tr><th>Private-sounding names get no pin</th><td>Anything called “home”, “my
          flat”, “office” and the like is stored <strong>without coordinates at all</strong>,
          whatever your device reported. You can't accidentally publish your address by
          pinning the sofa.</td></tr>
        <tr><th>Keep off the map</th><td>Any pour can be marked so it never appears on a
          public map, while still showing on your own shelf.</td></tr>
      </table>
      <p>Your device is only ever asked for its location when you tap
        <strong>Pin this spot</strong>. Draught does no background location tracking and
        cannot see where you are otherwise.</p>
    </section>

    <section class="block">
      ${blockHead('photos and location')}
      <p>Phone cameras bury GPS coordinates inside photo files. Draught resizes and
        re-encodes every photo <strong>in your browser before it uploads</strong>, which
        strips that metadata along with the rest of the EXIF block. A label shot taken at
        home does not publish where you live. The photo itself is public.</p>
    </section>

    <section class="block">
      ${blockHead('who else sees anything')}
      <table class="tbl">
        <tr><th>Google</th><td>Only when you sign in. Draught asks for the minimum —
          <code>openid</code>, <code>email</code>, <code>profile</code> — and keeps only
          the opaque id, your name and your avatar.</td></tr>
        <tr><th>Open Brewery DB</th><td>When you type a brewery name, that text goes to
          their public API to find matches. They see a search string with no identity
          attached to it.</td></tr>
        <tr><th>Cloudflare</th><td>Hosts the site, the database and the photos, and keeps
          ordinary web server logs.</td></tr>
      </table>
      <p>Nothing is sold, shared for advertising, or handed to a data broker. There are
        no third-party scripts on any page — no tag managers, no pixels, not even fonts
        loaded from somewhere else.</p>
    </section>

    <section class="block">
      ${blockHead('deleting it')}
      <p>Go to <a href="/settings">Settings</a> and delete your account. It removes your
        identity, pours, notes, photos, lists and follows immediately — the photo files
        too, not just the rows pointing at them.</p>
      <p>Breweries and beers themselves stay, because other people's pours point at them
        and removing a beer would damage their shelves. Nothing left behind identifies
        you.</p>
    </section>

    <section class="block">
      ${blockHead('one caveat, honestly')}
      <p>Draught is a personal project, not a company. It has no dedicated security team
        and offers no uptime guarantee. It holds nothing more sensitive than opinions
        about beer, and is built so that a breach could not reveal an email address —
        because there are none to reveal. Judge it on that basis.</p>
    </section>
  </div>`;
}

let WORLD_CACHE = null;

async function viewMap() {
  loading();
  const scope = new URLSearchParams(location.search).get('scope')
    || (state.me?.handle ? 'following' : 'all');

  // The map paths are 75 KB — only pulled in for the page that draws them.
  if (!WORLD_CACHE) {
    try { WORLD_CACHE = await import('./worldmap.js'); }
    catch { return oops('The map failed to load.'); }
  }
  const { WORLD, WORLD_VIEW } = WORLD_CACHE;
  const { project } = await import('./geo.js');

  let data;
  try { data = await api.map(scope); }
  catch (err) { return oops(err.message); }

  const countries = Object.entries(WORLD)
    .map(([name, d]) => `<path d="${d}" data-c="${esc(name)}"></path>`).join('');
  const svg = mapSvg(data.venues, project, WORLD_VIEW).replace('<!--countries-->',
    `<g class="land">${countries}</g>`);

  const tab = (key, label) =>
    `<a class="chip${scope === key ? ' chip-on' : ''}" href="/map?scope=${key}">${label}</a>`;

  const top = [...data.venues].sort((a, b) => b.pours - a.pours).slice(0, 12);

  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Map</h2>
      <p>${scope === 'following'
        ? 'Places you and the people you follow have logged a beer.'
        : scope === 'all' ? 'Every pinned venue on Draught.'
        : `Places @${esc(scope)} has logged a beer.`}</p></section>

    <div class="chips maptabs">
      ${state.me?.handle ? tab('following', 'Your people') : ''}
      ${tab('all', 'Everyone')}
      ${state.me?.handle ? tab(state.me.handle, 'Just you') : ''}
    </div>

    <section class="block">
      ${data.venues.length
        ? `<div class="mapwrap" id="mapwrap"><div id="glmap"></div>
            <noscript>${svg}</noscript></div>
           <p class="mapnote" id="mapnote">loading the basemap…</p>`
        : `<div class="empty"><p>No pinned venues yet.</p>
            <p class="hint">Log a beer, tap <strong>Pin this spot</strong>, and it lands here.</p>
            ${state.me ? '<a class="btn btn-amber" href="/log">Log a beer</a>' : ''}</div>`}
    </section>

    ${top.length ? `<section class="block">
      ${blockHead('Top venues', plural(data.venues.length, 'place'))}
      <ul class="tally">${top.map((v, i) => `
        <li><span class="n">${i + 1}</span>
          <span class="name">${esc(v.name)}${
            v.city || v.country ? `<span class="extra"> ${esc([v.city, v.country].filter(Boolean).join(', '))}</span>` : ''}
            ${v.handles.length ? `<span class="extra"> · ${v.handles.slice(0, 4).map((h) =>
              `<a href="/@${esc(h)}">@${esc(h)}</a>`).join(' ')}${
              v.handles.length > 4 ? ` +${v.handles.length - 4}` : ''}</span>` : ''}</span>
          <span class="count">${v.pours}</span></li>`).join('')}</ul>
    </section>` : ''}

    ${data.origins.length ? `<section class="block">
      ${blockHead('Countries')}
      <div class="chips">${data.origins.slice(0, 20).map((o) =>
        `<span class="chip">${esc(o.country)}<span class="n">${o.pours}</span></span>`).join('')}</div>
    </section>` : ''}
  </div>`;

  if (data.venues.length) await drawGlMap(data.venues, svg);
}

// The real map: MapLibre over our own PMTiles archive. ~1 MB of library, so it
// is imported only here and only when there is something to show. If any of it
// fails — old browser, no WebGL, archive unreachable — the hand-rolled SVG world
// map is swapped in instead, because a broken map is worse than a coarse one.
async function drawGlMap(venues, svgFallback) {
  const host = document.getElementById('glmap');
  const note = document.getElementById('mapnote');
  const giveUp = (why) => {
    document.getElementById('mapwrap').innerHTML = svgFallback;
    if (note) note.textContent = `${why} — showing the simple world map instead.`;
  };
  if (!host) return;

  try {
    if (!window.maplibregl) await loadScript('/assets/vendor/maplibre-gl.js');
    if (!window.pmtiles) await loadScript('/assets/vendor/pmtiles.js');
    if (!window.maplibregl || !window.pmtiles) return giveUp('The map library did not load');
    // MapLibre removed `supported()` in v5, and `maplibregl.supported?.()` there
    // evaluates to undefined — i.e. always falsy — which silently sent every
    // visitor to the fallback. Test the actual capability instead.
    if (!hasWebGl()) return giveUp('This browser cannot draw the map');

    // Teach MapLibre to read pmtiles: URLs, once per page.
    if (!window.__pmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
      window.__pmtilesRegistered = true;
    }

    const { style } = await import('./mapstyle.js');
    const map = new maplibregl.Map({
      container: host,
      style: style('world.pmtiles'),
      // The archive stops at z7; MapLibre keeps drawing past it by scaling the
      // vectors, which stays sharp — you just stop gaining smaller streets.
      maxZoom: 15,
      attributionControl: { compact: true },
      ...fitTo(venues),
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => { if (String(e?.error?.message || '').includes('pmtiles')) giveUp('The basemap failed to load'); });

    // If the map never finishes, don't leave "loading the basemap…" on screen
    // forever — swap in the SVG. Only start counting once the tab is actually
    // visible: MapLibre draws on requestAnimationFrame, which browsers freeze in
    // background tabs, so a hidden tab is stalled rather than broken.
    let settled = false;
    const armTimeout = () => setTimeout(() => {
      if (!settled) giveUp('The map is taking too long');
    }, 12000);
    if (document.visibilityState === 'visible') armTimeout();
    else document.addEventListener('visibilitychange', function once() {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', once);
      armTimeout();
    });

    map.on('load', () => {
      settled = true;
      note?.remove();
      const max = Math.max(1, ...venues.map((v) => v.pours));
      for (const v of venues) {
        const el = document.createElement('button');
        el.className = 'glpin';
        el.type = 'button';
        const size = 12 + 16 * Math.sqrt(v.pours / max);
        el.style.width = el.style.height = `${size}px`;
        el.title = `${[v.name, v.city, v.country].filter(Boolean).join(', ')} — ${plural(v.pours, 'pour')}`;
        el.addEventListener('click', () => {
          new maplibregl.Popup({ offset: 12, closeButton: false })
            .setLngLat([v.lon, v.lat])
            .setHTML(`<strong>${esc(v.name)}</strong>
              ${v.city || v.country ? `<span>${esc([v.city, v.country].filter(Boolean).join(', '))}</span>` : ''}
              <span>${plural(v.pours, 'pour')}${v.avg ? ` · ${outOfFive(v.avg)}★ mean` : ''}</span>
              ${v.handles.length ? `<span>${v.handles.slice(0, 5).map((h) =>
                `<a href="/@${esc(h)}">@${esc(h)}</a>`).join(' ')}</span>` : ''}`)
            .addTo(map);
        });
        new maplibregl.Marker({ element: el }).setLngLat([v.lon, v.lat]).addTo(map);
      }
    });
  } catch {
    giveUp('The map could not start');
  }
}

// Frame the pins: one venue gets a city-level view, several get their bounding
// box with room to breathe.
function fitTo(venues) {
  if (venues.length === 1) return { center: [venues[0].lon, venues[0].lat], zoom: 6 };
  const lons = venues.map((v) => v.lon), lats = venues.map((v) => v.lat);
  return {
    bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    fitBoundsOptions: { padding: 60, maxZoom: 7 },
  };
}

function hasWebGl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function viewSearch() {
  const q = (new URLSearchParams(location.search).get('q') || '').trim();
  if (!q) {
    app.innerHTML = `<div class="wrap"><section class="hero"><h2>Search</h2>
      <p>Look for a beer, a brewery or a person.</p></section></div>`;
    return;
  }
  loading();
  let d;
  try { d = await api.search(q); } catch (err) { return oops(err.message); }
  const total = d.beers.length + d.breweries.length + d.people.length;

  app.innerHTML = `<div class="wrap">
    <section class="hero"><h2>Search</h2>
      <p>${total ? `${plural(total, 'result')} for “${esc(q)}”` : `Nothing found for “${esc(q)}”.`}</p></section>

    ${d.beers.length ? `<section class="block">
      ${blockHead('Beers', plural(d.beers.length, 'beer'))}
      <ul class="litems">${d.beers.map((b) => `
        <li>
          <a class="ithumb" href="/b/${encodeURIComponent(b.brewery_slug)}/${encodeURIComponent(b.slug)}">${
            b.photo_key ? photoImg(b.photo_key) : '<span class="ithumb-none">▤</span>'}</a>
          <span class="it">
            <a class="beer" href="/b/${encodeURIComponent(b.brewery_slug)}/${encodeURIComponent(b.slug)}">${esc(b.name)}</a>
            <span class="by">· <a href="/brewery/${encodeURIComponent(b.brewery_slug)}">${esc(b.brewery)}</a></span>
            <span class="meta">${esc([b.style, b.abv ? `${b.abv}%` : '',
              b.pours ? plural(b.pours, 'entry', 'entries') : 'not logged yet'].filter(Boolean).join(' · '))}</span>
          </span>
          <span class="r"><span class="stars">${stars(b.avg ? Math.round(b.avg) : null)}</span></span>
        </li>`).join('')}</ul>
    </section>` : ''}

    ${d.breweries.length ? `<section class="block">
      ${blockHead('Breweries')}
      <div class="chips">${d.breweries.map((b) =>
        `<a class="chip" href="/brewery/${encodeURIComponent(b.slug)}">${esc(b.name)}${
          b.beers ? `<span class="n">${b.beers}</span>` : ''}</a>`).join('')}</div>
    </section>` : ''}

    ${d.people.length ? `<section class="block">
      ${blockHead('People')}
      <div class="folk">${d.people.map((u) => `
        <a class="fcard" href="/@${esc(u.handle)}">
          ${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">`
                     : '<img src="/assets/favicon.svg" alt="">'}
          <span><span class="fn">${esc(u.name || u.handle)}</span>
          <span class="fh">@${esc(u.handle)} · ${plural(u.pours || 0, 'entry', 'entries')}</span></span>
        </a>`).join('')}</div>
    </section>` : ''}

    ${!total ? `<div class="empty"><p>No beer, brewery or person matches that.</p>
      ${state.me ? '<a class="btn btn-amber" href="/log">Log a beer</a>' : ''}</div>` : ''}
  </div>`;
}

async function viewBrewery(slug) {
  loading();
  let d;
  try { d = await api.brewery(slug); } catch (err) { return oops(err.message); }
  const { brewery, stats, beers } = d;

  app.innerHTML = `<div class="wrap">
    <section class="hero">
      ${brewery.city || brewery.country
        ? `<p class="kicker">${esc([brewery.city, brewery.country].filter(Boolean).join(', '))}</p>` : ''}
      <h2>${esc(brewery.name)}</h2>
    </section>

    <div class="tiles">
      ${tile('beers', stats.beers ?? 0)}
      ${tile('logged', stats.pours ?? 0)}
      ${tile('people', stats.drinkers ?? 0)}
      ${tile('average', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.avg ? 'out of 5' : 'no ratings yet')}
    </div>

    <section class="block">
      ${blockHead('Beers', plural(beers.length, 'beer'))}
      ${beers.length
        ? `<ul class="litems">${beers.map((b) => `
            <li>
              <a class="ithumb" href="/b/${encodeURIComponent(brewery.slug)}/${encodeURIComponent(b.slug)}">${
                b.photo_key ? photoImg(b.photo_key) : '<span class="ithumb-none">▤</span>'}</a>
              <span class="it">
                <a class="beer" href="/b/${encodeURIComponent(brewery.slug)}/${encodeURIComponent(b.slug)}">${esc(b.name)}</a>
                <span class="meta">${esc([b.style, b.abv ? `${b.abv}%` : '',
                  b.pours ? plural(b.pours, 'entry', 'entries') : 'not logged yet'].filter(Boolean).join(' · '))}</span>
              </span>
              <span class="r"><span class="stars">${stars(b.avg ? Math.round(b.avg) : null)}</span></span>
            </li>`).join('')}</ul>`
        : '<div class="empty"><p>Nothing logged from this brewery yet.</p></div>'}
    </section>
  </div>`;
}

async function viewStyle(name) {
  loading();
  let d;
  try { d = await api.style(name); } catch (err) { return oops(err.message); }
  const canon = findStyle(d.style);

  app.innerHTML = `<div class="wrap">
    <section class="hero">
      ${canon ? `<p class="kicker">${esc(canon.family)}</p>` : ''}
      <h2>${esc(d.style)}</h2>
      ${canon ? `<p>From ${esc(canon.origin)}. Usually ${canon.abvLow}–${canon.abvHigh}% ABV.</p>` : ''}
    </section>

    <div class="tiles">
      ${tile('beers', d.stats.beers ?? 0)}
      ${tile('logged', d.stats.pours ?? 0)}
      ${tile('people', d.stats.drinkers ?? 0)}
      ${tile('average', d.stats.avg ? `${outOfFive(d.stats.avg)}★` : '—', d.stats.avg ? 'out of 5' : 'no ratings yet')}
    </div>

    <section class="block">
      ${blockHead('Beers', plural(d.beers.length, 'beer'))}
      ${d.beers.length
        ? `<ul class="litems">${d.beers.map((b) => beerRow(b)).join('')}</ul>`
        : `<div class="empty"><p>Nobody has logged a ${esc(d.style)} yet.</p>
            ${state.me ? `<a class="btn btn-amber" href="/log?style=${encodeURIComponent(d.style)}">Be the first</a>` : ''}</div>`}
    </section>
  </div>`;
}

// Want-to-try and liked — the two shelves a rating cannot express.
async function viewShelf(handle, kind) {
  loading();
  const want = kind === 'wishlist';
  let d;
  try { d = want ? await api.wishlist(handle) : await api.likes(handle); }
  catch (err) { return oops(err.message); }
  const mine = state.me?.handle === d.handle;

  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">@${esc(d.handle)}</p>
      <h2>${want ? 'Want to try' : 'Liked'}</h2>
      <p>${want
        ? (mine ? 'Beers you have marked to try.' : `Beers @${esc(d.handle)} means to try.`)
        : (mine ? 'Beers you have liked.' : `Beers @${esc(d.handle)} likes.`)}</p></section>
    <section class="block">
      ${d.beers.length
        ? `<ul class="litems">${d.beers.map((b) => beerRow(b)).join('')}</ul>`
        : `<div class="empty"><p>Nothing here yet.</p>
            <p class="hint">Open any beer and press ${want ? '“Want to try”' : '“Like”'}.</p></div>`}
    </section>
  </div>`;
}

// Likes and comments on what people *wrote*. Liking a review is a different act
// from liking the beer — you can love the write-up of something you hated.
function bindReviewSocial(root, pours) {
  root.querySelector('.reviews')?.addEventListener('click', async (e) => {
    const like = e.target.closest('button[data-like]');
    if (like) {
      const on = like.dataset.on === '1';
      like.disabled = true;
      try {
        const res = await api.likeReview(like.dataset.like, !on);
        like.dataset.on = on ? '0' : '1';
        like.classList.toggle('on', !on);
        like.querySelector('.ic').textContent = on ? '♡' : '♥';
        like.querySelector('.ct').textContent = res.likes;
      } catch (err) { alert(err.message); } finally { like.disabled = false; }
      return;
    }

    const open = e.target.closest('button[data-comments]');
    if (!open) return;
    const id = open.dataset.comments;
    const box = root.querySelector(`#thread-${id}`);
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = '<span class="loading">loading…</span>';
    let d;
    try { d = await api.comments(id); } catch { box.innerHTML = '<span class="hint">Could not load comments.</span>'; return; }
    drawThread(box, id, d.comments);
  });
}

function drawThread(box, pourId, comments) {
  box.innerHTML = `
    ${comments.length ? `<ul class="comments">${comments.map((c) => `
      <li data-comment="${c.id}">
        <a href="/@${esc(c.handle)}">${esc(c.name || c.handle)}</a>
        <span class="cbody">${esc(c.body)}</span>
        ${state.me?.handle === c.handle ? '<button class="kill" data-del-comment="' + c.id + '">delete</button>' : ''}
      </li>`).join('')}</ul>` : '<p class="hint">No comments yet.</p>'}
    ${state.me?.handle ? `<form class="cform">
      <input name="body" maxlength="1000" placeholder="Add a comment" autocomplete="off">
      <button class="btn" type="submit">Post</button>
    </form>` : ''}`;

  box.querySelector('.cform')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.body;
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      const added = await api.addComment(pourId, text);
      drawThread(box, pourId, [...comments, added]);
      const btn = box.closest('.revfoot')?.querySelector('button[data-comments]');
      if (btn) btn.textContent = plural(comments.length + 1, 'comment');
    } catch (err) { alert(err.message); input.disabled = false; }
  });

  box.querySelector('.comments')?.addEventListener('click', async (e) => {
    const del = e.target.closest('button[data-del-comment]');
    if (!del) return;
    del.disabled = true;
    try {
      await api.deleteComment(del.dataset.delComment);
      drawThread(box, pourId, comments.filter((c) => String(c.id) !== del.dataset.delComment));
    } catch { del.disabled = false; }
  });
}

async function viewTag(name) {
  loading();
  let d;
  try { d = await api.tag(name); } catch (err) { return oops(err.message); }
  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">Tag</p>
      <h2>${esc(d.label)}</h2>
      <p>${d.pours.length ? `${plural(d.pours.length, 'entry', 'entries')} tagged “${esc(d.label)}”.`
        : 'Nothing tagged this yet.'}</p></section>
    <section class="block">
      ${d.pours.length
        ? `<ul class="pours">${d.pours.map((p) => pourRow(p, { who: true })).join('')}</ul>`
        : '<div class="empty"><p>Add tags when you log or edit an entry.</p></div>'}
    </section>
  </div>`;
}

// ---- boot ------------------------------------------------------------------

function render() {
  renderNav();
  scrollTo({ top: 0 });
  const r = parse(location.pathname);
  switch (r.view) {
    case 'home': return viewHome();
    case 'welcome': return viewWelcome();
    case 'log': return viewLog();
    case 'recent': return viewRecent();
    case 'settings': return viewSettings();
    case 'profile': return viewProfile(r.handle);
    case 'beer': return viewBeer(r.brewery, r.beer);
    case 'feed': return viewFeed();
    case 'people': return viewPeople(r.handle, r.dir);
    case 'userLists': return viewUserLists(r.handle);
    case 'list': return viewList(r.handle, r.slug);
    case 'allLists': return viewAllLists();
    case 'privacy': return viewPrivacy();
    case 'map': return viewMap();
    case 'search': return viewSearch();
    case 'style': return viewStyle(r.name);
    case 'tag': return viewTag(r.name);
    case 'shelf': return viewShelf(r.handle, r.kind);
    case 'brewery': return viewBrewery(r.slug);
    default: return oops('There is nothing at that address.');
  }
}

(async function boot() {
  try {
    const { user, stats } = await api.me();
    state.me = user;
    state.stats = stats;
  } catch {
    state.me = null;
  }
  render();
})();
