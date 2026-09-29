#!/usr/bin/env bash
# PreToolUse(Bash) — dispatching or re-running CI goes through scripts/ci-e2e.sh (owner CI
# fair-use rule, 2026-09-29): it enforces the per-PR and per-day caps and the shared-runner check.
# An honour rule let one PR take three e2e dispatches in a day (#725).
# Reads the hook payload on stdin; emits a deny decision or nothing. Exits 0 in every path.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"
case "$cmd" in
  *"scripts/ci-e2e.sh"*) exit 0 ;;
  *"gh workflow run"*|*"gh run rerun"*|*"/dispatches"*) ;;
  *) exit 0 ;;
esac

jq -nc --arg r "BLOCKED by .claude/hooks/ci-e2e-gate.sh — dispatch the e2e lane with scripts/ci-e2e.sh <branch> (caps: 1 per PR, a 2nd only as --bugfix-proof, >3/day or more needs --owner-ok \"<owner's words>\"). Re-running a failed run to check for a fluke needs the owner's explicit OK: diagnose locally first." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
