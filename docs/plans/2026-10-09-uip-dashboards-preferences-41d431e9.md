# UIP dashboard queues and profile elevation plan

## Scope and decisions

- **Source criteria:** `docs/reviews/2026-10-09-ui-polish-critique.md` §§5–6, findings `UIP-010`, `UIP-011`, and `UIP-012`. The request provides no separate `docs/specs/*.spec.md` AC IDs; these three stable critique IDs are the acceptance identifiers and must appear in their owning test titles exactly as requested.
- This is a local React presentation/navigation slice: no schema, repository, hook, metric, monetary-source, sort, filter/scope, status-definition, or RLS change; therefore no migration or ADR is warranted.
- Reuse the existing `Card`/`CardHead`/`CardPad`, `ListState`, `Link`, and project-detail route patterns. Do **not** alter global `ListState`, `FinanceDashboard.tsx`, dashboard data hooks, or visual baselines.
- Preserve the dashboard hierarchy in `DESIGN.md`: static surfaces are bordered `bg-card` surfaces with no resting shadow; concise local empty content should not become a list-page illustration. The clear queue must have a bounded local body while all unavailable/loading/error data remains visibly distinct.
- The e2e inventory has no standalone PM-dashboard spec; `pmo-portal/e2e/AC-AUTH-003.spec.ts` is the existing read-only PM landing/dashboard journey. Extend that owning journey rather than adding a spec. Keep its existing `@e2e-isolation: read-only` tag and reason unchanged.

## Traceability

| Criterion | Owning proof | Secondary evidence |
| --- | --- | --- |
| UIP-010 | `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx` | Fresh Executive and Finance rendered captures at 1440/390 in light/dark; manual measurement of the clear-card height and its next sibling placement |
| UIP-011 | `pmo-portal/e2e/AC-AUTH-003.spec.ts` | `pmo-portal/src/components/dashboard/PMDashboard.test.tsx`; fresh PM rendered captures at 1440/390 in light/dark |
| UIP-012 | `pmo-portal/pages/ProfileSettings.test.tsx` | Fresh Profile settings rendered captures at 1440/390 in light/dark and computed resting `boxShadow` browser check |

## Implementation tasks (strict RED → GREEN → REFACTOR)

1. **Add the UIP-010 component-state contract before production changes.**
   - File: `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx` (new).
   - Copy only the existing card test’s router/hook/permission mock pattern; drive the hook state through: genuine clear `{ totals: [], incompleteCount: 0, rows: [], incomplete: [] }`, loading, error, incomplete/unavailable, and populated data.
   - Add `it` titles beginning `UIP-010:` that require a dashboard-local clear-state test target with explicit issued-work-order completion copy; assert that it is not a `ListState` empty illustration, has compact padding classes, and contains neither currency output nor a fabricated `0`. Assert loading retains `still-to-invoice-loading`; error retains its retryable error title; incomplete data retains its unavailable/incomplete notice and work-order link; populated data retains totals, rows, tax-basis labels, and the existing `/projects/:projectId/work-orders?wo=:workOrderId` links.
   - This test must fail because the current genuine empty state is the global `ListState` and has no compact clear-state target.

2. **Add the UIP-011 unit contract before production changes.**
   - File: `pmo-portal/src/components/dashboard/PMDashboard.test.tsx`.
   - Add an `it` title beginning `UIP-011:` that queries every Project Status project name as a link, asserts its accessible name is the project name and its `href` is exactly `/projects/${id}` for the fixture IDs, and confirms the non-owned project remains absent. Keep the present at-risk ordering/metric assertions; do not replace them.
   - This test must fail because Project Status currently renders each name in a `span`.

3. **Add the UIP-012 rest-elevation contract before production changes.**
   - File: `pmo-portal/pages/ProfileSettings.test.tsx`.
   - Add an `it` title beginning `UIP-012:` which locates the form card through the page heading, asserts the existing `rounded-lg`, `border`, `border-border`, `bg-card`, and responsive padding classes remain, and asserts `shadow-sm` is absent. Also focus an existing form control and assert the focusable/save behavior is still available; do not alter any save, localization, or axe test.
   - This test must fail because the card currently has `shadow-sm`.

4. **Capture one consolidated RED result.**
   - From `pmo-portal/`, run:
     ```bash
     ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx src/components/dashboard/PMDashboard.test.tsx pages/ProfileSettings.test.tsx
     ```
   - Record the literal failing-tail output and non-zero exit result in the build report. Stop if a test fails for an unrelated reason rather than changing existing tests or production code to mask it.

5. **Implement the compact genuine-clear treatment only.**
   - File: `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx`.
   - Replace only the branch `data.totals.length === 0 && data.incompleteCount === 0` with a local, `data-testid`-addressable compact clear block inside the existing card. Use the existing card typography/tokens and scale spacing (`CardPad` with compact vertical padding; concise text scope explicitly says issued work orders are clear) so the complete card is at most 120px high at a 1440px viewport. Keep the title and card border/surface intact.
   - Leave the pending, error, `!data`, incomplete, total, row, tax-basis, and work-order-link branches byte-for-byte behaviorally equivalent. In particular, never render zero for missing figures and do not modify `ListState`.
   - Verify the component test turns green:
     ```bash
     ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx
     ```

6. **Implement canonical, keyboard-native PM project links.**
   - File: `pmo-portal/src/components/dashboard/PMDashboard.tsx`.
   - Import `Link` from `react-router`; replace only the Project Status name `span` with a `Link to={`/projects/${p.id}`}` carrying the same `min-w-0 flex-1 truncate text-[13px] font-medium` layout classes plus the project-standard hover underline and `focus-visible` ring/outline classes. Do not make the whole row a link and do not add any status mutation/control.
   - Leave `mine`, `mineSorted`, `isAtRisk`, delivery-chip lookup, all status pills, margin calculation, displayed values, and row order unchanged.
   - Verify the extended unit suite turns green:
     ```bash
     ../scripts/with-test-lock.sh npx vitest run src/components/dashboard/PMDashboard.test.tsx
     ```

