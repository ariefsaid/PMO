#!/usr/bin/env bash
# e2e-local.sh — run the Playwright e2e suite locally with CI-PARITY environment.
#
# Running e2e in a fresh worktree bit us repeatedly (2026-07-11): a missing .env.local, a stale
# pre-#306 DB seed, and an un-exported SUPABASE_SERVICE_ROLE_KEY each looked like an app/test bug but
# were environment gaps. CI's integration job sets all of this up inline; locally it was undocumented.
# This wraps it so `scripts/e2e-local.sh` reproduces CI exactly:
#   1. reset the shared local DB from THIS branch's migrations + seed (fresh, correct seed)
#   2. write pmo-portal/.env.local exactly as ci.yml does (supabase local url/anon + the VITE_FEATURES_*
#      flags the view/agent/crm journeys need) — NOTE this OVERWRITES .env.local (regenerated each run)
#   3. export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY for the service-role specs
#   4. run both phases: chromium (workers:4) then the serial lane (--workers=1)
#
# All DB work is serialized via scripts/with-db-lock.sh (the shared local stack is one Docker DB).
# The local supabase service_role key is the ephemeral demo key from `supabase status`, never a secret.
#
# Usage:
#   scripts/e2e-local.sh                 # full two-phase run
#   scripts/e2e-local.sh AC-DEL-022      # pass-through playwright args (single spec, --repeat-each, etc.)
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Node 22 (repo convention; react-router 8 needs >=22.22.0). Pick the HIGHEST installed v22 rather
# than a pinned patch — the old hardcoded v22.20.0 silently fell below the engines floor when
# react-router 8 landed, and CI tracks the latest 22 anyway.
# ⚑ `|| true`: under `set -euo pipefail` a bare assignment is NOT exempt the way the old
# `[ -d … ] && export …` idiom was, so on a machine with no nvm (or no v22) `grep` exits 1 and the
# script would die right here, silently, before printing anything.
_n22="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | grep '^v22\.' | sort -V | tail -1 || true)"
[ -n "${_n22:-}" ] && export PATH="$HOME/.nvm/versions/node/$_n22/bin:$PATH"

# Selecting the newest v22 is not the same as MEETING the floor — warn loudly rather than fail an
# hour into an e2e run with a confusing bundler error.
if ! node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=22)' 2>/dev/null | grep -q true; then
  echo "[e2e-local] WARNING: node $(node -v 2>/dev/null || echo '?') is below the v22.22.0 floor (react-router 8 engines)." >&2
  echo "[e2e-local] Run 'nvm install 22' — continuing, but failures here may be toolchain, not the app." >&2
fi

# Re-exec the whole body under the DB lock (serializes shared-stack access). The sentinel prevents
# infinite recursion once we are already inside the lock.
if [ "${_E2E_LOCAL_LOCKED:-}" != "1" ]; then
  export _E2E_LOCAL_LOCKED=1
  exec "$REPO/scripts/with-db-lock.sh" "$0" "$@"
fi

cd "$REPO"
echo "[e2e-local] db reset (branch: $(git branch --show-current))"
supabase db reset >/dev/null

eval "$(supabase status -o env)"
{
  echo "VITE_SUPABASE_URL=${API_URL}"
  echo "VITE_SUPABASE_ANON_KEY=${ANON_KEY}"
  echo "VITE_FEATURES_USERVIEWS=true"
  echo "VITE_FEATURES_AI_COMPOSER=true"
  echo "VITE_FEATURES_AGENT_ASSISTANT=true"
  echo "VITE_FEATURES_CRM=true"
} > pmo-portal/.env.local
export SUPABASE_URL="${API_URL}" \
       SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY}" \
       VITE_SUPABASE_ANON_KEY="${ANON_KEY}"
echo "[e2e-local] env ready (service key: ${SUPABASE_SERVICE_ROLE_KEY:+set})"

cd pmo-portal
if [ "$#" -gt 0 ]; then
  echo "[e2e-local] playwright $*"
  exec npx playwright test "$@"
fi

echo "[e2e-local] phase 1: chromium (workers:4)"
npx playwright test --project=chromium
echo "[e2e-local] phase 2: serial (--workers=1)"
npx playwright test --project=serial --workers=1
