#!/usr/bin/env bash
# Fail when two files in supabase/migrations/ share the same numeric prefix.
# Parallel agents branching off dev keep colliding on migration numbers; the
# collision only surfaces later as a confusing pgTAP/db-reset error in CI.
# This makes it a deterministic one-liner instead. Run with --self-test to
# prove it catches a duplicate.
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  touch "$tmp/0001_a.sql" "$tmp/0002_b.sql"
  "$0" "$tmp" >/dev/null || { echo "self-test FAIL: clean dir flagged" >&2; exit 1; }
  touch "$tmp/0002_c.sql"
  if "$0" "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: duplicate 0002 not caught" >&2; exit 1; fi
  # A gate that reports green having scanned nothing is worse than no gate. This one did exactly
  # that on an empty/absent dir — `ls` returns nothing, `uniq -d` finds no duplicates, exit 0,
  # "migration prefixes OK (0 files)". Same class as the tile gate's entrypoint check and the
  # quota alarm's all-rows-skipped path (both 2026-07-28). Guard the never-ran case.
  empty=$(mktemp -d) && trap 'rm -rf "$tmp" "$empty"' EXIT
  if "$0" "$empty" >/dev/null 2>&1; then echo "self-test FAIL: empty dir reported OK" >&2; exit 1; fi
  echo "self-test OK"
  exit 0
fi

dir="${1:-$(dirname "$0")/../supabase/migrations}"
[[ -d "$dir" ]] || { echo "ERROR: $dir is not a directory — this gate scanned nothing." >&2; exit 1; }
if [[ "$(ls "$dir" | grep -cE '^[0-9]' || true)" -eq 0 ]]; then
  echo "ERROR: no numbered migrations found in $dir — this gate scanned nothing." >&2
  exit 1
fi
dups=$(ls "$dir" | grep -E '^[0-9]' | cut -d_ -f1 | sort | uniq -d || true)
if [[ -n "$dups" ]]; then
  echo "ERROR: duplicate migration prefix(es) in $dir — renumber before pushing:" >&2
  for p in $dups; do ls "$dir" | grep "^${p}_" | sed 's/^/  /' >&2; done
  exit 1
fi
echo "migration prefixes OK ($(ls "$dir" | grep -cE '^[0-9]') files, no duplicates)"
