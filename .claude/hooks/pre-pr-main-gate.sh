#!/usr/bin/env bash
# PreToolUse(Bash) — refuse `gh pr create --base main` unless scripts/verify-main-pr.sh
# has passed against the CURRENT HEAD of this worktree.
#
# WHY THIS EXISTS. AGENTS.md has carried a binding owner directive since 2026-07-24: run
# scripts/verify-main-pr.sh before creating, pushing or refreshing any PR targeting `main`.
# On 2026-07-29 it was skipped anyway on PR #412, and CI spent 30 minutes discovering
# locally-reproducible e2e failures — then hit its job cap and killed Playwright before it
# could print them, so the run cost 30 minutes and produced no diagnosis. A rule that only
# holds when someone remembers to invoke it is not a rule.
#
# Reads the hook payload on stdin; emits a PreToolUse deny decision, or nothing at all.
# Exits 0 in every path: a hook that errors is a hook that gets disabled.
set -uo pipefail

payload="$(cat)"
cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null || echo '')"

# Only PRs whose BASE is main. `--base dev` and every other gh call pass straight through.
case "$cmd" in
  *"gh pr create"*"--base main"*|*"gh pr create"*"--base=main"*|*"gh pr create"*"-B main"*) ;;
  *) exit 0 ;;
esac

git_dir="$(git rev-parse --git-dir 2>/dev/null || true)"
[ -n "$git_dir" ] || exit 0          # not a repo — nothing to assert
head="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$head" ] || exit 0             # no commits — nothing to assert

# ⚑ COMPARE TREES, NOT COMMITS (#555). The gate tests the working tree, so the tree is what it
# certified. A squash-merge into `dev` produces a new SHA with a byte-identical tree; keying on the
# commit forced a thirty-minute re-run to certify content already certified.
tree="$(git rev-parse 'HEAD^{tree}' 2>/dev/null || true)"
[ -n "$tree" ] || exit 0

stamp="$(cat "$git_dir/verify-main-pr-ok" 2>/dev/null || echo '')"
[ "$stamp" = "$tree" ] && exit 0     # verified against this exact CONTENT — allow

if [ -z "$stamp" ]; then
  why="scripts/verify-main-pr.sh has never passed in this worktree."
elif [ "$stamp" = "$head" ]; then
  # A stamp written by the pre-#555 script, which recorded the commit. It may well describe this
  # exact content, but nothing here can tell — so it FAILS CLOSED and asks for one cheap re-run.
  why="the stamp records a COMMIT ($(git rev-parse --short "$stamp" 2>/dev/null || echo "$stamp")), not a tree — it predates the tree-keyed stamp (#555). Re-run the gate once and it will not happen again."
else
  why="the last passing run certified tree $(git rev-parse --short "$stamp" 2>/dev/null || echo "$stamp"), but HEAD's tree is now $(git rev-parse --short "$tree"). The CONTENT changed since the gate ran — note a squash or rebase that preserves content does NOT trip this."
fi

jq -nc --arg r "BLOCKED by .claude/hooks/pre-pr-main-gate.sh — $why

AGENTS.md (binding, owner directive 2026-07-24): before creating, pushing or refreshing any PR
targeting main, run scripts/verify-main-pr.sh from the repo root. It runs the full verify gate,
the Deno suites, a fresh Supabase stack, every pgTAP test and the COMPLETE Playwright/visual
portfolio — the parts CI's integration lane runs and 'npm run verify' does not.

Run it, then retry. If it fails, that is the point: you get real error text locally instead of a
CI job that hits its 30-minute cap and kills Playwright before printing the failure.

Targeted spec reruns and scripts/e2e-local.sh are inner-loop tools, never a substitute." \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
exit 0
