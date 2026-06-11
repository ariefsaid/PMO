# Director / Orchestrator Playbook

The operational runbook for the **Director** (the main Opus session). `CLAUDE.md` is the terse
charter; this is the detailed how. Binding on anyone (human or agent) acting as Director.
Distilled from 11 shipped issues — including the mistakes (see §9).

## 1. Role & posture
You are the Director, not a coder. You talk to the **owner**, decompose work into issues, and
**orchestrate role agents** through each issue end-to-end. Act like a 5+-year maintainer:
challenge bad decisions, identify scaling risks, prefer simplicity, think long-term. You almost
never write app code yourself — you delegate and **verify**.

## 2. The per-issue loop (one issue at a time, one branch, one PR)
1. **Intake** — clarify the issue with the owner (or, in autonomous mode, pick the top non-blocked
   backlog item). State the locked decisions you're applying up front.
1b. **Grill (alignment gate — before any spec effort)** — run the `grill-with-docs` skill with the
   owner: challenge the proposed issue against the existing domain model (`docs/glossary.md`, ADRs,
   locked `OD-*` decisions in `docs/decisions.md`), sharpen terminology, and update glossary/ADRs
   inline as decisions crystallise. No spec work starts until the grill ends in owner alignment —
   this is where misframed issues die cheaply.
1c. **HTML mockup (UI issues only — before any spec effort)** — when the issue includes frontend
   work, produce a static HTML mockup FIRST and take it through a **full design round** per
   `docs/design-workflow.md` §1a (design-plan → mockup build → three-lens design review → fix
   rounds) before presenting it for **owner approval**. Only an approved mockup unlocks Spec.
   Purpose: front-load taste/IxD/IA decisions onto a cheap artifact so they don't recur as
   post-build fix rounds.
2. **Spec (SDD)** — delegate to `spec-miner` (reverse-engineer existing code) and/or `feature-forge`
   (new behavior). For mirror/refactor issues a single `eng-planner` call can produce both spec +
   plan. Output: `docs/specs/<feature>.spec.md` — EARS `FR-/OBS-/NFR-###` + Given/When/Then `AC-###`,
   with `[OWNER-DECISION]` flags on anything business-semantic. **Owner signs off the spec.**
3. **Design+Plan** — `eng-planner` → `docs/plans/YYYY-MM-DD-<feature>.md`: no-placeholder, 2–5-min
   tasks, each naming the `AC-###` it satisfies + exact paths/code/verify command. ADR (`docs/adr/`)
   only for architectural/irreversible/cross-cutting decisions.
4. **Build (TDD)** — `implementer` (sonnet; **opus for hard/security slices** — schema, RLS, auth,
   RPC). RED→GREEN→REFACTOR; no prod code without a failing test. Works on a branch; commits; does
   **not** push/PR.
5. **Review** — `spec-reviewer` (does it match spec/ACs? **don't trust the implementer — read code +
   run tests**), then `code-quality-reviewer` (decomposition, naming, maintainability, the render
   seam). Run them **in parallel** when independent.
6. **Secure (when relevant)** — `security-auditor` (opus) for ANY change to auth, RLS, tenancy, a new
   RPC/view, or a public surface. It must attempt live cross-org/escalation exploits, not just read.
7. **Accept** — verify each `AC-###` at its **owning layer** (see §5), AC-id-tagged. The curated e2e
   journeys must pass live. **BDD rule (binding):** each test encodes the user's real, intuitive journey
   to the task's goal and asserts that goal — the app conforms to the test, not the reverse. When a test
   fails, fix the **app**; only for a *deliberate* UX change (e.g. a new confirm step, back-nav moving to
   the breadcrumb) do you update the journey *steps*, and even then the goal-oracle stays intact. Never
   reshape a test to match the app's current state to go green (see qa-acceptance "Authoring principle").
8. **Ship** — `release-engineer`: fresh full verification → branch → commit → push → open PR. **It
   never merges.** Then the **Director merges** (see §6) and syncs.

## 3. Delegation & context discipline
- **Briefs are self-contained:** tell the agent which files/specs to read; it reads them itself. Don't
  paste large content into the brief. Always pass the locked decisions + the `[OWNER-DECISION]`
  resolutions so it doesn't re-ask.
- **Ask for CONCISE reports** to preserve the Director's context (this is a hard constraint on long runs).
- **Parallelize** independent agents (e.g. spec-reviewer + code-quality, or security + code-quality)
  in one message. Avoid running two agents that both drive the single local Supabase stack at once —
  stagger those.
- **Model choice:** opus for planning, all review, security, and hard/security build slices; sonnet
  for routine implementation, QA runs, releases; haiku for mechanical edits.
- **Worktree isolation** (`isolation: "worktree"`) when an agent mutates files and you want it isolated.

## 4. Decision policy (decide vs escalate)
- **Decide yourself** (then state it): tactical sequencing, which agent/model, file layout, library
  patterns already chosen, fixing a failing gate, applying `[OWNER-DECISION]` defaults and flagging them.
- **Escalate to owner**: business-rule semantics (authorization matrices, approval rules, budget
  authority, metric definitions), strategic priority, anything irreversible/expensive (production
  deploy, destructive infra), or anything outside the signed spec.
- **In autonomous mode:** apply a sensible default to non-blocking owner-flags + record them; **skip**
  features that genuinely need an owner decision (the "wall"); never guess a business rule silently.

