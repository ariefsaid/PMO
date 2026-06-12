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
| **pi dispatches** | Spec/plan authoring, implementation slices, mockup HTML builds, code-level reviews & audits — i.e. the role-agent work of playbook §2 steps 2–7 |
| **Director (you)** | Dispatch briefs · verification of every claim (§5 below) · **rendered** visual/3-lens checks (pi models have no browser or vision — design-workflow §2.3 lens (a) stays with you) · merge + git hygiene (playbook §6) · prod operations (`docs/environments.md`) |
| **Owner** | Spec sign-off, mockup approval, production/irreversible approvals — exactly as in CLAUDE.md "Quality gates & checkpoints" |

pi agents may **commit on the issue branch** (implementer discipline) but never push, open PRs,
or merge — the release-engineer flow and the Director merge gate (playbook §6) are unchanged.

## 2. Model routing (by task complexity)

Replaces playbook §3's opus/sonnet/haiku mapping when running the trial:

| Substrate | Use for | Analog |
|---|---|---|
| `zai` / `glm-5.1` | Planning, specs, complex or security-sensitive slices (schema, RLS, RPC), manager-grade judgment | opus |
| `zai` / `glm-4.7` | Routine implementation, mechanical edits, QA runs, mockup builds | sonnet/haiku |
| `openai-codex` / `gpt-5.4` | ALL reviews and audits — spec-review, code-quality, plan review, security. Deliberately **cross-family** vs the GLM builders | opus reviewers |

**Fallback (owner rule):** z.ai API limit → use `gpt-5.4`; OpenAI limit → use GLM. Smoke-test
with `pi --provider <p> --model <m> -p --no-session --no-tools "Reply with exactly: OK" < /dev/null`.

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
