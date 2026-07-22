#!/usr/bin/env bash
#
# renumber-migration.sh — renumber ONE Supabase migration safely (the remaining
# half of T1). Today this is a hand-rolled `git mv` + a cross-reference sweep,
# and a stale reference inside a reversibility note has actively mislead a
# rollback. This script renames the file AND rewrites every textual reference to
# the old prefix, then FAILS LOUDLY if any reference survives (so it can never
# report a success it did not achieve).
#
# Usage:
#   scripts/renumber-migration.sh <old-4-digit-prefix> <new-4-digit-prefix>
# Example:
#   scripts/renumber-migration.sh 0050 0051
#
# ── MATCHING RULE (conservative — will not touch unrelated 4-digit numbers) ──
# A migration is referenced two ways:
#   (a) FILENAME-FORM  "NNNN_slug" / "NNNN_slug.sql"   — the 4-digit prefix
#       immediately followed by `_`. This is unambiguous (a 4-digit token +
#       underscore is a migration filename token) and is AUTO-REWRITTEN. The
#       HARD guard re-greps for these afterwards: a survivor proves the sweep
#       silently did nothing (T6), so the script EXITS NON-ZERO rather than
#       claim a success it did not achieve.
#   (b) BARE-FORM      "migration 0050", "revert 0050" — the number without `_`.
#       NOT auto-rewritten: a bare 4-digit number is indistinguishable from an
#       ADR number, a PR number or a year, and blind rewriting corrupts them.
#       Reported as an ADVISORY list for human review (failing on these would
#       false-alarm on every unrelated 4-digit match). A reversibility note
#       citing the old number is the one that genuinely must be hand-updated.
#
# The boundary is "not preceded/followed by a digit" (ERE `(^|[^[:digit:]])` /
# `([^[:digit:]]|$)`), so `10050_` is NOT matched when old=0050, and `00505` is
# NOT matched either. macOS BSD sed has no `\b`, hence the capture-group form
# `s/(^|[^0-9])NNNN_/\1MMMM_/g` (verified on bash 3.2 + BSD sed).
#
# ── T6 SAFETY (the word-split trap that faked a clean result) ──
# File lists are consumed with `while IFS= read -r f; do ...; done` (NUL-separated
# via `git grep -lz`), NEVER `for f in $FILES`. An unquoted list var does not
# word-split under zsh and silently changes nothing; the re-grep guard below
# catches that too, but the loop is correct by construction.
#
# Refuses (exit non-zero) if: bad args, old file missing/ambiguous, new prefix
# already taken, old==new, the working tree is dirty, or the migration is
# plausibly already applied (pushed to origin/dev or origin/main — override with
# RENUMBER_FORCE=1 ONLY if you are certain no environment has applied it).
# Finishes by running scripts/check-migration-collisions.sh and failing if it does.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
COLLISION_CHECK="$DIR/check-migration-collisions.sh"

die() { echo "renumber-migration: ERROR: $*" >&2; exit 1; }

[ -x "$COLLISION_CHECK" ] || die "collision checker not found/executable at $COLLISION_CHECK"

# ── args ──
[ "$#" -eq 2 ] || { echo "usage: $0 <old-4-digit-prefix> <new-4-digit-prefix>" >&2; exit 2; }
OLD="$1"; NEW="$2"
[[ "$OLD" =~ ^[0-9]{4}$ ]] || die "old prefix must be exactly 4 digits (got '$OLD')"
[[ "$NEW" =~ ^[0-9]{4}$ ]] || die "new prefix must be exactly 4 digits (got '$NEW')"
[ "$OLD" != "$NEW" ] || die "old and new prefixes are identical ($OLD)"

# ── repo + migrations dir ──
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository"
cd "$ROOT"   # all git/grep ops run from the repo root
MIGRATIONS="$ROOT/supabase/migrations"
[ -d "$MIGRATIONS" ] || die "migrations dir not found: $MIGRATIONS"

# ── pre-flight refusals ──
# dirty tree: refuse so the renumber doesn't tangle with unrelated edits. Commit
# or stash first. (`git status --porcelain` covers staged, unstaged, untracked.)
if [ -n "$(git status --porcelain)" ]; then
  git status --porcelain >&2
  die "working tree is dirty — commit or stash before renumbering (see above)"
fi

# old file: exactly one match ${OLD}_*.sql
OLD_FILE="$(ls "$MIGRATIONS" 2>/dev/null | grep -E "^${OLD}_[^/]+\.sql$" || true)"
[ -n "$OLD_FILE" ] || die "no migration file matches '${OLD}_*.sql' in $MIGRATIONS"
OLD_COUNT="$(printf '%s\n' "$OLD_FILE" | grep -c . )"
if [ "$OLD_COUNT" -ne 1 ]; then
  printf '%s\n' "$OLD_FILE" >&2
  die "expected exactly one '${OLD}_*.sql', found $OLD_COUNT (see above)"
fi
OLD_FILE="$MIGRATIONS/$OLD_FILE"
SLUG="${OLD_FILE##*/${OLD}_}"          # everything after "OLD_"
SLUG="${SLUG%.sql}"                     # strip trailing .sql

