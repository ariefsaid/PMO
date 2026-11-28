# Role-setting working defaults (RR-3, 28 Nov 2026)

Owner ruling: an organisation's role settings must work out of the box. While an Admin has set
nothing, the app uses a working default keyed on built-in job-role keys; an explicit Admin value
still wins. Defaults ship for every organisation — existing (backfill) and new (`seed_org_defaults`).

Sources re-traced at origin/dev `9f16436de` (latest bodies): `2680` (standard checks template),
`1841` (request chain), `2290`+`2043`+`2441` (daily-report validation), `1936`+`2767`+`2600`
(billing step owner), `2040`+`2383` (close-out owner), `1322` (keeper guard), `2041` (crew tool
report), `2580` (PCM scheduled reports). RLS stays the authority (ADR-0016); `policy.ts` mirrors
for UX only.

Job-role semantics (1840 `holds_job_role`): a person fills a role when they hold its key, or hold
no key and have the role's base access level. Orgs that never turned built-in roles on therefore
still get live defaults through level inclusion; orgs that assign keys get exact routing. Where a
shipped surface deliberately reads the held key only (`actor_holds_job_role`, 2040 — close-out
owners; standard-check assignment, 2680), the default keeps that surface's own semantics.

## Requirements (EARS)

### FR-RSD-001 Standard work-order checks template
- The system SHALL ship four standard check lines to every organisation that keeps none:
  engineer, storekeeper, project_control_manager, hr_officer (one line each, target 1 day).
- When an Admin replaces the standard checks (set_work_order_check_template), the system SHALL use
  the Admin's list and only the Admin's list (an emptied list stays empty).
- When a new Draft work order is captured, the system SHALL copy the organisation's standard
  checks as open tasks (2680 rule unchanged).

### FR-RSD-002 Material-request approval chain
- The system SHALL ship a three-step approval chain to every organisation that keeps none:
  material_coordinator → project_control_manager → construction_manager, the third step
  (`only_over_plan`) snapshotting only for requests above plan.
- When an Admin sets a chain (mrq_set_chain), the system SHALL use it.
- When nobody holds a default step's role, the request SHALL wait on that step (no silent skip).
- The author SHALL never decide a step of their own request (MRQ_SOD_AUTHOR, unchanged); one
  person SHALL decide at most one step per request (MRQ_SOD_TWICE, unchanged).

### FR-RSD-003 Daily-report validation roles
- While `organizations.daily_report_validate_roles` is empty, the system SHALL admit as validators
  the holders of quantity_surveyor and project_control_manager (key held, or no key and the base
  level), besides today's Admin, Finance and the project's own manager.
- When an Admin sets validator roles, the system SHALL admit only those roles' key holders
  (2290 rule unchanged).
- The author SHALL never validate their own report (dsr_validate, unchanged).
- The validation queue's "waiting for validator" flag and the validation route SHALL honour the
  same effective role set.

### FR-RSD-004 Billing step owner for the QC report
- The system SHALL ship a default billing checklist whose first step is "QC report" owned by
  quality_inspector to every organisation that keeps no billing template and no default.
- When an Admin picks their own default billing template, the system SHALL use it.
- When a work order is issued, the system SHALL instantiate the organisation's default checklist
  (1773 rule unchanged); the QC step's holder reads it, acts on it and is told when it opens
  (1936 rule unchanged).

### FR-RSD-005 Close-out item owners
- The system SHALL ship a five-line close-out checklist to every organisation that keeps none:
  quality acceptance letter, mechanical acceptance certificate, certificate of completion,
  close-out document → project_control_manager; material completion report → storekeeper.
- When an Admin replaces the checklist (set_closeout_checklist), the system SHALL use it.
- A close-out item's owner key SHALL keep its shipped semantics: the held-key holder records the
  item (actor_holds_job_role, 2383), else Admin/Finance/the project's own manager.

