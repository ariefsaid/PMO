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
  echo "self-test OK"
  exit 0
fi

dir="${1:-$(dirname "$0")/../supabase/migrations}"
dups=$(ls "$dir" | grep -E '^[0-9]' | cut -d_ -f1 | sort | uniq -d || true)
if [[ -n "$dups" ]]; then
  echo "ERROR: duplicate migration prefix(es) in $dir — renumber before pushing:" >&2
  for p in $dups; do ls "$dir" | grep "^${p}_" | sed 's/^/  /' >&2; done
  exit 1
fi
echo "migration prefixes OK ($(ls "$dir" | grep -cE '^[0-9]') files, no duplicates)"
