# Reskin Port Plan — applying the monochrome-calm language to the app (pi + glm-5.2)

> **Authority:** ADR-0037 (language + method locked). **Look source:** `docs/design-mockups/redesign/reskin/`
> (+ `reskin/ext/`). **No-drop gate:** `docs/plans/2026-06-30-reskin-port-parity-inventory.md`.
> **Execution:** pi CLI / glm-5.2 per `docs/pi-delegation.md`; **Director verifies every result** (grep
> purity + render the pixel/taste lens). This plan is for whoever picks up the reskin build cold.

## 0. Prime directive
**Reskin IN PLACE.** Re-tone the **existing** `pmo-portal/pages/` + `src/components/` to the new
design tokens/aesthetic. Keep every widget, chart, action, and test. **Never rebuild a surface "from
the mockups"** — the mockups are the *look*, the codebase is the *feature set*. The parity inventory
is the checklist; nothing on it may vanish without owner sign-off.

## 1. Branch & baseline (do first)
- **Branch the port off CURRENT `dev`** (which carries the procurement case-folder revamp, migs→0044).
  The `redesign/design-system` branch is the **mockup/design-artifact** branch (docs only) — it is NOT
  the port branch; cherry-pick nothing from it into app code.
- Work lands `dev` → `main` (gated), **never `production`** without a direct per-instance owner go
  (binding rule; see `docs/backlog.md`). The reskin is a **big-bang branch**: it stays off `main` until
  the whole app is converted + green.

## 2. Foundation phase (once, before any surface)
1. **Fold the token system into the app.** Port `reskin/_tokens.css` + the `reskin/_app.css` §0
   monochrome-calm token overrides (incl. the dark-mode AA fixes: `--ds-primary-text`, `--ds-primary-solid`,
   `--ds-success/-destructive-solid`, lifted dark neutrals) into the app's token layer / `index.css`.
   Keep the `--ds-*` names so component classes port cleanly.
2. **Adopt Inter + cv** (`font-feature-settings: "cv02","cv03","cv04","cv11"`, `tabular-nums`) and a
   **real icon set** (Lucide or Tabler) replacing hand-rolled `iconPaths` (`src/components/ui/icons`).
3. **Rewrite `DESIGN.md`** to the monochrome-calm system (it becomes the source of truth; do this now,
   not before the port). Record: monochrome chrome + blue-for-primary-only + status-as-dot; Inter+cv
   type scale; 8px radius + soft easing; the chart treatment; the light+dark AA ramp with the verified
   contrast table.
4. **Leave the density/restraint conventions in `DESIGN.md`** (action↔density↔whitespace: one primary
   visible, secondary disclosed, content-over-containers, ~56–64px rows, generous gutters).

## 3. Surface order (each = its own PR to the port branch)
Reskin highest-traffic first; each PR checks its rows in the parity inventory + Director render-verifies
light+dark before merge.
1. **Shell** (rail + topbar + breadcrumb + ⌘K + view-toggle) — everything inherits it.
2. **Projects** list (table + board toggle) + **project record** + tabs (Overview/Budget/Procurement/
   Tasks+**Gantt**/Documents) + **S-curve** + MilestoneStrip.
3. **Procurement** list + case page (Overview bento + **vertical progression timeline** + Documents
   ledger + Vendor-quotes) — note this is the *revamped* procurement (ADR-0033), reskin its real tabs.
4. **Approvals** + **Timesheets** (two-pane triage + **timesheet grid** + HoursBar).
5. **Dashboards** — Exec (chart family) then PM/Finance/Engineer/Mobile.
6. **Sales** (pipeline + **funnel**), **Companies**, **Contacts** (+ activity log), **Incidents**,
   **My Tasks**, **Reports**, **Admin**, **Login**.
7. **Shared primitives + the ⚠️ widget types** as reached: calendar view, kanban, cards view,
   forms/modals/ConfirmDialog/**mobile bottom-sheet**, import wizard, command palette, banners/toasts,
   file rows/upload. **All mobile variants** (prod is mobile-gated — render @390 every surface).

## 4. pi + glm-5.2 dispatch recipe (per surface)
```bash
cd <port-worktree>            # main-session Director dispatches; see pi-delegation §3b
pi --provider zai --model glm-5.2 -p --no-session \
   --append-system-prompt .claude/agents/ui-implementer.md \
   "<self-contained brief>" < /dev/null
```
Brief must: name the exact files to re-tone; point at `reskin/_app.css` + the relevant `reskin/*.html`
/`reskin/ext/*.html` as the look reference; forbid feature/logic changes (reskin only); require
light+dark + AA; require `agent-browser` render + screenshot + DOM/purity self-check; end with a
`__PI_DONE__ <files>` sentinel. Run **`Bash(run_in_background:true)`** + `< /dev/null` + generous
timeout; the harness re-invokes on completion. **Reviews:** cross-family reviewer (`gpt-5.4`) if up,
else a *different* GLM (`glm-5.1`) per pi-delegation §2; Director does the final render-judge.

## 5. Verify / DoD (per surface, before merge)
- `npm run verify` green (typecheck·lint·unit·build) — **existing tests must still pass** (reskin
  shouldn't change behavior; update only genuinely-changed snapshots/DESIGN-token assertions).
- Rendered light+dark by the Director (screenshots); AA spot-checked; no parity row dropped.
- No hardcoded colours (tokens only); `AC-MOBILE-OVERFLOW-001` + `AC-VISUAL-ICON-001` gates green;
  render @390.
- Coverage ≥80% on changed lines; behavior-first tests.

## 6. Gotchas (hard-won this program)
- **Director MUST render** — `verify` shows no pixels; glm text models verify DOM/a11y only, not taste.
  (The /timesheets icon incident + the missing-dark-frame pi run both slipped a non-rendered gate.)
- **Session teardown kills in-flight pi runs** (children of the app) — on resume, check disk artifacts
  (files + screenshots), not the lost harness buffer, and re-dispatch only what's missing.
- **Don't overwrite `DESIGN.md` before the Foundation phase** — it still documents the live app.
- The reskin is docs until Foundation; the `redesign/design-system` branch never merges to app `dev`.
