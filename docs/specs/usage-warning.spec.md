# Spec: Warn the site engineer when installed material passes a share of plan

**Status:** approved (coordinator), built in Phase 2, size M. Steering of the coordinator supersedes the first Phase 1 draft: a responsible person on the work order, an organisation setting for what counts as installed, a check wherever installed quantity changes, and the request-time warning (#2686) stays beside it unchanged. IDs `FR-UW-###`, `AC-UW-###`. Plan: `docs/plans/2026-11-22-usage-warning.md`. Map #2516. Rulings in force: OD-SCOPE-2 (every number is a setting), OD-SCOPE-8 (material lines on a validated site report are the record of material used), warn and never block.

## Job story

When material installed on a work order passes a set share of the planned quantity, I want the site engineer told, so they go and check; and I want the measure to be the material actually installed, with one threshold setting.

## Today (verified on this branch, `origin/land/fix-1122`)

- **Measure is requested, not installed.** `supabase/migrations/1331_mrq_usage_alerts.sql` `mrq_usage_check`: use = `mrq_prior_quantity(...) + l.quantity` (other live requests plus the request being submitted). Run from `mrq_submit` (`1333_mrq_submit_carry_usage_check.sql:75`), so only when a request is submitted.
- **Recipient is the project manager** (`projects.project_manager_id`); `work_orders` has no person column (0193, 0337, 1320, 1400 add none).
- **Two thresholds** (`usage_warn_pct_1`, `usage_warn_pct_2`, 1330) edited in `UsageThresholdsEditor.tsx`; alerts unique on `(work_order_id, item_id, slot)`.
- **Installed material already exists as data:** `dsr_consumables` (1040) on reports that are validated, not superseded, not archived (the filter `qcr_figures` and `work_order_validated_revenue` use); and the stock ledger (`stock_ledger` kind issue/return, tagged to a work order through `stock_documents.work_order_id`, as `get_work_order_stock_balance` 1031 reads it).
- **Plan figure:** `mrq_plan_quantity` (1156). **Prior art:** `scripts/prior-art.sh "usage warning"` finds nothing; `overrun` finds only contract-quantity detection (1175), a different measure.

## What changes

Added beside the request-time warning, which stays exactly as shipped (nothing in 1330-1333 is restated or removed): a new check on INSTALLED quantity, a new alert table, a responsible person on the work order, and a source setting. The first threshold column (`usage_warn_pct_1`) is the one threshold of the installed check; no second one is added.

## Settings

| Setting | Where | Default |
|---|---|---|
| Usage threshold (percent of plan) | `material_request_settings.usage_warn_pct_1`, existing, edited in the existing editor (its text now says the first warning also tells the site engineer) | unset (off) |
| What counts as installed | `material_request_settings.usage_installed_source` (`site_reports` or `stock_issues`); Admin-only `set_usage_installed_source`; a select on the material-request settings screen | `site_reports` |
| Responsible person | `work_orders.responsible_person_id`, nullable; set by whoever may edit the work order (Admin, Executive, Project Manager, Finance) through `set_work_order_responsible_person`; shown and editable on the work-order screen | null |

**No on/off switch.** Unset threshold means no warning, as for the request-time one. **Not an approval-route or visibility change** (agreed by the coordinator): the feature is unreleased and off by default, a warning moves no money, approval or access.

## Requirements (EARS)

- FR-UW-010 The system shall hold one nullable responsible person per work order, an active member of the work order's organisation (the database refuses another organisation or a disabled member).
- FR-UW-013 A foreman or field user cannot be the responsible person (the database refuses, `RSP_FIELD_ACCOUNT`; the picker does not offer them), and a responsible person who has since become a field account is skipped for the project manager by the recipient rule.
- FR-UW-011 Whoever may edit the work order may name or clear the responsible person; the work-order screen shows it and offers the choice only to them, in English and Bahasa Indonesia; others read the name, or "Not set" with who sets it.
- FR-UW-012 The responsible person is the site engineer the usage warning goes to.
- FR-UW-002 **Installed** quantity of an item on a work order is, by the organisation's source (FR-UW-020): `site_reports`: the sum of material lines on the work order's reports that are validated, not superseded and not archived; `stock_issues`: posted issues less posted returns to the work order. Requests, transfers and the other source never count.
- FR-UW-003 Where the first threshold is set, when installed quantity of an item reaches that percent of plan (plan 0 with any installed quantity counts as reached), the system shall record one warning for the work order and item and write one in-app notification.
- FR-UW-004 The notification goes to the work order's responsible person; where there is none, or that person is not an active member, to the project's manager; where neither can be told the warning is recorded and nobody is notified. One function body holds this rule.
- FR-UW-005 A warning is raised once per work order and item (unique `(work_order_id, item_id)`); later quantities, corrections, a lowered threshold or a changed source do not notify again.
- FR-UW-006 The work-order card shows the recorded warnings (installed, plan, threshold) without opening anything else. It never disables an action.
- FR-UW-007 The check runs whenever installed quantity can change: a site report is validated (an original), superseded (a correction replaced it, checked after the supersede so both versions are never counted together) or archived, and a stock issue or return is posted to a work order.
- FR-UW-008 A failure of the check shall never block validating a report or posting a stock document: the trigger entry point swallows every error and logs it as a database warning.
- FR-UW-009 Where the threshold is unset the check does nothing: no record, no notification, no screen change.
- FR-UW-020 An Admin chooses what counts as installed (FR-UW-002); the server refuses anyone else.
- NFR-UW-001 `material_installed_usage_alerts` has RLS on, org reads only, no client write path; `org_id` is stamped, never sent; new client-callable functions carry the light-account refusal (1480 convention).
- NFR-UW-002 Screen text is English and Bahasa Indonesia. The notification body is plain English through `notify_workflow_user`, the deviation #2686 recorded.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-UW-001 | Given threshold 80, plan 100 and a responsible person, when a report with 85 is validated, then one warning and one notification to the responsible person, none to the project manager. | pgTAP |
| AC-UW-002 | Given no responsible person (or a disabled one), then the project manager is told. | pgTAP |
| AC-UW-003 | Given a warning raised, when more reports validate or the threshold is lowered, then no second row or notification. | pgTAP |
| AC-UW-004 | Given a correction replaces a validated report, then installed counts the new version only; a correction from 50 to 60 raises nothing, to 85 raises once. | pgTAP |
| AC-UW-005 | Given the threshold unset, then nothing is recorded or sent (mutation checks in the file header); a crossing that stood before the threshold was set is raised at the next change. | pgTAP |
| AC-UW-006 | Given plan 0 and installed above 0, then the warning is raised. | pgTAP |
| AC-UW-007 | Given a submitted, unvalidated report, then it is not installed and raises nothing. | pgTAP |
| AC-UW-008 | Given a non-Admin or an unknown value, when the source is set, refused; another organisation changes only its own and reads no warnings. | pgTAP |
| AC-UW-009 | Given source `stock_issues`, then a posted issue records the warning, installed is issues less returns, and site-report quantities are ignored. | pgTAP |
| AC-UW-010 | Given an Admin and a non-Admin on the settings screen, then only the Admin sees the installed-source select; saving sends the choice; a refusal is one sentence. | Unit |
| AC-UW-011 | Given the work-order screen, then someone who may edit names or clears the responsible person; a reader sees the name or "Not set" and who sets it. | Unit |
| AC-UW-012 | Given a validated report of 85 against plan 100 at 80 percent, then the responsible person is told and the work-order card shows the item. | e2e |
| AC-UW-013..016 | The responsible person: default null, set and cleared; refused for a role that may not edit work orders, another organisation's person, a disabled member, another organisation's work order. | pgTAP (`work_order_responsible.test.sql`) |
| AC-UW-019, 020 | A field account cannot be named (refused, not stored, not offered in the picker); a named person who later becomes a field account is skipped and the project manager is told. | pgTAP + Unit |
| AC-UW-017 | Given the check raises an error, then a report still validates and a stock issue still posts. | pgTAP |
| AC-UW-018 | Given a report is archived, then the work order is checked. | pgTAP |

## Errors (refusal catalogue, English and Bahasa Indonesia, each says what to do next)

| Condition | Code | Sentence (English) |
|---|---|---|
| Non-Admin sets the source | `MRQ_USAGE_ADMIN_ONLY` | Only an Admin can change the usage warning. Ask an Admin to change it. |
| Unknown source | `MRQ_USAGE_INVALID` | Choose site reports or stock issues as what counts as installed. |
| Role may not edit the work order | `RSP_FORBIDDEN` | Your role cannot set the responsible person. Ask a project manager or an Admin. |
| A foreman or field user | `RSP_FIELD_ACCOUNT` | A foreman or field user cannot be the responsible person. Choose an office member. |
| Person not an active member of this organisation | `RSP_PERSON` | Choose an active member of this organisation as the responsible person. |

## Existing tests whose steps change, and why

None of the request-time warning's tests change (it is untouched). `pages/MaterialRequestSettings.test.tsx` and `MaterialRequestSettings.usage.test.tsx` gain the mock of the new installed-source read because the Admin settings screen now renders the new select.

## Decisions (coordinator, 2026-11-22)

Site engineer = the work order's responsible person, project manager when none; the measure is installed (site reports by default, stock issues by setting); one threshold (the existing first); the request-time warning stays.
