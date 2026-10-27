# Orca dispatch — how agent work runs (owner, 2026-10-27)

Every subagent, builder, reviewer and cross-model job runs as an **Orca supervised worker**. Orca
launches any harness with any model, gives each worker its own worktree, and reports back when it
finishes. It replaces pi-delegation (`docs/pi-delegation.md`, kept as history) and the SSSF ADW as
the default executor. The gates, checkpoints and ceilings in `CLAUDE.md` are unchanged; only *who
runs the work* changed.

## Mechanics

Load the `orchestration` skill (supervised workers, tasks, waits) and `orca-cli` (worktrees,
terminals). The core call:

```
orca orchestration worker-start --spec "<brief or path>" --agent <harness> \
  --model <model-id> --effort <level> --worktree new-child --base-branch origin/dev
```

- **Harnesses:** `claude`, `codex`, `antigravity` (agy), `zcode`, `pi`, `dsh`. `orca orchestration
  worker-start --help` lists the ids enabled on this host; agents other than claude, codex and
  antigravity take their model from their own config.
- **One worker per task, with its full brief** — never reassign a worker to a different job.
- **Waiting:** use the orchestration skill's worker-done wait and cite it as `[watch: …]`; never
  poll by hand.
- Worktrees lack the vendored skills: briefs tell workers to run `scripts/vendor-skills.sh` when
  they need a skill.

## Model routing (defaults; right-size per task)

| Work | Model · harness · effort |
|---|---|
| Build a bounded code or UI slice | GPT-6 Luna · codex · xhigh |
| Spec, plan, hard fix round, design/rendered review | GPT-6.1 Sol · codex · medium |
| Complex assessment, second opinion on design or money | Gemini Argon · antigravity · high (quota-limited: reserve it) |
| Cross-family code or security review of a build | GLM-5.3-flash · pi or zcode · max |
| Quick, cheap, mechanical (formatting, lookups, summaries) | Gemini Flash (latest) · antigravity, or Claude Haiku · claude |
| Claude work when it fits best | Sonnet 5.5 · claude · medium/high; Opus 5.5 · claude · medium for design, money or security judgement |

Money-path, SoD and auth/token-custody work stays **Director-dispatched per issue** (one worker per
step, adversarial review, mutation checks) — now through Orca workers instead of pi.
Screen-by-screen UX/IA/IxD work runs with the `/restructure` skill.
