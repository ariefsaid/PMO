# Spec: Material issued ahead of progress raises an alert per work order (material-vs-progress)

**Status:** proposed, Phase 1 (lane gap-material). Map #2516. Extends `docs/specs/material-issued-vs-progress.spec.md` (#2674, shipped) and follows the alert pattern of `docs/specs/material-request-usage-thresholds.spec.md` (#2686, shipped). IDs `FR-MVP-###`, `AC-MVP-###`, `OQ-MVP-#`. Plan: `docs/plans/2026-11-22-material-vs-progress.md`. Scope rulings: OD-SCOPE-2 (every figure and recipient list is a setting), OD-SCOPE-6 (a warning is information, never a block).

## Job story

When material issued to a work order runs ahead of the progress reported for it, I want an alert to the people who control the work order, per work order, not only a banner on the project page, so that over-issue is acted on without someone having to open the right card.

## Today (verified on `land/fix-1122`)

- The comparison exists. `get_work_order_material_vs_progress(p_work_order_id)` (`supabase/migrations/1341_work_order_material_vs_progress.sql`, the only definition) returns per item issued share, the work order's progress share, gap and a `warn` flag, strictly above the organisation threshold. The threshold is `work_order_stock_settings.issue_progress_threshold_pct` (`1340_work_order_stock_settings.sql`; Admin-only `set_work_order_issue_threshold`; unset = off). It is a read on demand: nothing evaluates it when stock is issued or progress is reported.
- The only surface is the banner. `pmo-portal/pages/stock/WorkOrderMaterialProgressBanner.tsx:14-35` (data from `pmo-portal/src/hooks/useWorkOrderMaterialProgress.ts`) is rendered at `pmo-portal/pages/stock/WorkOrderStockBalance.tsx:60`, which sits behind the stock expander of the work-order card on the project's Work Orders tab (`pmo-portal/pages/project-detail/tabs/WorkOrderCustomerOrderCard.tsx:412`). Someone must open the project, the tab, the card and the stock section. The existing spec lists "a notification or email" as out of scope (`material-issued-vs-progress.spec.md`, Out of scope), so the ask is not answered by the base.
- No notification, no needs-you entry and no record of a warning exists for this comparison. `grep` of migrations for the comparison outside 1340/1341 finds nothing (`scripts/prior-art.sh "ahead of progress"` and `"material issued"` are silent).
- Who controls a work order: `work_orders` has no owner or responsible-person column (`0193_work_orders.sql:130-`, later columns `site_warehouse_id` 1320, `closed_by` 1400). The shipped stand-in is the project's manager: `mrq_usage_check` (`1331_mrq_usage_alerts.sql`) notifies `projects.project_manager_id`, skipping the actor, inactive members and other organisations, through `notify_workflow_user` (`1224_notify_workflow_user_carry.sql`). Billing-step notices fall back to the organisation's Admins when the role has no holder (`1460_...:billing_stage_overdue_recipients`). The needs-you list takes derived rows (`pmo-portal/src/components/dashboard/restructure/useNeedsYou.ts:216`, pointer shape `pmo-portal/src/lib/waitingSteps.ts`).
- The two events that move the comparison already commit in one place each: a stock document turning `Posted` (`stock_documents.status`, `0413_stock_posting_engine.sql:17`; issues and returns carry `work_order_id`, `1102`), a daily report turning `validated` (or being superseded or archived), and an acceptance turning `Confirmed`. These are the same inputs 1341 reads.

The design runs the other way from the ask (pull, one banner), so it changes to push-on-change plus a record: the alert is raised when issue or progress changes, not looked up.

## Definitions

Warning, issued share, progress share and gap are exactly those of `material-issued-vs-progress.spec.md`. An **alert** is one open record per work order and item while that item warns. It **resolves** when the item no longer warns (progress catches up, a return, threshold raised or cleared); if the item warns again later it is a new episode and is raised again.

## Requirements (EARS)

