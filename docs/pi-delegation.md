# Delegating role work to pi — Director guide

**Status: ACTIVE TRIAL** (started 2026-06-12, KANNA gap series). This document tells any agent
acting as **Director** (`docs/director-playbook.md` §1 posture) how to dispatch role work to the
**pi CLI** instead of (or alongside) Claude subagents. It changes **who executes a phase — nothing
else**. The per-issue loop, gates, and checkpoints in `docs/director-playbook.md` §2 (including
the 1b `grill-with-docs` gate and 1c HTML-mockup gate), the UI cycle in `docs/design-workflow.md`,
and the DoD in `docs/product-expectations.md` are unchanged and binding.

> **⚑ Dispatch entry point (owner, 2026-07-22): use `pi-dispatch <tier>` — not raw `pi` — for role dispatches.**
> The wrapper (`~/.local/bin/pi-dispatch`) owns provider/model selection: capability-banded fallback
> ladders (**z.ai GLM → codex OAuth → `claude -p` last resort**), per-model rung-hopping, and a token
> ledger (`~/.pi-usage.jsonl`; `pi-dispatch report [days]`).
> Tiers: `build` (sonnet–opus band) · `routine` (haiku–sonnet) · `mechanical` (haiku) · `review`
> (cross-family) · `review-money` (**Luna-only at max thinking — baked into the
> ladder; no fallback — failure = escalate, never a weaker reviewer**) · `multimodal` (vision judgment,
> quality-first: claude-sonnet → Luna:high; Director keeps the final taste lens) · `orchestrate` (GLM-5.3 manager
> loops, Luna fallback; no claude rung — orchestrate failure escalates to the Director). **Model slugs live ONLY in the wrapper's ladder table** — never pass raw
> provider/model in a dispatch; a wrong slug surfaces as 429-no-body and gets misdiagnosed as a rate
> limit. Verify new slugs with `pi-dispatch smoke <provider> <model>`. The §2 table below remains the
> capability rationale; the wrapper's ladders are the executable form. **Every free non-z.ai provider
> is now out** (owner 2026-07-30): NIM/`nvidia`, requesty, mistral and ollama-cloud are removed from
> every ladder, and openrouter stays banned (owner 2026-07-15). See the ruling box in §2 for why.

## 1. Division of labor (binding)

| Who | Keeps |
|---|---|
| **pi dispatches** | Spec/plan authoring, implementation slices, mockup HTML builds, code-level reviews & audits — i.e. the role-agent work of playbook §2 steps 2–7 · **rendered UI/UX/FE verification via the `agent-browser` CLI** (§3a below) |
| **Director (you)** | Dispatch briefs · verification of every claim (§5 below) · the **final rendered visual-taste lens** + owner-facing screenshots (design-workflow §2.3 lens (a) sign-off quality needs vision; pi text models work from the a11y tree) · merge + git hygiene (playbook §6) · prod operations (`docs/environments.md`) |
| **Owner** | Spec sign-off, mockup approval, production/irreversible approvals — exactly as in CLAUDE.md "Quality gates & checkpoints" |

pi agents may **commit on the issue branch** (implementer discipline) but never push, open PRs,
or merge — the release-engineer flow and the Director merge gate (playbook §6) are unchanged.

## 2. Model routing (by task complexity)

Replaces playbook §3's opus/sonnet/haiku mapping when running the trial:

