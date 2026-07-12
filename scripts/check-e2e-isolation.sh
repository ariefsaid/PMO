#!/usr/bin/env bash
# Fail when an e2e spec does not correctly declare its parallel-isolation class.
# Every pmo-portal/e2e/**/*.spec.ts must carry `// @e2e-isolation: <class>` where class is one of
# read-only | self-isolated | dedicated-row | serial. `serial` specs must live under e2e/serial/.
# This is the forcing function that keeps workers:4 e2e green as new specs are added (design
# 2026-07-11-e2e-parallel-isolation). Heuristic, not a proof — see the ceiling note in the design.
# Run with --self-test to prove it catches violations.
set -euo pipefail

VALID='read-only|self-isolated|dedicated-row|serial'
# Shared SEED-PROJECT ids that specs mutate — a service-role write touching one, outside the
# serial/dedicated-row lanes, is the mode-2 collision smell. NOTE: the org id
# (00000000-…-0001) is deliberately NOT here — nearly every self-isolated spec references it to
# scope its OWN uniquely-named row, so flagging it is a false positive. P001/P002/SP-2401 are the
# heavily-read shared projects whose mutation actually collides.
SHARED_IDS='40000000-0000-0000-0000-000000000001|40000000-0000-0000-0000-000000000002|41000000-0000-0000-0000-000000000001'
# Direct-DB-write signal: the service-role admin client. Bare .insert(/.delete( are NOT used — they
# false-match HTTP clients (api.delete(mailpit)) and array/string methods. UI-driven writes are not
# statically detectable; the author classifies those (heuristic ceiling — see the design doc).
WRITE_SIGNAL='requireServiceRoleKey'

check_dir() {
  local root="$1" rc=0 f tag base
  while IFS= read -r f; do
    tag=$(grep -m1 -oE "@e2e-isolation: (${VALID})" "$f" | sed -E 's/.*: //') || true
    if [[ -z "$tag" ]]; then
      echo "  MISSING/invalid @e2e-isolation tag: $f" >&2; rc=1; continue
    fi
    base="${f#"$root"/}"
    # lane consistency
    if [[ "$tag" == "serial" && "$base" != e2e/serial/* ]]; then
      echo "  serial-tagged but not under e2e/serial/: $f" >&2; rc=1
    fi
    if [[ "$tag" != "serial" && "$base" == e2e/serial/* ]]; then
      echo "  under e2e/serial/ but not tagged serial: $f" >&2; rc=1
    fi
    # read-only must not do direct DB writes (service-role admin)
    if [[ "$tag" == "read-only" ]] && grep -qE "$WRITE_SIGNAL" "$f"; then
      echo "  read-only tag but uses the service-role admin client (a DB write): $f" >&2; rc=1
    fi
    # non-serial/non-dedicated must not service-role-write a shared SEED PROJECT
    if [[ "$tag" != "serial" && "$tag" != "dedicated-row" ]] && grep -qE "$SHARED_IDS" "$f" \
        && grep -qE "$WRITE_SIGNAL" "$f"; then
      echo "  ${tag} spec service-role-writes a SHARED seed project (use dedicated-row or serial): $f" >&2; rc=1
    fi
  done < <(find "$root/e2e" -name '*.spec.ts' | sort)
  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/e2e/serial"
  printf '// @e2e-isolation: read-only\n' > "$tmp/e2e/ok.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: valid tree flagged" >&2; exit 1; }
  printf 'no tag here\n' > "$tmp/e2e/bad.spec.ts"
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: untagged not caught" >&2; exit 1; fi
  rm "$tmp/e2e/bad.spec.ts"
  printf '// @e2e-isolation: serial\n' > "$tmp/e2e/wrongdir.spec.ts"   # serial tag, not in serial/
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: lane mismatch not caught" >&2; exit 1; fi
  echo "self-test OK"; exit 0
fi

root="${1:-$(dirname "$0")/../pmo-portal}"
if check_dir "$root"; then
  echo "e2e isolation OK ($(find "$root/e2e" -name '*.spec.ts' | wc -l | tr -d ' ') specs tagged)"
else
  echo "ERROR: e2e isolation violations above — fix before pushing (see docs/qa-portfolio.md)." >&2
  exit 1
fi
