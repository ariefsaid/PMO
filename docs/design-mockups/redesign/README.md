# Redesign mockups — navigation (read this first)

Static HTML mockups from the 2026-06→07 design exploration. Open any `.html` in a browser
(light + dark stacked on one page). **Everything here is docs/design artifacts — not app code.**

## ✅ LOCKED — the current design language (use these)
The direction is **monochrome-calm** (ADR-0037): monochrome chrome, PMO blue only for the single
primary action + focus ring, status as a quiet dot/ring, Inter+cv, 8px radius, soft easing, deliberate
action↔density↔whitespace balance, first-class dark, WCAG-AA both themes.
- **`reskin/`** — the locked language on the core hybrid surfaces: `projects.html`, `record.html`,
  `approvals.html`, shared system in **`reskin/_app.css`** (the component/token layer to port).
- **`reskin/ext/`** — the chart/timeline widget treatments: `dashboard.html` (chart family),
  `delivery.html` (S-curve + Gantt), `procurement-and-funnel.html` (vertical procurement history + funnel).
- **`_shots/`** in each folder — rendered screenshots (light over dark).

## 🧭 Governance
- **ADR-0037** — the locked language + reskin-in-place port method.
- **`docs/plans/2026-06-30-reskin-port-parity-inventory.md`** — the no-features-left-behind gate
  (every route/widget/chart/action + reskin-treatment status).
- **`docs/plans/2026-07-01-reskin-port-plan.md`** — how pi+glm-5.2 executes the port.

## 🗂 Superseded / historical (do NOT port from these)
- **top-level `*.html`** (`app-shell`, `projects-list`, `project-detail`, `procurement-detail`,
  `executive-dashboard`, `login`, `index.html`) + **`converge/`** — earlier rounds. `converge/` was the
  denser hybrid the reskin replaced; the top-level files were the first light/records-workspace pass.
- **`diverge/`** — the 4 explored IA/IxD paradigms (A calm-workspace · B board-first · C two-pane ·
  D focused-console). Kept as the decision record; the owner converged on the A+C+B hybrid.
- **`_refs/agent-native/`** — reference screenshots of Builder.io's `agent-native` app (the visual
  inspiration). Third-party; local reference only.
