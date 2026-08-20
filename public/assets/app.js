// Draught — the whole client. History routing, seven views, no framework.

import { api } from './api.js';
import { STYLES, FAMILIES, findStyle } from './styles.js';
import {
  esc, stars, outOfFive, fmtDate, today, plural,
  tile, blockHead, pourRow, starRail, bindStarRail, bindAutocomplete,
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
  if (path === '/settings') return { view: 'settings' };
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
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || a.dataset.raw) return;
  e.preventDefault();
  if (a.getAttribute('href') !== location.pathname) go(a.getAttribute('href'));
});
addEventListener('popstate', () => render());

// ---- chrome ----------------------------------------------------------------

function renderNav() {
  const here = location.pathname;
  const on = (p) => (here === p ? ' class="on"' : '');
  if (!state.me) {
    nav.innerHTML = `<a href="/recent"${on('/recent')}>Recent</a>
      <a class="cta" href="/api/auth/google" data-raw>Sign in</a>`;
    return;
  }
  const h = state.me.handle;
  nav.innerHTML = `
    <a href="/recent"${on('/recent')}>Recent</a>
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
  return go(`/@${state.me.handle}`, { replace: true });
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
            <input id="venue" name="venue" maxlength="80" placeholder="home">
          </div>
        </div>
        <button class="btn btn-amber btn-lg" type="submit" id="submit">Log it</button>
        <p class="msg" id="msg"></p>
      </form>
    </div></section></div>`;

  const form = app.querySelector('#pform');
  const msg = app.querySelector('#msg');
  bindStarRail(app);

  // Style choice suggests the ABV band, but never overwrites a typed value.
  const styleSel = form.style;
  const abv = form.abv;
  const abvHint = app.querySelector('#abvHint');
  styleSel.addEventListener('change', () => {
    const s = findStyle(styleSel.value);
    abvHint.textContent = s ? `${s.origin} · typically ${s.abvLow}–${s.abvHigh}%` : '';
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
        note: form.note.value,
        serving: form.serving.value,
        venue: form.venue.value,
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
  const { user, stats, styles, pours } = data;
  const mine = state.me?.handle === user.handle;

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
      </div>
    </section>

    <div class="tiles">
      ${tile('pours', stats.pours ?? 0)}
      ${tile('distinct beers', stats.beers ?? 0)}
      ${tile('breweries', stats.breweries ?? 0)}
      ${tile('styles', stats.styles ?? 0)}
      ${tile('mean rating', stats.avg ? `${outOfFive(stats.avg)}★` : '—', stats.avg ? 'of five' : 'nothing rated yet')}
    </div>

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

    ${state.me ? `<a class="btn btn-amber" href="/log">Log this beer</a>` : ''}
  </div>`;
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
    </div></section></div>`;

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
