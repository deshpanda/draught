// Hand-rolled DOM helpers. Everything user-supplied goes through esc() before
// it reaches innerHTML — that is the whole XSS story.

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 7 -> "★★★½"   10 -> "★★★★★"   null -> ""
export const stars = (r) =>
  r == null ? '' : '★'.repeat(Math.floor(r / 2)) + (r % 2 ? '½' : '');

export const outOfFive = (r) => (r == null ? '—' : (r / 2).toFixed(1).replace(/\.0$/, ''));

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(+d)) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function tile(k, v, s = '') {
  return `<div class="tile"><p class="k">${esc(k)}</p><p class="v">${esc(v)}</p>${
    s ? `<p class="s">${esc(s)}</p>` : ''
  }</div>`;
}

export function blockHead(title, note = '') {
  return `<div class="block-head"><h3>${esc(title)}</h3><span class="rule"></span>${
    note ? `<span class="note">${esc(note)}</span>` : ''
  }</div>`;
}

// A pour, as it appears in any ledger. `who` shows the drinker (global feed);
// `mine` shows the delete button (your own shelf).
export function pourRow(p, { who = false, mine = false } = {}) {
  const beerUrl = `/b/${encodeURIComponent(p.brewery_slug)}/${encodeURIComponent(p.beer_slug)}`;
  const bits = [p.style, p.abv ? `${p.abv}%` : '', p.serving, p.venue].filter(Boolean);
  const shot = p.photo_key
    ? `<a class="thumb" href="${esc(beerUrl)}"><img src="/api/img/${encodeURIComponent(p.photo_key)}"
        alt="" loading="lazy" decoding="async"></a>`
    : '';
  return `<li${shot ? ' class="haspic"' : ''}>
    ${shot}
    <span class="d">${esc(fmtDate(p.drunk_on))}</span>
    <span class="t">
      <a class="beer" href="${esc(beerUrl)}">${esc(p.beer)}</a>
      <span class="by">· ${esc(p.brewery)}</span>
      ${who && p.handle ? `<span class="by">· <a href="/@${esc(p.handle)}">@${esc(p.handle)}</a></span>` : ''}
      ${bits.length ? `<span class="meta">${esc(bits.join(' · '))}</span>` : ''}
    </span>
    <span class="r">
      <span class="stars">${stars(p.rating)}</span>
      ${mine ? `<button class="kill" data-kill="${esc(p.id)}">remove</button>` : ''}
    </span>
    ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
  </li>`;
}

// The half-star rating rail: ten tappable halves, 0.5–5.0.
export function starRail(value = null) {
  const halves = Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return `<span class="half${v % 2 === 0 ? ' rh' : ''}${value && v <= value ? ' lit' : ''}"
      data-v="${v}" role="button" tabindex="-1" aria-label="${(v / 2).toFixed(1)} stars"><span>★</span></span>`;
  }).join('');
  return `<div class="rate">
    <div class="stars-input" id="rail">${halves}</div>
    <span class="out" id="rateOut">${value ? `${outOfFive(value)} / 5` : 'unrated'}</span>
    <button type="button" class="clear" id="rateClear">clear</button>
    <input type="hidden" name="rating" id="rating" value="${value ?? ''}">
  </div>`;
}

