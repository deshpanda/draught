// Draught — the whole client. History routing, seven views, no framework.

import { api, uploadPhoto, imgUrl } from './api.js';
import { STYLES, FAMILIES, findStyle } from './styles.js';
import {
  esc, stars, outOfFive, fmtDate, today, plural,
  tile, blockHead, pourRow, starRail, bindStarRail, bindAutocomplete,
  prepPhoto, photoImg, followBtn, bindFollow, listCard, askLocation, mapSvg,
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
    nav.innerHTML = `<a href="/recent"${on('/recent')}>Bar</a>
      <a href="/map"${on('/map')}>Map</a>
      <a href="/lists"${on('/lists')}>Lists</a>
      <a class="cta" href="/api/auth/google" data-raw>Sign in</a>`;
    return;
  }
  const h = state.me.handle;
  nav.innerHTML = `
    <a href="/feed"${on('/feed')}>Feed</a>
    <a href="/recent"${on('/recent')}>Bar</a>
    <a href="/map"${on('/map')}>Map</a>
    <a href="/lists"${on('/lists')}>Lists</a>
    ${h ? `<a href="/@${esc(h)}"${on(`/@${h}`)}>Your shelf</a>` : ''}
    <a href="/settings"${on('/settings')}>Settings</a>
    <button id="signout">Sign out</button>
    <a class="cta" href="/log">+ Log a beer</a>`;
  nav.querySelector('#signout')?.addEventListener('click', async () => {
    await api.logout().catch(() => {});
    state.me = null; state.stats = null;
    go('/');
  });
}

const loading = () => { app.innerHTML = '<p class="loading">pouring…</p>'; };
const oops = (msg) => {
  app.innerHTML = `<div class="wrap"><div class="empty"><p>${esc(msg)}</p>
    <a class="btn" href="/">Back to the bar</a></div></div>`;
};

// ---- views -----------------------------------------------------------------

function viewLanding() {
  app.innerHTML = `<div class="wrap"><section class="gate"><div class="gate-inner">
    <p class="glass">🍺</p>
    <h1>Draught</h1>
    <p class="tag">your beer life, on draught</p>
    <p class="pitch">Log the beer you drink. Rate it, remember it, and watch your
      taste take shape — the beers, the breweries, the styles you keep coming back to.</p>
    <div class="signin">
      <a class="btn btn-amber btn-lg" href="/api/auth/google" data-raw>Continue with Google</a>
    </div>
    ${isLocal ? '<p class="fine"><a href="/api/auth/dev?as=Local%20Drinker" data-raw>dev sign-in</a> (localhost only)</p>' : ''}
    <p class="fine">Free. No ads, no badges, no streaks to keep.<br>
      Your handle and your pours are public; nothing else is.</p>

    <div class="threeup">
      <div><h4>A pour, not a check-in</h4>
        <p>Half-star ratings, a date, and room for what you actually thought.
          Notes are the point, not an afterthought.</p></div>
      <div><h4>Every beer has a page</h4>
        <p>The first person to log a beer creates its page. Everyone's ratings
          and notes gather there — one shared record per beer.</p></div>
      <div><h4>Your taste, in the open</h4>
        <p>117 styles across 13 families, from Czech pale lager to Flanders red.
          Your shelf shows which ones you actually drink.</p></div>
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
    <section class="hero"><p class="kicker">one more thing</p>
      <h2>Pick a <em>handle</em></h2>
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

function styleOptions() {
  return FAMILIES.map((fam) => {
    const inFam = STYLES.filter((s) => s.family === fam);
    return `<optgroup label="${esc(fam)}">${
      inFam.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}</option>`).join('')
    }</optgroup>`;
  }).join('');
}

