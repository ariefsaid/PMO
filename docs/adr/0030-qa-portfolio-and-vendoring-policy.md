# ADR-0030 — QA portfolio (Discover→Graduate→Cover) + build-vs-buy vendoring policy

- **Status:** Accepted (owner-approved 2026-06-16)
- **Supersedes:** the standing "4-lens design review ×2" battery (`docs/design-workflow.md` §1a/§2.3) as the *primary* UX-quality mechanism. The 4 lenses are not deleted — they are reorganised (see Decision).
- **Related:** ADR-0010 (test pyramid), ADR-0016/0017 (policy/repository seam), `docs/jtbd.md` (the action-completeness oracle), `docs/director-playbook.md`, `docs/product-expectations.md`.

## Context

The review apparatus had grown long — intake grill + an owner-approved mockup + a **4-lens design review (A visual / B flow / C structure / D intent) run twice** (mockup round + rendered round) + 3 code reviewers (spec/quality/security) + qa-acceptance — yet it kept missing obvious defects: a categorical-axis S-curve plotting "today" at the far right, milestone diamonds rendered off-position, a stored-but-never-populated `projects.spent`/`budget` money bug, date TZ off-by-ones. The owner's verdict on the most-narrative lens was literal: *"the jtbd review isn't earning its keep."*

Two empirical facts drove this ADR (evidence in `docs/reviews/2026-06-14-jtbd-walkthrough.md` vs `2026-06-14-jtbd-census.md` vs `2026-06-15-broad-audit.md`):