// Wires the rail: hover previews, click commits, clear resets.
export function bindStarRail(root) {
  const rail = root.querySelector('#rail');
  if (!rail) return;
  const input = root.querySelector('#rating');
  const out = root.querySelector('#rateOut');
  const halves = [...rail.querySelectorAll('.half')];
  const paint = (n) => halves.forEach((h) => h.classList.toggle('lit', Number(h.dataset.v) <= n));
  const committed = () => Number(input.value || 0);

  rail.addEventListener('mousemove', (e) => {
    const h = e.target.closest('.half');
    if (!h) return;
    paint(Number(h.dataset.v));
    out.textContent = `${outOfFive(Number(h.dataset.v))} / 5`;
  });
  rail.addEventListener('mouseleave', () => {
    paint(committed());
    out.textContent = committed() ? `${outOfFive(committed())} / 5` : 'unrated';
  });
  rail.addEventListener('click', (e) => {
    const h = e.target.closest('.half');
    if (!h) return;
    input.value = h.dataset.v;
    paint(Number(h.dataset.v));
    out.textContent = `${outOfFive(Number(h.dataset.v))} / 5`;
  });
  root.querySelector('#rateClear')?.addEventListener('click', () => {
    input.value = '';
    paint(0);
    out.textContent = 'unrated';
  });
}

// Debounced typeahead against an async source, rendered into a .ac panel.
export function bindAutocomplete(input, panel, fetcher, onPick) {
  let timer, seq = 0;
  const close = () => { panel.innerHTML = ''; };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      const mine = ++seq;
      let results = [];
      try { results = await fetcher(q); } catch { return close(); }
      if (mine !== seq) return; // a later keystroke already won
      if (!results.length) return close();
      panel.innerHTML = results.map((r, i) =>
        `<button type="button" data-i="${i}"><span class="n">${esc(r.label)}</span>${
          r.sub ? `<span class="m"> ${esc(r.sub)}</span>` : ''
        }</button>`
      ).join('');
      panel.onclick = (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        onPick(results[Number(b.dataset.i)]);
        close();
      };
    }, 220);
  });

  input.addEventListener('blur', () => setTimeout(close, 160));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}


// ---- photos ---------------------------------------------------------------

export const MAX_EDGE = 1400;

// Downscale and re-encode on a canvas before upload. Two reasons: objects stay
// small (a phone shot goes from ~4 MB to ~250 KB), and re-encoding **drops all
// EXIF** — including the GPS coordinates most phones bury in every photo. That
// matters here: a label shot geotagged to someone's home is not something a
// public beer log should be quietly publishing.
export async function prepPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('That is not an image.');
  if (file.size > 25_000_000) throw new Error('That photo is enormous — under 25 MB please.');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
  if (!blob) throw new Error('Could not read that photo.');
  return { blob, width: w, height: h };
}

export const photoImg = (key, cls = '') =>
  key ? `<img class="${cls}" src="/api/img/${encodeURIComponent(key)}" alt="" loading="lazy" decoding="async">` : '';

// ---- follow button --------------------------------------------------------

export function followBtn(handle, following) {
  return `<button class="btn ${following ? '' : 'btn-amber'}" id="followBtn"
    data-handle="${esc(handle)}" data-following="${following ? '1' : '0'}">${
    following ? 'Following' : 'Follow'
  }</button>`;
}

export function bindFollow(root, api, onChange) {
  const btn = root.querySelector('#followBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const on = btn.dataset.following === '1';
    btn.disabled = true;
    try {
      const res = on ? await api.unfollow(btn.dataset.handle) : await api.follow(btn.dataset.handle);
      btn.dataset.following = on ? '0' : '1';
      btn.textContent = on ? 'Follow' : 'Following';
      btn.classList.toggle('btn-amber', on);
      onChange?.(res);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

// ---- list card ------------------------------------------------------------

export function listCard(l, handle) {
  const href = `/@${encodeURIComponent(handle)}/list/${encodeURIComponent(l.slug)}`;
  return `<a class="lcard" href="${esc(href)}">
    <span class="lcover">${l.cover ? photoImg(l.cover) : '<span class="lcover-none">▤</span>'}</span>
    <span class="lmeta">
      <span class="lt">${esc(l.title)}${l.ranked ? '<span class="rank">ranked</span>' : ''}</span>
      <span class="ln">${plural(l.items ?? 0, 'beer')}</span>
      ${l.description ? `<span class="ld">${esc(l.description)}</span>` : ''}
    </span>
  </a>`;
}
