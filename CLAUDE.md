# PMO Portal — project instructions

> ## ⚠️ THIS REPO IS PUBLIC
>
> `github.com/ariefsaid/PMO` is **world-readable**. Every commit, issue, PR, and comment is
> published permanently — indexed by search engines and scrapers; deleting later does not
> un-publish (history, forks, caches survive).
>
> **Never write into any tracked file, issue, PR, or comment:**
> - **Unpatched security weaknesses** — no "X has no auth check", no missing-control checklists.
>   The window between writing and fixing is exactly when it is useful to an attacker. A weakness
>   may be described publicly only **after** its fix has shipped.
> - **PII** — names, personal emails, phones, account-shape enumeration hints.
> - **Secrets or their coordinates** — keys, vault/item names, env-var names, internal hostnames,
>   tenant IDs.
>
> **Where open-weakness detail goes instead:** a GitHub **private security advisory**
> (`Security → Advisories`), or the Director's private memory
> (`public-repo-hygiene-open-items` holds the current set). In-repo docs carry only a **neutral
> stub** that names no path and no missing control; restore the detail to the docs when the fix
> ships. Before filing anything touching security, auth, infra, or people:
> `gh repo view --json visibility` and act on what it says.

Production SaaS for **contract- & project-based organizations** (NOT industry-specific — the
prototype's oil & gas framing is being generalized out). Built from an AI-Studio React/Vite
prototype. Tenancy is **single-tenant with a forward-compatible `org_id` seam** so it can scale to
B2B multi-tenancy without a rewrite.

## Repo layout
- `pmo-portal/` — the app (React 19 + Vite + TypeScript). Run npm/vite here.
- `pmo-portal/pages/` + `pmo-portal/App.tsx` — **the app's pages/routes live at the app root, NOT under
  `src/`.** `src/` holds only `auth/ components/ hooks/ lib/` (DAL `lib/db/*`, repositories, format). The
  reference slice is `pmo-portal/pages/Companies.tsx` + `pmo-portal/src/lib/db/companies.ts`.
- `docs/specs/` `docs/plans/` `docs/adr/` — specs, implementation plans, architecture decisions.
- `pmo-portal/e2e/` — Playwright acceptance tests (the BDD layer).
- `supabase/migrations/` — Postgres schema + RLS policies.
- `.claude/agents/`, `.claude/skills/` — the role agents and vendored skills (skills gitignored, via `scripts/vendor-skills.sh`). **Edit skills ONLY in `.claude/skill-overrides/<name>/` (tracked)** — the vendor script overlays them; edits in `.claude/skills/` are destroyed on re-vendor. Config the skills read: `docs/agents/{issue-tracker,triage-labels,domain,skills}.md`.

## Operating model: Owner → Director → role agents
The **owner** talks to the **Director** (Opus 4.8, the main session). The Director runs an
**issue-driven loop** and takes each issue end-to-end — but **does not run the build itself by
default.** ⛔ **Pick the executor before starting any build** (`docs/factory-workflow.md` § Executor
routing): a bounded code or FE slice → an **SSSF ADW** (`adws/adw_simple_sdlc.py`), chained with **no
owner pause between issues**; **money-path / SoD / auth / token-custody** → Director-dispatched per
issue. Reaching for `implementer` on a slice the factory should run is the standing mistake — it
spends an owner checkpoint that the routing removed. Keep tool approvals **ON**; pause for owner
approval before any push / merge / deploy, and at **milestone** boundaries — not at issue boundaries
inside a signed brief. `main` stays the ceiling either way.
> **⚑ Current executor (trial, 2026-06-12):** role-agent work is dispatched to the **pi CLI**
> (GLM/codex substrates), not Claude subagents — to spare the Claude quota. The roster + models below are
> the *contract* (and the Claude fallback); **`docs/pi-delegation.md` is how work is actually dispatched
> right now.** The gates are unchanged; the **per-issue QA loop now follows ADR-0030's portfolio model**
> (`docs/qa-portfolio.md`, `review mode: portfolio` default — see the loop below).

Per-issue loop (**QA = ADR-0030 "Discover → Graduate → Cover" portfolio; source of truth `docs/qa-portfolio.md`**,
with a `review mode` switch at its top: `portfolio` default | `4-lens` | `3-lens` fallback — the lens battery
stays intact in-repo, flip the mode to revert):

1. **Intake** — Director clarifies the issue with the owner, then runs the **`grill-with-docs` alignment
   grill** + captures the **job story**; UI issues additionally get a **~30-second owner sketch-glance** of
   layout/intent (directional "right shape?", NOT a full-lens mockup audit) before Spec. *(In `4-lens`/`3-lens`
   mode this step is instead the owner-approved static HTML mockup round, `docs/design-workflow.md` §1a.)*
2. **Spec (SDD)** — `spec-miner` (existing code) / `feature-forge` (new behavior) → `docs/specs/*.spec.md`.
3. **Design+Plan** — `eng-planner` → `docs/plans/YYYY-MM-DD-<feature>.md` (+ ADRs).
4. **Build (TDD)** — **executor per the routing above, decided before you start**: ADW by default
   (`--builder fe_builder --reviewer fe_reviewer` for UI); Director-dispatched only for the
   money/SoD/auth tier. `implementer` / `ui-implementer` name the **role contract handed to the
   executor** — they are not a decision to build it yourself (red-green-refactor; no prod code
   without a failing test). **Deterministic correctness becomes Layer-1 CI gate-tests** — chart-position, money, dates/TZ,
   derived values, `axe-core` a11y, Playwright visual-regression — not human review (ADR-0030 §C).
5. **Review — 3 reviewers, always** — `spec-reviewer`, `code-quality-reviewer`, **and** `security-auditor`
   (OWASP/STRIDE on auth + RLS + `org_id` tenancy; right-sized per model-tiering). All three run on every code
   issue. (Security focuses its depth on auth/RLS/RPC/public surfaces; on a change that touches none it
   confirms that quickly.)
6. **Discover (FE/UI only — the rendered unknown-unknown net)** — `design-reviewer` renders the running app
   on **rich seed** and audits open-endedly (no checklist). **Every finding GRADUATES** → a test + a
   `routes × oracles` matrix cell + a `DESIGN.md`/`docs/decisions.md` note (the retention KB,
   `docs/qa-portfolio.md`). Fixes route to `ui-implementer`; **re-render until clean.** Runs alongside step 5.
   *(In `4-lens`/`3-lens` mode this is the legacy rendered §2.3 battery, round 2 of 2, mockup-drift check.)*
7. **Cover / Accept (BDD)** — the Layer-1 gate-tests + the enumerated `routes × oracles` sweep + `qa-acceptance`
   verify each `AC-###` at its owning layer (unit / pgTAP / curated e2e per ADR-0010).
8. **Ship** — `release-engineer` (branch → commit → push → PR). *(Adversarial red-team review is a launch /
   version gate, not per-PR — ADR-0030 §E.)*

## Director posture (main session)
Act as a 5+-year maintainer, not a one-shot coder. Before delegating or accepting subagent work:
ask clarifying questions, challenge bad decisions, identify scaling risks, suggest better approaches,
prioritize simplicity. Deliver technical decisions, tradeoff analysis, recommended architecture, an
implementation plan, and a production-ready solution. Build a production-grade MVP — minimal enough
for one client, architected to scale to millions.

**Before asserting a fact, name the artifact that decides it and read THAT one.** A doc, a memory, a
test name, a policy body and an exit code are all *claims about* the deciding artifact, and each has
been wrong here: `role_table_grants` decides reachability (not the policy) · `pg_policies` at head
decides policy (not the migrations) · `supabase migration list --linked` decides the cloud's level
(never memory) · the output body decides pass/fail (not `$?` through a pipe) · shipped code decides
behaviour (not a spec default). **Never assert a negative from a grep without stating its scope** —
"nothing reads the stamp" was three directories searched out of four. `scripts/prior-art.sh <term>`
sweeps decisions, ADRs, migrations, hooks and issues in one command: run it before proposing work, so
you find the ruling that already exists instead of re-deriving it.

**And before calling something a defect — or promoting a stated default into a ruling — name what
breaks: who, doing what, with what wrong outcome.** If you cannot name one, it is a preference or a
restatement of a document, not a defect. This is the same rule's other half, and it reaches further
than it looks: `DD-TASK-7` was filed against shipped code because a spec said "forbid" and nobody
asked what allowing it would break (nothing did — retracted the same day), and asking "what breaks?"
of an RLS gap forces "can anyone reach it?", which is the `role_table_grants` join that would have
stopped two dead layers being ranked above the one live one.

## Quality gates & checkpoints (binding)
- **Pre-push full verify (binding — run the WHOLE suite, never just touched files):** before opening or
  pushing ANY PR, run **`npm run verify`** — **13 gates** as of 2026-08-20, and the list grows, so
  ⚑ **read `pmo-portal/package.json`'s `verify` script rather than trusting a count written here**
  (this line said "8 gates" long after it was 13). Mirrors CI's `verify` job from `pmo-portal/`. Targeted/per-file test runs are for the inner TDD loop only — they MISS
  cross-component breakage (a change to a shared component silently breaks every *other* test that renders
  it; recurring CI-verify-red, 2026-06). The build/Director MUST run the full verify before the phase
  transition; subagent briefs MUST mandate it as their final gate.
- **Pre-push PR→`main` simulation (binding, owner directive 2026-07-24):** before creating, pushing, or
  refreshing any PR targeting `main`, run **`scripts/verify-main-pr.sh`** from the repo root. It runs the
  whole verify gate, Deno boot/unit suites, a fresh local Supabase stack, every pgTAP test, and the complete
  Playwright/visual portfolio with `CI=true`, then runs the served-function smoke last. Targeted failing-spec
  reruns and `scripts/e2e-local.sh` are inner-loop tools, never substitutes for this promotion gate.
- **⛔ NOT DONE UNTIL GREEN — enforced, not advised (2026-07-17).** A task is not complete while any
  test is red. **Never** weaken, skip, delete, or re-implement a test to get green — fix the code; if a
  test is genuinely wrong, say so explicitly and stop. Dispatched agents violated this **5×** (claimed
  "DONE, all green" and committed red) and wrote tests that didn't bind to shipped code **3×** — so it
  is now mechanical, because briefs advise and hooks enforce:
  - **`.githooks/pre-commit`** (tracked; install once via `scripts/setup-hooks.sh`) — blocks a red
    commit from ANY actor. Fast + scoped: edge-fn test-binding guard + `deno test` for the *changed*
    functions only. The full `npm run verify` stays a pre-push/CI concern (a slow hook gets bypassed).
  - **`scripts/check-edge-fn-test-binding.mjs`** (also a CI step) — an edge-fn test MUST import the
    SHIPPED handler from `./index.ts`; copied `handle*WithDeps`/validators are a hard failure. Pattern
    per Supabase's guidance: **import the real handler + mock `globalThis.fetch`; NO dependency
    injection in production code** (https://supabase.com/docs/guides/functions/unit-test).
  - **`scripts/agent-git-shim/git`** — prepend to a dispatch's PATH; rejects `git commit --no-verify`
    (verified: `--no-verify` really does bypass the hook, so this is the only layer that holds).
  - **Mutation-check anything security-critical:** break the rule (e.g. `const allowed = true`) and the
    tests MUST go red. A suite that stays green while the handler is broken is not a suite.
  - **`scripts/check-e2e-skips.mjs`** (integration job, BOTH lane reports in one call) — a skipped test
    is not a passing one. Every skip needs a justified allowlist entry + a `restore` path; a **stale**
    entry fails too. Rationale + the guard-polarity rule: `docs/qa-portfolio.md` "Enforcement".
  - **No e2e spec may gate on `process.env.CI`** (enforced by `check-e2e-isolation.sh`) — gate on the
    DEPENDENCY (`SUPABASE_FUNCTIONS_URL`), never the environment. Shipped backwards twice (#371/#372, #386).
  - Both gates carry `--self-test`s that run in CI's verify job — the gates are themselves gated.
- **⚑ NEVER regenerate `package-lock.json` on macOS (binding).** `npm install` on darwin/arm64 silently
  PRUNES the wasm32-wasi optional deps (`@emnapi/core`, `@emnapi/runtime`, via `@tailwindcss/oxide-wasm32-wasi`),
  and linux CI then fails `npm ci` with *"Missing: @emnapi/core@… from lock file"*. It happens even with an
  UNCHANGED `package.json` — the lock is not reproducible from a Mac. Use **`scripts/relock.sh`** (regenerates
  in a `node:22` container, asserts the canary entries survived), then `npm ci` to sync `node_modules`.
- **Coverage:** ≥80% lines on changed code to merge; tests must assert behavior, not inflate numbers.
- **Typecheck/lint:** `npm run typecheck` zero errors; ESLint zero errors (CI `--max-warnings=0`). Both block merge.
- **⛔ HARD STOP — PRODUCTION (binding, owner directive 2026-06-17, RE-ENFORCED 2026-07-14 after a violation):** **NEVER push/deploy/promote to `production` without the owner's EXPLICIT, per-instance, this-message "yes" naming production.** This includes `git push origin main:production`, CF Pages prod, prod DB push (`db-push-prod.sh`), prod reseed, and prod edge-fn deploy. **Do NOT infer prod authorization** from "do it all", "ship it", "make it reachable", a stated deploy plan, or any prior approval — a prior "ship to prod" is **per-instance, never standing**, and ambiguity means STOP and ASK. Reaching `main` is the autonomous ceiling; the `main`→`production` step is ALWAYS a separate, explicit, owner-gated action. *(2026-07-14 incident: read "do it all and on by default" as prod authorization and promoted `main:production` without an explicit prod OK — this is exactly what must not happen; when in doubt, stop at `main` and ask.)*
- **Branch flow (binding, owner directive 2026-06-17):** **work lands on `dev` → promoted to `main` (gated). `main` is the ceiling for autonomous work.** A prior "ship to prod" is per-instance, never standing. CI is tiered + resource-lean: PR→`dev` = `verify` + `pgtap` (fast lane; `ci.yml` gates pgtap on `base_ref == 'dev'`); PR→`main` = `verify` + `integration` (pgTAP + e2e + visual gates) so `main` is always clean; push to `main` = `verify` smoke. Push CI is `main`-ONLY (dev/feature are PR-gated → no duplicate verify); `integration` fires once per change (the PR→`main`) and starts Supabase without the CI-unused containers (`studio,realtime,vector`) with Playwright browsers cached. `main`→`production` is a manual, owner-instructed promote only.
- **Checkpoints:** the **owner** approves spec sign-off + **every production deploy** / irreversible infra (see Branch flow — prod requires a direct, per-instance instruction); the **Director** approves merge-to-`dev` and merge-to-`main` within the signed spec, and escalates anything strategic or out-of-spec.
- **PRs:** one per issue — *for code*. **Docs-only changes (`docs/**`, `*.md`) push DIRECT to `dev`; no PR, no branch.**
  CI paths-ignores them, so a docs PR gates on nothing and is pure ceremony (a docs PR reports "no checks
  reported"). This matches long-standing practice on `dev`. Exception: a docs change that is genuinely
  *reviewable content* (a spec/ADR you want the owner to sign off) may still take a PR — that's a review
  request, not a gate. **ADRs:** only for architectural / irreversible / cross-cutting decisions.
- **Data/schema:** reversible migrations; RLS on every business table; `org_id` seam enforced.
- **Design/UI:** `DESIGN.md` (design.md format) is the design-system source of truth; QA per the
  **ADR-0030 portfolio** (`docs/qa-portfolio.md`) — Layer-1 deterministic gate-tests + a rendered Discover
  pass (every finding graduated) before merging UI changes (`/design-review` is the `4-lens`-mode fallback);
  Storybook for the shared component library (from Phase 3).

## Read-before-you-touch (context triggers — do NOT read these by default)
Durable subsystem gotchas live with their subsystem, not in this file and not in the backlog. Read the
matching one ONLY when your task touches that surface — that is the whole point, they cost nothing otherwise:

| Touching… | Read first |
|---|---|
| About to start ANY build — or to decide who runs it | [`docs/factory-workflow.md`](docs/factory-workflow.md) § Executor routing — **the ADW is the default and issues chain without owner pauses**; per-issue Director dispatch is the money/auth exception, not the reverse |
| Any money flow (budget activate · invoice/payment submit · procurement transition · timesheet push) | [`docs/money-path-primer.md`](docs/money-path-primer.md) — a map of the outbox/sweep/SoD architecture so you don't re-derive it from source |
| The agent / LLM surface (prompts, tools, evals, the assistant panel) | [`docs/adr/0050-layered-agent-prompt-charter-and-skills.md`](docs/adr/0050-layered-agent-prompt-charter-and-skills.md) + [`docs/adr/0052-agent-eval-harness.md`](docs/adr/0052-agent-eval-harness.md) — ⚑ the deployed model (`deepseek-v4-flash`) is a **weak tool-selector**; prompt steering is unit-tested for text presence but NOT verified against the live model. The eval harness is the real gate. |
| Authoring or editing any e2e spec | [`docs/e2e-parallel-conventions.md`](docs/e2e-parallel-conventions.md) — isolation classes, the `@e2e-isolation` tag, and the guard-polarity rule |
| Local/prod Supabase, secrets, or a deploy | [`docs/environments.md`](docs/environments.md) |

The full product charter + per-layer Definition of Done is **`docs/product-expectations.md`** — binding on all agents.
The Director's detailed orchestration runbook (per-issue loop, delegation, gates, git hygiene, grading rubric) is **`docs/director-playbook.md`**.
The UI/UX cycle (Foundation → per-UI-issue loop → human-UX improvement loop; code→UI agent analogs) is **`docs/design-workflow.md`**.

## Agent roster (`.claude/agents/`) and models
**Model-tiering (binding):** when delegating, pick the **minimum model that does the job well** — don't
use opus where sonnet suffices, don't use sonnet where haiku suffices — **but never skimp:** match the
model to the task's real difficulty, and use opus for opus-grade work (deep design, security/spec review,
hard slices) rather than under-spending on it. Right-size **per dispatch**, not by agent default: the
parenthesised tiers below are the *defaults*, and the Director overrides up or down per task (e.g. a
trivial implementer slice → haiku; a gnarly one → opus).

eng-planner (opus) · implementer (sonnet; opus for hard slices) · spec-reviewer (opus) ·
code-quality-reviewer (opus) · qa-acceptance (sonnet) · security-auditor (opus) ·
release-engineer (sonnet) · mechanical (haiku) · design-architect (opus) ·
ui-implementer (sonnet; opus for hard slices) · design-reviewer (opus).

## Skill ownership (one owner per concern — avoids collisions)
| Concern | Owner |
|---|---|
| Reverse-engineer prototype → spec | spec-miner (`.claude/skills/`) |
| User stories + acceptance criteria | feature-forge (`.claude/skills/`) |
| Design + task planning | superpowers (brainstorming, writing-plans) |
| TDD build / debugging / verification | superpowers (tdd, systematic-debugging, verification) |
| Code review | superpowers spec + quality reviewers |
| Design-system reverse-eng / maintenance (`DESIGN.md`) | design-architect (impeccable, design-consultation) |
| UI build (to tokens + design-plan) | ui-implementer (ui-ux-pro-max, taste) |
| Visual design review (render + screenshot audit) | design-reviewer (design-review, impeccable, taste) |
| Browser QA · security · ship/deploy/monitor | gstack (`/qa`, `/cso`, `/ship`, `/land-and-deploy`, `/canary`) |
| Multi-session fuzzy efforts → decision-ticket map | wayfinder (mattpocock set; maps live on GitHub issues, `docs/agents/issue-tracker.md`) |
| Skill routing ("which skill fits?") | ask-matt (override — main flow = the per-issue loop) |
| Conversation→spec synthesis (no interview) | to-spec (override; feature-forge keeps the interview workshop) |
| Ticket decomposition · inbound triage · cross-session handoff · throwaway spikes | to-tickets · triage (`docs/agents/triage-labels.md`) · handoff · prototype (mattpocock set) |

superpowers' planning tier owns planning; do NOT also use gstack's planning tier. spec-miner's
`Bash` tool was stripped (read-only). gstack telemetry stays `off`.

## Spec & test conventions (normalized across all skills/agents)
- Specs → `docs/specs/<feature>.spec.md`. Plans → `docs/plans/YYYY-MM-DD-<feature>.md` (no placeholders:
  exact paths, real code, exact verify commands, 2–5 min tasks). ADRs → `docs/adr/NNNN-<slug>.md`.
- IDs: `FR-###` (functional), `OBS-###` (observed/legacy), `NFR-###`, `AC-###` (acceptance).
- Requirements in **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` / optional
  `Where…` / conditional `While…when…`). All acceptance criteria in **Given/When/Then**.
- **Test pyramid (ADR-0010).** Each `AC-###` is owned by **one** test at the **lowest sufficient layer**:
  Unit (Vitest/RTL, mocked) for logic/components/render-empty-error-filter; Integration (**pgTAP**,
  `supabase test db`) for RLS/tenancy/role read+write contracts; E2E (Playwright, **one curated journey
  per cross-stack `AC-###`** — **114 spec files / 148 `test()` cases** as of 2026-07-25 (was "~50"); the original "6–8" was an under-estimate, re-baselined 2026-06-21
  after the charter audit confirmed all are genuine cross-stack journeys, none misplaced) for real
  cross-stack flows only. Coverage is never lost — never push an AC up a layer to satisfy a convention.
- **AC-id tagging (traceability).** The owning test names its `AC-###` in its title/description so
  `grep -r AC-XXX` finds the canonical proof at whatever layer owns it: Vitest in the `it(...)` title;
  pgTAP as the leading token of the test description; Playwright as the leading token of the `test(...)`
  title with file `e2e/<AC-id>-<slug>.spec.ts`. An AC may be referenced at multiple layers but has exactly
  one owning layer (recorded in the plan's traceability table).
- **BDD authoring rule (binding).** A test encodes the **user's real, intuitive journey to the task's goal**
  and asserts that **goal** — the app conforms to the test, never the test to the app. On failure: fix the
  **app**; only for a *deliberate* UX change (e.g. a new confirm-before-write step, back-nav moving to the
  breadcrumb) do you update the journey *steps*, and the goal-oracle still stays intact. **Never bend an
  assertion to the app's current state to go green** (don't downgrade "Back navigates to the pipeline" to
  "a Back element exists"). Full statement: `.claude/agents/qa-acceptance.md` "Authoring principle".

## Architecture patterns (binding for new features — the CRUD/RBAC foundation, ADR-0016/0017/0018/0019)
The app-wide CRUD layer is shipped (`main`); new entity/feature work MUST follow its patterns, not re-invent them:
- **3 layers / repository seam (ADR-0017):** FE → a typed **repository** per entity (`src/lib/repositories/*`, the API seam over the DAL) → Supabase. Hooks consume `repositories`/`useQuery`; never thread DAL calls or `org_id` from the client (RLS + column defaults/triggers stamp `org_id`).
- **Authorization (ADR-0016):** gate every create/edit/delete/approve affordance with `can(action, entity, ctx)` / `<CanWrite>` / `usePermission` (`src/auth/policy.ts`) on the **real JWT role** (impersonation is view-only + banner). `can()` is **UX only** — **RLS is the enforcement authority**; the FE may be stricter than RLS.
- **Server-enforced SoD + destructive deletes (ADR-0019):** if a rule is real SoD (e.g. approver≠author, `contract_value`-on-won) or a destructive delete (Admin-only), enforce it via a security-definer RPC / restrictive RLS policy + a pgTAP proof — not just a hidden button. Soft-archive (`archived_at`, ADR-0018) over hard-delete; referenced rows FK-block (23503 → "in use").
- **UI:** build forms with the shared primitives (`EntityFormModal`/`useEntityForm`/`TextField`/`SelectField`/`Combobox`/`FormGrid`/`FieldError`), confirm destructive writes with `ConfirmDialog`, classify errors with `classifyMutationError`. Strictly `DESIGN.md` tokens (root font is 16px → 32px controls). Reference template: the **Companies** slice (`pages/Companies.tsx` + `src/lib/db/companies.ts`).

## Tech stack & commands (run inside `pmo-portal/`)
- React 19, Vite 8, TypeScript ~5.8, **react-router 8** (⚑ `react-router-dom` was REMOVED in v8 — import
  everything from `react-router`; `react-router/dom` holds only `HydratedRouter`/`RouterProvider`/`unstable_RSC*`),
  recharts. Node **22.22+** (react-router 8 `engines`). Backend: **Supabase** (Postgres + Auth + RLS + Storage).
- `npm run dev` · `npm run build` · `npm run typecheck` (tsc) · `npm test` (Vitest) · **`npm run e2e`** (e2e — ⚑ NOT bare `npx playwright test`, which runs ONLY the `chromium` project and
  SILENTLY SKIPS the `serial` lane; `npm run e2e` runs both, as CI does).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Supabase environments (binding — full rules + registry: `docs/environments.md`)
**Local Docker = dev+test; the Supabase Cloud project = prod.** Test on local (`supabase db reset`); push
schema to prod with `scripts/db-push-prod.sh` (typed `prod` confirm + explicit `--db-url`), never raw.
The cloud DB secret is fetched from 1Password (vault `AS`) via `op-get.sh` — **NEVER read `~/.op-token` / the
SA-key file**. `seed.sql` = local ONLY, **never prod**; never hand-edit a cloud schema; run `supabase` from the repo root.

**⚑ Parallel-agent hygiene (binding — the local stack is ONE shared Docker DB):** multiple agents share it, so
(a) **wrap every DB-driving command in `scripts/with-db-lock.sh`** (`scripts/with-db-lock.sh supabase db reset` /
`… supabase test db` / `… npx playwright test`) — a cross-process mutex that serializes DB work (concurrent
`db reset`/`test db`/e2e corrupt each other); (b) **assume parallel — never work in the shared working tree:**
each dispatch/agent uses its OWN `git worktree` off `dev` on a **feature branch → PR to `dev`** (copy `.env.local`
in; worktrees isolate FILES, not the one DB). Worktrees don't remove the DB contention — the lock does.

**⚑ Post-merge cleanup (binding — verify first, delete last).** After GitHub reports the PR merged, fetch the
intended base and **verify the reported merge commit is reachable from `origin/<base>`**. Capture
`state,mergeCommit,headRefName,headRefOid` from `gh pr view`; require `git rev-parse <branch>` to equal that
immutable `headRefOid`, and, if the remote branch exists, require
`git ls-remote --heads origin refs/heads/<branch>` to report the same OID. Any mismatch means stop and preserve
the divergent branch. Only then confirm the exact issue worktree is clean, run
`git worktree remove <exact-path>` (never `--force`) and `git worktree prune`, delete the local feature branch
with `git branch -d <branch>` (use `-D` only after the exact-tip checks for a verified squash merge), and
finally delete the still-matching repository-owned remote branch with `git push origin --delete <branch>`.
Never remove a worktree or branch merely because it looks stale.

**⚑ Chain reset+test as ONE lock hold (binding).** Serializing the two commands *separately* is not enough: a
sibling worktree's reset landing **between** your `db reset` and your `supabase test db` leaves you testing a
schema you did not migrate — producing **false REDs and false GREENs** alike. Always:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`.
**Three machine-global locks now exist**, sharing one core (`scripts/lib/flock-run.sh`): `with-db-lock.sh`
(shared Supabase stack) · `with-erpnext-lock.sh` (ERPNext dev bed) · `with-test-lock.sh` (the heavy vitest
suite — **on a shared machine run `npm run verify:locked`, not bare `npm run verify`**, so only ONE full suite
runs at a time; under concurrent runs unrelated tests fail on timeout, and *contention moves while a real
regression stays put*. Bare `verify` stays lock-free because CI is a single dedicated runner). **When a command needs more
than one, acquire in this order, outermost first: `erpnext → db → test`.** Each is re-entrancy-safe via its own
`*_LOCK_HELD` var, so a self-wrapping script under an outer hold does not deadlock. Stack wedged under load
(`analytics`/`vector` blocking `db reset`)? `scripts/supabase-start-lean.sh`. Migration-number collision?
`scripts/renumber-migration.sh <old> <new>` (never hand-roll the `git mv` + reference sweep).
