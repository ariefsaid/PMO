#!/usr/bin/env bash
# scripts/serve-functions.sh — served-edge-fn e2e wrapper (spike §3.2 productionized).
# Usage: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test e2e/AC-ENA-053-*
#
# Wraps the spike's local recipe: start `supabase functions serve --no-verify-jwt` in the
# background, poll `/functions/v1/health` (60x2s) until it answers, run the caller's command,
# then tear down — killing the CLI process AND force-removing the runtime container (a plain
# SIGTERM leaks `supabase_edge_runtime_pmo-portal` — spike fact). Must run wrapped in
# `scripts/with-db-lock.sh` (this script does not take the lock itself — callers hold it only as
# long as the served-fn window needs, per the shared-stack hygiene rule).
set -euo pipefail

# 1. serve bg (self-manages its runtime container; [edge_runtime] enabled=false stays — the CLI
# brings up its own local/ECR runtime image regardless of that config flag, spike-verified).
# --env-file is optional local override (e.g. ERPNEXT_TEST_FAULTS=1 for fault-seam dev testing);
# supabase/functions/.env.local is gitignored and not committed, so `supabase functions serve`
# is only passed --env-file when a developer has actually created one (a missing path is a hard
# CLI error, not a silent skip — verified).
ENV_FILE_ARGS=()
if [ -f supabase/functions/.env.local ]; then
  ENV_FILE_ARGS=(--env-file supabase/functions/.env.local)
fi
# macOS ships bash 3.2, where "${arr[@]}" on an EMPTY array trips `set -u` ("unbound variable") —
# fixed only in bash 4.4+. The `+` parameter-expansion guard is the portable workaround.
supabase functions serve --no-verify-jwt "${ENV_FILE_ARGS[@]+"${ENV_FILE_ARGS[@]}"}" >/tmp/functions-serve.log 2>&1 &
CLI_PID=$!
# The `supabase` CLI wrapper forks a `supabase-go` child that does the real serving; a plain
# `kill $CLI_PID` only signals the wrapper — the child survives, reparents to init, and keeps
# holding :54321 (verified empirically: repeatable across runs, not a one-off race). Kill the
# child (scoped to OUR CLI_PID's own process tree, never a broad name-based pkill — this host
# runs other agents' own `supabase functions serve` in other worktrees) BEFORE the parent, then
# the parent itself.
cleanup() {
  pkill -P "$CLI_PID" 2>/dev/null || true
  kill "$CLI_PID" 2>/dev/null || true
  docker rm -f supabase_edge_runtime_pmo-portal >/dev/null 2>&1 || true
}
trap cleanup EXIT

# 2. health gate (60x2s)
for i in $(seq 1 60); do
  curl -sf http://localhost:54321/functions/v1/health >/dev/null && break || { sleep 2; }
  if [ "$i" = 60 ]; then
    echo "functions did not become healthy"
    cat /tmp/functions-serve.log
    exit 1
  fi
done
export SUPABASE_FUNCTIONS_URL=http://localhost:54321

# 3. run the caller's command (passed after --, or directly)
if [ "${1:-}" = "--" ]; then
  shift
fi
"$@"