7. **Remove only the Profile Settings resting shadow.**
   - File: `pmo-portal/pages/ProfileSettings.tsx`.
   - Delete `shadow-sm` from the existing profile form-card class list. Retain `rounded-lg border border-border bg-card p-4 sm:p-6` and all interaction, focus, save, theme, and localization code unchanged.
   - Verify the extended page suite turns green:
     ```bash
     ../scripts/with-test-lock.sh npx vitest run pages/ProfileSettings.test.tsx
     ```

8. **Extend the existing read-only PM dashboard journey.**
   - File: `pmo-portal/e2e/AC-AUTH-003.spec.ts`.
   - Preserve its first-line isolation tag and existing real password-login assertions. Add a test title containing `UIP-011:` (or extend its existing title with that exact token) that waits for the Project Status card, focuses the uniquely named seeded at-risk project link `Cascade Foods 6.0 MW Ground-Mount PV`, asserts keyboard focus, presses Enter, and asserts exactly `/projects/41000000-0000-0000-0000-000000000002` before asserting the canonical record heading. This proves a keyboard-operable, one-step, correct-ID route without writing or changing a project status.
   - Run the changed journey after implementation, from repo root and without a reset:
     ```bash
     scripts/with-db-lock.sh scripts/e2e-local.sh AC-AUTH-003
     ```
   - Record the literal output tail and exit result. If shared local data is temporarily unavailable, wait and rerun the same command; do not reset the database.

9. **Run the required final code gates, with no commit before all pass.**
   - From `pmo-portal/`:
     ```bash
     ../scripts/with-test-lock.sh bash -c 'npm run typecheck && npx vitest run --changed origin/dev'
     npx eslint --max-warnings=0 src/components/dashboard/StillToInvoiceCard.tsx src/components/dashboard/PMDashboard.tsx pages/ProfileSettings.tsx src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx src/components/dashboard/PMDashboard.test.tsx pages/ProfileSettings.test.tsx e2e/AC-AUTH-003.spec.ts
     npm run build
     ```
   - Report literal output tails and exit results for each command. Do not regenerate the lockfile, alter baselines, use `--no-verify`, reset Supabase, push, or touch `adws/`.

10. **Perform fresh rendered verification and capture the required non-repository evidence.**
    - Read browser instructions first with:
      ```bash
      agent-browser skills get core --full
      ```
    - From `pmo-portal/`, source the current local Supabase frontend configuration only from `cd .. && supabase status -o env`, start Vite at `http://127.0.0.1:3000/`, and use `agent-browser` to sign in as Executive, Project Manager, and Finance. Do not print or save configuration values.
    - At 1440px and 390px in both light and dark themes, capture these fresh files under `/private/tmp/claude-502/-Users-ariefsaid-Coding-PMO/abd5a194-c2a4-469e-b763-f2a75f07ec08/scratchpad/uip56-shots/`: `after-executive-{1440,390}-{light,dark}.png`, `after-pm-{1440,390}-{light,dark}.png`, `after-finance-{1440,390}-{light,dark}.png`, and `after-profile-{1440,390}-{light,dark}.png`.
    - In the settled browser (not a transition frame), verify: the clear Still-to-invoice card’s `getBoundingClientRect().height <= 120` at desktop; Finance’s Ready to pay panel remains the next adjacent panel and moves upward in the clear state; all three Still-to-invoice states remain visually distinct where available; PM project-name links have a visible focus indicator and open the canonical record; Profile’s resting card computes `boxShadow` to `none`, retains border/card surface, and its controls remain focusable. Compare every fresh shot to its supplied `before-*` counterpart without committing screenshots.
    - If any existing visual snapshot is directly changed by this scoped work, identify that single baseline and update only it; otherwise report “no visual baseline update.”

11. **Review the exact diff and commit only green scoped work.**
    - Confirm `git diff --check` is clean and `git status --short` contains only the seven planned production/test/e2e files (plus no screenshot files). Do not include plan documents or unrelated work in the code commit.
    - Commit on `feat/uip-slice5-6-dashboards-prefs` with no Co-Authored-By trailer:
      ```bash
      git add pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx pmo-portal/src/components/dashboard/PMDashboard.tsx pmo-portal/pages/ProfileSettings.tsx pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx pmo-portal/src/components/dashboard/PMDashboard.test.tsx pmo-portal/pages/ProfileSettings.test.tsx pmo-portal/e2e/AC-AUTH-003.spec.ts
      git commit -m "polish(ui): compact dashboard queues and flatten profile"
      ```
    - Do not push. Report the commit, exact changed files, RED/GREEN/final-gate output tails and exits, all 16 fresh screenshot paths, whether a baseline changed, and any concern rather than claiming unobserved rendered verification.

## Expected changed files

- `pmo-portal/src/components/dashboard/StillToInvoiceCard.tsx`
- `pmo-portal/src/components/dashboard/PMDashboard.tsx`
- `pmo-portal/pages/ProfileSettings.tsx`
- `pmo-portal/src/components/dashboard/__tests__/StillToInvoiceCard.polish.test.tsx` (new)
- `pmo-portal/src/components/dashboard/PMDashboard.test.tsx`
- `pmo-portal/pages/ProfileSettings.test.tsx`
- `pmo-portal/e2e/AC-AUTH-003.spec.ts`

No ADR, migration, data reset, global component change, baseline update, push, or deployment is planned.