function viewLog() {
  if (!state.me) return viewLanding();
  if (!state.me.handle) return go('/welcome', { replace: true });

  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">a new pour</p>
      <h2>What are you <em>drinking</em>?</h2></section>
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
        <div class="row two">
          <div class="field">
            <label for="style">Style</label>
            <select id="style" name="style"><option value="">—</option>${styleOptions()}</select>
          </div>
          <div class="field">
            <label for="abv">ABV %</label>
            <input id="abv" name="abv" type="number" step="0.1" min="0" max="70" placeholder="6.5">
            <p class="hint" id="abvHint"></p>
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
        <div class="row three">
          <div class="field">
            <label for="drunkOn">Date</label>
            <input id="drunkOn" name="drunkOn" type="date" value="${today()}" max="${today()}">
          </div>
          <div class="field">
            <label for="serving">Serving</label>
            <select id="serving" name="serving">
              <option value="">—</option><option>draught</option><option>cask</option>
              <option>can</option><option>bottle</option>
            </select>
          </div>
          <div class="field">
            <label for="venue">Where</label>
            <input id="venue" name="venue" maxlength="80"
              placeholder="Search a bar, or type any name" autocomplete="off">
            <div class="ac" id="acVenue"></div>
          </div>
        </div>
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

  // Style choice suggests the ABV band, but never overwrites a typed value.
  const styleSel = form.style;
  const abv = form.abv;
  const abvHint = app.querySelector('#abvHint');
  styleSel.addEventListener('change', () => {
    const s = findStyle(styleSel.value);
    abvHint.textContent = s ? `${s.origin} · typically ${s.abvLow}–${s.abvHigh}%` : '';
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
        serving: form.serving.value,
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
  const { user, stats, styles, pours, viewerFollows } = data;
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
        </p>
      </div>
      <span class="phead-act">
        ${mine
          ? '<a class="btn" href="/settings">Edit profile</a>'
          : (state.me ? followBtn(user.handle, viewerFollows) : '')}
      </span>
    </section>

    <div class="tiles">
      ${tile('pours', stats.pours ?? 0)}
      ${tile('distinct beers', stats.beers ?? 0)}
      ${tile('breweries', stats.breweries ?? 0)}
      ${tile('styles', stats.styles ?? 0)}
      ${tile('mean rating', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.avg ? 'of five' : 'nothing rated yet')}
    </div>

    ${pours.some((p) => p.photo_key) ? `<section class="block">
      ${blockHead('the wall', 'what they poured')}
      <div class="wall">${pours.filter((p) => p.photo_key).slice(0, 24).map((p) =>
        `<a class="wtile" href="/b/${encodeURIComponent(p.brewery_slug)}/${encodeURIComponent(p.beer_slug)}"
          title="${esc(p.beer)} — ${esc(p.brewery)}">${photoImg(p.photo_key)}</a>`).join('')}</div>
    </section>` : ''}

    ${styles.length ? `<section class="block">
      ${blockHead('the styles they drink', `${styles.length} of 117`)}
      <div class="chips">${styles.map((s) => `<span class="chip">${esc(s.style)}<span class="n">${s.n}</span></span>`).join('')}</div>
    </section>` : ''}

    <section class="block">
      ${blockHead(mine ? 'your ledger' : 'the ledger', pours.length ? plural(pours.length, 'pour') : '')}
      ${pours.length
        ? `<ul class="pours" id="ledger">${pours.map((p) => pourRow(p, { mine })).join('')}</ul>`
        : `<div class="empty"><p>${mine ? 'Nothing logged yet.' : 'This shelf is empty.'}</p>
            ${mine ? '<a class="btn btn-amber" href="/log">Log your first beer</a>' : ''}</div>`}
    </section>
  </div>`;

  bindFollow(app, api, (res) => {
    const el = app.querySelector('.social a');
    if (el) el.textContent = plural(res.followers, 'follower');
  });

  if (mine) {
    app.querySelector('#ledger')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-kill]');
      if (!btn || !confirm('Remove this pour?')) return;
      btn.disabled = true;
      try {
        await api.unpour(btn.dataset.kill);
        btn.closest('li').remove();
      } catch { btn.disabled = false; }
    });
  }
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
      <p class="kicker">${esc(beer.brewery)}${beer.country ? ` · ${esc(beer.country)}` : ''}</p>
      <h2>${esc(beer.name)}</h2>
      <p>${[beer.style, beer.abv ? `${beer.abv}% ABV` : ''].filter(Boolean).map(esc).join(' · ') || 'Style unrecorded.'}
        ${style ? `<br><span class="head-note">${esc(style.family)} · ${esc(style.origin)} · typically ${style.abvLow}–${style.abvHigh}%</span>` : ''}</p>
    </section>

    <div class="tiles">
      ${tile('mean rating', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.rated ? `${plural(stats.rated, 'rating')}` : 'unrated so far')}
      ${tile('pours', stats.pours ?? 0)}
      ${tile('drinkers', stats.drinkers ?? 0)}
    </div>

    ${stats.rated ? `<section class="block">
      ${blockHead('how it rates', 'half-stars, 0.5 to 5')}
      <div class="panel">
        <div class="hist">${counts.map((n, i) =>
          `<div class="col${n ? '' : ' nil'}" style="height:${Math.round((n / peak) * 100)}%"
            title="${outOfFive(i + 1)}★ — ${plural(n, 'pour')}"></div>`).join('')}</div>
        <div class="hist-axis"><span>0.5★</span><span>2.5★</span><span>5★</span></div>
      </div>
    </section>` : ''}

    <section class="block">
      ${blockHead('the margins', pours.length ? plural(pours.length, 'pour') : '')}
      ${pours.length
        ? `<ul class="pours">${pours.map((p) => pourRow({
            ...p, beer: beer.name, beer_slug: beer.slug,
            brewery: beer.brewery, brewery_slug: beer.brewerySlug,
          }, { who: true })).join('')}</ul>`
        : '<div class="empty"><p>Nobody has written anything down yet.</p></div>'}
    </section>

    <div class="beer-acts">
      ${state.me ? `<a class="btn btn-amber" href="/log">Log this beer</a>` : ''}
      ${state.me?.handle ? '<button class="btn" id="addList">Add to a list</button>' : ''}
    </div>
    <div id="listPicker"></div>
  </div>`;

  app.querySelector('#addList')?.addEventListener('click', () =>
    openListPicker(app.querySelector('#listPicker'), beer));
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
    <section class="hero"><p class="kicker">the bar</p>
      <h2>What people are <em>drinking</em></h2>
      <p>The last forty pours logged on Draught.</p></section>
    <section class="block">
      ${data.pours.length
        ? `<ul class="pours">${data.pours.map((p) => pourRow(p, { who: true })).join('')}</ul>`
        : `<div class="empty"><p>Nothing poured yet. Be the first.</p>
            ${state.me ? '<a class="btn btn-amber" href="/log">Log a beer</a>' : ''}</div>`}
    </section>
  </div>`;
}

function viewSettings() {
  if (!state.me) return viewLanding();
  app.innerHTML = `<div class="wrap">
    <section class="hero"><p class="kicker">settings</p><h2>Your <em>account</em></h2></section>
    <section class="block"><div class="panel" style="max-width:520px">
      <form id="sform">
        <div class="field">
          <label for="name">Display name</label>
          <input id="name" name="name" maxlength="60" value="${esc(state.me.name || '')}">
        </div>
        <div class="field">
          <label for="bio">Bio</label>
          <textarea id="bio" name="bio" maxlength="240">${esc(state.me.bio || '')}</textarea>
          <p class="hint">240 characters. Shown on your shelf.</p>
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
      ${blockHead('leaving')}
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
    <section class="hero"><p class="kicker">your table</p>
      <h2>What you and yours are <em>drinking</em></h2>
      <p>${data.following
        ? `Pours from the ${plural(data.following, 'person', 'people')} you follow, and your own.`
        : 'Follow a few drinkers and their pours land here.'}</p></section>
    <section class="block">
      ${empty
        ? `<div class="empty">
            <p>${data.following ? 'Nothing new from your table yet.' : 'You are not following anyone yet.'}</p>
            <a class="btn btn-amber" href="/recent">Find people at the bar</a>
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
      <h2>${dir === 'followers' ? 'Followers' : '<em>Following</em>'}</h2></section>
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
      <h2>${mine ? 'Your <em>lists</em>' : 'Lists'}</h2></section>
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
      ${blockHead('the list', plural(items.length, 'beer'))}
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
              ${mine ? `<button class="kill" data-drop="${it.beer_id}">remove</button>` : ''}</span>
            </li>`).join('')}</ol>`
        : `<div class="empty"><p>Nothing on this list yet.</p>
            ${mine ? '<p class="hint">Open any beer and choose “Add to a list”.</p>' : ''}</div>`}
    </section>
    ${mine ? `<button class="btn" id="delList">Delete this list</button>` : ''}
  </div>`;

  if (!mine) return;
  app.querySelector('#litems')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-drop]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await api.removeFromList(list.id, btn.dataset.drop);
      btn.closest('li').remove();
    } catch { btn.disabled = false; }
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
    <section class="hero"><p class="kicker">the library</p>
      <h2>Lists people are <em>keeping</em></h2>
      <p>Collections and rankings from across Draught.</p></section>
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
    <section class="hero"><p class="kicker">privacy</p>
      <h2>What Draught <em>knows</em></h2>
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
    <section class="hero"><p class="kicker">the map</p>
      <h2>Where it's being <em>drunk</em></h2>
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
        ? `<div class="mapwrap">${svg}</div>`
        : `<div class="empty"><p>No pinned venues yet.</p>
            <p class="hint">Log a beer, tap <strong>Pin this spot</strong>, and it lands here.</p>
            ${state.me ? '<a class="btn btn-amber" href="/log">Log a beer</a>' : ''}</div>`}
    </section>

    ${top.length ? `<section class="block">
      ${blockHead('the locals', plural(data.venues.length, 'venue'))}
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
      ${blockHead('where the beer is from', 'by brewery country')}
      <div class="chips">${data.origins.slice(0, 20).map((o) =>
        `<span class="chip">${esc(o.country)}<span class="n">${o.pours}</span></span>`).join('')}</div>
    </section>` : ''}
  </div>`;

  // Clicking a dot goes to whoever drank there, when it's a single person.
  app.querySelector('.pins')?.addEventListener('click', (e) => {
    const pin = e.target.closest('.pin');
    if (!pin) return;
    const v = data.venues.find((x) => x.slug === pin.dataset.slug);
    if (v?.handles.length === 1) go(`/@${v.handles[0]}`);
  });
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