- FR-MVP-001 When a stock issue or return to a work order is posted, a daily report for it becomes validated, is superseded or archived, or an acceptance of it is confirmed, the system shall re-evaluate that work order inside the same transaction, using the comparison of 1341 unchanged (no second formula).
- FR-MVP-002 When an item newly warns on a work order (no open alert for that work order and item), the system shall record one open alert (issued share, progress share, gap, threshold at the time) and notify the work order's controllers once.
- FR-MVP-003 While an alert is open and the item keeps warning, the system shall not notify again; it refreshes the recorded figures. Replaying the event, or another posting for the same item, never notifies twice.
- FR-MVP-004 When an item stops warning, the system shall mark its alert resolved. When it warns again, the system shall open a new episode and notify again.
- FR-MVP-005 Where the threshold is unset, the system shall record no alert, write no notification and resolve every open alert of the organisation (default off, as today).
- FR-MVP-006 The controllers of a work order are: its project's manager; plus the active members holding any role the organisation lists as extra recipients (setting below); if that gives nobody, the organisation's active Admins. The actor who caused the event is never notified; inactive members and members of other organisations never are.
- FR-MVP-007 The notification names the work order, the item, issued share, progress share and gap, and links to the work order's stock on the project page. Wording is a literal body, as `mrq_usage_check` (deliberate, same reason: the shared template guard is not edited here); an in-app text in Bahasa Indonesia is the follow-up recorded in OQ-MVP-3. The screens are translated now.
- FR-MVP-008 The system shall list every open alert on the work order card itself: a count badge on the work-order card header (not only inside the stock expander) and the existing banner, which now reads the recorded alert-free live comparison unchanged. Where inventory is externally owned, nothing is shown.
- FR-MVP-009 Each controller shall see open alerts for work orders they control in the needs-you list (derived on read from open alert rows, so it clears when the alert resolves), with a count and a link to the project's work-orders tab. The requester of the issue is not a controller; nobody else is told. A controller who is a light account (Foreman, Field user) is not notified and sees nothing (`docs/specs/light-accounts.spec.md`).
- FR-MVP-010 An Admin shall set, in stock setup beside the threshold, the extra recipient roles (a list of built-in roles, empty by default). The database refuses a non-Admin and an unknown role; the refusal has an English and a Bahasa Indonesia sentence in the shared refusals catalogue saying what to do next. The control, when read-only, says why.
- FR-MVP-011 An alert never blocks, holds or changes any issue, return, report, acceptance or request (FR-MIP-016 stands). The evaluation writes only the alert record and notifications; an evaluation that fails to find an organisation context (system actor) is skipped, never raised, so posting cannot fail because of it.
- FR-MVP-012 Alert rows carry `org_id` stamped by default, RLS on, select limited to the organisation's active members who are not light accounts, no client write path.

## Settings (no per-feature switch)

| Setting | Where | Default |
|---|---|---|
| Issued-versus-progress threshold | existing `work_order_stock_settings.issue_progress_threshold_pct` (1340) | unset (off), unchanged |
| Extra alert recipient roles | new column `work_order_stock_settings.ahead_alert_roles text[] not null default '{}'`; Admin-only definer `set_work_order_ahead_alert_roles(text[])`, audited | empty: project manager only, Admin fallback |

**Default statement.** The alert is not a new switch: it is on for every organisation that has set the threshold, and an organisation without one sees nothing (as today). No money figure, approval route or visibility of existing data changes. Organisations with a threshold already set start receiving alerts from the next posting; nothing is back-filled. The first evaluation after release opens alerts for already-warning items without notifying (see AC-MVP-012) so the release does not produce a burst.

## Acceptance criteria

