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
#   (a) FILENAME-FORM  "NNNN_slug" / "NNNN_slug.sql"   — matched as the FULL
#       basename `NNNN_<slug>`, never the bare prefix `NNNN_`. This matters:
#       pgTAP files in supabase/tests/ deliberately reuse migration prefixes
#       (0034/0052/0066 pre-exist and are TOLERATED — test files have no
#       ordering semantics), so a `NNNN_`-only rule would rewrite 7 unrelated
#       `0052_*.test.sql` references while renumbering migration 0052. Matching
#       the whole basename confines the sweep to the one migration. The
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

if [ "${1:-}" = "--self-test" ]; then
  SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  fail() { echo "self-test FAIL: $*" >&2; exit 1; }
  (
    cd "$tmp"
    git init -q . && git config user.email t@example.invalid && git config user.name t
    mkdir -p supabase/migrations/rollback docs
    echo "select 1;" > supabase/migrations/0001_base.sql
    echo "-- Reversible via supabase/migrations/rollback/0002_widget_down.sql." > supabase/migrations/0002_widget.sql
    echo "drop table widget; -- undo 0002_widget" > supabase/migrations/rollback/0002_widget_down.sql
    echo "see rollback/0002_widget_down.sql and 0002_widget.sql; keep 10002_widget" > docs/note.md
    git add -A && git commit -qm init
    "$SELF" 0002 0003 >/dev/null 2>&1 || fail "renumber exited non-zero"
    [ -f supabase/migrations/0003_widget.sql ] || fail "migration not renamed"
    [ -f supabase/migrations/rollback/0003_widget_down.sql ] || fail "rollback file not renamed"
    [ ! -e supabase/migrations/rollback/0002_widget_down.sql ] || fail "old rollback file remains"
    ! git grep -qE '(^|[^0-9])0002_widget' . || fail "stale reference to old number survived"
    git grep -q "rollback/0003_widget_down.sql" -- docs supabase/migrations/0003_widget.sql || fail "references not repointed to new rollback"
    git grep -q "10002_widget" -- docs || fail "5-digit token wrongly rewritten"
    [ -z "$(git status --porcelain | grep -v "^[MRAD]  " || true)" ] || { git status --porcelain >&2; fail "changes not fully staged"; }
  ) || exit 1
  echo "self-test OK"
  exit 0
fi

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

# ── rollback twin: supabase/migrations/rollback/<OLD>_*_down.sql ──
# The rollback file carries the same prefix and must move with its migration, or
# every reference we rewrite below would point at a file that no longer exists.
# Its slug may differ from the migration's, so collect those basenames too and
# sweep them as well (references with the migration's slug are caught by the main
# pattern, since a rollback basename normally starts with it).
ROLLBACK_DIR="$MIGRATIONS/rollback"
EXTRA_SLUGS=""
if [ -d "$ROLLBACK_DIR" ]; then
  while IFS= read -r rb; do
    [ -n "$rb" ] || continue
    rb_slug="${rb#${OLD}_}"; rb_slug="${rb_slug%.sql}"
    [ ! -e "$ROLLBACK_DIR/${NEW}_${rb_slug}.sql" ] || die "rollback target ${NEW}_${rb_slug}.sql already exists"
    echo "renumber-migration: git mv rollback/${rb} -> rollback/${NEW}_${rb_slug}.sql"
    git mv "$ROLLBACK_DIR/$rb" "$ROLLBACK_DIR/${NEW}_${rb_slug}.sql"
    EXTRA_SLUGS="${EXTRA_SLUGS}${EXTRA_SLUGS:+ }${rb_slug}"
  done < <(ls "$ROLLBACK_DIR" | grep -E "^${OLD}_[^/]+_down\.sql$" || true)
fi

SLUG_ALT="$SLUG"
for sl in $EXTRA_SLUGS; do SLUG_ALT="${SLUG_ALT}|${sl}"; done

# ── sweep: rewrite filename-form references NNNN_ -> MMMM_ (T6-safe loop) ──
# Boundary (^|[^[:digit:]]) so a 5-digit token like 10050_ is NOT touched. -I
# skips binaries; -z NUL-separates paths for `read -d ''`.
echo "renumber-migration: rewriting '${OLD}_' references -> '${NEW}_' ..."
# In-place edit WITHOUT `sed -i`: the suffix argument is incompatible between BSD
# sed (`-i ''`, macOS) and GNU sed (`-i`, Linux/CI) — `-i ''` makes GNU sed read an
# empty script and treat the expression as a filename, so it fails outright. Caught
# by CI, which runs Linux while this was only ever tested on macOS. Writing through
# a temp file and `cat`-ing back is portable AND preserves the original file's mode
# and inode (a `mv` would replace both).
rewrite_one() {
  local f="$1" tmp
  tmp="$(mktemp)"
  cp "$f" "$tmp.in"
  local sl
  for sl in "$SLUG" $EXTRA_SLUGS; do
    sed -E "s/(^|[^0-9])${OLD}_${sl}/\1${NEW}_${sl}/g" "$tmp.in" > "$tmp"
    cp "$tmp" "$tmp.in"
  done
  rm -f "$tmp.in"
  # Never write back an empty result. Every file we touch here is non-empty by
  # definition (git grep matched content in it), so an empty temp means sed did
  # not run or produced nothing — and `cat` would then TRUNCATE the original.
  # Silently emptying a source file while reporting success is the worst possible
  # outcome for this script; fail instead. (Found by mutation-testing the sweep.)
  if [ ! -s "$tmp" ]; then
    rm -f "$tmp"
    die "rewrite produced EMPTY output for $f — refusing to truncate it"
  fi
  cat "$tmp" > "$f"   # `cat >` not `mv`: preserves the original mode and inode
  rm -f "$tmp"
}
while IFS= read -r -d '' f; do
  rewrite_one "$f"
done < <(git grep -lzIE "(^|[^[:digit:]])${OLD}_(${SLUG_ALT})" . 2>/dev/null || true)

# ── GUARD (hard): did the sweep actually happen? ──
# Re-grep for FILENAME-FORM refs only. These are exactly what the sweep claims to
# rewrite, so a survivor means the sweep silently did nothing — the T6 failure
# this script exists to make impossible. Hard-fail; do NOT report success.
echo "renumber-migration: guard — re-grepping for surviving '${OLD}_(${SLUG_ALT})' references..."
GUARD_HITS="$(git grep -nIE "(^|[^[:digit:]])${OLD}_(${SLUG_ALT})" . 2>/dev/null || true)"
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

# ── stage the rewrites alongside the rename ──
# `git mv` stages the rename but `sed` edits are left unstaged. Leaving that split
# is a trap: a plain `git commit` (no -a) would commit the RENAMED migration while
# every rewritten reference stayed behind — the exact half-applied state this
# script exists to prevent. Stage everything, so the operation is atomic to review.
while IFS= read -r -d '' f; do
  git add -- "$f"
done < <(git grep -lzIE "(^|[^[:digit:]])${NEW}_(${SLUG_ALT})" . 2>/dev/null || true)

# ── collision check ──
echo "renumber-migration: running migration-prefix collision check ..."
if ! "$COLLISION_CHECK" "$MIGRATIONS" >/dev/null; then
  die "check-migration-collisions.sh failed after renumber — see above"
fi

echo "renumber-migration: OK — ${OLD}_${SLUG}.sql -> ${NEW}_${SLUG}.sql; no stale '${OLD}' references remain."
echo "renumber-migration: review with 'git status' / 'git diff --cached' and commit."
