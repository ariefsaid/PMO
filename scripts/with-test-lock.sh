#!/usr/bin/env bash
#
# with-test-lock.sh — machine-global mutual exclusion for the HEAVY NON-DB unit
# suite, so only ONE full vitest/verify run happens on this host at a time (T2).
# Under ~15 parallel agent worktrees, two concurrent `npm run verify` runs starve
# each other for CPU and produce FALSE REDs on the 5s jsdom render timeouts — a
# DIFFERENT test set each time, every one green in isolation (the tell that it is
# contention, not a regression: a real regression fails the same test
# deterministically; contention moves — docs/backlog.md T2). Wrap the whole run:
#
#   scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run verify'
#
# This serialises the test SUITE only. It is INDEPENDENT of the db lock (which
# serialises DB work) and the ERPNext lock (money e2e) — vitest is mocked and
# needs no stack, but two suites hammering the same CPU/RAM is the contention.
# Cooperative: it only works if ALL agents route heavy test runs through it.
#
# ── ACQUISITION ORDER (machine-global, outermost first): erpnext -> db -> test ──
# This is the INNERMOST lock — acquire it LAST (only after db/erpnext if a command
# needs those too). See scripts/lib/flock-run.sh.
#
#   PMO_TEST_LOCK          override the lock path (default ~/.pmo-test.lock)
#   PMO_TEST_LOCK_TIMEOUT  seconds to wait before giving up (default: wait forever)
set -euo pipefail

LOCK="${PMO_TEST_LOCK:-$HOME/.pmo-test.lock}"
TIMEOUT="${PMO_TEST_LOCK_TIMEOUT:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>   (wraps a heavy test-suite command in the shared lock)" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/lib/flock-run.sh" "test-lock" "$LOCK" "$TIMEOUT" "PMO_TEST_LOCK_HELD" \
  "the shared test suite" -- "$@"