| ID | Given / When / Then | Owning layer |
|---|---|---|
| AC-MVP-001 | Given threshold 10, allowance 100, progress 40, when an issue of 60 posts, then one open alert exists for that work order and item (issued 60.0, progress 40.0, gap 20.0) and the project manager has one notification naming work order and item. | pgTAP |
| AC-MVP-002 | Given the alert is open, when another issue posts for the same item, or the same posting is replayed, then still one alert and no new notification; the figures refresh. | pgTAP |
| AC-MVP-003 | Given an open alert, when a validated daily report lifts progress so the gap is at or under the threshold, then the alert is resolved with a timestamp; when a later issue makes it warn again, then a new episode opens and notifies again. | pgTAP |
| AC-MVP-004 | Given an open alert, when a return posts that brings the gap to the threshold exactly, then it resolves (strict `>`); a draft or superseded report changes nothing. | pgTAP |
| AC-MVP-005 | Given threshold unset, when issues post, then no alert and no notification; given open alerts and the Admin clears the threshold, then all resolve. | pgTAP |
| AC-MVP-006 | Given no project manager, when an alert opens, then every active Admin except the actor is notified; given extra roles set, then active holders of those roles are notified too; inactive members, other organisations and the actor are not. | pgTAP |
| AC-MVP-007 | Given a posting by a system actor (no organisation context), when it commits, then it succeeds and no alert is written. | pgTAP |
| AC-MVP-008 | Given a Foreman or Field user, when they read alerts, they see none and receive no notification; another organisation's member sees none. | pgTAP (tenancy) |
| AC-MVP-009 | Given a non-Admin, when they call the extra-roles save, then refused 42501; an unknown role is refused with the catalogue code; Admin saves and one audit row exists. | pgTAP |
| AC-MVP-010 | Given the first evaluation after release over already-warning items, then alerts open with `notified_user_ids` empty and no notification is written. | pgTAP |
| AC-MVP-011 | Given an open alert, then the work-order card shows the count without opening the stock expander, in English and Bahasa Indonesia, at 390px and 1440px; with none, the card is unchanged. | Unit (Vitest/RTL) |
| AC-MVP-012 | Given open alerts for the viewer, then needs-you lists "N work orders with material ahead of progress" with a link; with none, nothing; after resolve, it disappears on next read. | Unit |
| AC-MVP-013 | Given an Admin in stock setup, then they edit the extra roles; a non-Admin sees the list read-only with the reason; an empty list says who is told by default. | Unit |
| AC-MVP-014 | Given the threshold set and an issue past it, when the project manager signs in, then the bell shows the alert, following it opens the work order's stock with the warning, and the issue was not blocked. | E2E (one journey, written, run by the orchestrator) |

**Mutation notes (orchestrator):** (1) skip the "already open" check: AC-MVP-002 red. (2) drop the actor exclusion: AC-MVP-001 red. (3) change `gap > threshold` resolution to `>=`: AC-MVP-004 red. (4) remove the Admin check in the roles save: AC-MVP-009 red. (5) drop the unset-threshold early return: AC-MVP-005 red.

## Existing tests whose steps change

- `supabase/tests/1341_work_order_material_vs_progress.test.sql` and the three banner/panel vitest files: none change; the read and banner are untouched.
- `supabase/tests/inventory/anon-executable-definers/*` and the isolation-probe denominator gain fragments for the new table and functions (plan, §Migrations).
- Posting tests (`stock_documents` post, daily report validate, acceptance confirm): triggers are additive and exit early when the threshold is unset, so no step changes; the orchestrator's pgTAP run is the proof.

## Open questions

| ID | Question | Recommended answer, and what is built meanwhile |
|---|---|---|
| OQ-MVP-1 | Who "controls" a work order: the project manager, or a named person per work order (site manager, engineer)? No such column exists. | Project manager, plus roles the organisation lists, plus Admin fallback. Built as above; a work-order responsible person, if wanted, is a later column the recipient rule can prefer. |
| OQ-MVP-2 | Should the store-keeper or site role be told as well as the manager? | Left to the extra-roles setting, empty by default. |
| OQ-MVP-3 | Is an English-only in-app notification text acceptable for a Bahasa Indonesia organisation until the template key follow-up? | Yes for now, same as the shipped usage alerts; screens are translated. |
| OQ-MVP-4 | Should an alert re-notify while still warning (a reminder after N days)? | No. Once per episode; any reminder cadence would be a setting later. |

## Out of scope

Blocking an issue; email delivery of the alert (email is its own lane, the in-app notification already carries the `email_event` hook of 1224); a work-order owner column; changing the comparison formula; per-work-order thresholds.
