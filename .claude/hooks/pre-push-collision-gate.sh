#!/usr/bin/env bash
# PreToolUse(Bash) — run the ADR + migration collision gates before any push that lands on `dev`.
#
# WHY THIS EXISTS. Both gates already run inside `npm run verify`, which runs on PRs. But the
# project rule is that docs-only changes push DIRECT to dev with no PR — and an ADR is docs. So
# the one change type most likely to collide on a number is precisely the one that never reaches
# the gate. On 2026-07-29 that produced two live ADR-0069 files on dev (the trust boundary and
# the M365 linked-document drift), which is exactly what check-adr-collisions.sh was written to
# stop. A gate that cannot see the change it polices is decoration.
#
# Reads the hook payload on stdin; emits a PreToolUse deny decision, or nothing at all.
# Exits 0 in every path: a hook that errors is a hook that gets disabled.
set -uo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"

# Any push whose refspec mentions dev — `git push origin dev`, `git push origin HEAD:dev`,
# `git push origin some-branch:dev`, `git push -u origin dev`. A push to a feature branch is a
# PR candidate and CI will gate it, so it is deliberately NOT matched here.
case "$cmd" in
  *"git push"*dev*) ;;
  *) exit 0 ;;
esac

root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$root" ] || exit 0

out=""; rc=0
for gate in check-adr-collisions.sh check-migration-collisions.sh; do
  [ -f "$root/scripts/$gate" ] || continue   # gate not on this branch yet — do not invent a failure
  if ! g="$(bash "$root/scripts/$gate" 2>&1)"; then
    rc=1
    out="${out}
--- scripts/$gate ---
${g}"
  fi
done
[ "$rc" -eq 0 ] && exit 0

jq -nc --arg r "BLOCKED by .claude/hooks/pre-push-collision-gate.sh — a collision gate failed:
${out}

These run inside 'npm run verify', which only runs on PRs. Docs-only changes push direct to dev
with no PR, so an ADR — the change type most likely to collide on a number — would otherwise
never be checked. That is how two ADR-0069 files reached dev on 2026-07-29.

Renumber, then retry." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
