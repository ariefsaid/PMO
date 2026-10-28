# Orca dispatch — how agent work runs (owner, 2026-10-27)

Every subagent, builder, reviewer and cross-model job runs as an **Orca supervised worker**. Orca
launches any harness with any model, gives each worker its own worktree, and reports back when it
finishes. It replaces pi-delegation and the SSSF ADW as the default executor. The gates, checkpoints and ceilings in `CLAUDE.md` are unchanged; only *who
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

**Cheapest first (owner, 2026-10-28):** spend quota in this order and stop at the first model that can do
the job well: Gemini Flash → GLM-5.3-flash → GPT (Luna, then Sol) → Claude (Sonnet, then Opus). Claude
tokens are preserved for the Opus orchestrator: no Opus while Sol has quota; no Opus or Sol where Sonnet
or Luna will do; no Luna where GLM will do. Only a used-up quota moves work up a rung, not habit. Routing applies before `worker-start`: never stop a running worker to re-route it; stop only on the owner's explicit "stop".

| Work | Model · harness · effort |
|---|---|
| Quick, cheap, mechanical (formatting, lookups, summaries, transcript harvests) | Gemini Flash (latest) · antigravity |
| Bounded build with a precise brief; code or security review of a build; read-only audits | GLM-5.3-flash · pi (Z.AI provider) · max — see GLM launch below |
| Build a slice GLM can't (judgement, UI craft) | GPT-6 Luna · codex · xhigh |
| Spec, plan, hard fix round, design/rendered review, money or security judgement | GPT-6.1 Sol · codex · medium |
| Complex assessment, second opinion on design or money | Gemini Argon · antigravity · high (quota-limited: reserve it) |
| Only when GPT quota is out, or the job needs Claude | Sonnet 5.5 · claude · medium/high; then Opus 5.5 · claude |

**GLM launch.** `--agent pi` ignores `--model` and runs pi's own default provider, which is not GLM, and
`zcode` does not start under Orca. Start GLM by opening a terminal in the worker's worktree that runs
`pi --provider zai --model glm-5.3-flash:max`, then `orca orchestration worker-start --terminal <handle>`.

Money-path, SoD and auth/token-custody work stays **Director-dispatched per issue** (one worker per
step, adversarial review, mutation checks) — now through Orca workers instead of pi.
Screen-by-screen UX/IA/IxD work runs with the `/restructure` skill.

## Briefs

A worker sees nothing of your session; the brief stands alone:

1. The task in one line, with the role contract (`.claude/agents/<role>.md`) it works to.
2. A read-first list of exact paths (spec, plan, reference slice, ADRs); the worker reads them itself.
3. The exact output: files, branch, PR target.
4. Scope fences: what not to touch, what is already decided.
5. A persistence clause (finish every item; stopping early with partial work is the known failure)
   and a final sentinel line (`DONE: <task>`) so a killed or truncated run is obvious.
6. "Check your own work against the input list and report deviations."
7. Fix rounds: numbered findings, "fix all, change nothing else". After a killed run: list only
   the missing items, "don't rework what landed".

Workhorse models (Luna, Flash) are strong builders but weak readers of intent: spell out the
seams — exact files, names and the one behaviour each test must prove.

## Verifying a worker

Never accept a completion report on its word:

- The artifact exists, ends with the sentinel, and `git diff` matches the claims.
- Grep the load-bearing claims (finding ids, AC ids, constants); render UI work yourself.
- Read the worker's gate evidence; re-run only a targeted check you doubt — CI runs the full suite.
- A killed or timed-out run leaves half-applied edits: `git diff` first, then a completion round,
  never a blind retry.
- Cross-family review complements your own read; it doesn't replace it. On anything
  load-bearing, run both.

Known failure tendencies: e2e assertions softened to "element exists" or wrapped in `.catch`
(reject on sight, BDD rule in `CLAUDE.md`); honest-UX shortcuts such as fake progress; stopping
partway on long briefs; tests copied instead of importing the shipped code.

## Shared local database

Workers share one local Supabase stack. Every DB-driving command runs under
`scripts/with-db-lock.sh`, and a reset counts only when reset and test run in **one** lock hold
(`CLAUDE.md` "Chain reset+test as ONE lock hold") — separate holds let a sibling's reset produce
false reds and false greens. pgTAP fixtures: namespaced UUIDs, `begin;`/`rollback;`, `finish()`;
grep gate output for `Parse errors` (an aborted file reports zero tests and looks green).
Heavy local processes (the Supabase stack, vitest, browsers) are the Mac's real RAM cost:
`supabase stop` when not testing the DB.
