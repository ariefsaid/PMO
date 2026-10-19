# Tax disclosure separator — #1157

Status: self-contained extraction of the approved v0.24.0 polish scope, 2026-10-19; planning only.
Issue: [Tax disclosure: retain presentation and future caller coverage observations](https://github.com/ariefsaid/PMO/issues/1157).
Source contract: `v024-ris-polish.spec.md` FR-V24P-014 / AC-V24P-014 and `2026-10-19-v024-ris-polish.md` P08. This document carries their complete separator-only contract; execution does not require those umbrella files to be published.
Deciding source baseline: `origin/dev` = `c599d87d849f37c3db6c22f71efa8bb0db2199f9` in the current primary checkout. The older planning checkout is not behavior evidence.
Plan: `docs/plans/2026-10-19-tax-disclosure-separator.md`.

## Job and observed outcome

When a person reads a project or invoice amount with tax details collapsed, they want the saved tax basis and a clean disclosure label so that punctuation does not suggest missing visible information. Expanding the control must reveal the original tax facts without changing the amount or activating another action.

At the pinned baseline, `pmo-portal/src/components/ui/TaxBasisLabel.tsx:79–98` renders the separator after the trigger outside the span carrying `hidden={!detailsExpanded}`. Consequently, the collapsed control leaves a trailing middle dot. The pre-trigger separator at line 81 correctly separates the immediate basis from the trigger.

## Existing contracts to retain

| Deciding artifact at the baseline | Observed contract |
|---|---|
| `pmo-portal/src/components/ui/TaxBasisLabel.tsx:27–59` | Existing props remain unchanged. The stored treatment supplies the label; invalid/absent treatments render nothing. Null rate and unknown DPP remain explicit unknown facts; numeric zero remains `0%`. |
| `pmo-portal/src/components/ui/TaxBasisLabel.tsx:64–97` | Ordinary mode stays inline; `showDetails={false}` stays basis-only. The labelled disclosure preserves its IDs, ARIA relationship, Enter/Space/click behavior, Escape close and trigger focus restoration. |
| `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx` AC-S39-001, AC-DPP-002, AC-UNB-001 | Existing authored inclusive/exclusive rate/fraction, unknown/zero, immediate basis, token, touch and compact-line assertions are retained. |
| `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.test.tsx` AC-S39-002 and money/currency tests | A missing historical rate is informational; genuine contract prerequisites retain their remedy. Project currency and financial values remain exact. |
| `pmo-portal/components/ProjectCard.test.tsx` AC-S39-003 | Opening tax details does not activate the project card; card identity, currency and amount stay visible. |
| `pmo-portal/pages/approvals/SalesInvoiceApprovalSection.test.tsx` AC-S39-004, AC-NAR-002, AC-1048-02 | Tax disclosure does not open invoice evidence or approve it. Net/tax/total remain reconciled; approval requires review plus explicit confirmation. |
| `pmo-portal/src/hooks/useInvoicesAwaitingViewer.ts`, `pmo-portal/src/hooks/useRevenue.ts:70–78`, `pmo-portal/src/lib/db/revenue.ts:171–180` | The current approval queue reads native Draft invoices and is inactive outside native revenue mode. The existing standalone ERP-origin preview test is not proof of an admitted ERP-origin queue row. |

## Requirements (EARS)

- **FR-V24P-014:** While tax details are collapsed, the display shall not leave a trailing separator; showing details shall retain exact rate/base facts and existing keyboard/touch behavior.
- **FR-TDS-001:** When disclosure details are shown or hidden, the post-trigger separator shall share the details span's visibility boundary; the pre-trigger separator shall remain unchanged.
- **FR-TDS-002:** While a tax basis is displayed, the component shall retain its stored treatment, authored nominal rate and DPP fraction, explicit unknown facts, ordinary inline default, basis-only mode and empty rendering for unknown treatments.
- **FR-TDS-003:** When tax disclosure is operated, existing Escape/focus behavior and caller separation from card activation, invoice evidence and explicit invoice approval shall remain unchanged.
- **NFR-TDS-001:** The trigger shall retain `touch-target`, `-my-2`, `min-h-8`, `text-primary-text`, its current focus classes and every other existing class. Preserve the S39/#1169 32px visual control, coarse-pointer target and compact project-header height; introduce no color or spacing change.
- **NFR-TDS-002:** The implementation shall modify only `pmo-portal/src/components/ui/TaxBasisLabel.tsx` and `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx`; it shall add no dependency or change existing financial, authorization, repository or data contracts.
- **NFR-TDS-003:** Verification shall use Node 22.22+ with the approved Node 22 bin exported before child commands, locked typecheck/Vitest, scoped zero-warning ESLint and at least 80% changed executable-line coverage. Existing tests, assertions and timeouts shall not be deleted, skipped, loosened or replaced with snapshots.
- **NFR-TDS-004:** Build, review and CI may proceed on the feature branch only. Merge to dev shall remain held until Root verifies that the actual v0.23.0 dev-to-main release PR was merged by the owner; this condition grants no authorization to main or production. A red dev browser gate independently blocks unrelated code merges.

## Acceptance and ownership

**AC-V24P-014 — canonical owner: RTL**, `pmo-portal/src/components/ui/__tests__/TaxBasisLabel.test.tsx`, with `AC-V24P-014` leading the new test title.

Given exclusive, inclusive, unknown-rate/base and known-zero disclosure facts, when the label starts collapsed, expands, closes by toggle and closes by Escape, then its visible collapsed text ends at the toggle label without a trailing dot, its expanded text includes exactly one separator before the exact authored/unknown facts, and Escape restores trigger focus. The immediate basis and all existing mode, token, touch, card, invoice approval, currency and money assertions remain intact.

The canonical proof belongs at the lowest sufficient component layer. Existing caller suites remain regression evidence; no duplicate e2e or database acceptance case is added.

## Design and boundaries

Move the existing `{' · '}` immediately after the disclosure button to the beginning of the existing hidden details span. Do not add a second state variable, wrapper, CSS visibility mechanism, formatting helper or public prop. Both separator and facts must disappear together and return together; a CSS-only concealment of the old orphan separator is not the design.

The existing component hierarchy, typography, focus treatment, inline flow and responsive behavior remain as specified by `DESIGN.md` “Tax detail disclosure (S-39)” and the current source. No new loading, empty or error state exists in this presentation-only change; retain the existing unknown/absent states. Root must admit and complete the rendered Discover/affected-route sweep before merge, preserving compact geometry and behavior in both themes/locales at phone and desktop sizes. Every discovered finding follows the existing graduation process.

Excluded: new copy or locale keys; catalogue work; financial calculations, totals or currency conversion; authority, permissions or approval rules; API/schema/migrations; queue admission changes; CI, scripts and lockfiles. No ADR is needed for relocating existing presentation punctuation.

## Remaining future coverage and uncertainty

Issue #1157 explicitly records ERP-origin approval-row disclosure coverage as future work if the queue later admits those rows. It is not a reachable queue defect at this baseline, and neither a synthetic queue fixture nor broadened admission belongs here. Keep that observation in the issue disposition after the separator fix; do not claim the future caller case is proved or implemented. There is no new owner design decision in this extraction. Route any actual scope or approval question through Root to the owner’s designated coordinator.
