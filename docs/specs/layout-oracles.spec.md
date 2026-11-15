# Layout oracles: behavioural vs composition (#2205)

Scope: `pmo-portal/e2e/support/layout-oracles.ts` and the new `layout-composition.ts`. Rule source:
OD-VISUAL-RESET (docs/decisions.md): composition rulings are evidence; tokens, type, domain language,
roles, money and accessibility stay binding; a test asserts what a user can do. Screen rules:
docs/ux/screen-rules.md (Numbers, One name one look, Layout, Graphics, Phone).

## Requirements
- FR-LO-1 (ubiquitous) The shared oracle module shall assert only user outcomes: figure readability and
  non-overlap, reachable actions, visible focus, no horizontal bleed, correct navigation, money fit.
- FR-LO-2 A check that pins where a block sits or a spacing number shall live in `layout-composition.ts`,
  with its owning rule named in that file's header, so a recomposition edits one clearly named file.
- FR-LO-3 No assertion is deleted, loosened or skipped; moving is the only change (thresholds identical).
- AC-LO-1 Given a broken containment (figure/action past its box or the page), when the layout specs
  run, then a behavioural oracle fails. AC-LO-2 Given an approved alternative composition that keeps
  those outcomes, then only the composition module needs review, never the behavioural one.

## Classification (40 exports)
B = behavioural, C = composition. Owner = requirement that decides it.

| Export | Class | Owning requirement |
|---|---|---|
| findBleeders, assertNoBleed, assertPageWithinWidth, expectNoHorizontalOverflow | B | no horizontal bleed (Phone) |
| findOversizedIcons, assertIconSizes | B | AC-VISUAL-ICON-001 icon fits |
| assertMinutesHandle, assertMinutesWithinViewport | B | AC-MTG-021 editor reachable, unclipped |
| assertProjectsDisclosures | B | #1983 filters/More actions reachable, Escape returns focus |
| expectFiguresContained | B | Numbers: figure readable, one line, in card (AC-RD-GEOM-001) |
| expectMoneyFits | B | Numbers: exact amount title, fits tile |
| assertDashboardPaintAndDesktopAccount | B | tokens: active-nav state visible; account menu keyboard/focus |
| assertShortAccountMenu | B | every action reachable on a short viewport; text-size scales |
| assertProjectsTableLayout | B | columns present, reach, containment, money columns |
| assertProjectsTableComposition | **C** | 12px Actual/Progress header gap pins spacing (split out of assertProjectsTableLayout) |
| assertCompaniesSearchFits | B | search control inside viewport |
| assertSalesBoardCards | B | AC-SBC-001 money row inside card |
| assertFunnelAmountsContained | B | AC-SFA-001 amount inside stage, no pan |
| assertFunnelFocusRingInsideViewport | B | AC-SFA-007 visible focus not clipped |
| assertFunnelBarGapAndAlignment | **C** | AC-SFA-006: 8px gap and equal bar tops pin spacing; Graphics: descending bars on one scale |
| STICKY_EPSILON, StickyGeometry, measureSticky | B (helpers) | AC-TBL-STICKY-001 |
| expectSeamClean | B | no scrolled text ink under the sticky cell |
| expectHairlineVisible | **C** | divider hairline luminance is a look; owner ruling 2026-11-15 |
| setDarkTheme | helper | theme switch for dark-mode checks |
| assertResponsiveRailAndDrawer, assertRailNavWithinViewport | B | AC-1201 / UX-001 navigation reachable per breakpoint |
| ADMINISTRATION_*_SECTIONS, driveAdministrationSections | B | AC-ADMIA-005 reach each section, 44px target, no bleed |
| assertProcurementViewToggle | B | AC-PVT-001 view switch reachable and works |
| assertWorkOrderInvoiceContainment | B | AC-BWO-004 action inside card/region |
| assertStepperFocusRingNotClipped | B | AC-RAM-004 visible focus |
| openMilestoneCardGrid | helper | navigation step |
| assertMilestonePctClearOfName | B | AC-RAM-004 non-overlap (either axis passes) |
| assertMilestoneNamesWrapAtWords | B | readability, no mid-word break |
| assertCompactProjectHeader | B (mixed) | AC-RD-HDR-001 figures fit, no prose; see OPEN-RULINGS 4 |
| assertPhonePipelineGeometry | B | AC-S24-004 card and long amount inside 390 |
| assertGroupedProcurementValueAlignment | **C** | UIP-007 Value-column right edge and tabular-nums is alignment; owner ruling 2026-11-15 |
| assertRecordHeaderStacksTitleAboveStatus | **C** | UIP-009: strict title-above-status is an arrangement; Record pages rule |

Totals: 35 behavioural/helper in `layout-oracles.ts`, 5 composition in `layout-composition.ts`.

## Moves (this change)
`assertFunnelBarGapAndAlignment` and `assertRecordHeaderStacksTitleAboveStatus` moved unchanged to
`e2e/support/layout-composition.ts`; `sales.layout.spec.ts` and `procurement.layout.spec.ts` import them
from there and call them with the same arguments.

## Moves (owner ruling 2026-11-15)
`assertProjectsTableComposition` (new, the 12px header gap), `expectHairlineVisible` and
`assertGroupedProcurementValueAlignment` moved to `layout-composition.ts`; callers updated, every
assertion still runs. The columns/reach/containment half stays in `assertProjectsTableLayout`.
Rulings 1-3 below are resolved by this move.

## Open rulings
1. Value-column right edge + tabular-nums (UIP-007): kept behavioural because Numbers requires
   right-aligned tabular money; the ticket names it, so confirm.
2. assertProjectsTableLayout: also pins a 12px header gap, 2px resize indicator and column presence;
   needs a split into outcome and arrangement parts after rendered evidence.
3. expectHairlineVisible: a divider luminance check is a look; ruling needed.
4. assertCompactProjectHeader and the record-header check also hold outcome parts (no clip, no pan)
   that should split from the arrangement part; not split here (move-unchanged ruling).

## Evidence owed
Rendered evidence from an authorised browser lane (390 and 1440, every state) is required before any
composition assertion is changed or retired.
