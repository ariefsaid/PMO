# UI/UX Workflow

> **⚑ SUPERSEDED IN PART by ADR-0030 (2026-06-16) — read `docs/qa-portfolio.md` first.** The standing
> **4-lens design review run ×2** (mockup round + rendered round) below is being replaced by the
> **Discover → Graduate → Cover** QA portfolio: open-ended *Discover* (the lenses' real value — unknown-unknowns)
> → *Graduate* each finding into a test + a `routes×oracles` matrix cell + a DESIGN/decision note → *Cover*
> via enumerated sweeps + deterministic gate-tests. The mockup becomes a 30-sec owner sketch-glance; deterministic
> correctness (chart positions, money, dates, a11y, tokens) moves to CI tests; the double-pass retires in favour
> of one pass + a retained KB. Foundation + per-issue mechanics here still apply; the *review-battery* section
> migrates per the ADR-0030 rollout phases.

The design analog of the code-side SDD→TDD→BDD loop (`docs/director-playbook.md` §2,
`docs/decisions.md`). The **Director** (main Opus session) orchestrates this and **owns the
human-UX checkpoint** — taste is the owner's gate, the way spec sign-off is. `DESIGN.md` at repo
root is the single source of truth (see `docs/product-expectations.md` Part C "Design/UI").

## 1. Foundation (one-time, human-collaborative)
Establish the design system before any UI issue builds on it.
1. **Reverse-engineer `DESIGN.md`** — `design-architect` extracts the existing app's de-facto
   tokens (color / type / spacing / radius / elevation) + component patterns into `DESIGN.md`
   (design.md format) **via `impeccable document` (DESIGN.md from existing code) → `impeccable extract`
   (reusable tokens/components) → `impeccable distill`**, naming tokens with `ui-ux-pro-max`'s
   `design-system` vocabulary; `design-consultation` supplies the format only. The existing look is the
   IDENTITY authority; skills supply craft, not a new aesthetic — never invent a brand.
2. **Owner sign-off** — the owner approves `DESIGN.md` (taste is the owner's gate, like spec
   sign-off). Until signed, no UI issue proceeds.

## 1a. Pre-spec HTML mockup gate (every UI issue — before Spec) — design-review **ROUND 1 of 2**
> **⚑ FALLBACK PATH (review mode `4-lens`/`3-lens`).** Under the **default `portfolio`** mode (ADR-0030),
> this full mockup round is **demoted to a ~30-second owner sketch-glance** (`docs/director-playbook.md`
> §2 step 1c) — directional "right shape?" alignment, not an agent battery. The full mockup round below
> runs **only** when `review mode` (top of `docs/qa-portfolio.md`) is flipped to `4-lens`/`3-lens`. Kept
> intact as the reversible fallback.

Runs at **intake**, right after the `grill-with-docs` alignment grill (`docs/director-playbook.md`
§2 step 1b/1c) and **before any spec/plan/build effort is committed**. The mockup is the cheap
artifact that absorbs taste/IxD/IA iteration so the per-issue loop (§2) doesn't re-litigate it
post-build. **Every FE issue gets the four-lens review twice:** here on the *mockup* (round 1, vets
the design before code exists) and again in §2.3 on the *built* UI (round 2, catches drift from this
approved mockup).

1. **Artifact** — a static HTML+CSS mockup (no build step, no React) under
   `docs/design-mockups/<issue-slug>/`, styled strictly with `DESIGN.md` tokens. It must show the
   key states (default / empty / error at minimum) and the mobile breakpoint, not just the happy
   desktop frame.
2. **Full design round on the mockup (review round 1 of 2)** — same discipline as a real UI build:
   design-plan (`design-architect`) → mockup build (`ui-implementer`) → the **four-lens review
   battery** of §2.3 (visual/correctness, IxD task-flow, IA structure, **product/intent**) rendered
   in a browser → fix rounds until ship-clean. The approved mockup is the **drift baseline** that
   round 2 (§2.3, post-implementation) audits the built UI against.
3. **Owner approval** — the owner approves the mockup the way they sign off a spec. The approved
   mockup then becomes a **binding input** to the spec and the per-issue design-plan (§2.1).
4. **Status: design-binding, code-throwaway** — the later React implementation builds to
   `DESIGN.md` tokens + the design-plan; mockup markup is never copied into the app.

## 2. Per-UI-issue loop
Slots into the Director per-issue loop **between Build and Accept** (so a feature's data/logic lands
under TDD, then its UI is designed, built, and reviewed). The **BDD authoring rule** still governs the
Accept step that follows: tests encode the user's real journey to the goal and assert that goal — when a
UI change alters the *intended* journey (e.g. a new confirm step, back-nav moving to the breadcrumb),
update the e2e *steps*, never weaken the goal-oracle to match the rendered app (see `CLAUDE.md` →
"BDD authoring rule" and `.claude/agents/qa-acceptance.md`).
1. **Design-plan** *(`impeccable shape` + `ui-ux-pro-max` `plan`)* — `design-architect` → layout,
   component breakdown, all states (loading / empty / error / edge), responsive breakpoints, WCAG-AA
   a11y, and which `DESIGN.md` tokens each piece uses. (May be a `## Design` section in the eng-planner plan.)
2. **UI-implement** *(`ui-ux-pro-max` `ui-styling` + `build`; `taste` discipline; `impeccable`
   `harden`/`adapt`/`animate`/`clarify` per plan)* — `ui-implementer` builds strictly to tokens + the
   design-plan; all states + responsive + a11y; TDD component tests (Vitest/RTL). No raw hex/spacing.
3. **Design-review.** **Default (review mode `portfolio`, ADR-0030):** a **single rendered Discover pass** —
   `design-reviewer` renders the running app on **rich seed** and audits **open-endedly** (no checklist;
   `taste`/`impeccable`/`design-review`), and **every finding GRADUATES** into a test + a `routes × oracles`
   matrix cell + a `DESIGN.md`/`docs/decisions.md` note (`docs/qa-portfolio.md` "Graduation registry"). The
   double-pass is retired — one retained pass beats two stateless ones. Deterministic correctness (token/visual
   drift, chart positions, money, dates, a11y) moves to **Layer-1 CI gate-tests**, not this human pass.
   **Fallback (review mode `4-lens`/`3-lens`) — the standing FOUR-LENS battery (review ROUND 2 of 2 — post-build drift pass)** *(read-only; renders + screenshots the running app at the plan's breakpoints)*. Every UI review runs **all four** lenses, each **explicitly directed** — a single generic "UX review" prompt reliably hits only the first and misses the others (this gap let real IxD/IA/intent defects ship). This is the **second** of the two mandatory FE reviews: beyond `DESIGN.md` + the design-plan, it **explicitly diffs the rendered build against the owner-approved mockup (§1a) to catch mockup→implementation drift** (spacing/scale/state/interaction that slipped between the approved design and the built result). Findings write to `review/*.md`.
   - **(a) Visual / correctness** *(`design-review` engine + `impeccable critique`/`audit`; `taste` AI-tells; `ui-ux-pro-max` `review`)* — token fidelity, hierarchy, all states, AI-slop, WCAG-AA, interaction perf, vs `DESIGN.md` + the design-plan.
   - **(b) IxD / task-flow naturalness** *(`impeccable critique`: Nielsen-10 scored + cognitive-load + 5-persona walkthrough; `ui-ux-pro-max` `primary-action`/`progressive-disclosure`/`success-feedback`)* — for each role's REAL tasks, walk the journey in the running app and flag **workflow friction, convention violation, needless state transition, information overload, mental-model mismatch, task-analysis gap**. *Naturalness, not correctness.* (e.g. timesheet Save↔Submit split across a view change.) **Scoped to flow-smoothness — not job-fit (that is Lens D).**
   - **(c) IA / structure & navigation** *(Nielsen #4 Consistency + IA first-principles + ERP/CRM/PSA domain conventions)* — **one canonical home/URL per entity**, no list/route overlap, no entry-point-dependent rendering, coherent lifecycle presentation, consistent breadcrumb/back. *Structure, not flow.* (e.g. one record → two lists → two detail pages.)
   - **(d) Lens D — Product / Intent (JTBD Cognitive Walkthrough)** — grades **intent-fit** against `docs/jtbd.md` (the role × job-story oracle). Owner: `design-reviewer` (same as A/B/C). For each screen × its primary role, interrogate the **5 questions**:
     1. **Job** — what job did the user come here to do? State it as a job story ("When [situation], a [role] wants to [motivation], so they can [outcome]").
     2. **Expectation** — does the user *expect* this feature/affordance HERE? Does placement + naming match their mental model and ERP/domain convention?
     3. **Priority/placement** — is information/affordance ordered by decision-relevance to the job (most-decision-relevant above the fold)?
     4. **Actionability** — *"so what / now what?"* — can the user ACT on what they see in one step? Is the next action ADJACENT to the insight?
     5. **Mental-model consistency** — do analogous objects share one interaction paradigm (name / create / open / advance / get-back / preview-before-drill-in)?

     **3 calibration anchors** (Lens D must always catch these — they pass code review + security + Lenses A/B/C but fail intent):
     - Procurement has no preview; approvals/timesheets do → mental-model inconsistency (Q5).
     - Calendar view on the project LIST, not clickable, not in task detail → view with no job/scent in the wrong place (Q2).
     - S-curve above the fold with actionable tabs buried below → analytic with no adjacent lever (Q3/Q4).

     Findings output + severity exactly like the other lenses. Fixes route back to `ui-implementer`. Charter + full oracle: `docs/reviews/2026-06-14-intent-lens-gap.md` + `docs/jtbd.md`.

   Reusable: the IxD-audit, IA-audit, and Intent-audit **workflow scripts** are saved under the session's workflow scripts and re-run on demand; their directed prompts are the source of truth for what each lens hunts. Real owner-flagged defects become **calibration anchors** in the prompts.
4. **Fix round (if needed)** — issues route back to `ui-implementer`; `design-reviewer` re-checks
   with before/after. Repeat until ship-clean.
5. **Owner visual UX sign-off** — the owner approves the look on a real artifact.
6. **Merge** — Director merges within the signed spec (code-side gates still apply).

## 3. The Human-UX improvement loop (distinct)
Taste cannot be automated like correctness, so polish runs as an explicit owner-gated loop, separate
from the per-issue build:
1. Produce a **look-at-able artifact** — preview URL / screenshots of the running app.
2. **Owner directed feedback** — the owner points at what to change.
3. `design-reviewer` / `ui-implementer` implement the change and return **before/after**.
4. Repeat until the owner **signs off**.

This loop is gated by the **owner**, not the gates — visual quality is a judgment call.

## 3a. e2e encodes the NATURAL journey, not the app's current shape (discovery → regression)
The review battery (§2.3) **discovers** UX issues and makes the judgment calls; **e2e locks the observable ones so they can't regress.** Author each acceptance test to the user's *ideal, conventional* journey and assert the **convention-invariants + the expected post-states** — so the test is RED until the app behaves naturally (the binding BDD rule, sharpened). The anti-pattern that let real defects pass: authoring the e2e *to the app's current steps* (e.g. AC-TSE-021 walked save→summary→submit and only asserted "submitted", so the unnatural flow stayed green). Write them the owner's way:
- *"When a PM creates a project, opening it from **either** the Projects list **or** the Pipeline resolves to **ONE** detail page (same URL), showing the stage-appropriate lens."* — the IA canonical-view invariant.
- *"On the timesheet entry screen the engineer sees **Save and Submit together** from first paint; on **Save**, the entered hours persist with a quiet confirmation and no forced summary view; on **Submit**, the week becomes read-only Submitted."* — co-located primaries + the explicit post-states.

**Rule: every confirmed IxD/IA finding becomes a regression invariant at the lowest sufficient layer** (ADR-0010) — observable flow/structure → e2e/component test; data-logic (honest numbers, list scoping) → unit/pgTAP. Discovery (the agent battery) feeds regression (the test pyramid); the battery then re-runs to find the next unforeseen class.

## 4. Storybook
When the shared component library is extracted (Phase 3, per `docs/product-expectations.md`), each
component gets a Storybook story: per-component **state matrix** (loading / empty / error / edge /
variants) + a11y checks in isolation. Not before — premature Storybook is overhead.

## 5. Code-agent → UI/UX-agent analog
| Code-side agent | UI/UX analog | Role |
|---|---|---|
| spec-miner / eng-planner | **design-architect** | reverse-engineer `DESIGN.md`; per-issue design-plan (read-only on code, writes DESIGN.md + docs/) |
| implementer | **ui-implementer** | build/refactor UI to tokens + plan; TDD component states; all states + responsive + a11y |
| spec-reviewer + code-quality-reviewer + security-auditor (the **3-reviewer** code battery) | **design-reviewer** — default (`portfolio`): **one rendered Discover pass** on rich seed, every finding **graduated** into a test + matrix cell + DESIGN/decision note (ADR-0030); fallback (`4-lens`/`3-lens`): the **4-lens** battery run **twice** (mockup §1a + built UI §2.3 for drift) | render + screenshot; audit vs `DESIGN.md` + plan (+ approved mockup + `docs/jtbd.md` Lens D in `4-lens` mode); AI-slop / a11y / perf; read-only |
| Director (main session) | **Director (main session)** | orchestrates the loop; owns the **human-UX checkpoint** (owner sign-off) |

### Skills → exact commands per agent (one owner per command — no overlap)
| Agent | Primary | Secondary / checklist | Not used |
|---|---|---|---|
| **design-architect** | `impeccable` `document`→`extract`→`distill`; `ui-ux-pro-max` `design-system` + `plan`; `impeccable shape` (per-issue) | `design-consultation` (format only); `taste` (states/a11y into the plan) | design-consultation greenfield brand interview |
| **ui-implementer** | `ui-ux-pro-max` `ui-styling` + `build`/`implement`; `taste` (discipline) | `impeccable` `harden`/`adapt`/`animate`/`optimize`/`clarify`/`layout`/`typeset` — per plan only; `agent-browser` (rendered self-check) | `impeccable live` (localhost browser loop) |
| **design-reviewer** | `design-review` (render→screenshot→audit); `agent-browser` (the render engine — `skills get core`; `dogfood` for exploratory QA) | `impeccable` `critique` + `audit`; `taste` AI-tells/pre-flight; `ui-ux-pro-max` `review`/`check` | — |

## 6. Skill caveats
- **impeccable** — phone-home / telemetry disabled (vendored copy); use offline.
- **ui-ux-pro-max** — Gemini generative sub-skills are **excluded**; use only its reference data
  (palettes / font-pairs / UX rules / anti-patterns) + design-system / ui-styling sub-skills.
- **taste** — its specific opinionated aesthetic **yields to `DESIGN.md` identity**; use it for the
  craft discipline (states, perf, a11y, AI-tells), not to re-skin the app.
