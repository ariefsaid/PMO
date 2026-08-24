#!/usr/bin/env bash
# Fires on every Agent-tool dispatch (PreToolUse, non-blocking). One job: put the
# executor-routing rule in front of the model at the exact moment the habit strikes —
# the raw subagent dispatch that bypasses every skill.
#
# Added 2026-08-19 (#476, pattern proven in the sibling MOS repo). The gap it closes:
# CLAUDE.md and docs/factory-workflow.md carry the routing, but nothing FIRES at the
# dispatch seam — the other PreToolUse hooks gate `gh pr create` and `git push` only.
# Evidence it was needed: the routing text was corrected earlier the same day and three
# raw Agent dispatches still went out without any check running.
cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","additionalContext":"Routing check (docs/factory-workflow.md § Executor routing): for BUILD work the SSSF ADW is the default executor — `uv run adws/adw_simple_sdlc.py <brief.md>` (add `--builder fe_builder --reviewer fe_reviewer` for UI). A Claude/pi subagent dispatch for build work needs a stated lane exemption: money-path/SoD/auth/token-custody · anything under adws/ (protected_files bars agents, #482) · foggy or multi-issue (use /wayfinder) · research, analysis or design that produces a decision rather than a diff. Name the lane in the dispatch, or route it to the factory."}}
JSON
exit 0
