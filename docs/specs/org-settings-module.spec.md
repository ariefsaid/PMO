# Organisation switch module (#2746)

Status: Draft for Director review · Map: #1533 · Decision: ADR-0121 · Plan: `docs/plans/2026-11-22-org-settings-module.md`

## What this is

The 15 December round added about thirty organisation settings (27 `organizations` columns and 14 `*_settings`
tables). Each was built with its own getter, setter, data-access pair, repository pair, hook, Admin card and
permission line, and each picked its own freshness window and error display.

This spec makes **one module for the on/off settings** (an *organisation switch*) on the front end, over the
**existing storage**, and gives **every** organisation setting one audit line per change in the database. It does
not move any stored value. ADR-0121 records why: most of these settings are not one boolean, and their rules
live in the storage (CHECK constraints, foreign keys, preconditions) where a key/value table would lose them.

## Inventory at origin/dev

"Writer" is the server path that changes the value; `can()` mirrors it (ADR-0016). Gate wordings
`auth_role() = 'Admin'` and `role_rank(auth_role()) >= 50` are the same rule (Admin is the only rank-50 role).
Audit coverage differs per setting today; FR-OSM-020 makes it one rule for all.

| # | Setting | Storage | Who writes (server path) | Validation | Read by |
|---|---|---|---|---|---|
| 1 | Quantity change limit | `organizations.quantity_change_limit` | Admin (column grant + Admin update policy) | integer ≥ 1 or empty (CHECK) | quantity change request RPCs (1176, 1178) |
| 2 | Built-in roles | `organizations.built_in_roles_enabled` | Admin (`set_built_in_roles_enabled`) | true/false, empty refused (22023) | Users admin role picker; built-in role triggers (1202, 1232) |
| 3 | Check-in supervisor role | `organizations.phone_check_in_supervisor_role` | Admin (`set_phone_check_in_supervisor_role`) | a built-in role key or empty (FK, 22023) | phone check-in decisions (1211, 1213) |
| 4 | Hide prices from requesters | `organizations.hide_prices_from_requesters` | Admin (`set_hide_prices_enabled`) | true/false (22023) | app-shell price read path; price visibility helpers (1215, 1218) |
| 5 | Cleared-for-site checklist | `organizations.clearance_checklist_enabled` | Admin (column grant + Admin update policy) | true/false, NOT NULL | Administration › Clearance, person clearance, person detail |
| 6 | Leave requests + approver role | `organizations.leave_requests_enabled`, `leave_approver_role` | Admin (`set_leave_settings`, both at once) | role must be a user role (22023); 1–60 chars | Leave page; leave RPCs (1241) |
| 7 | Crew loans | `organizations.crew_loans_enabled` | Admin (`set_org_crew_loans_enabled`) | true/false (22023) | Crews page loans card |
| 8 | Revenue per discipline | `organizations.discipline_profit_enabled` | Admin (`set_org_discipline_profit_enabled`) | true/false (22023) | project discipline profit, earned vs billed, management pack, BOQ discipline picker; their RPCs (1266–1272) |
| 9 | Performance indices + bands | `organizations.performance_indices_enabled`, `performance_band_low`, `performance_band_high` | Admin (column grant + Admin update policy) | 0 < low < 1 < high (CHECK) | work order performance (1286) |
| 10 | Transfer mode, proof timing | `organizations.stock_transfer_mode`, `stock_proof_timing` | Admin (`set_stock_transfer_mode`, `set_stock_proof_timing`) | enum (P0001); refused while transfers are in flight, or when the ERP owns stock | stock transfer RPCs (1306–1309) |
| 11 | Work-order stock transfers | `organizations.stock_wo_transfers` | Admin (`set_stock_wo_transfers`) | true/false (P0001); refused when the ERP owns stock | stock documents, work-order transfer screens and RPCs (1310–1312) |
| 12 | Reservations + borrowing | `organizations.stock_reservations`, `reservation_borrow_mode`, `_role`, `_label` | Admin (`set_stock_reservations`) | role and label both or neither (P0001); ERP-owned stock refused | reservation RPCs (1316, 1317); material request borrowing (1318) |
| 13 | Site reports post stock | `organizations.dsr_stock_issue`, `dsr_stock_issue_items` | Admin (`set_dsr_stock_issue`) | enum (P0001); turning on refused when the ERP owns stock | site report stock posting (1323) |
| 14 | Line planning | `organizations.purchase_line_planning` | Admin (`set_purchase_line_planning`) | true/false (22023); first turn-on seeds starter categories | purchase create, line planning panel (1346) |
| 15 | Safety records | `organizations.safety_records_enabled` | Admin (`set_safety_records_enabled`) | empty stored as off | safety days, safety summary, work-order safety section (1411) |
| 16 | Equipment targets | `organizations.equipment_availability_target_pct`, `_utilisation_target_pct`, `equipment_escalation_down_days` | Admin (`set_equipment_targets`) | 0–100, one decimal; 1–365 days (22023) | equipment escalation (1416), equipment screens |
| 17 | Attendance target | `organizations.attendance_target_rate` | Admin (column grant + Admin update policy) | 0–100 (CHECK) | Crews, attendance rate (1437) |
| 18 | Crew tool reports | `org_crew_tool_settings` (coordinator, due days) | Admin or Project Manager (`set_crew_tool_settings`) | due days 1–60 (CHECK, 22023) | crew tool report RPCs (1159) |
| 19 | Idle hours as cost | `idle_cost_settings.enabled` | Admin or Finance (`save_idle_cost_setting`) | true/false (22023); counts only while labour cost is on | idle cost figures (1255) |
| 20 | Labour cost | `labour_cost_settings.enabled` | Admin or Finance (`save_labour_cost_settings`) | true/false (22023); first turn-on seeds three classes | labour cost screens and RPCs (1250–1299) |
| 21 | Revenue plan | `org_revenue_plan_settings` (on, working weekdays) | Admin (`set_revenue_plan_settings`) | weekdays 1–7 (CHECK, 23514) | revenue plan, daily targets (1275–) |
| 22 | Spend approval tiers | `spend_approval_settings.tiers_enabled` | Admin (insert/update under RLS) | true/false | spend approver routing (1291) |
| 23 | Work-order issue threshold | `work_order_stock_settings` | Admin (`set_work_order_issue_threshold`) | 0–100 (CHECK, 22023) | work-order stock issue (1340) |
| 24 | Purchase types | `org_purchase_type_settings.enabled` | Admin (`set_purchase_types_enabled`) | true/false (22023); first turn-on seeds starter types | purchase type fields, purchase type settings |
| 25 | Payment channels | `org_payment_channel_settings.enabled` | Admin (`set_payment_channel_settings`) | true/false (22023); `enabled_at` stamped | purchase payment channel (1356) |
| 26 | Monthly equipment plan | `org_equipment_plan_settings` (on, approval step, self-approval) | Admin (`set_equipment_plan_settings`) | enum (22023, 55000) | equipment plans (1358) |
| 27 | Billing plan | `org_billing_plan_settings` (target, currency, reminder) | Admin or Finance (`set_billing_plan_settings`) | amount ≥ 0; ISO currency; a target needs a currency | billing plan (1375) |
| 28 | Issue closing report | `issue_closing_report_settings` (on, grouping) | Admin, Executive or Project Manager (insert/update under RLS) | enum (CHECK) | issue closing time report (1424) |
| 29 | Purchase order print | `purchase_order_settings` | Admin (`po_set_print_settings`, RLS) | bounded signature blocks and collectors (CHECK) | purchase order print (1444) |
| 30 | Email notifications | `email_org_settings.locale`, `email_event_settings` rows | Admin (`set_email_locale`, `set_email_event_setting`) | `en`/`id`; known event keys; ≤ 30 extra roles | email outbox (1221–1227) |

