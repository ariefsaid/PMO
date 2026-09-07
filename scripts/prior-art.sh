#!/usr/bin/env bash
# prior-art.sh — "has this already been decided, built, or filed?" in one command.
#
# WHY THIS EXISTS. On 2026-08-24 a single session re-derived three things that already existed:
# `0194` (a catalog-derived sweep of the exact RLS class being audited), `DD-ENTRA-1` (the Entra
# option ruling), and the promote-gate stamp reader (`.claude/hooks/pre-pr-main-gate.sh`, reported as
# "nothing reads it" after grepping three of the four places it could live). Each cost real work and
# one produced a false issue. The habit failed repeatedly; a command does not.
#
# It searches the five places a prior answer hides — they are NOT the same place, which is the point:
#   docs/decisions.md      OD-/DD- rulings
#   docs/adr/              architecture decisions
#   supabase/migrations/   what actually shipped to the schema
#   scripts/ .claude/hooks/ .githooks/   the enforcement layer (the one most often missed)
#   gh issues (all states) including CLOSED — a closed issue is where a settled question lives
#
# Usage:  scripts/prior-art.sh <term> [more terms...]
#         scripts/prior-art.sh --self-test
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

hit() { # $1 label, rest: grep args
  local label="$1"; shift
  local out; out="$(grep -rniI --exclude-dir=node_modules --exclude-dir=.git "$@" 2>/dev/null | head -12)"
  if [ -n "$out" ]; then printf '\n=== %s ===\n%s\n' "$label" "$out"; return 0; fi
  return 1
}

search() {
  local term="$1" found=0
  printf '\n──────── prior art for: %s ────────\n' "$term"
  hit "decisions (OD-/DD-)" "$term" docs/decisions.md && found=1
  hit "ADRs"                "$term" docs/adr/          && found=1
  hit "migrations (shipped schema)" -l "$term" supabase/migrations/ && found=1
  hit "enforcement layer (scripts/hooks)" -l "$term" scripts/ .claude/hooks/ .githooks/ && found=1
  if command -v gh >/dev/null 2>&1; then
    local iss; iss="$(gh issue list --state all --search "$term" --limit 8 \
      --json number,state,title -q '.[] | "#\(.number) [\(.state)] \(.title)"' 2>/dev/null)"
    [ -n "$iss" ] && { printf '\n=== issues (INCLUDING CLOSED) ===\n%s\n' "$iss"; found=1; }
  else
    printf '\n(gh not available — issues NOT searched; that is a gap in this run, not an absence of prior art)\n'
  fi
  [ "$found" = 0 ] && printf '\nno prior art found in the five sources.\n'
  printf '\n⚑ Absence here is not proof. It means these five sources are silent — say that, not "nothing exists".\n'
}

if [ "${1:-}" = "--self-test" ]; then
  # A search tool that silently matches nothing looks exactly like a clean repo.
  out="$(search 'is_active_member')"
  echo "$out" | grep -q 'migrations (shipped schema)' || { echo "SELF-TEST FAIL: known-present term found no migration"; exit 1; }
  # ⚑ The probe term is ASSEMBLED at runtime and never appears whole in this file. Written as a
  # literal it matched — because `scripts/` is inside the search path, so the tool found its own
  # source and reported prior art for a term that exists nowhere else. A search tool whose scope
  # includes itself will always find itself; the first version of this self-test caught exactly that.
  absent="zzz""_absent""_probe""_marker"
  out2="$(search "$absent")"
  echo "$out2" | grep -q 'no prior art found' || { echo "SELF-TEST FAIL: absent term reported a hit"; exit 1; }
  echo "prior-art self-test: PASS (finds a known term; does not invent one)"; exit 0
fi

[ $# -ge 1 ] || { echo "usage: scripts/prior-art.sh <term> [more...]   |   --self-test" >&2; exit 2; }
for t in "$@"; do search "$t"; done
