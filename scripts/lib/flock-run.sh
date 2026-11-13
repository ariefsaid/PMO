#!/usr/bin/env bash
#
# flock-run.sh — the SHARED flock-and-run core behind the machine-global mutex
# wrappers with-odoo-lock.sh / with-erpnext-lock.sh / with-db-lock.sh / with-test-lock.sh. Collapses
# three byte-for-byte-identical python3/fcntl copies into one (T2/D1).
#
# Dependency-free: bash + python3 stdlib only. macOS ships no flock(1), which is
# why python3's fcntl is used — do NOT switch to flock(1). The lock is an ADVISORY
# OS lock (fcntl.flock) the kernel releases the instant the holding process exits
# (crash included), so there is never a stale lock to clean up.
#
# ── ACQUISITION ORDER (machine-global, outermost first): odoo -> erpnext -> db -> test ──
# When a command needs MORE THAN ONE of these locks, acquire them in THIS order
# only, to avoid cross-lock deadlock: Odoo is outermost, then ERPNext, DB sits between it and
# test, and test is innermost.
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
# While a slot is held, "<slot>.holder" records pid, start time and the command line; a wait that
# passes PMO_LOCK_HOLDER_AFTER seconds (default 180) prints it ONCE, so a queued job explains itself
# instead of looking hung. The record is removed on release (the lock file itself keeps the pid stamp).
#
#   flock-run.sh --self-test   run the core's real-process tests (temp lock paths only)
#
# Exit codes: the wrapped command's rc; 75 (EX_TEMPFAIL) on timeout; 2 on misuse.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# The core's own real-process tests (temp lock paths only; CI runs the same file as
# "Lock wrapper process tests").
if [ "${1:-}" = "--self-test" ]; then
  [ "$#" -eq 1 ] || { echo "usage: $0 --self-test" >&2; exit 2; }
  exec python3 "$DIR/../tests/test_flock_run.py" -v
fi

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
# FLOCK_SLOTS=N (default 1) turns the mutex into an N-slot semaphore: slot 0 is lock_path itself,
# slots 1..N-1 are lock_path.1 .. lock_path.<N-1>. A wrapper with N=1 (or an older copy of this
# script) still contends only for slot 0, so mixed versions stay compatible.
# ponytail: polls free slots every second; a FIFO queue only if starvation shows up.
slots = max(1, int(os.environ.pop("FLOCK_SLOTS", "1") or "1"))  # pop: a nested lock (e.g. the db lock) must not inherit our slot count
paths = [lock_path] + ["%s.%d" % (lock_path, i) for i in range(1, slots)]
t0 = time.time()
announced = False
reported_holder = False

# Who holds a slot? The lock file itself keeps the byte-exact pid stamp the tests assert on, so the
# command line goes in a SIDECAR record (<slot>.holder) written on acquire and removed on release:
# a long wait then explains itself instead of looking like a hung job (#2217).
try:
    HOLDER_AFTER = float(os.environ.get("PMO_LOCK_HOLDER_AFTER", "180"))
except ValueError:
    HOLDER_AFTER = 180.0  # a bad override must never stop the lock from working

def holder_path(slot):
    return slot + ".holder"

def write_holder(slot, started):
    try:
        with open(holder_path(slot), "w") as record:
            record.write("pid=%d started=%s slots=%d cmd=%s\n" % (os.getpid(), started, slots, joined))
    except OSError:
        pass  # a diagnostic record must never break the run it describes

def clear_holder(slot):
    try:
        with open(holder_path(slot)) as record:
            mine = ("pid=%d " % os.getpid()) in record.read()
        if mine:
            os.unlink(holder_path(slot))
    except OSError:
        pass

def describe_holders():
    found = []
    for slot in paths:
        try:
            with open(holder_path(slot)) as record:
                line = record.read().strip()
        except OSError:
            continue
        if not line:
            continue
        # A holder killed outright (SIGKILL) leaves its record behind: say so rather than
        # repeating a dead process as if it were still holding the slot.
        state = ""
        try:
            holder_pid = int(line.split()[0].split("=")[1])
            os.kill(holder_pid, 0)
        except ProcessLookupError:
            state = " (stale: that pid is gone)"
        except (OSError, ValueError, IndexError):
            pass
        found.append("%s [%s]%s" % (line, slot, state))
    return "; ".join(found) or "unknown (no holder record)"

def report_holder_if_due(waited):
    global reported_holder
    if reported_holder or waited < HOLDER_AFTER:
        return
    reported_holder = True
    sys.stderr.write("[%s] still waiting after %.0fs - holder: %s\n" % (label, waited, describe_holders()))

if slots > 1:
    files = [open(p, "a") for p in paths]
    f = None
    while f is None:
        for cand, fh in zip(paths, files):
            try:
                fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
                f, lock_path = fh, cand
                break
            except BlockingIOError:
                pass
        if f is None:
            waited = time.time() - t0
            if timeout > 0 and waited > timeout:
                sys.stderr.write("[%s] gave up after %.0fs waiting for a free slot of %s\n" % (label, timeout, paths[0]))
                sys.exit(75)  # EX_TEMPFAIL
            if not announced:
                sys.stderr.write("[%s] waiting for %s (%d slots, %s)...\n" % (label, waiting_desc, slots, paths[0]))
                announced = True
            report_holder_if_due(waited)
            time.sleep(1)
    for fh in files:
        if fh is not f:
            fh.close()
else:
    # Opening in write mode truncates before flock succeeds, so a waiter would
    # erase the current lock-owner stamp while it is still blocked. Poll non-blocking so a long
    # wait can report its holder; the kernel still releases the lock the instant we exit.
    f = open(lock_path, "a")
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            waited = time.time() - t0
            if timeout > 0 and waited > timeout:
                sys.stderr.write("[%s] gave up after %.0fs waiting for %s\n" % (label, timeout, lock_path))
                sys.exit(75)  # EX_TEMPFAIL
            if not announced:
                sys.stderr.write("[%s] waiting for %s (%s)...\n" % (label, waiting_desc, lock_path))
                announced = True
            report_holder_if_due(waited)
            time.sleep(1)
waited = time.time() - t0
started = time.strftime("%H:%M:%S")
# Replace the prior stamp only after this process owns the lock.
f.seek(0); f.truncate()
f.write("pid=%d started=%s\n" % (os.getpid(), started)); f.flush()
write_holder(lock_path, started)
# Announce only after the stamp and the holder record exist: a reader that sees ACQUIRED may rely on both.
sys.stderr.write("[%s] ACQUIRED (waited %.0fs) - running: %s\n" % (label, waited, joined))
# Re-entrancy: advertise the lock is held so a wrapped script that self-wraps in
# this same lock (e.g. `with-db-lock.sh scripts/m365-race-probe.sh`) does NOT
# re-acquire it recursively and self-deadlock. The child sees *_LOCK_HELD=1 and
# skips its own self-wrap.
if held_var:
    os.environ[held_var] = "1"
try:
    rc = subprocess.call(cmd)  # inherits stdio (real stdin) + the env above; lock held for its whole lifetime
finally:
    clear_holder(lock_path)
sys.stderr.write("[%s] released (rc=%d)\n" % (label, rc))
sys.exit(rc)
' "$LABEL" "$LOCK_PATH" "$TIMEOUT" "$HELD_VAR" "$WAITING_DESC" "$@"