Not in this list and not touched: Operator-owned **feature entitlements** (`org_features`, ADR-0049); settings older
than the round; three-way match and material-request settings (they keep their own paths and can join later).

**Shape, from the table.** Thirteen rows are one on/off value (2, 4, 5, 7, 8, 11, 14, 15, 19, 20, 22, 24, 25).
Even among those, three seed data on first turn-on (14, 20, 24), one counts only while another is on (19) and one
swaps the app's price read path (4). The other seventeen are groups validated together (both-or-neither,
target-needs-currency, low < 1 < high, refused-while-in-flight, refused-when-ERP-owned) or real per-key rows (30);
they keep their own forms.

## What breaks today, and what this changes

| Change | Who, doing what | Wrong outcome today |
|---|---|---|
| One read per switch, refreshed on focus and every 5 minutes (FR-OSM-001–003) | A Project Manager already signed in when an Admin turns crew loans, the clearance checklist or revenue per discipline on or off | Their screens keep the old state until they reload the app (those three never refresh in a session); safety records lag up to 5 minutes, work-order transfers 60 seconds |
| One write path and one switch card (FR-OSM-004–010) | The next builder adding an on/off setting, and its reviewers | About 150 non-test lines rebuilt per switch, and each one re-reviewed for gate and freshness; this round produced four control shapes (switch, checkbox, a "Turn on…" button, a select with Save), three error displays and four freshness windows for the same kind of fact |
| A new Admin-only switch needs no new RPC (FR-OSM-009) | Same builder | Today every new switch adds a getter and setter RPC pair; the column-grant path (rows 1, 5, 9, 17) already does the job in three SQL lines |
| One audit line per setting change (FR-OSM-020–022) | An Admin or Executive (or the client at acceptance) asking who changed a setting, and when | The answer depends on which setting it was |