1. **Enumerated beat narrative.** The narrative JTBD *walkthrough* found ~14 gaps (mostly re-confirming already-known anchors). The **enumerated census** (16 routes × an action-completeness oracle) found the systemic dead-display class; the **broad audit** (5 *separate specialised* dimension-sweeps) found the Critical money bug. The decisive variable was **enumerated-denominator vs narrative-sampling**, not "JTBD vs not" — the census *is* JTBD, just enumerated.
2. **Specialised beat generalist.** One narrow oracle per agent (the broad audit's 5 dimensions) outperformed a generalist "look and judge" pass — consistent with the non-deterministic nature of LLMs: bound the scope, get reliable output.

But enumeration has a hard limit the owner named: **it cannot catch unknown-unknowns** — you cannot write a checklist question or a test for a defect you have not yet conceived of. Open-ended expert review (the lenses / `taste` / `impeccable` / `design-review` skills) is the only net for those, and is exactly what a non-UX owner relies on to surface what they cannot articulate. Finally, agents **repeat** findings because they lack prior context — which is why the same review runs twice; the double-pass is a workaround for statelessness, not a real control.

## Decision

### A. QA is a **Discover → Graduate → Cover** pipeline, not a pile of reviews

- **Discover (open-ended):** finds unknown-unknowns. Open-ended critique agents (`taste`/`impeccable`/`design-review`) + a **vision-model rendered pass on rich seed data** + the **owner at boundaries**. No checklist — its job is "something is wrong here that no rule would name." This is where the old 4 lenses' real value lives.
- **Graduate (the retention step — the crux):** every Discover finding is converted into permanent memory so it is never re-found, never re-explained, and never regresses:
  - a **deterministic test** (the regression lock), and
  - a **cell in the `routes × oracles` matrix** (so it is always checked), and
  - a **DESIGN.md / `docs/decisions.md` note** (the decided pattern/taste call).
- **Cover (enumerated + deterministic):** locks the known classes forever. The `routes × oracles` enumerated sweep + the deterministic gate-tests (below). No skipping, no judgement drift.

The asymptote: the owner (or a skill) explains/discovers a thing **once**; it is captured; the unknown space monotonically shrinks. A single review pass *with retained memory* beats two passes without it — so the **double review pass is retired** in favour of one pass + the retention KB.

### B. `routes × oracles` (the enumerated denominator), defined

- **Routes** = the app's real screens (≈16 URLs: `/`, `/my-tasks`, `/sales`, `/sales/:id`, `/projects`, `/projects/:id/:tab`, `/procurement`, `/procurement/:id`, `/timesheets`, `/approvals`, `/companies`, `/companies/:id`, `/contacts`, `/contacts/:id`, `/administration`; `/incidents` currently feature-hidden).
- **Oracles** = the narrow specialised questions asked of *each* screen: action-completeness ("then what?"), state-coverage (loading/empty/error/permission), data-correctness (every number/date/plotted position right), cross-screen consistency, a11y, mobile@390, job-fit-per-role.
- The **matrix** is routes × oracles; the *denominator* is every cell. A sweep (agent or test) must answer every cell on the affected routes — that is what makes coverage non-skippable. The matrix lives in `docs/qa-portfolio.md` and is a **merge-gate to update when a route/screen is added** (a new screen must not silently escape every sweep — this maintenance is the price of the method).

### C. Deterministic correctness graduates **out of human review into gate-tests**

Anything with a right answer is a test, not an opinion — chart-position/golden, money, dates/TZ (property-based), derived values, `axe-core` a11y, Playwright visual-regression (replaces human Lens-A token/visual checking). These are CI merge-blockers. The S-curve, the money bug, the TZ off-by-ones were each *a test that should have existed*, not a lens that should have looked harder.

### D. What is retired / kept / added

- **Demoted from default — NOT deleted (kept fully runnable as the reversible fallback; see "Reversibility" below):** the narrative 4-lens **×2** battery and the **full-lens audit of the static mockup** stop being the *default* path. Their unknown-unknown value is preserved in the **Discover** layer (same skills, same agents). The `design-reviewer` agent, the 4-lens skills, and `design-workflow.md` §1a/§2.3 stay intact in-repo so the old battery can be re-enabled with a single switch. Within the new default: Lens A → visual-regression + token-lint; Lens B/C/D → enumerated sweep + vision discovery; taste → owner-at-boundaries.
- **Kept, right-sized:** the **3 code reviewers** (spec/quality/security — orthogonal, cheap; depth right-sized per CLAUDE.md model-tiering), the **intake grill**, and the mockup **only as a ~30-second owner "right shape?" sketch-glance** (directional alignment), never an agent battery.
- **Added:** the deterministic gate-tests (C), the enumerated `routes×oracles` sweep (B), the retention KB / graduation step (A), and a **vision rendered-acceptance** pass with a fixed per-screen question bank.

### E. Adversarial review is a **launch / version gate**, not per-PR

A red-team + verify team (Workflow adversarial pattern) runs at release/version boundaries and on genuinely dangerous changes (auth/RLS/money/migrations) — not on every PR.

### F. Build-vs-buy: **"buy the engine, build the skin"**

For any **non-trivial generic widget**, default to vendoring a mature, widely-used, permissively-licensed library; **prefer headless** so DESIGN.md tokens are preserved exactly; hand-roll only **identity atoms** (buttons, cards, pills, the rail) or where no suitable library exists.

**There is a third outcome between "buy" and "build from scratch": _build-and-own, referencing a proven implementation._** When the widget is core + identity-defining and no headless option fits, but mature **permissively-licensed (MIT/Apache)** source exists — study/adapt its *algorithms and conventions* (e.g. dependency-arrow routing, auto-scheduling, resource histograms) but write the implementation to **our** tokens / a11y / target framework, so we own it (no runtime dependency, no skin to fight, no bundle/license tax). Don't reinvent; don't depend. Reading MIT source for reference is fine; if substantial code is adapted, keep the MIT attribution. **This is the Gantt path (owner decision, 2026-06-16).** Rationale: industry-standard libraries encode **conventions users already know**, **built-in a11y**, and **edge-cases we would never enumerate** — i.e. they are *captured UX expertise the owner does not have to articulate*, and they are QA **Layer 0** (the cheapest defect is the class that cannot exist).

**Selection bar:** high downloads/stars (battle-tested + convention) · actively maintained · accessibility built-in · themeable to our tokens (headless preferred) · **permissive license (MIT/Apache; NOT GPL, NOT commercial-for-core)** · sane bundle.

**Supply-chain hygiene (mandatory; informed by CVE-2026-45321, the May-2026 `@tanstack/*` npm worm — note `@tanstack/table` itself was *not* compromised):** pin exact versions for vendored deps (no floating ranges), enforce lockfile integrity, keep Dependabot on, prefer libraries with a demonstrated security-response posture.

**Standing shortlist (verified 2026-06):** Gantt → **keep custom + fix** (the spike — `docs/spikes/2026-06-16-gantt-library-eval.md` — *overturned* the SVAR pick: SVAR `wx-react-gantt` is **GPLv3** on npm *and* crashes on React 19; Frappe is MIT but ships **zero a11y** + no milestone-diamond model; our custom component is 80% there, the most accessible, and the smallest — its gaps [dependency connector lines, axis diamonds, MS-Project table+zoom] are bounded SVG work, **M** effort); tables/data-grid → **TanStack Table** (headless, confirmed *not* in CVE-2026-45321); primitives → **React Aria / Base UI** (Radix slowed post-acquisition); date math → **date-fns** (kills the TZ class); charts → **keep recharts** (the S-curve bug was our misuse, not the lib); virtualization → **TanStack Virtual**. Excluded for MVP: Bryntum (commercial). *Correction from the spike:* DHTMLX Community Edition is **now MIT** (`dhtmlx-gantt@10`, not the GPLv2 the search reported) — still excluded for the MVP (heavy, imposes its own skin), but re-weighable if the custom Gantt's gaps ever prove too costly.

> **Worked example of the policy (do not delete):** my initial Gantt rec (SVAR, "MIT") came from a *vendor blog* (svar.dev ranked its own product #1). The hands-on spike found the real npm license is **GPLv3** and it **does not render on React 19**. Lesson, now binding for L0: **verify license + target-framework compatibility + a11y empirically in a throwaway harness before adopting — never from a blog/marketing page.** Vendoring is *evaluate-first*, not *always-buy*; a widget may (as here) fail the bar and custom wins.

## Reversibility (binding — this ADR is a *trial*, not a one-way door)

This is a process bet; it must be cheap to undo. Reversibility is a first-class requirement.

- **Nothing is deleted.** The `design-reviewer` agent (+ `.codex` surface), the 4-lens skills
  (`design-review`/`impeccable`/`taste`), and `design-workflow.md` §1a/§2.3 (the mockup-round + rendered-round
  4-lens battery) remain in the repo, unchanged, for the entire trial. The new portfolio runs *alongside* them.
- **One-switch revert — a "review mode" selector** (`portfolio` | `4-lens` | `3-lens`), recorded at the top of
  `docs/qa-portfolio.md` and honoured by the Director's per-issue loop. Reverting = flip the mode back to
  `4-lens` (or `3-lens`); no rebuild, no agent re-creation. The deterministic gate-tests (Layer 1) and any
  graduated tests **stay regardless of mode** — they are pure additions and never need reverting.
- **Trial window:** the next ~5 UI issues (≈2 weeks). 
- **Success criteria (keep the portfolio):** (a) it catches **≥** what the lens battery would — measured by the
  owner-boundary pass + later audits finding **no** escape the 4-lens would plausibly have caught; (b) fewer
  defects reach the owner than under the battery; (c) the **graduation registry actually grows** (findings get
  locked into tests/matrix cells, not re-found).
- **Revert trigger:** if escapes rise, the owner judges quality dropped, or graduation stalls → flip `review mode`
  back to `4-lens`. Because the battery was never removed, this is immediate and lossless.

## Consequences

- **Positive:** fewer *narrative* passes; the correctness class is caught deterministically and forever; discovery is retained (no repeats, no re-explaining, single review pass); vendoring removes whole hand-rolled bug classes and imports conventions a non-UX owner cannot specify.
- **Costs (accepted):** upfront QA-infra investment (test harnesses, the question bank, the matrix); **recurring denominator maintenance** (the routes×oracles matrix must track new screens); per-widget themeability risk on vendored libs (mitigated by headless-first + the bar).
- **Rollout:** Phase 1 = S-curve fix + the data-viz/money/date property-test + axe floor (bug-fix *and* the deterministic floor in one wave). Phase 2 = vision rendered-acceptance + visual-regression harness. Phase 3 = `routes×oracles` matrix + specialist oracle agents + the maintenance gate. Phase 4 = vendoring pilots (Gantt → SVAR; date-fns) + adversarial-at-launch. Operational detail: `docs/qa-portfolio.md`.
