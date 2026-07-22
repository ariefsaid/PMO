#!/usr/bin/env bash
#
# flock-run.sh — the SHARED flock-and-run core behind the machine-global mutex
# wrappers with-db-lock.sh / with-erpnext-lock.sh / with-test-lock.sh. Collapses
# three byte-for-byte-identical python3/fcntl copies into one (T2/D1).
#
# Dependency-free: bash + python3 stdlib only. macOS ships no flock(1), which is
# why python3's fcntl is used — do NOT switch to flock(1). The lock is an ADVISORY
# OS lock (fcntl.flock) the kernel releases the instant the holding process exits
# (crash included), so there is never a stale lock to clean up.
#
# ── ACQUISITION ORDER (machine-global, outermost first): erpnext -> db -> test ──
# When a command needs MORE THAN ONE of these locks, acquire them in THIS order
# only, to avoid cross-lock deadlock. (db is outermost; test is innermost.)
# Each wrapper is independently re-entrant-safe via its OWN *_LOCK_HELD env var:
# a self-wrapping script — see scripts/m365-race-probe.sh, which relies on
# with-db-lock.sh exporting PMO_DB_LOCK_HELD=1 — checks that var before re-wrapping
# so it never re-acquires its own outer hold. The wrapper EXPORTS the var into the
# child env; the child decides to skip its own self-wrap. (The raw nested case
# `with-X-lock bash -c 'with-X-lock ...'` is NOT protected — do not nest a wrapper
# inside itself; self-wrap via the held-var check instead.)
#
# Invoked by the wrappers (not normally by hand):
#   flock-run.sh <label> <lock_path> <timeout> <held_env_var> <waiting_desc> -- <command...>
# label         short tag for stderr lines, e.g. "db-lock"
# lock_path     file to flock
# timeout       0 = wait forever; >0 = give up (exit 75 / EX_TEMPFAIL) after N seconds
# held_env_var  env var name to export=1 into the child so a self-wrap detects the hold
# waiting_desc  human phrase for the "waiting for ..." line, e.g. "the shared local Supabase DB"
# command...    the command to run under the lock (stdio inherited, incl. real stdin)
#
# Exit codes: the wrapped command's rc; 75 (EX_TEMPFAIL) on timeout; 2 on misuse.
set -euo pipefail

if [ "$#" -lt 7 ]; then
  echo "flock-run.sh: internal misuse — expected <label> <lock_path> <timeout> <held_var> <waiting_desc> -- <command...>" >&2
  exit 2
fi

LABEL="$1"; LOCK_PATH="$2"; TIMEOUT="$3"; HELD_VAR="$4"; WAITING_DESC="$5"
shift 5
if [ "${1:-}" != "--" ]; then
  echo "flock-run.sh: expected '--' before the command" >&2
  exit 2
fi
shift  # drop the '--'; "$@" is now the command

if [ "$#" -eq 0 ]; then
  echo "flock-run.sh: no command given after '--'" >&2
  exit 2
fi

exec python3 -c '
import fcntl, os, sys, time, subprocess
label        = sys.argv[1]
lock_path    = sys.argv[2]
timeout      = float(sys.argv[3])
held_var     = sys.argv[4]
waiting_desc = sys.argv[5]
cmd          = sys.argv[6:]
joined       = " ".join(cmd)
f = open(lock_path, "w")
t0 = time.time()
if timeout > 0:
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.time() - t0 > timeout:
                sys.stderr.write("[%s] gave up after %.0fs waiting for %s\n" % (label, timeout, lock_path))
                sys.exit(75)  # EX_TEMPFAIL
            time.sleep(1)
else:
    sys.stderr.write("[%s] waiting for %s (%s)...\n" % (label, waiting_desc, lock_path))
    fcntl.flock(f, fcntl.LOCK_EX)  # blocks; kernel releases it when this process exits
waited = time.time() - t0
sys.stderr.write("[%s] ACQUIRED (waited %.0fs) - running: %s\n" % (label, waited, joined))
f.write("pid=%d started=%s\n" % (os.getpid(), time.strftime("%H:%M:%S"))); f.flush()
# Re-entrancy: advertise the lock is held so a wrapped script that self-wraps in
# this same lock (e.g. `with-db-lock.sh scripts/m365-race-probe.sh`) does NOT
# re-acquire it recursively and self-deadlock. The child sees *_LOCK_HELD=1 and
# skips its own self-wrap.
if held_var:
    os.environ[held_var] = "1"
rc = subprocess.call(cmd)  # inherits stdio (real stdin) + the env above; lock held for its whole lifetime
sys.stderr.write("[%s] released (rc=%d)\n" % (label, rc))
sys.exit(rc)
' "$LABEL" "$LOCK_PATH" "$TIMEOUT" "$HELD_VAR" "$WAITING_DESC" "$@"
