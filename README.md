# Draught

**Your beer life, on draught.**

Log the beer you drink. Rate it in half-stars, write down what you actually
thought, and watch your taste take shape — the beers, the breweries, the styles
you keep coming back to.

Letterboxd for beer. Not a check-in app: there are no badges, no streaks and no
toasts. A **pour** is the unit of record, and notes are the point.

## The idea

Untappd already exists, and the usual reply to "someone should build Letterboxd
for beer" is to say so. But Untappd is a *check-in* app — gamified, badge-driven,
optimised for the moment you raise the glass. Letterboxd beat IMDb on exactly the
axis Untappd leaves open: **taste**. Lists, writing, a shared canonical page per
work, and a profile that reads like a person rather than a scoreboard.

Draught takes that axis:

| | |
| --- | --- |
| **A pour, not a check-in** | Half-star ratings, a date, a serving, and room for real notes |
| **Every beer has one page** | The first person to log a beer creates it; everyone's ratings and notes gather there |
| **A style canon** | 117 styles across 13 families, each with an origin and a typical ABV band |
| **Your shelf is public** | `draught/@you` — your handle and your pours. Nothing else. |

## The rooms

| Route | What's there |
| --- | --- |
| `/` | Signed out: the pitch. Signed in: straight to your shelf |
| `/log` | The one form that matters — brewery, beer, style, half-stars, notes |
| `/@handle` | A drinker's shelf: totals, the styles they drink, the full ledger |
| `/b/:brewery/:beer` | A beer's page: mean rating, the ratings histogram, the margins |
| `/recent` | The bar — the last forty pours logged |
| `/settings` | Display name and bio |

## Architecture

Three moving parts, all on free tiers, none of which sleep.

```
browser (SPA, no framework)
      │  same-origin fetch, HttpOnly session cookie
      ▼
Cloudflare Pages Functions  ──▶  Open Brewery DB (brewery lookup)
      │
      ▼
Cloudflare D1 (SQLite)
```

- **Frontend** — hand-rolled ES modules on Cloudflare Pages. No build step, no
  dependencies, no bundler. `public/` is the deployable artefact as-is.
- **API** — one catch-all Pages Function, `functions/api/[[route]].js`. OAuth
  against Google and GitHub, opaque session tokens hashed into D1.
- **Data** — D1. Five tables; a pour is a row.

The API lives on the same origin as the page, so the session is an
`HttpOnly; SameSite=Lax` cookie rather than a token in `localStorage`, and there
is no CORS surface at all.

See [docs/DESIGN.md](docs/DESIGN.md) for the schema, the routes and the
trust boundaries.

### On privacy

Draught has accounts, so — unlike a purely client-side dashboard — it *does*
hold your data. Being straight about what that means:

- Your **handle, pours, ratings and notes are public**. That is the product.
- Your **email is never stored**. OAuth gives us a provider id; we keep that,
  a display name and an avatar URL, and nothing else.
- There are **no analytics, no trackers and no third-party scripts**. The only
  outbound call is a brewery-name lookup against Open Brewery DB, which sees a
  search string and no user identity.
- Sessions are opaque 256-bit tokens; only their hashes are stored.

## Running it

```bash
npm install
npx wrangler d1 create draught          # paste the id into wrangler.toml
npm run db:local                        # apply schema.sql to the local D1
cp .dev.vars.example .dev.vars          # DEV_LOGIN=1 lets you sign in offline
npm run dev                             # http://localhost:8788
```

With `DEV_LOGIN=1` and no OAuth apps registered, `/api/auth/dev?as=Name` signs
you in locally so the whole app is usable offline. That route is refused unless
the flag is set.

### Deploying

```bash
npx wrangler d1 create draught
npm run db:remote
npx wrangler pages deploy
```

Then set the secrets — `SESSION_SECRET` (`openssl rand -base64 32`) plus the
Google and GitHub client id/secret pairs:

```bash
npx wrangler pages secret put SESSION_SECRET
```

OAuth callback URLs are `https://<your-domain>/api/auth/google/callback` and
`.../github/callback`.

## Tests

```bash
npm test
```

Ten tests over the pure parts: slug collision (the rule that decides when two
people have logged the same beer), input cleaning, handle validation, half-star
rendering, HTML escaping, and the integrity of the style canon.

## Non-goals

No badges, no streaks, no check-in gamification. No ads. No email collection.
No scraping — breweries come from Open Brewery DB's public API and everything
else is typed by the people who drank it.

---

Sibling to [Matinée](../matinee), which does this for film and keeps everything
in your browser. Draught borrows its palette and its typography, and gives up
its "we could not see your data if we wanted to" promise in exchange for the one
thing film didn't need: other people.
