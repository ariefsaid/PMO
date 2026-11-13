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
# ── ACQUISITION ORDER (machine-global, outermost first): odoo -> erpnext -> db -> test ──
# This is the INNERMOST lock — acquire it LAST (only after db/erpnext if a command
# needs those too). See scripts/lib/flock-run.sh.
#
#   PMO_TEST_LOCK          override the lock path (default ~/.pmo-test.lock)
#   PMO_TEST_LOCK_TIMEOUT  seconds to wait before giving up (default: wait forever)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# The wrappers' own tests (temp lock paths only; they never touch the machine locks).
if [ "${1:-}" = "--self-test" ]; then
  [ "$#" -eq 1 ] || { echo "usage: $0 --self-test" >&2; exit 2; }
  exec node --test --test-name-pattern 'lock' "$DIR/parallel-infra.test.mjs"
fi

LOCK="${PMO_TEST_LOCK:-$HOME/.pmo-test.lock}"
TIMEOUT="${PMO_TEST_LOCK_TIMEOUT:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>   (wraps a heavy test-suite command in the shared lock)" >&2
  echo "       $0 --self-test    (runs the wrappers' own lock tests on temp paths)" >&2
  exit 2
fi

# 3 concurrent heavy suites machine-wide (PMO + MOS share these files): owner 2026-10-16, "skip the
# lock but mind OOM/CPU" on a 10-core/24 GB Mac with local vitest maxWorkers=2. PMO_TEST_LOCK_SLOTS=1 restores the mutex.
SLOTS="${PMO_TEST_LOCK_SLOTS:-3}"
# #2217: a DATABASE job holds the db lock (outer) while it waits here (inner), doing no DB work — and
# every other DB job on the machine is blocked behind it. Give a DB-lock holder at least two slots so
# it can never queue behind a unit/typecheck/build job, whatever PMO_TEST_LOCK_SLOTS the caller passed.
# Callers that hold no db lock (unit, typecheck, build) keep the slot count they asked for.
if [ -n "${PMO_DB_LOCK_HELD:-}" ]; then
  case "${PMO_DB_LOCK_HELD}" in
    0) ;;  # a defensive =0 means "not held": keep the slot count the caller asked for
    *)
      case "$SLOTS" in
        '' | *[!0-9]*) SLOTS=2 ;;
        *) if [ "$SLOTS" -lt 2 ]; then SLOTS=2; fi ;;
      esac
      ;;
  esac
fi
FLOCK_SLOTS="$SLOTS" exec "$DIR/lib/flock-run.sh" "test-lock" "$LOCK" "$TIMEOUT" "PMO_TEST_LOCK_HELD" \
  "the shared test suite" -- "$@"
