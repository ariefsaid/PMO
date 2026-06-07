# UI/UX Workflow

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
3. **Design-review** *(`design-review` engine + `impeccable critique` & `audit`; `taste` AI-tells;
   `ui-ux-pro-max` `review`/`check`)* — `design-reviewer` renders the running app, **screenshots** each
   state at the plan's breakpoints, and audits against `DESIGN.md` + the design-plan (token fidelity,
   hierarchy, states, AI-slop, a11y, interaction perf). Read-only on source.
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

## 4. Storybook
When the shared component library is extracted (Phase 3, per `docs/product-expectations.md`), each
component gets a Storybook story: per-component **state matrix** (loading / empty / error / edge /
variants) + a11y checks in isolation. Not before — premature Storybook is overhead.

## 5. Code-agent → UI/UX-agent analog
| Code-side agent | UI/UX analog | Role |
|---|---|---|
| spec-miner / eng-planner | **design-architect** | reverse-engineer `DESIGN.md`; per-issue design-plan (read-only on code, writes DESIGN.md + docs/) |
| implementer | **ui-implementer** | build/refactor UI to tokens + plan; TDD component states; all states + responsive + a11y |
| spec-reviewer + code-quality-reviewer | **design-reviewer** | render + screenshot; audit vs `DESIGN.md` + plan; AI-slop / a11y / perf; read-only |
| Director (main session) | **Director (main session)** | orchestrates the loop; owns the **human-UX checkpoint** (owner sign-off) |

### Skills → exact commands per agent (one owner per command — no overlap)
| Agent | Primary | Secondary / checklist | Not used |
|---|---|---|---|
| **design-architect** | `impeccable` `document`→`extract`→`distill`; `ui-ux-pro-max` `design-system` + `plan`; `impeccable shape` (per-issue) | `design-consultation` (format only); `taste` (states/a11y into the plan) | design-consultation greenfield brand interview |
| **ui-implementer** | `ui-ux-pro-max` `ui-styling` + `build`/`implement`; `taste` (discipline) | `impeccable` `harden`/`adapt`/`animate`/`optimize`/`clarify`/`layout`/`typeset` — per plan only | `impeccable live` (localhost browser loop) |
| **design-reviewer** | `design-review` (render→screenshot→audit) | `impeccable` `critique` + `audit`; `taste` AI-tells/pre-flight; `ui-ux-pro-max` `review`/`check` | — |

## 6. Skill caveats
- **impeccable** — phone-home / telemetry disabled (vendored copy); use offline.
- **ui-ux-pro-max** — Gemini generative sub-skills are **excluded**; use only its reference data
  (palettes / font-pairs / UX rules / anti-patterns) + design-system / ui-styling sub-skills.
- **taste** — its specific opinionated aesthetic **yields to `DESIGN.md` identity**; use it for the
  craft discipline (states, perf, a11y, AI-tells), not to re-skin the app.
