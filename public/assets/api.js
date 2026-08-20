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
};