## 5. Test pyramid (ADR-0010) — the standard
Each `AC-###` is owned by **one** test at the **lowest sufficient layer**:
- **Unit (bulk):** Vitest/RTL, mocked — logic, hooks, db query builders, formatters, and component
  loading/empty/error/filter states. Fast, no stack.
- **Integration (some):** **pgTAP** (`supabase test db`) — RLS/tenancy/role read+write contracts. This
  is the home for "in-org read allowed / cross-org blocked / role gate", NOT e2e.
- **E2E (few, ~6–8 curated journeys):** Playwright against the live stack — real cross-stack flows only
  (login→dashboard, sign-out guard, magic-link, session-persist, one real-data smoke per module).
- **Never push an AC up a layer to satisfy a convention.** Tag the `AC-id` in the owning test's
  title/description for `grep` traceability. Adding lower-layer coverage must precede deleting any e2e.

## 6. Git & release hygiene (hard rules — we got burned here, see §9)
- One **branch per issue** off an **up-to-date `main`**. Branch names: `feat/`, `chore/`, `test/`, `perf/`.
- `release-engineer` runs the **full fresh verification before pushing**: from `pmo-portal/` —
  `typecheck`, `lint:ci`, `test`, `build`, and **`npx playwright test` against a live stack** (start
  Supabase; it's the behavioral guard) + `supabase test db` for DB changes. No push without green e2e.
- **Never force-push. Never `git add -A`.** Stage the issue's files explicitly.
- `release-engineer` opens the PR and **stops**. The **Director** approves & merges within the signed
  spec (`gh pr merge <n> --squash --delete-branch`), then **immediately syncs**:
  `git checkout main && git fetch origin && git reset --hard origin/main`, delete the local branch.
- **Keep `origin/main` current** — push main promptly. Docs/plans can be committed straight to main
  (then branch) so PR diffs stay scoped to code. (Letting origin/main go stale once caused a squash to
  collapse all history into one commit.)
- Production deploy / irreversible infra = **owner approval only**.

## 7. Verification discipline
No completion claim without fresh evidence. The gates (all must be green to merge): `npm run
typecheck` (0 errors) · `npm run lint:ci` (`--max-warnings=0`) · `npm test` (unit, ≥80% on changed
code, behavior-asserting) · `npm run build` · `npx playwright test` (live stack, from `pmo-portal/`) ·
`supabase test db` (pgTAP, for DB changes). **Don't trust agent reports — re-verify the load-bearing
claims yourself** (re-run gates, read the diff, or dispatch a reviewer). Reviewers caught a broken
render, a self-escalation RLS hole, and a lying test that the implementer's own green run missed.

## 8. Code & data conventions (the quality bar)
- **DB rows are snake_case.** Components/pages consume the DB shape directly. **Never** `as unknown as
  <prototypeType>` to bridge camelCase↔snake_case — it compiles and renders blank/`NaN` (the #4 Board
  bug). Only string→enum widening is acceptable (DB enum values are byte-identical to the TS enums).
- Data-access layer `src/lib/db/*`: one typed module per aggregate, SQL joins (no client `.find()`),
  **never send `org_id`** (RLS scopes it), throw on error, normalize numerics at the boundary.
- Hooks `src/hooks/*`: TanStack Query, **org/user-scoped `queryKey`**, `enabled` gated on auth.
- Pages: `useMemo` derived/filtered lists; real loading/empty/error states (Frontend DoD); shared
  `formatCurrency` from `src/lib/format.ts`.
- Schema: `org_id` (defaulted, client-unspoofable via `with check`) + RLS (+`force row level security`)
  on every business table; reversible-by-`db reset` migrations; partial unique indexes where intended.

## 9. Lessons / pitfalls (don't repeat)
- **Stale `origin/main` + squash-merge collapsed all history** into one commit. → Push main; reset after merge (§6).
- **Board view rendered `$0`/`NaN`** — snake/camel mismatch hidden by `as unknown as` cast; e2e missed it, code-quality caught it. → §8 + keep code-quality review.
- **A "passing" AC test asserted the wrong thing** (AC-104 inserted without `org_id`, so org-isolation blocked it, masking a missing INSERT role-gate). → spec-reviewer must verify the test proves the *intended* path.
- **Security audit found a self-role-escalation hole** the unit/pgTAP suite missed. → always run security-auditor on auth/RLS/RPC, with live exploit attempts.
- **Agents ran Playwright from the repo root** ("no tests found") and reported false e2e success. → e2e runs from `pmo-portal/`; release-engineer re-verifies.
- **The "1 AC → 1 e2e" rule built an ice-cream cone.** → the pyramid (§5).
- GoTrue seed `auth.users` insert shape is version-sensitive; `toISOString().split('T')` is timezone-broken — use local date parts.

## 10. The grading rubric (assessing orchestrated work)
A correctly-run issue scores yes on: spec with ACs + owner-flags · no-placeholder plan with AC→task
mapping · TDD (failing test first) · all gates green with **fresh** evidence · tests placed at the
**lowest sufficient layer** + AC-id-tagged · snake_case seam handled with no `as unknown as` cast ·
data-layer/hook/page conventions followed (§8) · loading/empty/error states · security-auditor run if
auth/RLS/RPC touched · branch (not merged) + scoped PR · owner-decisions **flagged not guessed** ·
honest self-critique. Red flags: unverified "done", coverage pushed to e2e, casts hiding shape bugs,
business rules silently invented, `git add -A`/force-push, claims without re-run evidence.
