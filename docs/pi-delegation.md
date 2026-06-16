# Delegating role work to pi — Director guide

**Status: ACTIVE TRIAL** (started 2026-06-12, KANNA gap series). This document tells any agent
acting as **Director** (`docs/director-playbook.md` §1 posture) how to dispatch role work to the
**pi CLI** instead of (or alongside) Claude subagents. It changes **who executes a phase — nothing
else**. The per-issue loop, gates, and checkpoints in `docs/director-playbook.md` §2 (including
the 1b `grill-with-docs` gate and 1c HTML-mockup gate), the UI cycle in `docs/design-workflow.md`,
and the DoD in `docs/product-expectations.md` are unchanged and binding.

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

| Substrate | Use for | Analog |
|---|---|---|
| `zai` / `glm-5.2` | **Newest GLM (out 2026-06; trialed-good as builder 2026-06-16 — first-pass-correct, no §6 tendencies).** Strong builder; prefer for implementation slices | opus/sonnet |
| `zai` / `glm-5.1` | Planning, specs, complex or security-sensitive slices (schema, RLS, RPC), manager-grade judgment | opus |
| `zai` / `glm-4.7` | Routine implementation, mechanical edits, QA runs, mockup builds | sonnet/haiku |
| `openai-codex` / `gpt-5.4` | ALL reviews and audits — spec-review, code-quality, plan review, security. Deliberately **cross-family** vs the GLM builders | opus reviewers |

> **⚑ GLM-only degraded mode (gpt-5.4/openai-codex UNAVAILABLE, observed 2026-06-16).** When the
> cross-family reviewer is down, route reviews to a **different GLM model than the builder** (e.g. build
> `glm-5.2` → review `glm-5.1`). This gives *some* independence but is **same-family** — weaker than the
> intended cross-family check. Acceptable for low-risk/presentational slices; for **security/RLS/RPC or
> money-path** changes, escalate to the Director's own review or wait for cross-family, don't ship on a
> same-family-only sign-off.
| `openrouter` / `nvidia/nemotron-3-ultra-550b-a55b:free` · `nex-agi/nex-n2-pro:free` | **Tertiary fallback only** — when BOTH z.ai and codex are rate-limited. Free, so no quota cost; keeps the loop moving instead of stalling for the reset | spare tire |

**Fallback (owner rule):** z.ai API limit → use `gpt-5.4`; OpenAI limit → use GLM. **When BOTH are
rate-limited at once** (the 5-hour windows can overlap — observed 2026-06-12), drop to the
**OpenRouter free models** (`openrouter` provider, both smoke-tested OK): Nemotron 3 Ultra for the
heavier slice, NEX N2 Pro as its alternate. They're free — no quota — but unproven on this codebase,
so treat their output as lower-trust: keep them to routine/mechanical/throwaway work, **never the
sole author of a security/schema/RLS slice**, and the Director re-verifies harder (gates + read the
diff). If the work is high-stakes and both primaries are down, prefer to **wait for the reset** over
shipping a free-model security change. Smoke-test any substrate with
`pi --provider <p> --model <m> -p --no-session --no-tools "Reply with exactly: OK" < /dev/null`.

## 3. Invocation pattern

```bash
cd <issue-worktree>   # ALWAYS dispatch from the issue worktree (one per issue, playbook §6)
pi --provider zai --model glm-5.1 -p --no-session \
  --append-system-prompt .claude/agents/<role>.md \
  "<self-contained brief>" < /dev/null
```

- **`< /dev/null` is load-bearing** — without it `-p` can block on stdin.
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