# new prefix free?
if ls "$MIGRATIONS" 2>/dev/null | grep -qE "^${NEW}_[^/]+\.sql$"; then
  ls "$MIGRATIONS" | grep -E "^${NEW}_" >&2
  die "new prefix '${NEW}' is already taken in $MIGRATIONS (see above)"
fi

# already pushed/applied? (heuristic: present in a remote-tracking branch)
ALREADY_PUSHED_REFS=""
for ref in origin/dev origin/main origin/production; do
  if git rev-parse --verify --quiet "$ref" >/dev/null; then
    if git ls-tree -r --name-only "$ref" -- supabase/migrations/ 2>/dev/null | grep -qE "/${OLD}_"; then
      ALREADY_PUSHED_REFS="${ALREADY_PUSHED_REFS}${ALREADY_PUSHED_REFS:+ }$ref"
    fi
  fi
done
if [ -n "$ALREADY_PUSHED_REFS" ]; then
  cat >&2 <<EOF
renumber-migration: WARNING: migration ${OLD}_${SLUG}.sql is present in remote(s):
  $ALREADY_PUSHED_REFS
Renumbering a migration that has ALREADY BEEN APPLIED by any environment is
UNSAFE — that DB recorded it under the old number and will re-apply the new
number on its next reset, silently double-applying. Only do this if NO
environment has run it (e.g. you caught a collision before anyone reset).
EOF
  if [ "${RENUMBER_FORCE:-0}" != "1" ]; then
    die "refusing to renumber an already-pushed migration (set RENUMBER_FORCE=1 to override)"
  fi
  echo "renumber-migration: RENUMBER_FORCE=1 set — proceeding despite the above." >&2
fi

# ── rename (git mv preserves history) ──
NEW_FILE="$MIGRATIONS/${NEW}_${SLUG}.sql"
echo "renumber-migration: git mv ${OLD}_${SLUG}.sql -> ${NEW}_${SLUG}.sql"
git mv "$OLD_FILE" "$NEW_FILE"

# ── sweep: rewrite filename-form references NNNN_ -> MMMM_ (T6-safe loop) ──
# Boundary (^|[^[:digit:]]) so a 5-digit token like 10050_ is NOT touched. -I
# skips binaries; -z NUL-separates paths for `read -d ''`.
echo "renumber-migration: rewriting '${OLD}_' references -> '${NEW}_' ..."
rewrite_one() {
  local f="$1"
  sed -E -i '' "s/(^|[^0-9])${OLD}_/\1${NEW}_/g" "$f"
}
while IFS= read -r -d '' f; do
  rewrite_one "$f"
done < <(git grep -lzIE "(^|[^[:digit:]])${OLD}_" . 2>/dev/null || true)

# ── GUARD (hard): did the sweep actually happen? ──
# Re-grep for FILENAME-FORM refs only. These are exactly what the sweep claims to
# rewrite, so a survivor means the sweep silently did nothing — the T6 failure
# this script exists to make impossible. Hard-fail; do NOT report success.
echo "renumber-migration: guard — re-grepping for surviving '${OLD}_' references..."
GUARD_HITS="$(git grep -nIE "(^|[^[:digit:]])${OLD}_" . 2>/dev/null || true)"
if [ -n "$GUARD_HITS" ]; then
  echo "renumber-migration: ERROR — '${OLD}_' references SURVIVED the sweep:" >&2
  printf '%s\n' "$GUARD_HITS" | sed 's/^/  /' >&2
  cat >&2 <<EOF
The rewrite did not take effect. The tree is now PARTIALLY renumbered (the file
was moved, references were not). Undo with:  git reset --hard HEAD
EOF
  die "sweep failed — refusing to report success"
fi

# ── GUARD (advisory): bare-form soft references ──
# "migration 0050" / "revert 0050" — deliberately NOT auto-rewritten, because a
# bare 4-digit number is indistinguishable from an ADR number, a PR number or a
# year, and blind rewriting corrupts them. Report for human review; do not fail
# (failing here would be a false alarm on every unrelated 4-digit match).
BARE_HITS="$(git grep -nIE "(^|[^[:digit:]])${OLD}([^[:digit:]_]|\$)" . 2>/dev/null || true)"
if [ -n "$BARE_HITS" ]; then
  echo "renumber-migration: REVIEW — bare '${OLD}' tokens (NOT rewritten; most are" >&2
  echo "  unrelated ADR/PR/year numbers, but a reversibility note citing the old" >&2
  echo "  migration number MUST be updated by hand):" >&2
  printf '%s\n' "$BARE_HITS" | sed 's/^/  /' >&2
fi

# ── collision check ──
echo "renumber-migration: running migration-prefix collision check ..."
if ! "$COLLISION_CHECK" "$MIGRATIONS" >/dev/null; then
  die "check-migration-collisions.sh failed after renumber — see above"
fi

echo "renumber-migration: OK — ${OLD}_${SLUG}.sql -> ${NEW}_${SLUG}.sql; no stale '${OLD}' references remain."
echo "renumber-migration: review with 'git status' / 'git diff --cached' and commit."
