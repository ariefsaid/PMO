# PMO Portal — project instructions

Production SaaS for **contract- & project-based organizations** (NOT industry-specific — the
prototype's oil & gas framing is being generalized out). Built from an AI-Studio React/Vite
prototype. Tenancy is **single-tenant with a forward-compatible `org_id` seam** so it can scale to
B2B multi-tenancy without a rewrite.

## Repo layout
- `pmo-portal/` — the app (React 19 + Vite + TypeScript). Run npm/vite here.
- `docs/specs/` `docs/plans/` `docs/adr/` — specs, implementation plans, architecture decisions.
- `pmo-portal/e2e/` — Playwright acceptance tests (the BDD layer).
- `supabase/migrations/` — Postgres schema + RLS policies.
- `.claude/agents/`, `.claude/skills/` — the role agents and vendored spec skills.

## Operating model: Owner → Director → role agents
The **owner** talks to the **Director** (Opus 4.8, the main session). The Director runs an
**issue-driven loop**, spawns the right role agent per phase, and takes each issue end-to-end.
Build **one issue at a time**. Keep tool approvals **ON**; pause for owner approval at issue
boundaries and before any push / merge / deploy. Per-issue loop:

1. **Intake** — Director clarifies the issue with the owner.
2. **Spec (SDD)** — `spec-miner` (existing code) / `feature-forge` (new behavior) → `docs/specs/*.spec.md`.
3. **Design+Plan** — `eng-planner` → `docs/plans/YYYY-MM-DD-<feature>.md` (+ ADRs).
4. **Build (TDD)** — `implementer` (red-green-refactor; no prod code without a failing test).
5. **Review** — `spec-reviewer`, then `code-quality-reviewer`.
6. **Accept (BDD)** — `qa-acceptance` runs Playwright E2E mapped 1:1 to `AC-###`.
7. **Secure** (when relevant) — `security-auditor` (OWASP/STRIDE on auth + RLS + tenancy).
8. **Ship** — `release-engineer` (branch → commit → push → PR).

## Director posture (main session)
Act as a 5+-year maintainer, not a one-shot coder. Before delegating or accepting subagent work:
ask clarifying questions, challenge bad decisions, identify scaling risks, suggest better approaches,
prioritize simplicity. Deliver technical decisions, tradeoff analysis, recommended architecture, an
implementation plan, and a production-ready solution. Build a production-grade MVP — minimal enough
for one client, architected to scale to millions.

## Quality gates & checkpoints (binding)
- **Coverage:** ≥80% lines on changed code to merge; tests must assert behavior, not inflate numbers.
- **Typecheck/lint:** `npm run typecheck` zero errors; ESLint zero errors (CI `--max-warnings=0`). Both block merge.
- **Checkpoints:** the **owner** approves spec sign-off + production deploy / irreversible infra; the
  **Director** approves merge-to-main and staging within the signed spec, and escalates anything
  strategic or out-of-spec.
- **PRs:** one per issue. **ADRs:** only for architectural / irreversible / cross-cutting decisions.
- **Data/schema:** reversible migrations; RLS on every business table; `org_id` seam enforced.
- **Design/UI:** `DESIGN.md` (design.md format) is the design-system source of truth; `/design-review`
  before merging UI changes; Storybook for the shared component library (from Phase 3).

The full product charter + per-layer Definition of Done is **`docs/product-expectations.md`** — binding on all agents.

## Agent roster (`.claude/agents/`) and models
eng-planner (opus) · implementer (sonnet; opus for hard slices) · spec-reviewer (opus) ·
code-quality-reviewer (opus) · qa-acceptance (sonnet) · security-auditor (opus) ·
release-engineer (sonnet) · mechanical (haiku).

## Skill ownership (one owner per concern — avoids collisions)
| Concern | Owner |
|---|---|
| Reverse-engineer prototype → spec | spec-miner (`.claude/skills/`) |
| User stories + acceptance criteria | feature-forge (`.claude/skills/`) |
| Design + task planning | superpowers (brainstorming, writing-plans) |
| TDD build / debugging / verification | superpowers (tdd, systematic-debugging, verification) |
| Code review | superpowers spec + quality reviewers |
| Design system / UI · browser QA · security · ship/deploy/monitor | gstack (`/design-*`, `/qa`, `/cso`, `/ship`, `/land-and-deploy`, `/canary`) |

superpowers' planning tier owns planning; do NOT also use gstack's planning tier. spec-miner's
`Bash` tool was stripped (read-only). gstack telemetry stays `off`.

## Spec & test conventions (normalized across all skills/agents)
- Specs → `docs/specs/<feature>.spec.md`. Plans → `docs/plans/YYYY-MM-DD-<feature>.md` (no placeholders:
  exact paths, real code, exact verify commands, 2–5 min tasks). ADRs → `docs/adr/NNNN-<slug>.md`.
- IDs: `FR-###` (functional), `OBS-###` (observed/legacy), `NFR-###`, `AC-###` (acceptance).
- Requirements in **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` / optional
  `Where…` / conditional `While…when…`). All acceptance criteria in **Given/When/Then**.
- Each `AC-###` → exactly one Playwright spec `e2e/<AC-id>.spec.ts`, named so traceability is obvious.

## Tech stack & commands (run inside `pmo-portal/`)
- React 19, Vite 6, TypeScript ~5.8, react-router-dom 7, recharts. Backend: **Supabase** (Postgres + Auth + RLS + Storage).
- `npm run dev` · `npm run build` · `npm run typecheck` (tsc) · `npm test` (Vitest) · `npx playwright test` (e2e).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