> ## ⛔ OWNER RULING 2026-07-30 — **NIM IS REMOVED. z.ai IS THE pi SUBSTRATE.**
> Every `nvidia` (NIM) rung is gone from every ladder, along with the free non-z.ai spares
> (`requesty`, `mistral`, `ollama`). **`openrouter` remains banned** (owner 2026-07-15). What is left:
> **z.ai GLM → `openai-codex` Luna → `claude -p` (last resort)**. This supersedes the 2026-07-11/12
> cascade that put `nvidia` ahead of `zai`, and the 2026-07-22 "free-first" ordering.
>
> **Why, from the run that caused it.** A `build` dispatch landed on `nvidia|z-ai/glm-5.2` and burned
> **98 minutes producing nothing** — completions arrived 1.5–5 minutes apart, it was still probing the
> environment for `psql` at minute 98, then died on `Request timed out`. The identical brief on
> `zai|glm-5.2` did **40 turns in 5 minutes**, ~40× the throughput. The wrapper had ALREADY recorded
> this on the `orchestrate` tier — *"NIM glm-5.2 excluded: >120s/completion reads as a hang in agentic
> loops"* — and still shipped NIM as rung 1 of `build`. **A lesson learned on one tier has to be
> applied to every tier**, which is why NIM is removed rather than demoted: a rung that is wrong for
> agentic loops will keep being selected by whichever tier forgot to exclude it.
>
> **When z.ai caps (5-hour window), the ladder falls to Luna, then `claude -p`. That is the intended
> behaviour — it is not a reason to re-add a free rung.** Free-but-unusable is not cheaper than paid:
> the 98-minute run cost nothing in tokens and two hours of the owner's clock.
>
> **⚑ NIM model pin (owner 2026-08-15).** NIM stays off every ladder. *If* NIM is ever invoked
> explicitly, the only sanctioned model is **`deepseek-ai/deepseek-v4-flash-0731`** — note the `v4`;
> the bare `deepseek-ai/deepseek-v4-flash` slug is **gone from the live NIM catalog** and would have
> surfaced as 429-no-body (the exact misdiagnosis §2's slug-discipline note warns about). Verified
> against `GET https://integrate.api.nvidia.com/v1/models` and `pi-dispatch smoke` on 2026-08-15;
> `~/.pi/agent/models.json` is pinned to that one entry.

| Substrate | Use for | Analog |
|---|---|---|
| `zai` / `glm-5.3` | **THE DEFAULT for all build work** (owner 2026-08-15, supersedes `glm-5.2`). Planning, specs, complex or security-sensitive slices (schema, RLS, RPC), manager-grade judgment, and implementation slices (the 5.2 line was trialed-good as builder 2026-06-16 — first-pass-correct). First rung of `build`, `routine` (as the step-up from 4.7) and `orchestrate`. | opus |
| `zai` / `glm-5.2`, `glm-5.1` | Secondary/alternate to 5.3 (rate-limit relief, or as the different-model reviewer in GLM-only degraded mode). Not on any ladder — Director picks one explicitly. | opus fallback |
| `zai` / `glm-4.7` | Routine implementation, mechanical edits, QA runs, mockup builds. First rung of `routine` and `mechanical`. | sonnet/haiku |
|  `openai-codex` / `gpt-5.6-luna` (owner-directed 2026-07-11; supersedes `gpt-5.4`) | ALL reviews and audits — spec-review, code-quality, plan review, security. Deliberately **cross-family** vs the GLM builders. **⚑ money/security audits run at `--thinking max` (owner 2026-07-15)**; the `review-money` tier bakes that in and has **no fallback by design**. | opus reviewers |
| `claude` / `sonnet`·`haiku` | Last-resort rung only (`claude -p`, sanctioned plan entry) when both z.ai and codex are down. Spends the Claude quota the whole trial exists to protect — if the work is high-stakes and both primaries are capped, prefer to **wait for the reset**. | — |

> **⚑ GLM-only degraded mode (gpt-5.4/openai-codex UNAVAILABLE, observed 2026-06-16).** When the
> cross-family reviewer is down, route reviews to a **different GLM model than the builder** (e.g. build
> `glm-5.3` → review `glm-5.1`). This gives *some* independence but is **same-family** — weaker than the
> intended cross-family check. Acceptable for low-risk/presentational slices; for **security/RLS/RPC or
> money-path** changes, escalate to the Director's own review or wait for cross-family, don't ship on a
> same-family-only sign-off.
**Fallback (owner rule, as of 2026-07-30):** z.ai capped → `gpt-5.6-luna`; codex capped too → `claude -p`
(the last-resort rung, which spends the quota this trial protects). **There is no free tier below that
any more** — NIM, requesty, mistral, ollama and openrouter are all out. When both primaries are down on
high-stakes work, **wait for the reset**; that was already the rule for security/schema/RLS slices, and
the 98-minute NIM run is the evidence that a free-but-slow substrate is not a cheaper option.
Smoke-test any substrate with
`pi --provider <p> --model <m> -p --no-session --no-tools "Reply with exactly: OK" < /dev/null`.

**⚑ Brief the environment, don't make the agent discover it.** The 98-minute run spent most of its life
finding out there is no host `psql`. Every build brief should state, up front: `docker exec -i
supabase_db_pmo-portal psql -U postgres -d postgres` is how you reach the DB; there is **no `timeout`**
on macOS; `supabase` runs from the repo root; wrap DB commands in `scripts/with-db-lock.sh`; pgTAP is
not resident between `supabase test db` runs. Discovery is the most expensive thing a slow rung does.

## 3. Invocation pattern

```bash
cd <issue-worktree>   # ALWAYS dispatch from the issue worktree (one per issue, playbook §6)
pi-dispatch build \
  --append-system-prompt .claude/agents/<role>.md \
  "<self-contained brief>"
```

- **The brief must be the LAST argument** — the wrapper appends `< /dev/null`, picks provider/model
  from the tier's ladder, retries/falls back, and ledgers tokens. Extra args pass through to pi
  verbatim (the `claude -p` last-resort rung keeps only `--append-system-prompt`).
- Raw `pi --provider … --model …` is for diagnostics only (e.g. `pi-dispatch smoke`); if you must
  use it: **`< /dev/null` is load-bearing** — without it `-p` can block on stdin.
- **`--append-system-prompt`** injects the role contract. `.claude/agents/*.md` are **tracked**
  (present in every worktree). `.claude/skills/*` are **gitignored** (vendored) — reference them
  by **absolute path from the primary checkout** (e.g.
  `--append-system-prompt /Users/<you>/Coding/PMO/.claude/skills/feature-forge/SKILL.md`).
- Run long dispatches as **harness-tracked background tasks** with a generous timeout. **Never
  `nohup … &`** — the wrapper is reaped when the parent shell exits and the run dies silently.
- Avoid `--mode json` unless piping to a file — a single long run once emitted 664 MB of stdout.
- pi has no MCP and no built-in subagents; its power tool is Bash. Default tools: read/bash/edit/write.

### 3a. Rendered UI/FE verification from pi — `agent-browser` CLI

pi agents can drive a real browser through Bash with the **`agent-browser`** CLI
([vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser), installed globally).
Use it in design-review / qa-style dispatches and in ui-implementer self-checks:

- **Tell the agent to start with** `agent-browser skills get core --full` — the CLI ships its own
  version-matched usage skill (snapshot-and-ref workflow, examples). Put that line in the brief;
  don't paste flag docs. A discovery stub is also vendored at `.claude/skills/agent-browser/` (so
  the Claude `Skill` tool finds it too); the stub just points back at `skills get core`. Setup:
  `npm i -g agent-browser && agent-browser install`, then `scripts/vendor-skills.sh` copies the stub.
