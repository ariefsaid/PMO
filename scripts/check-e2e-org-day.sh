#!/usr/bin/env bash
# Fail when an e2e spec computes a calendar day from the RUNNER's clock for data the app reads by
# the ORGANISATION's day (#2917). The organisation runs on Asia/Jakarta: between 17:00 and 24:00 UTC
# the runner's UTC day (and on CI, whose local zone is UTC, every local-getter day) is a day behind
# the organisation's — AC-ATR-010 and AC-DSF-015 went red in exactly that window. Specs take days
# from `orgToday()`/`inDays()` (e2e/support/jobJourney.ts) instead.
#
# Flagged patterns (heuristic, not a proof — same ceiling as check-e2e-isolation.sh):
#   A) `.toISOString().slice(0, 10)` — an instant sliced into a day on the runner's clock.
#   B) local date getters `.getFullYear() .getMonth() .getDate() .getDay() .setDate(` — a day built
#      on the runner's local zone (CI = UTC). The `getUTC*` spellings are NOT flagged: a spec may
#      pin itself to UTC deliberately.
# A justified case carries the marker `e2e-org-day: allow` on the offending line or the line before
# it, with the reason. Comment lines are stripped first, so documenting the rule never trips it —
# but a marker line is kept, because it is the escape hatch itself.
# Run with --self-test to prove it catches violations.
set -euo pipefail

PATTERN_A='toISOString\(\)\.slice\(0, ?10\)'
PATTERN_B='\.getFullYear\(\)|\.getMonth\(\)|\.getDate\(\)|\.getDay\(\)|\.setDate\('
ALLOW='e2e-org-day: allow'

check_dir() {
  local root="$1" rc=0 f line prev
  while IFS= read -r f; do
    prev=""
    # Strip pure-comment lines (so the rule's own documentation never trips it) but KEEP allow-marker
    # lines, then judge each remaining line against the previous kept line (for a marker above).
    while IFS= read -r line; do
      if [[ "$line" == *"$ALLOW"* || "$prev" == *"$ALLOW"* ]]; then
        prev="$line"
        continue
      fi
      if [[ "$line" =~ $PATTERN_A ]]; then
        echo "  runner-clock day (toISOString().slice) in: $f" >&2
        echo "    $line" >&2
        echo "    use orgToday()/inDays() from e2e/support/jobJourney.ts, or add 'e2e-org-day: allow <reason>'" >&2
        rc=1
      elif [[ "$line" =~ $PATTERN_B ]]; then
        echo "  runner-local date getter in: $f" >&2
        echo "    $line" >&2
        echo "    use orgToday()/inDays() from e2e/support/jobJourney.ts, or add 'e2e-org-day: allow <reason>'" >&2
        rc=1
      fi
      prev="$line"
    done < <(awk -v allow="$ALLOW" '/^[[:space:]]*(\/\/|\*|\/\*)/ && index($0, allow) == 0 { next } { print }' "$f" 2>/dev/null)
  done < <(find "$root/e2e" -name '*.spec.ts' | sort)
  return $rc
}

if [[ "${1:-}" == "--self-test" ]]; then
  tmp=$(mktemp -d) && trap 'rm -rf "$tmp"' EXIT
  mkdir -p "$tmp/e2e"
  printf 'import { orgToday } from "../support/jobJourney";\nconst today = orgToday();\n' > "$tmp/e2e/ok.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: orgToday spec flagged" >&2; exit 1; }
  printf 'const day = new Date().toISOString().slice(0, 10);\n' > "$tmp/e2e/slice.spec.ts"
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: toISOString().slice not caught" >&2; exit 1; fi
  rm "$tmp/e2e/slice.spec.ts"
  printf 'const d = new Date(); d.setDate(d.getDate() - 7);\n' > "$tmp/e2e/getter.spec.ts"
  if check_dir "$tmp" >/dev/null 2>&1; then echo "self-test FAIL: local date getter not caught" >&2; exit 1; fi
  rm "$tmp/e2e/getter.spec.ts"
  printf 'const day = new Date().toISOString().slice(0, 10); // e2e-org-day: allow — deliberate UTC pin, reason here\n' > "$tmp/e2e/marked-inline.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: same-line allow marker not honored" >&2; exit 1; }
  rm "$tmp/e2e/marked-inline.spec.ts"
  printf '// e2e-org-day: allow — the grid reads the browser clock\nconst day = new Date().toISOString().slice(0, 10);\n' > "$tmp/e2e/marked-above.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: preceding-line allow marker not honored" >&2; exit 1; }
  rm "$tmp/e2e/marked-above.spec.ts"
  printf '// the rule bans toISOString().slice(0, 10) and .getDate() — this comment documents it\n' > "$tmp/e2e/comment.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: comment-only mention flagged" >&2; exit 1; }
  rm "$tmp/e2e/comment.spec.ts"
  printf 'const y = d.getUTCFullYear(); // deliberate UTC pin\n' > "$tmp/e2e/utc.spec.ts"
  check_dir "$tmp" >/dev/null || { echo "self-test FAIL: getUTC getter flagged" >&2; exit 1; }
  echo "self-test OK"; exit 0
fi

root="${1:-$(dirname "$0")/../pmo-portal}"
if check_dir "$root"; then
  echo "e2e org-day OK ($(find "$root/e2e" -name '*.spec.ts' | wc -l | tr -d ' ') specs checked)"
else
  echo "ERROR: runner-clock day computations above — fix before pushing (#2917; orgToday()/inDays() in e2e/support/jobJourney.ts)." >&2
  exit 1
fi