Dropped, because nothing breaks: unifying the invalid-input codes (22023 vs P0001: a switch never sends a bad
value and `classifyMutationError` reads both); rewording role gates (equivalent); moving values into one table
(ADR-0121); deleting `policy.ts` entries (they gate other cards too); moving the settings that live on six other
screens into Administration (a screen change: the owner's call, not proposed here).

## Requirements

Slices are in the plan. "Switch" = an organisation switch registered in `ORG_SWITCHES`.

- **FR-OSM-001** The module shall read each switch through `useOrgSwitch(key)`, which returns the value its existing
  server read returns (an absent settings row reads as off, as today).
- **FR-OSM-002** All readers of one switch in one browser shall share one cached value, keyed by organisation and key.
- **FR-OSM-003** When the window regains focus, or five minutes after the last read, the module shall re-read every
  mounted switch (`SERVER_SESSION_QUERY_OPTIONS`, the existing policy for server-arbitrated org facts).
- **FR-OSM-004** When a person who may change a switch changes it, the module shall call that switch's existing server
  write exactly once with the new value, then re-read the switch and every query root the switch lists as dependent.
- **FR-OSM-005** If the server refuses the write, the card shall show the refusal under the switch and the switch
  shall show the stored value.
- **FR-OSM-006** While the signed-in person's real role may not change the switch, the card shall show the switch
  disabled with a note naming who can change it, and shall send no write.
- **FR-OSM-007** Each switch's `can('manage', …)` shall allow exactly the roles its server write accepts.
- **FR-OSM-008** The module shall not change any server write's gate, validation, error, stored value or audit
  (slices 1–2). Every rule stays at least as strict.
- **FR-OSM-009** Where a new switch is written by Admin only, it shall be addable as an `organizations` boolean
  column (NOT NULL, default false, column UPDATE grant) plus one registry entry read and written by the module's
  column adapter: no new RPC, data-access function, hook or card.
- **FR-OSM-010** `<OrgSwitchSetting>` shall render: an optional heading with the card's existing anchor id, the
  label, the helper text, the switch, the writers note (FR-OSM-006), the inline refusal (FR-OSM-005), a loading row
  and a load error with Retry, and optional content shown only while the switch is on.
- **FR-OSM-020** When any setting in the inventory changes value, by whichever path, the database shall write one
  `org.setting.change` audit event carrying the setting name (`table.column`), the old value, the new value and the
  actor (slice 3 for non-money settings; each money slice for its own).
- **FR-OSM-021** When a write leaves a setting's value unchanged, the database shall write no `org.setting.change` event.
- **FR-OSM-022** Record history shall label the event "Organisation setting changed" (Bahasa: "Pengaturan organisasi diubah").
- **NFR-OSM-001** Slices 1–3 change no stored setting value and add no migration that rewrites rows.
- **NFR-OSM-002** One request per switch per organisation for all of a page's readers (no per-component reads).
- **NFR-OSM-003** Migrations are reversible (a `rollback/*_down.sql` per forward file).

## Acceptance criteria

| AC | Owning layer | Given / When / Then |
|---|---|---|
| AC-OSM-001 | Unit (`src/hooks/useOrgSwitch.test.tsx`) | **Given** crew loans stored on, **when** two components read `useOrgSwitch('crewLoans')`, **then** the server read runs once and both show on. |
| AC-OSM-002 | Unit (same) | **Given** a mounted switch read as off and the server now on, **when** the window regains focus, **then** the switch reads on. |
| AC-OSM-003 | Unit (same) | **Given** an Admin, **when** they turn the clearance checklist on, **then** the write runs once with `true`, the switch re-reads, and the `clearance` queries refetch. |
| AC-OSM-004 | Unit (`src/components/admin/OrgSwitchSetting.test.tsx`) | **Given** the server refuses (for example "the ERP owns stock"), **when** the Admin flips work-order transfers, **then** the refusal shows under the switch and the switch shows the stored value. |
| AC-OSM-005 | Unit (same) | **Given** a Project Manager, **when** the card renders, **then** the switch is disabled, "Only an Admin can change this." shows, and no write is sent. |
| AC-OSM-006 | Unit (`src/lib/repositories/orgSwitches.test.ts`) | **Given** each registered switch, **when** `can('manage', entry.manage)` is asked for every role, **then** it is true exactly for `entry.writers`, and `entry.writers` equals the roles the server write accepts (proved per switch by the existing pgTAP files the plan lists). |
| AC-OSM-007 | Unit (same) | **Given** a column-backed switch, **when** it is read and written, **then** it reads that column of the one visible organisation row and writes by that row's id; with more than one visible row the write is refused (`no-org`), as today. |
| AC-OSM-008 | E2E (existing, steps updated in slice 2) | `AC-BIR-001` and `AC-CLR-011` still reach their goal (role assigned; person Cleared) with the switch card. Their goal oracles do not change. |
| AC-OSM-020 | pgTAP (`supabase/tests/1510_org_setting_audit.test.sql`) | **Given** an Admin, **when** each in-scope setting is changed through its normal writer, **then** exactly one `org.setting.change` event exists with `setting`, `from`, `to` and the Admin as actor. |
| AC-OSM-021 | pgTAP (same) | **Given** a setting already on, **when** the Admin writes on again, **then** no `org.setting.change` event is added. |
| AC-OSM-022 | Unit (`src/components/history/__tests__/historyLabels.test.tsx`) | **Given** an `org.setting.change` event, **when** history renders, **then** it reads "Organisation setting changed" (and the Bahasa label in `id`). |

## Out of scope

Moving any value into a shared table; changing any gate, validation or error text on the server; the grouped
settings' forms; where settings live on screen; Operator entitlements and plans (#1718).
