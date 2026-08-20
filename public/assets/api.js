// Same-origin fetch wrapper. Sessions ride an HttpOnly cookie, so there is no
// token to hold, leak or refresh here.

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  me: () => req('/me'),
  logout: () => req('/logout', { method: 'POST' }),
  claimHandle: (handle) => req('/handle', { method: 'POST', body: { handle } }),
  saveProfile: (body) => req('/profile', { method: 'PATCH', body }),
  searchBreweries: (q) => req(`/search/breweries?q=${encodeURIComponent(q)}`),
  searchBeers: (q) => req(`/search/beers?q=${encodeURIComponent(q)}`),
  pour: (body) => req('/pours', { method: 'POST', body }),
  unpour: (id) => req(`/pours/${id}`, { method: 'DELETE' }),
  profile: (handle) => req(`/users/${encodeURIComponent(handle)}`),
  beer: (brewery, beer) => req(`/beers/${encodeURIComponent(brewery)}/${encodeURIComponent(beer)}`),
  recent: () => req('/recent'),
  feed: () => req('/feed'),

  follow: (handle) => req(`/follow/${encodeURIComponent(handle)}`, { method: 'POST' }),
  unfollow: (handle) => req(`/follow/${encodeURIComponent(handle)}`, { method: 'DELETE' }),
  people: (handle, dir) => req(`/users/${encodeURIComponent(handle)}/people?dir=${dir}`),

  lists: (handle) => req(`/users/${encodeURIComponent(handle)}/lists`),
  list: (handle, slug) => req(`/users/${encodeURIComponent(handle)}/lists/${encodeURIComponent(slug)}`),
  recentLists: () => req('/lists'),
  createList: (body) => req('/lists', { method: 'POST', body }),
  updateList: (id, body) => req(`/lists/${id}`, { method: 'PATCH', body }),
  deleteList: (id) => req(`/lists/${id}`, { method: 'DELETE' }),
  addToList: (id, body) => req(`/lists/${id}/items`, { method: 'POST', body }),
  removeFromList: (id, beerId) => req(`/lists/${id}/items/${beerId}`, { method: 'DELETE' }),
};

// Photos go up as raw bytes, not multipart — there's one file and no fields.
export async function uploadPhoto(blob) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': blob.type },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.key;
}

export const imgUrl = (key) => (key ? `/api/img/${encodeURIComponent(key)}` : null);
