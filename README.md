# Draught

**A diary for the beer you drink.** Letterboxd, for beer.

**Live: [ondraught.pages.dev](https://ondraught.pages.dev)**

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
| `/` | Signed out: the pitch. Signed in: Following |
| `/feed` | **Following** — beers logged by people you follow, and by you |
| `/log` | The one form that matters — brewery, beer, style, half-stars, photo, notes |
| `/@handle` | A profile: totals, photos, styles, and the full diary |
| `/@handle/lists` · `/@handle/list/:slug` | Their lists, and one list in full |
| `/@handle/followers` · `/following` | Who's at whose table |
| `/b/:brewery/:beer` | A beer's page: hero photo, mean rating, histogram, the margins |
| `/map` | The map — pinned venues, filtered to everyone, your people, or just you |
| `/recent` | **Everyone** — the last forty beers logged, by anyone |
| `/lists` | **Lists** — collections and rankings from everyone |
| `/search?q=` | One box: beers, breweries and people |
| `/brewery/:slug` | A brewery and every beer logged from it |
| `/settings` | Display name and bio |

## Architecture

Three moving parts, all on free tiers, none of which sleep.

```
browser (SPA, no framework)
      │  same-origin fetch, HttpOnly session cookie
      │  photos downscaled on a canvas before upload
      ▼
Cloudflare Pages Functions  ──▶  Open Brewery DB (brewery lookup)
      │           │
      ▼           ▼
     D1        R2 bucket
   (SQLite)    (label photos)
```

- **Frontend** — hand-rolled ES modules on Cloudflare Pages. No build step, no
  dependencies, no bundler. `public/` is the deployable artefact as-is.
- **API** — one catch-all Pages Function, `functions/api/[[route]].js`. OAuth
  against Google, opaque session tokens hashed into D1.
- **Data** — D1. Ten tables; a pour is a row. Label photos live in R2.
- **The map** — `worldmap.js` is Natural Earth country outlines baked into
  equirectangular SVG paths and served from our own origin. No tile server and no
  map library, because a tile request would hand every viewer's IP to a third
  party — which the privacy page promises doesn't happen.

The API lives on the same origin as the page, so the session is an
`HttpOnly; SameSite=Lax` cookie rather than a token in `localStorage`, and there
is no CORS surface at all.

See [docs/DESIGN.md](docs/DESIGN.md) for the schema, the routes and the
trust boundaries.

### Rate limits

Every write is capped (`functions/_shared/ratelimit.js`), not because an attack
is expected but because each one mints *shared* state — a typo'd brewery becomes
a page every other drinker has to look at, and an upload costs storage. Creating
canonical rows is capped harder (25/hr) than logging against beers that already
exist (40/hr), so hitting the former never blocks ordinary use. Counters are
fixed-window rows in D1, incremented by a single `UPSERT … RETURNING` so
concurrent bursts can't race past the ceiling. A limiter failure fails *open* —
it must never take the feature down with it.

### On privacy

Draught has accounts, so — unlike a purely client-side dashboard — it *does*
hold your data. Being straight about what that means:

- Your **handle, pours, ratings and notes are public**. That is the product.
- Your **email is never stored**. OAuth gives us a provider id; we keep that,
  a display name and an avatar URL, and nothing else.
- There are **no analytics, no trackers and no third-party scripts**. The only
  outbound call is a brewery-name lookup against Open Brewery DB, which sees a
  search string and no user identity.
- **Photos are re-encoded in your browser before upload**, which strips EXIF —
  including the GPS coordinates phones bury in every shot. A label photo taken
  at home does not quietly publish your address.
- Sessions are opaque 256-bit tokens; only their hashes are stored.
- **Photos are re-encoded in your browser before upload**, which strips EXIF —
  including the GPS coordinates phones bury in every shot.
- **Deletion works.** Settings → delete account removes your identity, pours,
  notes, photos, lists and follows, including the R2 objects — not just the rows
  pointing at them. Breweries and beers survive, because other people's pours
  point at them; nothing left behind identifies you.

The full policy lives at [`/privacy`](https://draught-5bp.pages.dev/privacy) and
is written to be read rather than survived.

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
npx wrangler d1 create draught          # paste the id into wrangler.toml
npm run db:remote                       # schema against the real database
npx wrangler pages project create draught --production-branch=main
npx wrangler pages deploy --project-name=draught --branch=main
```

#### Finishing sign-in

One self-verifying script sets the Google client secret, redeploys, and checks
that the live endpoint actually flipped — because "the deploy succeeded" looks
identical to success even when the secret never landed:

```bash
./tools/finish-setup.sh
```

It hides the input, never writes the value to disk or shell history, confirms the
secret stored rather than trusting the upload, and polls
`/api/auth/google` until it returns `302`. Safe to re-run.
`pbpaste | ./tools/finish-setup.sh` works too.

The remaining secrets, done by hand. `SESSION_SECRET` is generated and piped so
it is never displayed:

```bash
openssl rand -base64 32 | npx wrangler pages secret put SESSION_SECRET --project-name=draught
```
```bash
npx wrangler pages secret put GOOGLE_CLIENT_ID --project-name=draught
```
```bash
npx wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name=draught
```

Sign-in is Google-only by design — one button, no provider chooser. The
callback URL to register in the Google console is
`https://<your-domain>/api/auth/google/callback`, plus
`http://localhost:8788/api/auth/google/callback` for local work.

**Never set `DEV_LOGIN` in production.** It exists so the app is usable
offline with no OAuth client registered; in production it would be an open
door. `/api/auth/dev` 404s unless the flag is present.

## Tests

```bash
npm test
```

Seventeen tests over the pure parts: slug collision (the rule that decides when two
people have logged the same beer), input cleaning, handle validation, half-star
rendering, HTML escaping, the integrity of the style canon, and a pinned regression for the link
interceptor (a valueless `data-raw` attribute is `""`, so guarding on its
truthiness silently swallowed every `/api/` navigation — including sign-in), the
private-venue-name guard, coordinate rounding, and the map projection.

## Non-goals

No badges, no streaks, no check-in gamification. No ads. No email collection.
No scraping — breweries come from Open Brewery DB's public API and everything
else is typed by the people who drank it.

---

Sibling to [Matinée](../matinee), which does this for film and keeps everything
in your browser. Draught borrows its palette and its typography, and gives up
its "we could not see your data if we wanted to" promise in exchange for the one
thing film didn't need: other people.
