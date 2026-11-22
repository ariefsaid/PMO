# Spec: Warn the site engineer when installed material passes a share of plan

**Status:** approved (coordinator), built in Phase 2. Rulings: OQ-UW-1 report author, OQ-UW-2 engineer only, OQ-UW-3 one threshold. Lane gap-material. Replaces the measure and the recipient of `docs/specs/material-request-usage-thresholds.spec.md` (#2686); that spec's FR-MUT-003..005 and 009 are superseded here. IDs `FR-UW-###`, `AC-UW-###`, `OQ-UW-#`. Plan: `docs/plans/2026-11-22-usage-warning.md`. Rulings in force: OD-SCOPE-2 (every number is a setting), OD-SCOPE-8 (material lines on a validated site report are the record of material used), warn and never block.

## Job story

When material installed on a work order passes a set share of the planned quantity, I want the site engineer told, so they go and check; and I want the measure to be the material actually installed (from validated site reports), with one threshold setting.

## Today (verified on this branch, `origin/land/fix-1122`)

The item text is right on all three points; the base builds a different design.

- **Measure = requested, not installed.** `supabase/migrations/1331_mrq_usage_alerts.sql` `mrq_usage_check`: `v_use := mrq_prior_quantity(...) + l.quantity`. `mrq_prior_quantity` (1001) sums lines of other live material requests (pending, approved, fulfilled) and `l.quantity` is the request being submitted. Nothing reads a site report. The spec text says the same ("quantity already used ... posted stock ... plus requests").
- **Evaluated at request submit**, not when material is reported installed: `1333_mrq_submit_carry_usage_check.sql:75` calls `mrq_usage_check` inside `mrq_submit` (latest body; no later migration restates `mrq_submit`).
- **Recipient = the project manager:** `mrq_usage_check` reads `projects.project_manager_id` and calls `notify_workflow_user(...)` to that person only; "the work order's engineer resolves to the project's manager" (spec ruling 2026-11-21). No work-order engineer column exists (`work_orders` has none; `0193`, `0337`, `1320`, `1400` add none).
- **Two thresholds, not one:** `1330_mrq_usage_threshold_settings.sql` adds `material_request_settings.usage_warn_pct_1` and `usage_warn_pct_2`; `mrq_set_usage_thresholds(p1, p2)`; alerts unique on `(work_order_id, item_id, slot)`.
- **Installed material already exists as data:** `dsr_consumables` (1040; `stock_item_id`, `quantity`, `report_id`) are the material lines of a daily site report. A report counts once it is `validated`, not superseded, not archived (same filter `qcr_figures` and `work_order_validated_revenue` use). Validation happens in `dsr_validate` (1041:263, status update then, at 266, the superseded version's `superseded_at`).
- **Plan figure:** `mrq_plan_figure/mrq_plan_quantity` (1156): consumable plan line, else BoQ allowance, else 0.
- **Screens:** `pages/materialRequests/UsageWarning.tsx` (request form `MaterialRequestNew.tsx:197`, detail `MaterialRequestDetail.tsx:146`) shows "Use reaches X% of plan" from `planQty + priorQty + quantity` (requested). Settings: `UsageThresholdsEditor.tsx` (two fields). `get usage thresholds`: `useUsageThresholds`.
- **Search:** `scripts/prior-art.sh "usage warning"` finds nothing; `overrun` finds only the contract-quantity detection (1175), a different measure. Nothing else answers the ask.

## What changes (design change, not a second path)

The measure becomes installed material from validated site reports, the check runs when installed material changes, the recipient becomes the site engineer, and the two thresholds become one. The request-based check is removed (not left beside the new one).

## Settings

| Setting | Where | Default |
|---|---|---|
| Usage warning threshold (percent of plan, 1 to 1000, or unset) | `material_request_settings.usage_warn_pct` (the existing `usage_warn_pct_1`, renamed; `usage_warn_pct_2` dropped); Admin-only `set_material_usage_threshold(p_pct)`; one field on the existing material-request settings screen | unset (off) |

**No on/off switch.** Unset means no warning, as today. The existing first threshold keeps its value; a second threshold, if one was set, is discarded (the job asks for one).

**Is this an "approval route / visibility" change needing a default-keeps-old-behaviour setting? Ruling proposed: no.** It is a warning-only notification: no money figure, approval step or access changes. #2686 is unreleased on this branch and off by default (null), so no organisation depends on the requested-quantity behaviour. Flagged as OQ-UW-2 for confirmation anyway.

## Requirements (EARS)

- FR-UW-001 The system shall let an Admin set, change or clear one usage threshold for the organisation (1 to 1000, two decimals); the server refuses another value and any non-Admin or field account.
- FR-UW-002 **Installed** quantity of an item on a work order shall be the sum of `dsr_consumables.quantity` over that work order's reports that are validated, not superseded and not archived. Requests, transfers and stock issues are not counted.
- FR-UW-003 Where the threshold is set, when installed quantity of an item reaches that percent of plan (plan 0 with any installed quantity counts as reached), the system shall record one warning for the work order and item and write one in-app notification to the site engineer. Checked when a report is validated and when a correction replaces a validated report.
- FR-UW-004 The site engineer is the author of the most recently validated live report on that work order that carries the item, so the person who entered the quantity is told. Where that person is inactive or outside the organisation the warning is recorded and nobody is notified. (OQ-UW-1.)
- FR-UW-005 A warning is raised once per work order and item: later reports, corrections, a lowered threshold or a re-validation do not notify again.
- FR-UW-006 Where the threshold is set and an item's installed quantity has reached it, the work-order material card, the material request form and the request detail shall show a warning line stating installed quantity, plan quantity and percent reached. It never disables Save, Submit, approval or any report action.
- FR-UW-007 The warning, record and notification shall write nothing else and never block validation, a request or a stock posting; a failure of the check shall not roll back the validation.
- FR-UW-008 Where the threshold is unset the system shall behave as before: no record, no notification, no screen change.
- NFR-UW-001 `material_request_usage_alerts` keeps RLS on, org reads only, no client write path; the check is a security-definer function with `org_id` from the work order; new client-callable functions carry the light-account refusal (1480 convention).
- NFR-UW-002 Warning text on screens is translated (English, Bahasa Indonesia). The notification body is plain English through `notify_workflow_user`, the deviation #2686 recorded; a translatable key follows with the shared template guard change.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-UW-001 | Given threshold 80, plan 100, when a report with 85 of the item is validated, then one warning row and one notification to that report's author. | pgTAP |
| AC-UW-002 | Given installed 50 and 40 requested (pending request), threshold 80, then no warning: requested quantity is not counted (mutation: count requests, test red). | pgTAP |
| AC-UW-003 | Given a warning raised, when another report, a correction or a lowered threshold follows, then no second row or notification. | pgTAP |
| AC-UW-004 | Given a correction replaces a validated report so installed falls below then rises past the share, then installed counts the new version only (the old is excluded once superseded) and the warning is raised once. | pgTAP |
| AC-UW-005 | Given the threshold unset, when reports of any size validate, then no row, no notification. (mutation: ignore the unset test.) | pgTAP |
| AC-UW-006 | Given plan 0 and installed above 0, then the warning is raised. | pgTAP |
| AC-UW-007 | Given the author is inactive, then the row exists and no notification; validation succeeds. | pgTAP |
| AC-UW-008 | Given a non-Admin or a field account, when they set the threshold, refused (42501); another org reads no rows; 0, 1001 refused; null clears. | pgTAP |
| AC-UW-009 | Given a request is submitted over the share by request quantity alone, then submit succeeds, no warning row is written (the request path no longer checks). | pgTAP |
| AC-UW-010 | Given the threshold set and installed past it, when the request form shows that item, then the warning line states installed, plan and percent; Save and Submit stay enabled; unset shows nothing. | Unit |
| AC-UW-011 | Given an Admin and a non-Admin on the settings screen, then only the Admin sees one threshold field, with its refusal sentences in English and Bahasa Indonesia. | Unit |
| AC-UW-012 | Given a foreman reports installed material, an engineer validates, the author sees the notification and the work order card shows the warning. | e2e (one curated journey) |

## Errors (refusal catalogue, English and Bahasa Indonesia, each says what to do next)

| Condition | Code | Sentence (English) |
|---|---|---|
| Non-Admin sets the threshold | `MRQ_USAGE_ADMIN_ONLY` | Only an Admin can change the usage warning. Ask an Admin to change it. |
| Value outside 1 to 1000 | `MRQ_USAGE_INVALID` | Enter a percent of plan from 1 to 1000, or leave it empty to turn the warning off. |

(`MRQ_ADMIN_ONLY` and `MRQ_INVALID` already carry delivery-note sentences, so this feature has its own two codes, added to both locale files.)

## Existing tests that change, and why

- `supabase/tests/mrq_usage_thresholds.test.sql` (AC-MUT-*): rewritten as `usage_warning.test.sql`; its measure, trigger point, recipient and two-slot cases are the old design.
- `pages/MaterialRequestSettings.usage.test.tsx`, `pages/materialRequests/UsageWarning.test.tsx`, `MaterialRequestNew.usage.test.tsx`, `MaterialRequestDetail.usage.test.tsx`, `src/lib/db/materialRequestsUsage.test.ts`: one field instead of two; the line reads installed quantity, not requested.
- 1480's name sweeps list `mrq_set_usage_thresholds`; the renamed function is added there by restating its guard (plan).

## Open questions for the customer

- **OQ-UW-1 Who is "the site engineer"?** PMO has no per-work-order engineer. Recommended: the person who entered the report that took installed material over the share (they are on site). Alternatives: every holder of a named role (setting), or the project manager as today. Built meanwhile: the report author, behind one function so the choice is one body.
- **OQ-UW-2 Should the project manager still be told?** Recommended: no; the warning row shows on the work-order card for managers. Built meanwhile: engineer only.
- **OQ-UW-3 Does one threshold replace two?** Recommended: yes, as the job asks. Built meanwhile: one.
