#!/usr/bin/env bash
# PreToolUse(Bash) — the cloud DB is read through scripts/prod-read.sh and written through
# scripts/db-push-prod.sh (docs/environments.md). The `supabase` CLI's --linked commands need a
# management token, fail without one, and tempt agents into fetching it ad hoc (2026-10-23).
# Reads the hook payload on stdin; emits a deny decision or nothing. Exits 0 in every path.
set -uo pipefail

cmd="$(jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"
case "$cmd" in
  *supabase*--linked*) ;;
  *) exit 0 ;;
esac

jq -nc --arg r "BLOCKED by .claude/hooks/prod-db-path-gate.sh — use the runbook (docs/environments.md): read the cloud DB with scripts/prod-read.sh -c \"<sql>\" (migration level: select max(version) from supabase_migrations.schema_migrations); push schema with scripts/db-push-prod.sh. Never the supabase CLI with --linked." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
