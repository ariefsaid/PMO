#!/usr/bin/env bash
# ci-round.sh — the read-the-rules gate for pushes CI will test (owner, 2026-11-28: seven CI rounds on one PR).
#   ack          print docs/ci-push-rules.md and stamp HEAD as read
#   check <branch> <sha>   called by .githooks/pre-push; exit 1 refuses the push
#   --self-test
# ponytail: the stamp proves the rules were printed to the pusher, not understood; the round cap is the hard stop.
set -euo pipefail
MAX_ROUNDS=3
root="$(git rev-parse --show-toplevel)"
stamps="$(git rev-parse --git-common-dir)/ci-rules-ack"

# decide <gated> <acked> <rounds> <owner_ok> → "ok" or the refusal reason
decide() {
  [ "$1" = 1 ] || { echo ok; return; }
  [ "$2" = 1 ] || { echo "read the rules first: scripts/ci-round.sh ack"; return; }
  if [ "$3" -ge "$MAX_ROUNDS" ] && [ -z "$4" ]; then
    echo "$3 CI rounds already on this branch (limit $MAX_ROUNDS): the next needs the owner's OK, CI_ROUND_OK=\"<their words>\""; return
  fi
  echo ok
}

case "${1:-}" in
  --self-test)
    t() { [ "$(decide "$1" "$2" "$3" "$4")" = ok ] && r=ok || r=no; [ "$r" = "$5" ] || { echo "FAIL decide $*"; exit 1; }; }
    t 0 0 9 "" ok; t 1 0 0 "" no; t 1 1 0 "" ok; t 1 1 2 "" ok; t 1 1 3 "" no; t 1 1 3 "go ahead" ok; t 1 0 3 "go ahead" no
    echo "ci-round self-test: ok" ;;
  ack)
    cat "$root/docs/ci-push-rules.md"
    mkdir -p "$stamps"; date -u +%FT%TZ > "$stamps/$(git rev-parse HEAD)"
    echo; echo "ci-round: rules shown; $(git rev-parse --short HEAD) stamped." ;;
  check)
    branch="$2"; sha="$3"
    # Gated: integration branches by name, and any branch with an open pull request (CI runs on its pushes).
    gated=0; rounds=0
    case "$branch" in batch/*|land/*|release/*) gated=1 ;; esac
    if command -v gh >/dev/null 2>&1; then
      [ "$gated" = 1 ] || [ "$(gh pr list --head "$branch" --state open --json number -q length 2>/dev/null || echo 0)" = 0 ] || gated=1
      [ "$gated" = 0 ] || rounds="$(gh run list --branch "$branch" --workflow ci.yml --event pull_request --limit 50 --json databaseId -q length 2>/dev/null || echo 0)"
    fi
    acked=0; [ -f "$stamps/$sha" ] && acked=1
    verdict="$(decide "$gated" "$acked" "$rounds" "${CI_ROUND_OK:-}")"
    [ "$gated" = 0 ] || echo "$(date -u +%FT%TZ) $branch $sha rounds=$rounds ok='${CI_ROUND_OK:-}' -> $verdict" >> "${CI_ROUND_LOG:-$HOME/.ci-round.log}"
    [ "$verdict" = ok ] || { echo "pre-push refused ($branch): $verdict" >&2; exit 1; } ;;
  *) echo "usage: scripts/ci-round.sh ack | check <branch> <sha> | --self-test" >&2; exit 2 ;;
esac
