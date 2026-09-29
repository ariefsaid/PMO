#!/usr/bin/env bash
# ci-e2e.sh — the ONLY way to dispatch the full e2e lane (ci.yml `integration`) for a branch.
#
# Owner CI fair-use rule (2026-09-29, agreed with the MOS Director; the same wrapper exists in
# gordi-mos): one dispatched e2e run per PR/branch; a second only as --bugfix-proof (the first run
# found a real app bug and app code changed — announce it); anything beyond that, or more than
# DAY_CAP dispatches in this repo today, needs --owner-ok "<the owner's quoted words>". Never
# while a dispatched heavy run is queued or running in PMO or MOS: both share the account's
# 20-job concurrency limit, and a second run only queues. Every dispatch is appended to the
# shared log $HOME/.ci-e2e.log. .claude/hooks/ci-e2e-gate.sh blocks raw `gh workflow run`.
#
# usage: scripts/ci-e2e.sh <branch> [--bugfix-proof "<why>" | --owner-ok "<quote>"] [--dry-run]
#        scripts/ci-e2e.sh --self-test
set -euo pipefail

REPO=ariefsaid/PMO
WF=ci.yml
DAY_CAP=3
LOG="${CI_E2E_LOG:-$HOME/.ci-e2e.log}"
# Heavy dispatchable workflows sharing the account's runners: "<repo> <workflow>".
HEAVY=("ariefsaid/PMO ci.yml" "ariefsaid/gordi-mos integration.yml")

# decide <busy> <today> <on_branch> <kind> → prints "ok" or the refusal reason.
decide() {
  local busy=$1 today=$2 on_branch=$3 kind=$4
  if [ "$busy" -gt 0 ]; then echo "a dispatched heavy run is already queued or running (PMO or MOS) — wait for it"; return; fi
  [ "$kind" = owner-ok ] && { echo ok; return; }
  if [ "$today" -ge "$DAY_CAP" ]; then echo "$today dispatches in $REPO today (cap $DAY_CAP) — needs --owner-ok"; return; fi
  if [ "$on_branch" -ge 2 ] || { [ "$on_branch" -eq 1 ] && [ "$kind" != bugfix-proof ]; }; then
    echo "$on_branch dispatch(es) already on this branch — a 2nd needs --bugfix-proof (real app bug fixed), a 3rd needs --owner-ok"; return
  fi
  echo ok
}

if [ "${1:-}" = --self-test ]; then
  t() { [ "$(decide "$1" "$2" "$3" "$4")" = ok ] && r=ok || r=no; [ "$r" = "$5" ] || { echo "FAIL decide $*"; exit 1; }; }
  t 0 0 0 normal ok;       t 1 0 0 normal no;      t 1 0 0 owner-ok no
  t 0 3 0 normal no;       t 0 3 0 owner-ok ok;    t 0 0 1 normal no
  t 0 0 1 bugfix-proof ok; t 0 0 2 bugfix-proof no; t 0 0 2 owner-ok ok
  echo "ci-e2e self-test: ok"; exit 0
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

n_runs() { gh run list -R "$1" --workflow "$2" --event workflow_dispatch "${@:3}" --limit 200 --json databaseId -q length; }
busy=0
for rw in "${HEAVY[@]}"; do
  read -r r w <<<"$rw"
  for st in queued in_progress; do busy=$((busy + $(n_runs "$r" "$w" --status "$st" 2>/dev/null || echo 0))); done
done
today=$(n_runs "$REPO" "$WF" --created ">=$(date -u +%Y-%m-%d)")
on_branch=$(n_runs "$REPO" "$WF" --branch "$branch")
pr=$(gh pr list -R "$REPO" --head "$branch" --state all --json number -q '.[0].number // "-"')

verdict=$(decide "$busy" "$today" "$on_branch" "$kind")
echo "ci-e2e: branch=$branch pr=#$pr today=$today on_branch=$on_branch busy=$busy kind=$kind → $verdict"
[ "$verdict" = ok ] || exit 3
[ "$dry" -eq 1 ] && exit 0

printf '%s\t%s\t%s#%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$REPO" "$branch" "$pr" "$kind" "$quote" >>"$LOG"
gh workflow run "$WF" -R "$REPO" --ref "$branch"
