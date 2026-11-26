# Spec: the sales and project stage list is an organisation setting (#2906)

Status: draft for Director sign-off · Map: field operations (#2755) · Found by: #2899
Plan: `docs/plans/2026-11-26-stage-list-setting.md`

## 1. Job story

*When my organisation's sales process has different steps from the shipped one, I (Admin) want to
name, order and switch off the stages, and say what winning a deal needs, so that our sales lead's board
and win step show our own process and nothing else.*

*When I (sales lead, a Project Manager) work the board, I want to see only my organisation's stages under
its own names, so I never have to translate "Tender submitted" into what we actually do.*

## 2. What exists today (settled from code)

### 2.1 The stage is a database enum, and its twelve values are keys everywhere

`project_status` is a Postgres enum (`supabase/migrations/0001_init_schema.sql:13-15`, `Declined` added
`0235_project_status_declined.sql:5`). The twelve values, in four fixed groups:

| Group | Stored key (enum) | Shipped English label (`src/lib/status/statusMap.ts:29-40`) |
|---|---|---|
| pipeline | `Leads`, `Quotation Submitted`, `PQ Submitted`, `Tender Submitted`, `Negotiation` | Leads · Quotation submitted · PQ submitted · Tender submitted · Negotiation |
| on hand | `Won, Pending KoM`, `Ongoing Project`, `On Hold`, `Close Out` | Won, pending kickoff · Ongoing · On hold · Close-out |
| lost | `Loss Tender`, `Declined` | Lost · Declined |
| internal | `Internal Project` | Internal |

Pipeline order since #1793 is Leads → Quotation → PQ → Tender → Negotiation
(`0591_pipeline_order_go_get.sql:151-155`, `pmo-portal/components/salesPipeline.ts:50-56`).

The groups are defined in code, twice, and kept in step by tests:
- Database: `pipeline_project_statuses()` (`0591_pipeline_order_go_get.sql:151`),
  `on_hand_project_statuses()` (`0044_dashboard_status_helpers.sql:45-53`),
  `active_delivery_project_statuses()` (`0286_executive_at_risk_active_delivery.sql:4-11`); lost and
  internal are literal `in ('Loss Tender','Declined')` / `'Internal Project'` tests inside functions.
- App: `PIPELINE_STATUSES`, `ON_HAND_STATUSES`, `LOST_STATUSES`, `INTERNAL_STATUSES`,
  `projectStatusGroup()` (`pmo-portal/src/lib/db/projectTransitions.ts:64-97`);
  `pmo-portal/src/lib/dashboardConstants.ts:51-61`.

### 2.2 Every place a fixed stage name is used

**Database functions (latest definition; each names stored keys or a group helper).**
Money / SoD / auth tier (any change is Director-dispatched and ships alone):
`transition_project` (`0534_feature_enforcement.sql:2590`; transition map at `:2603-2616`, whose
pipeline rows were rewritten in place by `0591_pipeline_order_go_get.sql:158-185`; win branch requires
`customer_contract_ref` + `contract_date` at `:2759-2761`; lost/declined reason at `:2658-2669`),
`project_win_eligibility` (`0394_action_eligibility.sql:41`, win only from Quotation / Tender /
Negotiation), `stamp_contract_value_witness` and `audit_procurement_quotation_delete`
(`0177_delete_path_sod_and_project_money_sod.sql`), `audit_project_document_insert` and
`assert_project_origination_insert` (`0176_create_path_sod_residuals.sql`; a project is created only at
Leads or Internal Project), `set_project_contract_value` (`0283_vat_flag_unlock.sql`).
Stage behaviour: `set_project_probabilities_for_status` (`0591_pipeline_order_go_get.sql:68-103`) and
check `projects_terminal_get_probability_check` (`0591:58-65`); `projects_lost_reason_status_check`
(`0461_lost_reason.sql:13`); stage history table `project_stage_entries.stage project_status`
(`0448_pipeline_stage_history.sql:9-24`) with `project_stage_entry_append`, `stage_entry_set_date`,
`add_skipped_stage_entry`, `backfill_project_stage_entries` (`0448`), `stage_entries_pull_back`
(`0586_pullback_keeps_system_dated.sql:24`), `import_project_stage_history`
(`0534_feature_enforcement.sql:2414`); `seed_org_defaults` (`0591:139-148`).
Reports and dashboards (read groups only): `get_sales_pipeline` (`0591`), `get_win_rate` (`0448`),
`get_loss_breakdown` (`0462_loss_breakdown.sql`), `get_executive_dashboard`
(`1971_task_leaf_readers_inline.sql:177`, reads `pipeline_stage_config` at `:293`),
`get_management_pack` (`0919_pack_on_hand_after_billed_totals.sql`), `get_finance_hub_figures`
(`0810_pack_earned_value.sql`), `get_work_in_hand` (`2530_work_in_hand_capacity.sql`),
`project_management_overview` (`2280_project_management_overview.sql`), `project_budget_positions`
(`0859_project_budget_positions.sql`), `project_counts_toward_limit` (`0535_plan_limits.sql`).
Other: `confirm_erp_project_link` (`0324_reviewed_project_links.sql`), `expense_posting_for_push`
(`0425_imprest_postings.sql`), `stock_apply_issue` (`0414_stock_out_flows.sql`, Ongoing only).
61 forward migrations name at least one stored key.

**App (stored keys, not words).** Transition mirror `projectTransitions.ts:45-58`; groups
`projectTransitions.ts:64-97`; board columns `components/salesPipeline.ts:50-75` (+ titles
`OPEN_STAGE_TITLES :59-65`, journey `dealJourneySteps :232-270`, stage-date labels
`STAGE_KEY_DATE_LABEL :273-`, `stageLine :306-311`); Projects board `components/ProjectKanbanBoard.tsx:61-95, 184-190`; status
menu and win prompt `components/ProjectStatusControl.tsx:46-251`; deal actions
`pages/sales/useDealActions.tsx:23-35` (next-stage words), `:78-104` (win/lose legality), `:147-205`
(win panel requires reference + date); drag board win prompt
`pages/sales-pipeline/DraggableSalesBoard.tsx:143,210`; lost tests `pages/sales/DealParts.tsx:55,78,168,210`,
`components/SalesKanbanBoard.tsx:79,426`, `src/hooks/useDashboard.ts:95,163`; Ongoing-only pickers
`pages/timesheets/useTimesheetWeekEditor.ts:110,152,371`, `src/hooks/useStock.ts:144`,
`pages/projects/useProjectListModel.ts:168`; create-path statuses `src/lib/db/projects.ts:101-102`;
ERP link on win `src/hooks/useProjectTransitions.ts:43`; import columns
`src/lib/import/projectDescriptor.ts:39-61`; list URL codec `src/lib/listWorkingSet.ts:128`; tones
`src/lib/status/statusVariants.ts:50-83`; legacy enum `pmo-portal/types.ts:4-17`; assistant prompt
`supabase/functions/agent-chat/prompt.ts:213`.

**App (words a person reads) — four label paths that disagree today.**
1. `statusLabel('project', key, t)` over `STATUS_MAP` (`src/lib/status/statusMap.ts:29-40`; pills,
   lists, filters, menus).
2. `useProjectStatusLabel()` (`src/hooks/useProjectStatusLabel.ts:11-28`; history, confirm dialog,
   form, funnel, deal band).
3. `useSalesStageLabel()` (`src/hooks/useProjectStatusLabel.ts:34-48`) over board titles
   (`salesPipeline.ts:59-65`: "Quotation", "Pre-Qual", "Tender").
4. Deal journey and "Advance to" words (`useDealActions.tsx:23-62`: "Pre-Qualification", "Tender").
Translations: `pmo-portal/public/locales/{en,id}/status.json` (`project.*`), `translation.json`
(`projects.status.*`, `sales.stage.*`, `projects.kanban.*`), `project.json`
(`projectDetail.pipeline.journey.*`, `nextStage.*`), `sales.json` (`stageDate.*`).

**Filters and saved views** store keys only (`?status=Leads`, `listWorkingSet.ts:128`): a rename needs no
migration of saved views. **Seed** sets keys only (`supabase/seed.sql`; `:1686` notes the stage config
comes from migration 0008). **e2e**: 78 spec and unit files name stored keys; keys do not change, so none
move in slice 1.

### 2.3 What `pipeline_stage_config` holds, and whether it can carry the setting

`pipeline_stage_config` (`0008_project_revenue.sql:33-47`): `org_id uuid`, `status project_status`,
`win_probability numeric(4,3) not null`, primary key `(org_id, status)`. RLS + FORCE; select = own org and
active member (`0203`, `0646:2046`); write = own org, active member, **Admin only**
(`0268_role_gate_hardening.sql:314-316`); `org_id` stamped by trigger (`0074_org_id_stamp_trigger.sql`).
It holds **five rows per organisation**, one per pipeline stage (Leads 0.10, Quotation 0.20, PQ 0.40,
Tender 0.80, Negotiation 0.90; `0591:107-136`), seeded for new organisations by `seed_org_defaults`
(`0591:139-148`, called from create-org `0906_org_name_unique.sql:168`). Readers: `get_sales_pipeline` (`0591:187`),
`get_executive_dashboard` (`1971:293`), `set_project_probabilities_for_status` (`0591`), the DAL
`listPipelineStageConfig` (`projectTransitions.ts:136`) whose only caller is the repository
(`src/lib/repositories/projects.ts:28`); no page or hook reads it. It is in the isolation manifest
(`scripts/isolation-probe-denominator.d/legacy.json:181`) and not in `record_history_config`.

**Verdict: it can carry the setting.** Its key is exactly the stage key, it is organisation-scoped, the
write is already Admin-only, and new organisations already get rows. It needs (a) a row for each of the
seven non-pipeline stages and (b) setting columns. `win_probability` becomes nullable; a check keeps it
required on the five pipeline rows and the seven new rows are created without one, so no reader changes
meaning: every reader filters to pipeline keys or coalesces to 0.

## 3. Decisions

- **D1. The stored stage key stays the fixed enum.** The setting overlays words, order, on/off and the
  win step on the twelve keys; it never renames a stored value. This is what gives zero change for an
  organisation that keeps the default, and keeps 30+ database functions, exports, saved views, the import
  and the assistant untouched.
- **D2. Each stage's group comes from its key, never from the setting.** The four groups (pipeline, on
  hand, lost, internal) stay the reporting contract: the database helpers and `projectStatusGroup()` are
  not changed by any slice.
