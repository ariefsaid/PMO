# #953 — Toast mobile action-bar clearance and modal save errors — planning blocked

## Status

Blocked before implementation planning. The repository has no `docs/specs/` specification for issue #953 and consequently no owner-approved EARS requirements or Given/When/Then `AC-###` acceptance criteria. The planning contract prohibits inventing those identifiers or implementation behavior.

## Evidence read

- `gh issue view 953` supplies two issue bullets, but it is not an AC register.
- `docs/specs/` was searched for `953`, the issue title, and “mobile action”; no matching specification was found.
- `docs/product-expectations.md` requires a spec with `FR-`/`OBS-`/`NFR-` requirements and `AC-###` criteria before Design+Plan.
- `scripts/prior-art.sh toast`, `scripts/prior-art.sh mobile-sticky-action`, and `scripts/prior-art.sh "save error"` found the existing toast and modal-error rulings, including `DD-TOAST-1` and `OD-FORM-A11Y-3` in `docs/decisions.md`.

## Relevant existing implementation (for the spec author)

- `pmo-portal/src/components/ui/Toast.tsx` owns the one-at-a-time toast host at `bottom-5 right-5 z-[1000]`; the visual message is marked `data-toast="visible"` and has a separate dismiss button. Any later work must retain that attribute and the visible copy contract.
- `pmo-portal/pages/ProcurementDetails.tsx` and `pmo-portal/pages/project-detail/ProjectDetail.tsx` each render independent fixed mobile action bars. Their current visibility breakpoints differ (`max-[920px]` CSS versus the project page’s `useIsDesktop` seam), so a generic publisher needs an explicit breakpoint/activation contract rather than a page-specific offset.
- `pmo-portal/pages/SalesInvoices.tsx` catches a received-date mutation rejection in the parent and emits only a warning toast while keeping `ReceivedDateModal` open. It does not currently pass a `submitError` into that modal.
- `pmo-portal/pages/project-detail/WorkOrderValueModal.tsx` already classifies a rejected save, passes it to `EntityFormModal` as `submitError`, and delegates its page-level toast through `onError`; it is not evidence that this issue requires a second work-order implementation.
- `pmo-portal/src/components/ui/EntityFormModal.tsx` already supplies the token-compliant persistent in-dialog `role="alert"` / focus behavior required by `DESIGN.md`; a spec must say which callers should use it and whether an accompanying toast remains in scope.

## Required owner-approved spec inputs

Create `docs/specs/toast-mobile-modal.spec.md` (or provide the exact existing spec path) with EARS requirements and explicit `AC-###` criteria resolving all of the following:

1. **Generic mobile action-bar contract:** Name the shared component/hook boundary, define when an action bar is “active,” define its single mobile breakpoint (or require the publisher to mirror its own rendered visibility), and state whether it must track dynamic height and safe-area changes. Define reset behavior on route/unmount and concurrent-bar behavior.
2. **Toast geometry:** State the required bottom gap relative to an active bar, whether only warning/error or every toast moves, and the exact narrow-viewport width guarantee. Confirm that desktop geometry remains unchanged.
3. **Modal failure policy:** Resolve the apparent difference between existing `OD-FORM-A11Y-3` (the toast is additive) and this issue’s instruction to keep toast for non-modal flows: after a modal save rejection, must the toast be suppressed, retained as an additional live announcement, or be decided per modal?
4. **Scope:** Enumerate the modal callers to remediate. The issue names `ReceivedDateModal` and the work-order Set value modal, but the latter already has a persistent `submitError`; state whether it needs only regression coverage or whether every remaining modal that stays open after a rejection is in scope.
5. **Acceptance/test ownership:** Assign an `AC-###` to the lowest sufficient test layer. At minimum, criteria need to say how a 390px mobile action bar/toast clearance is measured and how a rejected ReceivedDate save proves a persistent, keyboard-focusable in-dialog error while preserving entered data. State the English/Bahasa acceptance for any new copy; no new translation keys are needed if the spec deliberately reuses existing classified errors and `EntityFormModal` copy.

## No implementation tasks scheduled

No source, test, locale, migration, or ADR task is planned until the required specification is approved. Once supplied, the build plan will be TDD-first and will name exact tests, files, verify commands, and one owning test per approved `AC-###`.
