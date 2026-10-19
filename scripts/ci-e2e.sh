#!/usr/bin/env bash
# ci-e2e.sh — the ONLY way to dispatch the full e2e lane (ci.yml `integration`) for a branch.
#
# Owner CI fair-use rule (2026-09-29, agreed with the MOS Director): one
# dispatched e2e run per PR/branch; a second only as --bugfix-proof (the first run found a real app
# bug and app code changed — announce it); anything beyond that, or more than DAY_CAP dispatches in
# this repo today, needs --owner-ok "<the owner's quoted words>".
# Temporary cap: owner 2026-10-18, v0.23.0 only; revert to one after the release. Up to two dispatched
# browser runs may be queued or running across PMO and MOS; at two, refuse even with --owner-ok. Every dispatch
# is appended to the shared log $HOME/.ci-e2e.log. The coordinator keeps its reservation ledger
# beside that log. .claude/hooks/ci-e2e-gate.sh blocks raw `gh workflow run`.
#
# usage: scripts/ci-e2e.sh <branch> [--bugfix-proof "<why>" | --owner-ok "<quote>"] [--dry-run]
#        scripts/ci-e2e.sh --self-test
set -euo pipefail

REPO=ariefsaid/PMO
WF=ci.yml
DAY_CAP=3
CAPACITY=2
LOG="${CI_E2E_LOG:-$HOME/.ci-e2e.log}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Heavy dispatchable workflows sharing the account's runners: "<repo> <workflow>".
HEAVY=("ariefsaid/PMO ci.yml" "ariefsaid/gordi-mos integration.yml")

# decide <busy> <today> <on_branch> <kind> → prints "ok" or the refusal reason.
decide() {
  local busy=$1 today=$2 on_branch=$3 kind=$4
  if [ "$busy" -gt 1 ]; then echo "two dispatched heavy runs are already queued or running (PMO or MOS) — wait for one to finish"; return; fi
  [ "$kind" = owner-ok ] && { echo ok; return; }
  if [ "$today" -ge "$DAY_CAP" ]; then echo "$today dispatches in $REPO today (cap $DAY_CAP) — needs --owner-ok"; return; fi
  if [ "$on_branch" -ge 2 ] || { [ "$on_branch" -eq 1 ] && [ "$kind" != bugfix-proof ]; }; then
    echo "$on_branch dispatch(es) already on this branch — a 2nd needs --bugfix-proof (real app bug fixed), a 3rd needs --owner-ok"; return
  fi
  echo ok
}

if [ "${1:-}" = --self-test ]; then
  t() { [ "$(decide "$1" "$2" "$3" "$4")" = ok ] && r=ok || r=no; [ "$r" = "$5" ] || { echo "FAIL decide $*"; exit 1; }; }
  t 0 0 0 normal ok;       t 1 0 0 normal ok;      t 1 0 0 owner-ok ok
  t 2 0 0 normal no;       t 2 0 0 owner-ok no;    t 3 0 0 normal no; t 3 0 0 owner-ok no
  t 0 3 0 normal no;       t 0 3 0 owner-ok ok;    t 0 0 1 normal no
  t 0 0 1 bugfix-proof ok; t 0 0 2 bugfix-proof no; t 0 0 2 owner-ok ok
  t 1 3 0 normal no;       t 1 3 0 owner-ok ok;    t 1 0 1 normal no
  t 1 0 1 bugfix-proof ok; t 1 0 2 bugfix-proof no; t 1 0 2 owner-ok ok
  echo "ci-e2e self-test: ok"; exit 0
fi

# Check → dispatch → log runs under one machine-wide lock shared with MOS's wrapper, so two sessions
# in different repos can never both pass the busy check at once.
if [ -z "${CI_E2E_LOCK_HELD:-}" ]; then
  exec "$(cd "$(dirname "$0")" && pwd)/lib/flock-run.sh" "ci-e2e-lock" "${CI_E2E_LOCK:-$HOME/.ci-e2e.lock}" 60 \
    CI_E2E_LOCK_HELD "another session's CI dispatch check" -- "$0" "$@"
fi

usage() { echo "usage: $0 <branch> [--bugfix-proof \"<why>\" | --owner-ok \"<quote>\"] [--dry-run]" >&2; exit 2; }
[ $# -ge 1 ] || usage
branch=$1; shift
kind=normal; quote=""; dry=0
while [ $# -gt 0 ]; do
  case $1 in
    --bugfix-proof|--owner-ok) [ $# -ge 2 ] && [ -n "$2" ] || usage; kind=${1#--}; quote=$2; shift 2 ;;
    --dry-run) dry=1; shift ;;
    *) usage ;;
  esac
done

coordinator=(node "$SCRIPT_DIR/lib/ci-dispatch-reservations.mjs" coordinate
  --repo "$REPO" --workflow "$WF" --branch "$branch" --kind "$kind" --quote "$quote"
  --log "$LOG" --capacity "$CAPACITY" --daily-cap "$DAY_CAP")
for rw in "${HEAVY[@]}"; do
  read -r r w <<<"$rw"
  coordinator+=(--observe "$r:$w")
done
[ "$dry" -eq 1 ] && coordinator+=(--dry-run)
exec "${coordinator[@]}"
