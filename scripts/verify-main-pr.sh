#!/usr/bin/env bash
# Authoritative local simulation for a PR targeting main.
#
# Runs every local equivalent of the CI verify + integration gates against a
# fresh stack. The served-function lane is deliberately last: its teardown
# removes the temporary edge runtime while Kong can retain that upstream until
# the next stack restart.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# CI pins node-version: 22 (ci.yml) and react-router 8 declares engines >=22.22.0. A shell
# defaulting to an older node fails inside vitest's bundler with an unrelated-looking `node:util`
# export error — a false RED that costs more to diagnose than this check costs to run.
node_ok="$(node -p 'const [a,b]=process.versions.node.split(".").map(Number); a>22||(a===22&&b>=22)')"
if [ "$node_ok" != "true" ]; then
  echo "[verify-main-pr] node $(node -v) is below the v22.22.0 floor (react-router 8 engines; CI runs latest 22)." >&2
  echo "[verify-main-pr] Switch (e.g. nvm install 22 && nvm use 22) and re-run." >&2
  exit 1
fi

# Non-DB gates run before acquiring the machine-global DB lock. verify:locked
# already serializes the heavy Vitest suite with other worktrees.
if [ "${_VERIFY_MAIN_PR_DB_LOCKED:-}" != "1" ]; then
  cd "$REPO/pmo-portal"
  npm run verify:locked

  # CI's verify job runs the coverage-instrumented suite and enforces ≥80% on
  # changed executable lines. Plain `npm run verify` does neither, so repeat the
  # complete suite under coverage rather than allowing a local false green.
  "$REPO/scripts/with-test-lock.sh" npm run test:coverage

  cd "$REPO"
  git fetch --no-tags origin main
  node scripts/changed-lines-coverage.mjs \
    --base origin/main \
    --coverage pmo-portal/coverage/coverage-final.json \
    --min 80
  node --test \
    scripts/parallel-infra.test.mjs \
    scripts/ci-integration-order.test.mjs \
    scripts/deno-inventory.test.mjs
  node scripts/audit-prod.mjs
  bash scripts/deno-boot-smoke-edge-fns.sh
  bash scripts/deno-test-edge-fns.sh

  export _VERIFY_MAIN_PR_DB_LOCKED=1
  exec "$REPO/scripts/with-db-lock.sh" "$0"
fi

cd "$REPO"
echo "[verify-main-pr] restart the local stack to match a fresh CI runner"
supabase stop || true
supabase start -x studio,realtime,vector

echo "[verify-main-pr] reset DB and run the complete pgTAP suite"
supabase db reset --yes
supabase test db

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

# CI does not expose this override to the ordinary browser lane. Clearing a
# developer shell value prevents an accidental served-function lane locally.
unset SUPABASE_FUNCTIONS_URL

echo "[verify-main-pr] run the parallel Chromium project and visual gate with CI semantics"
cd "$REPO/pmo-portal"
CI=true npx playwright test --project=chromium --fail-on-flaky-tests

echo "[verify-main-pr] run shared-state Playwright cases in a separate serial invocation"
CI=true npx playwright test --project=serial --workers=1 --fail-on-flaky-tests

echo "[verify-main-pr] run the served-function boundary smoke last"
cd "$REPO"
served_rc=0
scripts/serve-functions.sh -- bash -c 'cd pmo-portal && CI=true npx playwright test served-fn-smoke --project=chromium --fail-on-flaky-tests' || served_rc=$?

# serve-functions removes its temporary edge-runtime container; restart the
# ordinary stack before returning the shared local environment to other work.
echo "[verify-main-pr] restore the ordinary local stack after the served lane"
supabase stop || true
restore_rc=0
supabase start -x studio,realtime,vector || restore_rc=$?

if [ "$served_rc" -ne 0 ]; then exit "$served_rc"; fi
if [ "$restore_rc" -ne 0 ]; then exit "$restore_rc"; fi

echo "[verify-main-pr] all local PR-to-main gates passed"