- **For a structured exploratory pass / bug-hunt**, brief the agent to load
  `agent-browser skills get dogfood` — it produces a reproducible defect report with screenshots,
  matching the design-workflow §2.3 lens (b)/(c) walk.
- Core verbs: `open <url>` · `click/fill/type/press` · `wait <sel|ms>` · `screenshot [path]` ·
  snapshot/refs per the core skill. Serve static mockups with `python3 -m http.server <port>`
  from the mockup directory; the app via `npm run dev` from `pmo-portal/`.
- **Text models verify against the accessibility tree / DOM assertions** (snapshot + selector
  checks: states, labels, focus order, counts) — that covers design-workflow §2.3 lens (b)/(c)
  walks and functional FE verification. **Screenshots are for vision-capable reviewers** — have
  the pi agent save them to a known path and the Director (or a vision model) judges lens (a)
  pixel/taste quality from the files.
- The owner-approval artifact (design-workflow §2.5, §3) is still produced/curated by the
  Director — pi screenshots feed it, they don't replace the gate.

### 3b. Dispatch mechanics — background, never block or poll (Claude Code harness)

A pi dispatch runs minutes-to-hours. The whole point of offloading to pi is that the **Director's
own context/turn-budget is NOT consumed while it runs.** Get this wrong and you defeat the purpose.

**Do — fire-and-forget on the harness:**
- Launch every pi dispatch with **`Bash(run_in_background: true)`** + a generous `timeout` +
  `< /dev/null`. The tool returns immediately with a task id; **your turn ends and your context
  stops being spent.**
- The harness sends a **`<task-notification>`** when the background command exits and **re-invokes
  you automatically** with the result. You do nothing to wait — the wake-up is free.
- On that wake, **Read the output file ONCE** to verify (sentinel line, greps, re-run gates), then
  dispatch the next phase. One read, not a stream.
- While pi runs you may either **end the turn** (preferred — zero spend) or start an *independent*
  dispatch in another worktree. Don't invent busywork to "stay active".

**Don't — the capacity-hogging anti-patterns:**
- ❌ **Foreground Bash** (no `run_in_background`) — ties up the turn for the entire run, burning
  context the whole time. This is the main way capacity gets hogged.
- ❌ **Polling loops** — repeatedly `TaskOutput`/`Read`-ing the output file, or `ScheduleWakeup`/
  sleep-checking a harness-tracked task. The completion notification is automatic; polling spends
  turns to learn nothing. (External, harness-*untracked* work — a remote CI run — is the only case
  where a paced check is justified; a local backgrounded `pi`/`supabase`/`npm` is always tracked.)
- ❌ **Blocking the owner** — never sit waiting "to see if it finishes". Hand control back; the
  notification will bring you back exactly when there's something to do.

