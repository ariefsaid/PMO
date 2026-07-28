#!/usr/bin/env bash
# Fail when two files in docs/adr/ share the same numeric prefix.
#
# Sibling of check-migration-collisions.sh, and for the same reason: parallel agents branching off
# dev pick "the next free number" from a tree that no longer reflects dev. Migrations have had this
# gate for a while; ADRs did not, and the class has now bitten THREE times — 0058/0059 (#387) and
# 0037, where a design-language ADR was written over the number already held by the
# View-Composition compiler ADR. An ADR collision is worse than a migration collision: nothing
# errors, both documents keep existing under one id, and every citation to that number silently
# becomes ambiguous. #395 spent a whole PR repointing citations and still missed five of them.
#
# Run with --self-test to prove it catches a duplicate.
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  touch "$tmp/0001-a.md" "$tmp/0002-b.md"
  "$0" "$tmp" >/dev/null || { echo "self-test FAIL: clean dir flagged" >&2; exit 1; }
  touch "$tmp/0002-c.md"
  if "$0" "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: duplicate 0002 not caught" >&2; exit 1; fi
  # A gate that reports green having scanned nothing is worse than no gate — this repo has shipped
  # that bug twice (the tile gate's entrypoint check, the quota alarm's all-rows-skipped path).
  empty=$(mktemp -d) && trap 'rm -rf "$tmp" "$empty"' EXIT
  if "$0" "$empty" >/dev/null 2>&1; then echo "self-test FAIL: empty dir reported OK" >&2; exit 1; fi
  echo "self-test OK"
  exit 0
fi

dir="${1:-$(dirname "$0")/../docs/adr}"
[[ -d "$dir" ]] || { echo "ERROR: $dir is not a directory — this gate scanned nothing." >&2; exit 1; }

count=$(ls "$dir" | grep -cE '^[0-9]' || true)
if [[ "$count" -eq 0 ]]; then
  echo "ERROR: no numbered ADRs found in $dir — this gate scanned nothing." >&2
  exit 1
fi

dups=$(ls "$dir" | grep -E '^[0-9]' | cut -d- -f1 | sort | uniq -d || true)
if [[ -n "$dups" ]]; then
  echo "ERROR: duplicate ADR number(s) in $dir — renumber before pushing:" >&2
  for p in $dups; do ls "$dir" | grep "^${p}-" | sed 's/^/  /' >&2; done
  echo "  An ADR number is a citation target. Two documents under one number makes every" >&2
  echo "  reference to it ambiguous, and nothing will error to tell you." >&2
  exit 1
fi
echo "ADR numbers OK ($count files, no duplicates)"
