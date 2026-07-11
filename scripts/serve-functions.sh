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
# Job control ON: without it, `cmd &` in a non-interactive script shares the SCRIPT's own process
# group (verified empirically — `ps -o pgid` on the background job matches the parent, not its own
# PID), so a process-group kill can't target it in isolation. `set -m` gives the background job its
# OWN process group (PGID == its PID), which `kill -- -"$CLI_PID"` below then targets directly —
# reaching the CLI wrapper's forked `supabase-go` child AND any of ITS children too (not just a
# single direct child), fixing the trap's "only walks one level of pkill -P" gap (Slice-0 fix-round
# finding 6).
set -m

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
# holding :54321 (verified empirically: repeatable across runs, not a one-off race). Belt-and-braces
# teardown (Slice-0 fix-round finding 6 — a bare `trap cleanup EXIT` misses SIGTERM/SIGINT/SIGHUP,
# leaking an orphaned `supabase-go`/deno tree + the runtime container when this script itself is
# killed, e.g. a CI job timeout or a developer Ctrl-C):
#   1. kill the WHOLE process group (`set -m` above put CLI_PID in its own group) — reaches the
#      wrapper, its `supabase-go` child, AND any grandchildren the child itself forks, not just one
#      pkill -P level deep.
#   2. pkill -P + a direct kill as a fallback in case a child raced past the group-kill's signal
#      delivery window (scoped to OUR CLI_PID's own tree, never a broad name-based pkill — this host
#      runs other agents' own `supabase functions serve` in other worktrees).
#   3. force-remove the runtime container regardless (a plain SIGTERM alone leaks it — spike fact).
cleanup() {
  kill -- -"$CLI_PID" 2>/dev/null || true
  pkill -P "$CLI_PID" 2>/dev/null || true
  kill "$CLI_PID" 2>/dev/null || true
  docker rm -f supabase_edge_runtime_pmo-portal >/dev/null 2>&1 || true
}
# EXIT covers normal/`set -e` termination; INT/TERM/HUP must ALSO exit explicitly afterward — a
# bash trap handler for a non-EXIT signal does NOT itself terminate the script (verified empirically:
# without the trailing `exit`, execution resumes at the line AFTER the interrupted command instead
# of tearing down), which would otherwise leave this script running past a killed serve process.
# 128+signum is the POSIX convention for a signal-caused exit code (INT=2, HUP=1, TERM=15).
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 129' HUP

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