**Parallel vs serial:** independent dispatches (different worktrees, no shared stack) can run
concurrently — launch them in one message, each `run_in_background`. But **stagger anything that
drives the single local Supabase stack** (migrations, `db reset`, pgTAP, e2e) — two at once corrupt
each other (playbook §3).

### 3c. Resource isolation — pi is a CHILD of the Claude app (RAM + crash survival)

A `Bash(run_in_background)` pi dispatch is spawned **inside the Claude-app process tree**. Consequences:
- pi's **model inference is remote** (z.ai/OpenAI) — zero local RAM. But **pi's own process and
  everything it spawns are local and parented under the app**: `supabase db reset` (Docker, ~10
  containers, multi-GB), `vitest`/`vite`, chromium for agent-browser/playwright. Those are the real
  local hogs.
- Because they're children of the app, **a Claude-app crash kills the in-flight pi run** (we've
  seen this — half-applied edits). And the app's own RAM grows over a long session from the
  transcript, any screenshots read into context, and retained background-task output buffers.

**Levers when local RAM is the binding constraint (most effective first):**
1. **`supabase stop` when not DB-testing** — the local stack is the biggest persistent chunk; bring
   it up only for migration/pgTAP/e2e phases, down otherwise.
2. **Detached-tmux mode for long/heavy phases** — run the dispatch *outside* the app's process tree
   so it survives an app crash and the app doesn't hold its output:
   ```bash
   tmux new-session -d -s pi_<phase> \
     "cd <worktree> && pi --provider <p> --model <m> -p --no-session \
        --append-system-prompt .claude/agents/<role>.md '<brief>' </dev/null \
        > /tmp/pi_<phase>.log 2>&1; echo '__PI_EXIT_'\$?'__' >> /tmp/pi_<phase>.log"
   ```
   Trade-off vs §3b: **no auto-notification** — you must check the log for the `__PI_EXIT_0__`
   sentinel. This is the *one* justified poll (the work is now harness-untracked). Pick a cadence
   matched to the phase length, not a tight loop.
3. **Compact/clear at issue boundaries**, and **don't read screenshots into the Director context** —
   grep/DOM-verify; let a vision pass open image files only when a visual judgment is actually due.

**Choosing the mode:** §3b harness-background is the default (context economy + auto-notify, best for
spec/plan/review/short dispatches). Switch to detached-tmux when a phase spawns the heavy local
toolchain (Docker `db reset`, full e2e) AND session RAM is already high — crash-survival then beats
the convenience of auto-notification.

### 3c-bis. ⚑ Dispatching pi from a *subagent* orchestrator (NOT the main session)

The §3b "background + the harness re-invokes you" pattern is **main-session-only**. A **Claude subagent
acting as orchestrator** (e.g. an opus QA-orchestrator) is **never re-invoked when a background task
finishes** — if it launches pi with `Bash(run_in_background)` and ends its turn, the build is
**orphaned** (verified 2026-06-16: empty worktree, idle pi). And **detached-tmux (§3c) can also fail**
in a sandboxed subagent (`fork failed: Device not configured`). So a subagent orchestrator must keep pi
**inside its own turn**:
- **Blocking foreground** `Bash(timeout: 600000)` per pi dispatch — the proven pattern for bounded
  build/review slices (≤10 min each). The subagent stays alive to verify and continue the loop.
- If a single dispatch would exceed 10 min, split the work, or (where tmux works) launch detached + poll
  the `__PI_EXIT_0__` sentinel with a loop of short Bash calls **within the same turn** — never exit and
  expect re-invocation.
- The **main Director** keeps using §3b (background + auto-notify); only a *subagent* orchestrator needs
  this rule. Make this explicit in any orchestrator brief.

### 3d. Keeping Claude / Codex / Pi role surfaces in sync

`.claude/` is the canonical authoring surface. When changing role prompts, edit
`.claude/agents/*.md` first, then run:

```bash
node scripts/sync-agent-surfaces.mjs --write
node scripts/sync-agent-surfaces.mjs --check
```

The sync script regenerates `.codex/agents/*.toml` from `.claude/agents/*.md`. If this repo later
adds a project-local `.pi/`, the same command mirrors `.claude/agents/*.md` into `.pi/agents/`.
For skills, run `scripts/vendor-skills.sh`; it vendors `.claude/skills/` and then mirrors the
ignored skill payloads to `.agents/skills/` and optional `.pi/skills/`.

## 4. Brief structure — the quality lever

pi agents see NOTHING of your session. The brief must stand alone:

