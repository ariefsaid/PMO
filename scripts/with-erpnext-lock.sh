#!/usr/bin/env bash
#
# with-erpnext-lock.sh — mutual exclusion for the ERPNext v15 dev-bed Docker stack
# (docs/environments.md "ERPNext v15 dev bed (P2)"). A SECOND shared resource on this
# host, distinct from the local Supabase stack (locked by with-db-lock.sh) — the
# ERPNext bench is a single machine-global Docker Compose project
# (`~/Coding/frappe-docker-pmo`), so two agents driving money e2e against it at once
# (creating/submitting/cancelling the same doctypes) corrupt each other's runs. Same
# flock idiom as with-db-lock.sh, a DIFFERENT lockfile — these two locks are
# independent and BOTH must be held for the full money-e2e recipe:
#
#   scripts/with-db-lock.sh scripts/with-erpnext-lock.sh scripts/serve-functions.sh -- \
#     npx playwright test e2e/AC-ENA-053-*
#
#   PMO_ERPNEXT_LOCK          override the lock path (default ~/.pmo-erpnext.lock)
#   PMO_ERPNEXT_LOCK_TIMEOUT  seconds to wait before giving up (default: wait forever)
set -euo pipefail

LOCK="${PMO_ERPNEXT_LOCK:-$HOME/.pmo-erpnext.lock}"
TIMEOUT="${PMO_ERPNEXT_LOCK_TIMEOUT:-0}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <command...>   (wraps an ERPNext-bench-driving command in the shared lock)" >&2
  exit 2
fi

exec python3 -c '
import fcntl, os, sys, time, subprocess
lock_path = sys.argv[1]
timeout = float(sys.argv[2])
cmd = sys.argv[3:]
joined = " ".join(cmd)
f = open(lock_path, "w")
t0 = time.time()
if timeout > 0:
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.time() - t0 > timeout:
                sys.stderr.write("[erpnext-lock] gave up after %.0fs waiting for %s\n" % (timeout, lock_path))
                sys.exit(75)  # EX_TEMPFAIL
            time.sleep(1)
else:
    sys.stderr.write("[erpnext-lock] waiting for the shared ERPNext dev bed (%s)...\n" % lock_path)
    fcntl.flock(f, fcntl.LOCK_EX)  # blocks; kernel releases it when this process exits
waited = time.time() - t0
sys.stderr.write("[erpnext-lock] ACQUIRED (waited %.0fs) - running: %s\n" % (waited, joined))
f.write("pid=%d started=%s\n" % (os.getpid(), time.strftime("%H:%M:%S"))); f.flush()
rc = subprocess.call(cmd)  # inherits stdio (real stdin), lock held for its whole lifetime
sys.stderr.write("[erpnext-lock] released (rc=%d)\n" % rc)
sys.exit(rc)
' "$LOCK" "$TIMEOUT" "$@"
