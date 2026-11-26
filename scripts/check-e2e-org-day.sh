#!/usr/bin/env bash
# Fail when an e2e spec computes a calendar day from the RUNNER's clock for data the app reads by
# the ORGANISATION's day (#2917). The organisation runs on Asia/Jakarta: between 17:00 and 24:00 UTC
# the runner's UTC day (and on CI, whose local zone is UTC, every local-getter day) is a day behind
# the organisation's — AC-ATR-010 and AC-DSF-015 went red in exactly that window. Specs take days
# from `orgDay()` (e2e/support/orgDay.ts). New or edited specs also use the shared job-role fixture.
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
CREATE_USER='auth[[:space:]]*\.[[:space:]]*admin[[:space:]]*\.[[:space:]]*createUser[[:space:]]*\('
PATTERN_B='\.getFullYear\(\)|\.getMonth\(\)|\.getDate\(\)|\.getDay\(\)|\.setDate\('
ALLOW='e2e-org-day: allow'

check_dir() {
  local root="$1" role_scope="$2" rc=0 f line prev role_check changed_file
  local -a changed=('')
  if [[ "$role_scope" == changed ]]; then
    local base
    if base=$(git -C "$root" merge-base HEAD "${E2E_FIXTURE_BASE:-origin/dev}" 2>/dev/null); then
      while IFS= read -r -d "" f; do changed+=("$f"); done < <(
        git -C "$root" diff --relative --name-only -z "$base" -- e2e
        git -C "$root" ls-files --others --exclude-standard -z -- e2e
      )
    else
      # CI may have a shallow checkout with no base ref. Check every journey rather than fetching
      # or letting an unavailable merge-base silently skip the fixture check.
      role_scope=all
    fi
  fi
  while IFS= read -r f; do
    prev=""
    role_check=0
    if [[ "$role_scope" == all ]]; then
      role_check=1
    else
      for changed_file in "${changed[@]}"; do
        if [[ "$changed_file" == "${f#"$root"/}" ]]; then
          role_check=1
          break
        fi
      done
    fi
    # Strip pure-comment lines (so the rule's own documentation never trips it) but KEEP allow-marker
    # lines, then judge each remaining line against the previous kept line (for a marker above).
    while IFS= read -r line; do
      if [[ "$role_check" == 1 && "$line" =~ $CREATE_USER ]]; then
        echo "  direct user provisioning in $f: use jobRoleUser() from e2e/support/jobRole.ts" >&2
        rc=1
      fi
      if [[ "$line" == *"$ALLOW"* || "$prev" == *"$ALLOW"* ]]; then
        prev="$line"
        continue
      fi
      if [[ "$line" =~ $PATTERN_A ]]; then
        echo "  runner-clock day (toISOString().slice) in: $f" >&2
        echo "    $line" >&2
        echo "    use orgDay() from e2e/support/orgDay.ts, or add 'e2e-org-day: allow <reason>'" >&2
        rc=1
      elif [[ "$line" =~ $PATTERN_B ]]; then
        echo "  runner-local date getter in: $f" >&2
        echo "    $line" >&2
        echo "    use orgDay() from e2e/support/orgDay.ts, or add 'e2e-org-day: allow <reason>'" >&2
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
  check_dir "$tmp" all >/dev/null || { echo "self-test FAIL: orgToday spec flagged" >&2; exit 1; }
  printf 'const day = new Date().toISOString().slice(0, 10);\n' > "$tmp/e2e/slice.spec.ts"
  if check_dir "$tmp" all >/dev/null 2>&1; then echo "self-test FAIL: toISOString().slice not caught" >&2; exit 1; fi
  rm "$tmp/e2e/slice.spec.ts"
  printf 'await admin.auth.admin.createUser({ email, password });\n' > "$tmp/e2e/login.spec.ts"
  if check_dir "$tmp" all >/dev/null 2>&1; then echo "self-test FAIL: direct job-role provisioning not caught" >&2; exit 1; fi
  rm "$tmp/e2e/login.spec.ts"
  printf 'const d = new Date(); d.setDate(d.getDate() - 7);\n' > "$tmp/e2e/getter.spec.ts"
  if check_dir "$tmp" all >/dev/null 2>&1; then echo "self-test FAIL: local date getter not caught" >&2; exit 1; fi
  rm "$tmp/e2e/getter.spec.ts"
  printf 'const day = new Date().toISOString().slice(0, 10); // e2e-org-day: allow — deliberate UTC pin, reason here\n' > "$tmp/e2e/marked-inline.spec.ts"
  check_dir "$tmp" all >/dev/null || { echo "self-test FAIL: same-line allow marker not honored" >&2; exit 1; }
  rm "$tmp/e2e/marked-inline.spec.ts"
  printf '// e2e-org-day: allow — the grid reads the browser clock\nconst day = new Date().toISOString().slice(0, 10);\n' > "$tmp/e2e/marked-above.spec.ts"
  check_dir "$tmp" all >/dev/null || { echo "self-test FAIL: preceding-line allow marker not honored" >&2; exit 1; }
  rm "$tmp/e2e/marked-above.spec.ts"
  printf '// the rule bans toISOString().slice(0, 10) and .getDate() — this comment documents it\n' > "$tmp/e2e/comment.spec.ts"
  check_dir "$tmp" all >/dev/null || { echo "self-test FAIL: comment-only mention flagged" >&2; exit 1; }
  rm "$tmp/e2e/comment.spec.ts"
  printf 'const y = d.getUTCFullYear(); // deliberate UTC pin\n' > "$tmp/e2e/utc.spec.ts"
  check_dir "$tmp" all >/dev/null || { echo "self-test FAIL: getUTC getter flagged" >&2; exit 1; }
  # Exercise change selection from the app subdirectory inside a repository.
  app="$tmp/repo/pmo-portal"
  mkdir -p "$app/e2e"
  git -C "$tmp/repo" init -q
  printf 'await admin.auth.admin.createUser({ email, password });\n' > "$app/e2e/legacy.spec.ts"
  git -C "$tmp/repo" add .
  git -C "$tmp/repo" -c user.name=Fixture -c user.email=fixture@example.test commit -qm 'Seed guard case'
  E2E_FIXTURE_BASE=HEAD check_dir "$app" changed || { echo "self-test FAIL: unchanged role setup flagged" >&2; exit 1; }
  printf '\n// edited spec\n' >> "$app/e2e/legacy.spec.ts"
  if E2E_FIXTURE_BASE=HEAD check_dir "$app" changed >/dev/null 2>&1; then
    echo "self-test FAIL: edited spec bypassed job-role guard" >&2
    exit 1
  fi
  # A shallow CI checkout may have no origin/dev ref. In that case unchanged legacy specs must
  # still be checked; failing the merge-base lookup must never skip the role fixture guard.
  shallow="$tmp/shallow/pmo-portal"
  mkdir -p "$shallow/e2e"
  git -C "$tmp/shallow" init -q
  printf 'await admin.auth.admin.createUser({ email, password });\n' > "$shallow/e2e/unchanged.spec.ts"
  git -C "$tmp/shallow" add .
  git -C "$tmp/shallow" -c user.name=Fixture -c user.email=fixture@example.test commit -qm 'Seed shallow checkout case'
  if output=$(E2E_FIXTURE_BASE=origin/dev check_dir "$shallow" changed 2>&1); then
    echo "self-test FAIL: missing base ref skipped the all-journeys fallback" >&2
    exit 1
  elif [[ "$output" != *"direct user provisioning"* ]]; then
    echo "self-test FAIL: missing base ref did not fall back to checking all journey files" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "self-test OK"; exit 0
fi

root=$(cd "${1:-$(dirname "$0")/../pmo-portal}" && pwd)
if check_dir "$root" changed; then
  echo "e2e org-day OK ($(find "$root/e2e" -name '*.spec.ts' | wc -l | tr -d ' ') specs checked)"
else
  echo "ERROR: use the shared journey fixtures for the cases above (#2917)." >&2
  exit 1
fi
