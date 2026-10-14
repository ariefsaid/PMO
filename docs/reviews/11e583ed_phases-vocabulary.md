# UX wave 2c — phases

This UI/localization slice applies the Phase/Fase vocabulary ruling while retaining `milestone` in internal identifiers, data types, callbacks, test IDs, and URLs. It also addresses the two Discover findings: phase forms now explain weight, position, and progress behavior, and calendar phase chips identify their project before activation.

## What changed

- `pmo-portal/pages/project-detail/MilestoneFormModal.tsx` now presents “Phase” copy, adds visible helper text for relative weight and position, and explains linked-task progress in both create and edit modes. The edit-only progress override remains edit-only; payloads and validation behavior are unchanged.
- `pmo-portal/pages/project-detail/MilestoneStrip.tsx` changes rendered fallback/action/menu/delete/error/toast copy to phase terminology. The existing progress editing and milestone-backed behavior remain intact.
- `pmo-portal/components/ProjectCalendarView.tsx` localizes phase event labels and accessible names. Phase chips now render `Project · Phase`, while project start/end events and project-opening behavior remain unchanged. The empty-state subcopy now refers to project or phase target dates.
- `pmo-portal/public/locales/en/common.json` and `pmo-portal/public/locales/id/common.json` provide the updated form, planner, toast, and calendar strings. `pmo-portal/src/lib/i18n/launch-scope-routes.txt` includes the calendar component in the `/projects` i18n scope.
- `docs/qa-portfolio.md` records completed graduation rows for B-10 and B-13 under DD-VOCAB-1.
- `pmo-portal/e2e/AC-DEL-022-milestone-journey.spec.ts` updates only the user-facing journey locators/comments to Phase wording; the internal journey and progress goal remain the same.

## Proof and regression coverage

New locale/component coverage is in `pmo-portal/pages/project-detail/__tests__/MilestoneFormModal.locale.test.tsx`, `pmo-portal/pages/project-detail/__tests__/MilestoneVocabulary.locale.test.tsx`, and `pmo-portal/components/__tests__/ProjectCalendarView.events.test.tsx`. The latter covers two same-named phases from different projects in English and Indonesian, including accessible names and the Indonesian empty state.

Existing assertions were updated in `pmo-portal/pages/project-detail/__tests__/MilestoneStrip.states.test.tsx`, `MilestoneStrip.deleteConfirm.test.tsx`, and `MilestoneStrip.inlineEdit.test.tsx`; `MilestoneStrip.display.test.tsx` adds the `AC-UXP-004` effective-progress regression assertion; and `ProjectCalendarView.milestoneLink.test.tsx` checks project-first accessible naming.

The implementation plans, including acceptance-test traceability and the bounded rendered-check requirements, are `docs/plans/2026-10-14-phases-11e583ed.md` and `docs/plans/2026-10-14-phases-11e583ed_v2.md`.

## Verify

From `pmo-portal/`, run the targeted Vitest files above plus the changed-test gate, typecheck under `scripts/with-test-lock.sh`, ESLint with `--max-warnings=0` over the touched app/test files, and `npm run check:i18n`. Run `scripts/e2e-local.sh AC-DEL-022` from the repository root. The plan also specifies the rendered check of planner/form/calendar at 1440×900 and 390×844 in both `en` and `id`, confirming visible helpers, project-first chips, keyboard reachability, and no mobile overflow.
