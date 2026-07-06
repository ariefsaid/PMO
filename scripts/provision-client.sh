#!/usr/bin/env bash
#
# Provision a NEW per-client Supabase Cloud Pro project (ADR-0047; this script IS the
# Operator's "add org" operation at <~5-deployment scale — no in-app UI). Mirrors
# db-push-prod.sh's shape exactly: typed-confirm + op-get.sh + explicit --db-url + --check.
#
#   scripts/provision-client.sh <slug>            provision (after a typed slug confirm)
#   scripts/provision-client.sh <slug> --check    resolve the secret + confirm reachability, NO writes
#
# NEVER seeds (FR-PROV-005 — a real client project is never demo-seeded). Manual-vs-CLI split is
# documented in docs/environments.md's per-client registry section (added by this issue).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

SLUG="${1:?Usage: scripts/provision-client.sh <client-slug> [--check]}"
CHECK_MODE="${2:-}"

ENV_FILE="supabase/op.${SLUG}.env"
: "${ENV_FILE:?}"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found. Copy supabase/op.CLIENT-SLUG.env.template and fill in the" >&2
  echo "  1Password item/vault/field coordinates for this client. See docs/environments.md." >&2
  exit 1
fi
. "$ENV_FILE"
OP_GET="$(command -v op-get.sh || echo "$HOME/.local/bin/op-get.sh")"

if [ -x "$OP_GET" ]; then
  if ! CLIENT_DB_URL="$("$OP_GET" "$OP_CLIENT_ITEM" "$OP_CLIENT_VAULT" "$OP_CLIENT_FIELD")"; then
    echo "✗ op-get.sh could not resolve '$OP_CLIENT_ITEM' / '$OP_CLIENT_FIELD' in vault '$OP_CLIENT_VAULT'." >&2
    echo "  Create that 1Password item (field '$OP_CLIENT_FIELD' = the Session-pooler URI, port 5432)." >&2
    exit 1
  fi
elif [ -f "supabase/.env.${SLUG}" ]; then
  set -a; . "supabase/.env.${SLUG}"; set +a
fi
: "${CLIENT_DB_URL:?No secret resolved for slug '$SLUG' — set up 1Password or supabase/.env.$SLUG.}"

if [ "$CHECK_MODE" = "--check" ]; then
  echo "→ $SLUG: secret resolved; checking DB reachability (dry-run, no changes applied)…"
  if supabase db push --db-url "$CLIENT_DB_URL" --dry-run >/dev/null 2>&1; then
    echo "✓ $SLUG is usable (1Password resolved + DB reachable)."
  else
    echo "✗ $SLUG check failed: secret resolved, but could not connect to the DB." >&2
    exit 1
  fi
  exit 0
fi

echo "⚠  Provisioning client '$SLUG' → a NEW Supabase Cloud project. Seed is NEVER run here."
read -r -p "   Type '$SLUG' to confirm: " ans
if [ "$ans" != "$SLUG" ]; then
  echo "Aborted." >&2
  exit 1
fi

echo "→ Linking repo to the target project…"
supabase link --project-ref "$OP_CLIENT_PROJECT_REF"

echo "→ Applying migrations…"
supabase db push --db-url "$CLIENT_DB_URL"

echo "→ Deploying edge functions (agent-chat, compose-view, agent-dispatch — deployed, flag-OFF by default)…"
supabase functions deploy agent-chat compose-view agent-dispatch

echo "→ Setting secrets (names only — values from THIS shell's env, never a file)…"
: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY in this shell (op-get.sh) before running.}"
supabase secrets set OPENROUTER_API_KEY="$OPENROUTER_API_KEY"

echo "→ Creating the org row + first Admin (idempotent — reports 'already provisioned' if the org exists)…"
node scripts/lib/provisionOrgAdmin.mjs --slug "$SLUG" --db-url "$CLIENT_DB_URL"

echo ""
echo "── Manual steps remaining (this script cannot do these) ──"
echo "  1. Cloudflare Pages: create/branch a project for '$SLUG', set Production env vars:"
echo "       VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_APP_ENV=prod"
echo "       (VITE_POSTHOG_KEY/VITE_POSTHOG_HOST if analytics is licensed; NEVER VITE_DEMO_MODE)"
echo "  2. Confirm the Supabase dashboard shows Pro plan + daily backups enabled (ADR-0047/MVP item 5)."
echo "  3. Invite the first Admin's real email via 'supabase auth-admin invite' (MVP item 1a dependency —"
echo "     until the ops-admin invite fn ships) — requires SMTP (MVP item 2 dependency) to deliver."
echo ""
echo "→ Running the readiness check…"
node scripts/check-client-readiness.mjs || echo "⚠  Some readiness checks failed/skipped — see above."

echo ""
echo "→ Registry row for docs/environments.md (public-safe — paste manually):"
node -e "
const { buildRegistryRow } = await import('./scripts/lib/provisionRegistryRow.mjs');
console.log(buildRegistryRow({
  slug: '$SLUG',
  projectRef: '${OP_CLIENT_PROJECT_REF:-<fill in>}',
  apiUrl: '<fill in from supabase status / dashboard>',
  anonKey: '<fill in — public-safe>',
  frontendUrl: '<fill in — the Cloudflare Pages URL>',
}));
"

# ERPNext provisioning leg — ADR-0048, out of scope v1 (FR-PROV-012 seam hook, no-op).