### FR-RSD-006 Warehouse keeper fallback
- When no keeper is named for a warehouse, the system SHALL let any active member who fills
  storekeeper (key held, or no key and the Engineer level) post stock for that warehouse.
- When a keeper IS named for the warehouse, the system SHALL let only the named keepers (and an
  Admin, audited as the override) post — today's rule (1322).
- The fallback SHALL NOT count as the Admin override: no override audit is recorded for it.

### FR-RSD-007 Crew field controller fallback
- When a crew names no field controller, the system SHALL let a member who fills site_supervisor
  (key held, or no key and the Engineer level) report the crew's tool damage/loss (report_crew_tool).
- When a crew DOES name a field controller, the system SHALL let only that person (besides the
  shipped crew-manager and keeping-storekeeper paths) report — today's rule (2041).
- A member holding a DIFFERENT job-role key SHALL NOT fill site_supervisor (1840: a keyed person
  is judged by their key alone).

### FR-RSD-008 Project Control Manager scheduled reports
- Already shipped on dev (2580): `organizations.pcm_scheduled_reports_enabled` defaults to true.
  This round re-verifies and documents it; no change.

## Acceptance criteria (Given/When/Then)

- **AC-RSD-001** Given an organisation with no standard checks, when a Draft work order is
  captured, then four check tasks exist (engineer, storekeeper, project_control_manager,
  hr_officer; due +1 day); Given the Admin replaces the list with one line, when another Draft is
  captured, then only that line's task exists.
- **AC-RSD-002** Given an organisation with no chain, when a request above plan is submitted, then
  three open steps snapshot (coordinator, control manager, construction manager); when a request
  within plan is submitted, then two steps; the author is refused on every step; a coordinator-role
  holder decides step 1; a different construction-manager-role holder decides step 3.
- **AC-RSD-003** Given no Admin setting, an unkeyed Engineer (level) and a keyed
  quantity_surveyor validate a submitted report and appear in the queue/route; the author is
  refused; when the Admin sets `{quantity_surveyor}` only, an unkeyed Engineer is refused and a
  keyed quantity_surveyor still validates.
- **AC-RSD-004** Given the default billing checklist, when a work order is issued, then a current
  "QC report" step exists owned by quality_inspector; its keyed holder matches
  wo_step_owner_matches and is among notify_wo_step_opened's recipients; an organisation with its
  own default template instantiates only its own steps.
- **AC-RSD-005** Given the default close-out checklist, when a work order is issued, then five
  required items exist with owners project_control_manager (×4) and storekeeper (MCR); the keyed
  owner completes their item; an unkeyed Engineer is refused; Admin/own-PM still complete items.
- **AC-RSD-006** Given a warehouse with no keepers, a member filling storekeeper passes the keeper
  guard (no override audit); given a keeper named on that warehouse, the same member is refused
  and the named keeper passes; the Admin override still returns true.
- **AC-RSD-007** Given a crew with no field controller, a keyed site_supervisor and an unkeyed
  Engineer report a tool; a keyed buyer (same base level, different key) is refused; given a named
  field controller, only that person (besides shipped paths) reports.
- **AC-RSD-008** A new organisation has `pcm_scheduled_reports_enabled = true` (2580, unchanged).

## Layering (ADR-0010)

Every AC is owned by one pgTAP proof (`supabase/tests/2803_role_setting_defaults.test.sql`,
mutation-checked per the mut: notes in that file). The role-job screen tests: quantity_surveyor
validates on the daily-report screen, a storekeeper posts on the stock screen, a site_supervisor
reports on the crew-tools screen, a material_coordinator decides on the request screen
(`pmo-portal/e2e/JOB-RSD-*.spec.ts`). The billing-step and close-out owner screen jobs are already
covered by JOB-BQ10 and JOB-PC13b signing in as the owner roles; the default's instantiation is
proven in pgTAP. FE gates mirror the database in `policy.ts`, `useStock.ts` and
`workOrderBillingSteps.ts` (UX only; RLS/RPC decide).