1. **Task in one line**, naming the phase and the binding role rules ("per docs/design-workflow.md §1a").
2. **READ FIRST list** — exact paths: the locked `OD-*` decisions (`docs/decisions.md`), glossary,
   spec/plan, the reference slice (`pages/Companies.tsx` per CLAUDE.md), relevant ADRs. The agent
   reads them itself; don't paste content.
3. **Output path** — exact file the agent must write.
4. **Conventions verbatim** — spec/plan/test conventions from CLAUDE.md (EARS, AC-### GWT,
   no-placeholder tasks, AC-id tagging, one-owning-layer per ADR-0010).
5. **Do-NOT list** — scope fences ("do not redesign the shell", "spec is signed — do not re-litigate").
6. **End marker** — require a final sentinel line (`SPEC-DONE`, `PLAN-FIX-DONE`…) so you can
   detect truncated/killed runs cheaply.
7. **"Verify your own work"** — instruct the agent to re-read its output against the input list
   and report deviations. (Then verify yourself anyway — §5.)
8. **Fix rounds:** numbered findings, "fix ALL, change nothing else". **Completion rounds** (after
   a killed run): list ONLY the missing items and say "do not rework what already landed".

## 5. Verification — playbook §7, applied doubly

Never accept a pi completion report. Minimum per dispatch:

- **Artifact exists** (`wc -l`, `git status`) and **ends with the sentinel line**.
- **Grep the load-bearing claims** (the fix list items, the AC ids, the constants).
- **Structure-check HTML edits** — glm-4.7 once broke tag nesting mid-file (a lost `<section>` +
  unclosed `<div>`s silently swallowed every later section). Balance-count tags or parse before
  trusting any HTML/JSX bulk edit.
- **Render UI work yourself** (playwright/preview MCP) — this is design-workflow §2.3 lens (a),
  and it catches what source review can't.
- **Run the gates yourself** before any phase transition (typecheck/lint/test/build/e2e from
  `pmo-portal/`, `supabase test db` for DB).
- **Killed/timed-out runs leave HALF-APPLIED edits.** `git diff` first; re-dispatch as a
  completion round, never a blind retry.

**Cross-family review is complementary, not sufficient.** Trial empirics (issue #1, plan review):
`gpt-5.4` caught 3 criticals the GLM author missed (fake progress bar, e2e tests not proving
their ACs, an org_id seam violation) — while the Director's own read caught 2 the reviewer missed
(an Issued-parent supersede bug, a missing DWG MIME). Run **both** lenses on anything load-bearing.

## 6. Known failure tendencies (watch for these in review)

- **e2e softening** — `.catch(...)` around assertions, or asserting "element exists" instead of
  the journey goal. Violates the binding BDD rule (CLAUDE.md). Reject on sight.
- **Honest-UX shortcuts** — e.g. a fake/indeterminate progress bar when real progress is specced.
- **Stopping partway** on long multi-item briefs (glm-4.7) — hence sentinel lines + completion rounds.
- **Scope drift in mockups** — page-level reframing of tab-level UI, invented category values;
  pin vocabulary to the real component and `docs/glossary.md` in the brief.

## 7. Where this fits

- Sequencing + status: `docs/backlog.md` → "ACTIVE PROGRAM — KANNA gap-closing series".
- The loop being executed: `docs/director-playbook.md` §2; UI issues additionally
  `docs/design-workflow.md` §1a (pre-spec mockup gate) + §2 (per-UI-issue loop + 3-lens battery).
- Grading: playbook §10 rubric applies to pi-produced work unchanged.
- If pi/the providers are unavailable, fall back to the standard Claude role agents
  (`.claude/agents/`, playbook §3) — the loop is substrate-agnostic by design.

## 8. ⚑ Shared-DB verdict rule (binding, learned 2026-07-12/13)

A pgTAP verdict on the shared local stack counts ONLY when `supabase db reset && supabase test db`
run **chained inside one `with-db-lock.sh` hold**:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'
```

Separate holds let a sibling worktree's reset apply a *different* migration set in between —
producing false-FAIL (missing tables) and, worse, false-PASS (a failure masked by someone else's
schema). Both were observed live. Related pgTAP fixture discipline (all three defects shipped in
one file and masked each other, 2026-07-12): **namespaced fixture UUIDs** (never bare `01…`
prefixes — they collide with seed data), **`begin;`/`rollback;` wrappers** (a file that ever ran
without one has COMMITTED fixtures poisoning every later run until a reset), and **pgTAP's
`finish()`** (not `finish_testing()`). An aborted file reports "Bad plan … ran 0" and contributes
zero tests — a green-looking summary can hide it; grep for `Parse errors` in gate output.