- **D3. Adding a stage of your own is not in this issue.** It needs an organisation-defined stage id on
  every project and a rewrite of the transition map, the win SoD and stage history: a separate design
  (§6, open question Q3).
- **D4. Labels are per language** (English, Bahasa Indonesia), blank = shipped wording, the same rule as
  the terminology setting (#2529).

## 4. Requirements (EARS)

### Slice 1: rename (ships alone; no money-path function changes)

- **FR-STG-001** The system shall keep one `pipeline_stage_config` row per stored stage key per
  organisation (twelve), created for every existing organisation by migration and for every new one by
  `seed_org_defaults`.
- **FR-STG-002** The system shall keep a `win_probability` on each of the five pipeline rows, with the
  values they hold today, and create the other seven rows without one.
- **FR-STG-003** Where an organisation has set a stage name for a language, the system shall show that
  name wherever that stage is named to a reader of that language: status pills, lists, filters, menus,
  history, confirmations, the Sales board column, the funnel, the deal journey, the "Advance to" action,
  the Projects board column and the stage-date label.
- **FR-STG-004** While no name is set for a stage in the reader's language, the system shall show exactly
  the wording it shows today.
- **FR-STG-005** When an Admin saves a stage name, the system shall store it trimmed; a blank name shall
  return that language to the shipped wording.
- **FR-STG-006** If a stage name is longer than 40 characters, or equals (ignoring case) the name another
  stage shows in the same language, then the system shall refuse it and say why.
- **FR-STG-007** The system shall let only an active Admin of the organisation change stage settings;
  every active member may read them.
- **FR-STG-008** When a stage is renamed, the system shall leave every stored status, stage history row,
  saved view, filter link, report figure and export key unchanged.
- **FR-STG-009** The Administration › Project setup screen shall list the twelve stages under their four
  group headings, each with its shipped name and an English and a Bahasa name.
- **NFR-STG-001** The stage settings shall load once per session with the organisation's other naming
  settings (no read per screen) and be bounded to twelve rows.

### Slice 2: order and switch off (money/SoD tier: changes `transition_project`)

- **FR-STG-101** The system shall let an Admin set the order of the five pipeline stages; the board, the
  funnel, the journey, "Advance to" and moved-forward/back wording shall follow it.
- **FR-STG-102** The system shall let an Admin switch off a pipeline stage other than Leads, and switch
  off Declined or Internal Project.
- **FR-STG-103** If a stage that is switched off is the stage of any project that is not archived, then
  the system shall refuse the change and name how many projects are at that stage.
- **FR-STG-104** While a stage is switched off, the system shall not show it as a board column, a target
  or a filter option, and `transition_project` shall refuse a move into it.
- **FR-STG-105** The system shall allow a move between any two switched-on pipeline stages, in either
  direction; moves out of the pipeline group stay as today.
- **FR-STG-106** The system shall never let Leads, Won (pending kickoff), Ongoing, On Hold, Close Out or
  Lost be switched off, and shall never change a stage's group.

### Slice 3: what the win step requires (money/SoD tier)

- **FR-STG-201** The system shall let an Admin set, per pipeline stage, whether a deal may be won from it.
- **FR-STG-202** The system shall let an Admin set whether the customer contract reference is required to
  win; the contract date stays required (it dates the decision the win rate counts).
- **FR-STG-203** When a deal is won, the win panel and `transition_project` shall require exactly the
  fields the setting requires; the contract value SoD is unchanged.

### Slice 4: neutral shipped default (new organisations only)

- **FR-STG-301** When an organisation is created, the system shall give it a neutral default: PQ
  Submitted and Tender Submitted switched off, win allowed from Quotation and Negotiation, contract
  reference optional.
- **FR-STG-302** The system shall migrate every existing organisation to all stages on, win from
  Quotation / Tender / Negotiation, reference required: exactly today's behaviour.

## 5. Acceptance criteria (slice 1; owning layer in the plan's traceability table)

- **AC-STG-001** Given every organisation before the migration, when the migration runs, then each has
  twelve stage rows, the five pipeline rows keep their exact `win_probability`, the other seven hold null,
  and every name column is null.
- **AC-STG-002** Given the stage rows, when anyone writes a pipeline row with a null probability, or a
  name that is blank after trimming or longer than 40 characters, then the database refuses it (23514).
- **AC-STG-003** Given an active Admin of organisation A, when they set a name on an A stage, then it is
  stored; given a Project Manager of A, an Admin of organisation B, or a field account, when they try the
  same, then no row changes.
- **AC-STG-004** Given a new organisation, when it is created, then it has twelve stage rows and its five
  pipeline rows carry the 0591 defaults.
- **AC-STG-005** Given a project at Tender Submitted, when an Admin renames that stage, then the
  project's stored status, its stage history and `get_sales_pipeline`'s stage keys are unchanged.
- **AC-STG-006** Given a name typed by an Admin, when it is validated, then blank means "back to shipped",
  more than 40 characters is refused, and a name another stage already shows in that language (ignoring
  case) is refused.
- **AC-STG-007** Given an organisation name "Bid sent" (English) for Tender Submitted and none in Bahasa,
  when an English reader sees that stage through any label path, then it reads "Bid sent"; when a Bahasa
  reader sees it, then it reads the shipped Bahasa wording; and every other stage reads exactly as before.
- **AC-STG-008** Given the rename, when the Sales board, the funnel, the deal journey, the "Advance to"
  action and the stage-date label render, then each says "Bid sent".
- **AC-STG-009** Given an Admin on Administration › Project setup, when the stage card renders, then it
  lists twelve stages under Pipeline, On hand, Lost and Internal; given a Project Manager, then the card is
  not shown.
- **AC-STG-010** Given the Admin renames Tender Submitted to "Bid sent" on screen, when a Project Manager
  signs in and opens the Sales board, then the column and the deal's stage read "Bid sent", and moving the
  deal there still works.

Slices 2-4 get their AC ids (`AC-STG-1xx`, `-2xx`, `-3xx`) in their own plans, after Q1-Q3.

## 6. Open questions for the owner (each with the default the build uses)

- **Q1. Neutral default for new organisations.** Default: switch off PQ Submitted and Tender Submitted,
  keep the shipped names, reference optional (FR-STG-301). Existing organisations keep today's process.
- **Q2. What the win step may require.** Default: the contract date stays required for everyone (the win
  rate dates the decision by it); only the customer contract reference becomes optional per
  organisation. No new win fields.
- **Q3. Stages of your own (beyond the twelve).** Default: not in #2906; file a follow-up under #2755,
  built only when an organisation asks for a sixth pipeline step. Renaming and switching off cover the
  "board shows stages we never use" case named in the issue.

## 7. Out of scope

Text the server writes (assistant answers, PMO CLI output, e-mail notifications) keeps stored keys or
shipped words in slice 1. The group words (the Sales board's "Won" and "Lost" columns, the journey's
Won/Lost steps) are not stage names and stay as shipped. Import template column headers stay as shipped.
