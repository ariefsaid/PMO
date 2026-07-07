#!/usr/bin/env bash
#
# Provision a NEW per-client Supabase Cloud Pro project (ADR-0047; this script IS the
# Operator's "add org" operation at <~5-deployment scale — no in-app UI). Mirrors
# db-push-prod.sh's shape exactly: typed-confirm + op-get.sh + explicit --db-url + --check.
#
#   scripts/provision-client.sh <slug>                 provision (after a typed slug confirm)
#   scripts/provision-client.sh <slug> --check         resolve the secret + confirm reachability, NO writes
#   scripts/provision-client.sh <slug> --skip-auth-check
#                                                       provision but SKIP the auth-floor pre-flight —
#                                                       ONLY for the shared STAGING/DEMO project, never
#                                                       for a real client tenant (loud warning printed)
#
# Runs scripts/check-auth-floor.mjs as a HARD gate before `db push` (audit follow-up, #1
# MVP-blocker) — requires SUPABASE_ACCESS_TOKEN (a Management API PAT, e.g. via op-get.sh) in
# this shell and OP_CLIENT_PROJECT_REF in the client's op env file.
#
# NEVER seeds (FR-PROV-005 — a real client project is never demo-seeded). Manual-vs-CLI split is
# documented in docs/environments.md's per-client registry section (added by this issue).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/opt/libpq/bin:/usr/local/opt/libpq/bin:$PATH"

SLUG="${1:?Usage: scripts/provision-client.sh <client-slug> [--check|--skip-auth-check]}"
CHECK_MODE="${2:-}"

# Auth-floor pre-flight (audit follow-up, #1 MVP-blocker): docs/environments.md's "Production
# auth floor" checklist was a PRINTED reminder only — a real tenant could go live with open
# self-signup if a step were skipped. --skip-auth-check is ONLY for the shared STAGING/DEMO
# project (prwccpsiumjzvnwjlkwq, intentionally open per docs/environments.md) — never for a
# real client project.
SKIP_AUTH_CHECK=0
if [ "$CHECK_MODE" = "--skip-auth-check" ]; then
  SKIP_AUTH_CHECK=1
  CHECK_MODE=""
fi

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

if [ "$SKIP_AUTH_CHECK" = "1" ]; then
  echo "⚠⚠⚠  --skip-auth-check: SKIPPING the production auth-floor pre-flight for '$SLUG'." >&2
  echo "     This is ONLY valid for the shared STAGING/DEMO project. If '$SLUG' is a REAL" >&2
  echo "     client tenant, stop now — do not skip this check." >&2
else
  echo "→ Verifying the production auth floor on ${OP_CLIENT_PROJECT_REF:-<unset ref>} (pre-flight, read-only)…"
  : "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (a Management API PAT, e.g. via op-get.sh) before running.}"
  : "${OP_CLIENT_PROJECT_REF:?OP_CLIENT_PROJECT_REF must be set in $ENV_FILE to run the auth-floor check.}"
  if ! SUPABASE_PROJECT_REF="$OP_CLIENT_PROJECT_REF" node scripts/check-auth-floor.mjs; then
    echo "✗ Auth floor not configured on $OP_CLIENT_PROJECT_REF — configure signup-off + confirmations +" >&2
    echo "  HTTPS-only redirects per docs/environments.md, then re-run." >&2
    exit 1
  fi
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
