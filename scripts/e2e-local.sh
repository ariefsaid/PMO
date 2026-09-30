#!/usr/bin/env bash
# e2e-local.sh — run the Playwright e2e suite locally with CI-PARITY environment.
#
# Running e2e in a fresh worktree bit us repeatedly (2026-07-11): a missing .env.local, a stale
# pre-#306 DB seed, and an un-exported SUPABASE_SERVICE_ROLE_KEY each looked like an app/test bug but
# were environment gaps. CI's integration job sets all of this up inline; locally it was undocumented.
# This wraps it so `scripts/e2e-local.sh` reproduces CI's environment:
#   1. (--reset only) reset the shared local DB from THIS branch's migrations + seed
#   2. write pmo-portal/.env.local exactly as ci.yml does (supabase local url/anon + the VITE_FEATURES_*
#      flags the view/agent/crm journeys need) — NOTE this OVERWRITES .env.local (regenerated each run)
#   3. export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY for the service-role specs
#   4. run chromium (--workers=2) then the serial lane (--workers=1); or your pass-through args at 2 workers
#
# Load-lean by default (shared Mac): no DB reset, 2 workers, and ONE dev server — the analytics
# :3100 server + `consent` project start only when your args name a consent spec (E2E_CONSENT_LANE).
# The whole run holds scripts/with-db-lock.sh (the shared local stack is one Docker DB); Playwright
# starts its own dev server(s) inside that run (reuseExistingServer: false), so startup can't move out.
# The local supabase service_role key is the ephemeral demo key from `supabase status`, never a secret.
#
# Usage:
#   scripts/e2e-local.sh [--reset]                # chromium + serial lanes
#   scripts/e2e-local.sh [--reset] AC-DEL-022     # pass-through playwright args (single spec, --repeat-each, …)
#   --reset: `supabase db reset` first. Needed when your branch adds/changes a migration or the seed
#            (or the shared DB is in another branch's schema); implied by E2E_SECOND_ORG=1.
set -euo pipefail

reset=0
if [ "${1:-}" = --reset ]; then reset=1; shift; fi
[ "${E2E_SECOND_ORG:-}" = "1" ] && reset=1

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
  [ "$reset" -eq 1 ] && set -- --reset "$@"
  exec "$REPO/scripts/with-db-lock.sh" "$0" "$@"
fi

cd "$REPO"
if [ "$reset" -eq 1 ]; then
  echo "[e2e-local] db reset (branch: $(git branch --show-current))"
  supabase db reset >/dev/null
else
  echo "[e2e-local] no db reset (pass --reset if your branch adds/changes a migration or seed)"
  # A previous E2E_SECOND_ORG run leaves the seed org moved; without a reset every spec would fail.
  seed_org=$(docker exec supabase_db_pmo-portal psql -U postgres -d postgres -XAtc \
    "select count(*) from public.organizations where id = '00000000-0000-0000-0000-000000000001'" 2>/dev/null || echo 0)
  if [ "$seed_org" != 1 ]; then
    echo "[e2e-local] shared DB is not at seed state (seed org missing) — re-run with --reset" >&2
    exit 1
  fi
fi
# E2E_SECOND_ORG=1 (#621): make the seed org a NON-seed org. Every business table defaults org_id to the
# seed literal; the app never sends it; a second tenant relies on the stamp triggers to fix it up. With
# the seed org moved to another id, every "worked only because default == org" path goes red here
# instead of at the client. FK/trigger checks are off for the rewrite only (replica role), which is
# what makes the id move atomic. Helpers read E2E_ORG_ID; anything else that hardcodes the literal is a
# test assumption, not an app bug.
if [ "${E2E_SECOND_ORG:-}" = "1" ]; then
  export E2E_ORG_ID="b0000000-0000-0000-0000-00000000000b"
  docker exec -i supabase_db_pmo-portal psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -c "
    do \$\$ declare t record; b uuid := '${E2E_ORG_ID}'; a uuid := '00000000-0000-0000-0000-000000000001';
    begin
      set local session_replication_role = replica;   -- FK (system) triggers off for the move
      -- replica role is not enough: 0190's immutability trigger is ENABLE ALWAYS. Disable ALL triggers
      -- (user + FK) on the touched tables for the move, then re-enable.
      for t in select c.table_name from information_schema.columns c join pg_tables p on p.tablename = c.table_name and p.schemaname = 'public'
               where c.table_schema = 'public' and c.column_name = 'org_id' loop
        execute format('alter table public.%I disable trigger user', t.table_name);
        execute format('update public.%I set org_id = \$1 where org_id = \$2', t.table_name) using b, a;
      end loop;
      alter table public.organizations disable trigger user;
      update public.organizations set id = b where id = a;
      alter table public.organizations enable trigger user;
      for t in select c.table_name from information_schema.columns c join pg_tables p on p.tablename = c.table_name and p.schemaname = 'public'
               where c.table_schema = 'public' and c.column_name = 'org_id' loop
        execute format('alter table public.%I enable trigger user', t.table_name);
      end loop;
    end \$\$;"
  echo "[e2e-local] SECOND-ORG mode: seed org moved to ${E2E_ORG_ID}"
fi

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
# One dev server unless the args reach the consent lane (its specs need the analytics :3100 server).
case " $* " in
  *consent*|*AC-CON-*|*AC-VISUAL-CHECKBOX*) export E2E_CONSENT_LANE=1 ;;
  *) export E2E_CONSENT_LANE=0 ;;
esac
if [ "$#" -gt 0 ]; then
  echo "[e2e-local] playwright --workers=2 $* (consent lane: $E2E_CONSENT_LANE)"
  exec npx playwright test --workers=2 "$@"
fi

echo "[e2e-local] phase 1: chromium (--workers=2)"
npx playwright test --project=chromium --workers=2
echo "[e2e-local] phase 2: serial (--workers=1)"
npx playwright test --project=serial --workers=1
