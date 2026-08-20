#!/usr/bin/env bash
# Finish Draught's Google sign-in setup: set the client secret, redeploy, and
# verify the live endpoint actually flipped. Self-verifying on purpose — the
# failure mode this exists to kill is "the redeploy succeeded, so I assumed the
# secret landed", which looks identical to success until you click sign in.
#
#   ./tools/finish-setup.sh              # prompts, nothing echoed to the terminal
#   pbpaste | ./tools/finish-setup.sh    # take it from the clipboard instead
#
# Safe to re-run. Never writes the secret to disk, history, or a log.

set -euo pipefail

PROJECT="draught"
SITE="https://draught-5bp.pages.dev"
NAME="GOOGLE_CLIENT_SECRET"

cd "$(dirname "$0")/.."
[ -f wrangler.toml ] || { echo "✗ run this from the draught repo"; exit 1; }

# ---- 1. obtain the secret without it ever being echoed or stored -------------
if [ -t 0 ]; then
  printf 'Paste the Google client secret (input hidden), then press Enter:\n> '
  read -rs SECRET
  printf '\n'
else
  SECRET="$(cat)"                     # piped, e.g. from pbpaste
fi
SECRET="$(printf '%s' "$SECRET" | tr -d '[:space:]')"

[ -n "$SECRET" ] || { echo "✗ nothing supplied — aborted, nothing changed"; exit 1; }
case "$SECRET" in
  GOCSPX-*) ;;
  *) printf '⚠  that does not look like a Google client secret (expected GOCSPX-…).\n   Continue anyway? [y/N] '
     read -r yn < /dev/tty; [ "$yn" = "y" ] || { echo "aborted, nothing changed"; exit 1; } ;;
esac

# ---- 2. set it --------------------------------------------------------------
echo "→ setting $NAME on Pages project '$PROJECT'…"
printf '%s' "$SECRET" | npx wrangler pages secret put "$NAME" --project-name="$PROJECT" >/dev/null 2>&1 \
  || { echo "✗ wrangler could not set the secret. Are you logged in? Try: npx wrangler whoami"; exit 1; }
unset SECRET

# ---- 3. confirm it is actually there, rather than trusting step 2 ------------
echo "→ confirming it stored…"
if ! npx wrangler pages secret list --project-name="$PROJECT" 2>/dev/null | grep -q "$NAME"; then
  echo "✗ $NAME is still missing from the project. Nothing else was changed."
  exit 1
fi
echo "  ✓ $NAME is present"

# ---- 4. redeploy — Pages secrets only reach the running deployment on deploy --
echo "→ redeploying (secrets need a deploy to take effect)…"
npx wrangler pages deploy --project-name="$PROJECT" --branch=main --commit-dirty=true >/dev/null 2>&1 \
  || { echo "✗ deploy failed — run it manually to see why:"; \
       echo "  npx wrangler pages deploy --project-name=$PROJECT --branch=main"; exit 1; }

# ---- 5. verify the live endpoint flipped ------------------------------------
echo "→ checking $SITE/api/auth/google …"
for i in $(seq 1 12); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$SITE/api/auth/google" || true)"
  [ "$CODE" = "302" ] && break
  sleep 5
done

echo
if [ "$CODE" = "302" ]; then
  echo "✓ Sign-in is live. $SITE/api/auth/google now redirects to Google."
  echo "  Open $SITE and click Continue with Google."
  echo
  echo "  If Google shows redirect_uri_mismatch, add this exact URI to the"
  echo "  OAuth client's Authorized redirect URIs:"
  echo "    $SITE/api/auth/google/callback"
else
  echo "✗ Still returning $CODE (expected 302)."
  echo "  The secret is stored and the deploy succeeded, so this is unusual."
  echo "  Check: npx wrangler pages secret list --project-name=$PROJECT"
fi
