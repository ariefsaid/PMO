# Plans and Feature Switches Implementation Plan

> **For agentic workers:** Use the supervised Orca executor and test-driven development. Execute slices in order; slices 1–3 are auth-tier changes and ship alone.

**Goal:** Give each organisation an Operator-assigned plan, enforce its switches and limits, and keep existing behaviour through migration.

**Architecture:** A database resolver owns the global → override → plan precedence. Caller-scoped RPC projections serve the UI and assistant; privileged jobs use a separately authorized server-only entry point to the same resolver. A data migration contains the catalogue and plan matrix. Keep deployment-availability gates independent of entitlement, and retain the Admin feedback control.

**Tech stack:** PostgreSQL/RLS/pgTAP, React/TypeScript/Vitest, Deno, Playwright, PostHog.

**Spec:** `docs/specs/plans-and-feature-switches.spec.md` (D1–D15); map #1718.

**Scope:** S1 is detailed below. S2–S6 are outlines; each requires a separate detailed plan before implementation, per Director ruling.

## Constraints and review focus

- No billing or prices; core features remain on; off retains data. All new SQL has rollback files, RLS, an org seam, fixed search paths and explicit grants.
- Preserve both layers of current behaviour: `org_has_feature` defaults absent rows to true (`supabase/migrations/0070_org_features.sql:54`); FE absent rows use environment and revenue ownership (`pmo-portal/src/auth/useFeature.tsx:24`, `pmo-portal/src/hooks/useOrgFeatures.ts:29`). Environment capability gates remain ANDed with entitlement and cannot grant an entitlement. Capture before/after results in migration tests, including absent and explicit rows and both revenue ownership modes, subject to the revenue exception below.
- `feedback_surveys` retains its Admin-owned writer and default-on semantics (`supabase/migrations/0419_feedback_surveys_switch.sql:20`); exclude it from global and Operator controls. All core keys in D5 and meetings/tasks are always on and rejected by all switch-writing RPCs.
- Migration numbers 0530–0534 are reserved for this lane; check collisions against the target branch immediately before integration. Use numbered down migrations. Test 0137's service-role inventory and `0178_anon_executable_definers.test.sql`; no new anon-executable definer is intended.
- Later slice plans must test failure, unavailable resolution, org changes during a cached query, concurrent limit requests, and duplicate monthly jobs. Never make authorization decisions using impersonated UI state.
- Do not add an Operator toggle to `FEATURE_KEYS_TOGGLEABLE` until the corresponding UI and server gates actually consume the resolved entitlement. `agent_assistant` and `user_views` have separate deployment capability gates (`pmo-portal/src/lib/features.ts:48`); `aiComposer` is an environment subflag, not an entitlement.

## Decisions and open questions

1. Catalogue placement #1719: use the spec's S/G/P/E matrix verbatim as initial data; 0531 is the amendable data migration, not hard-coded UI logic.
2. Basic/full #1720: planning default supplied by Director: `procurement` covers create, approve and track; `procurement_full` covers receipts, three-way match and ERP push. `sales_invoices` covers raise and track; `revenue` covers incoming payments and ageing. Keep the module-to-key mapping data-driven so the owner can amend it.
3. Enterprise seats and AI credits are per contract: represent unspecified as NULL (unlimited seats / no automatic credit grant), and permit the Operator to enter values; Pro/Enterprise active projects NULL means unlimited. No automatic credit grant for NULL avoids inventing an amount.
4. Monthly allowance: default to additive monthly grants, not expiration of prior credits, because the existing pool is an append-only ledger (`supabase/migrations/0067_org_credit_balance.sql:13`). One credit represents $0.005; grant allowance × 0.005 in existing monetary units. Confirm rollover semantics before releasing limits.
5. Revenue compatibility (Director ruling): entitlement is global/override/plan; display additionally follows existing ERP ownership only when the override is absent. This preserves the old FE value but deliberately changes `org_has_feature` for an ERP-owned org with no revenue row. The policy-safe enforcement projection must use entitlement, not display. This is an explicit qualification of FR-PLN-005 and AC-PLN-016 requiring spec reconciliation before S1 ships.

## Interfaces and catalogue

- 0530 creates `plans(id text primary key, name text, seat_limit integer, project_limit integer, ai_monthly_messages integer)`, `plan_features(plan_id text, feature_key text, enabled boolean)`, `org_plans(org_id uuid primary key, plan_id text)`, and `global_features(feature_key text primary key, enabled boolean default true)`; all relevant FKs and unique constraints are explicit. `org_features` remains the override table. An absent org plan resolves Enterprise.
- `resolve_feature_internal(p_org_id uuid,p_key text) returns table(enabled boolean,display_enabled boolean,source text)` is private to the database, stable and shared. `org_has_feature(uuid,text)` keeps its active-member/own-org guard and returns `display_enabled`; `org_feature_enabled(uuid,text)` retains its non-raising RLS contract and returns `enabled` from the same resolver. For revenue only, when no override exists, `display_enabled = enabled AND NOT erp_owns_revenue`; for all other cases it equals enabled. `resolved_org_features()` returns own-org `(feature_key, enabled, display_enabled, source)`; an Operator-only `operator_resolved_org_features(uuid)` returns the selected organisation's result. No unauthenticated execution; service jobs use an explicitly service-only wrapper.
- Global false wins; otherwise an explicit org row wins; otherwise plan row wins. `feedback_surveys` resolves its existing row/default independently; core keys return `(true,'core')`. Reject unknown keys and guard every write RPC; preserve `operator_toggle_feature(uuid,text,boolean)` and add a clear-override RPC.
- In 0531 seed the complete matrix in the spec: all tiers for `timesheets`, `crm`, `procurement`, `sales_invoices`, `incidents`, `import_export`, `agent_assistant`, `feedback_surveys`; Growth+ for `sales_pipeline`, `procurement_full`, `revenue`, `budget_projection`, `imprest`, `user_views`, `m365_integration`, `clickup_sync`; Pro+ for `erp_sync`, `erp_purchases`, `financial_statements`, `management_pack`, `budget_phasing`, `multi_currency`, `stock`, `api_access`; Enterprise only for `sso`. Seed all globals on except the Admin-owned key, and backfill each existing org to Enterprise without replacing any existing override. Seed limits `(10,25,300)`, `(25,100,1500)`, `(50,NULL,5000)`, `(NULL,NULL,NULL)` in S/G/P/E order.
- Use per-org query keys and invalidate after every assignment or switch change; no cross-org shared cached result. The UI holds the route while a result is pending and displays an unavailable/error state on failure.

### Existing callers and revenue boundary

A source search of `pmo-portal`, `supabase/functions`, and migrations found no production call to `org_has_feature` beyond its definition and grants in `supabase/migrations/0070_org_features.sql:54` and `supabase/migrations/0210_service_only_definers_execute_grants.sql:71`; generated types are not calls. Migration history calls `org_feature_enabled` in `supabase/migrations/0097_companies_contacts_erpnext_flip.sql:59`, `0203_rls_active_member_write_composition.sql:173`, `0233_erp_contacts.sql:28`, `0393_procurement_draft_line_authoring.sql:89`, `0406_procurement_atomic_create.sql:24` and `0449_subcontract_po_lines.sql:48`. The 0081 policy rewrite (`supabase/migrations/0081_feature_flag_write_enforcement.sql:145`) maps incidents, CRM, procurement, timesheets and user views; its listed tables do not include a revenue mapping. These are migration-source findings, not a substitute for inspecting the live `pg_policies` and function bodies in S1 tests. Revenue's current FE ownership projection is `pmo-portal/src/hooks/useOrgFeatures.ts:18`.

## S1 — resolution core (0530, 0531, 0532)

> **Director ruling (no upgrade harness):** AC-PLN-016 is proven after migration by inserting fixture orgs
> (absent / explicit on / explicit off rows; ERP-owned and not, for revenue) and comparing the new resolver
> to a reference expression of the old rule written inline in the test (0070's CASE, plus the FE revenue
> ownership rule). Existing orgs are backfilled to Enterprise (all on) with overrides untouched, so that
> equivalence is the whole proof. The spec now carries the receivables exception as FR-PLN-005a.

### Task 1 — registry and compatibility (AC-PLN-016)

**Files:** create `supabase/migrations/0530_plan_registry.sql`, `supabase/migrations/0531_plan_catalogue.sql`, matching files under `supabase/migrations/rollback/`, and `supabase/tests/plans_compatibility.test.sql`.

- [ ] First write a pgTAP fixture with two existing orgs and all existing key rows, including absent/on/off and Admin feedback; capture the pre-migration result before applying migrations in a migration-upgrade harness. Assert the post-migration Enterprise result equals that snapshot. For revenue assert the pre-existing FE ownership rule rather than the old DB result; retain the existing FE environment tests unchanged. Add an ERP-owned, absent-override case proving an otherwise authorized revenue-table write succeeds.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_compatibility.test.sql'`; verify the new registry assertion fails on the old schema. Inspect TAP for `not ok` and `Parse errors`.
- [ ] Create the four tables, indexes, FK constraints, default-deny RLS and explicit service grants in 0530. Populate exactly the matrix and limits above in 0531; preserve existing overrides and the Admin feedback policies. Write reverse SQL in dependency order, preserving pre-existing org rows.
- [ ] Repeat the locked command; every assertion passes and no parse errors occur. Run the migration-upgrade harness as well; a fresh reset alone cannot prove an existing-org upgrade.

### Task 2 — resolution and source (AC-PLN-001, 002, 004)

**Files:** create `supabase/migrations/0532_plan_resolution.sql`, matching rollback, `supabase/tests/plans_resolution.test.sql`.

- [ ] Test global stock off plus override on → false/global; global on plus Starter/no override → false/plan; override on → true/override; no plan → Enterprise; every core key → true/core; any layer's attempt to write a core key → `core_not_gatable`. Test own-org, other-org, inactive and service contexts and both wrapper contracts. For revenue, assert ERP-owned/no override returns false for display but true for policy enforcement, explicit override wins, and global-off defeats override.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_resolution.test.sql'`; observe failing assertions before implementation.
- [ ] Implement the interfaces above and pin `search_path`; preserve `org_feature_enabled`'s non-raising behaviour for policy evaluation (`supabase/migrations/0081_feature_flag_write_enforcement.sql:108`). Add operator RPCs `operator_set_org_plan(uuid,text)`, `operator_set_global_feature(text,boolean)`, `operator_clear_feature_override(uuid,text)` and `operator_set_plan_feature(text,text,boolean)`, plus `operator_set_plan_limits(text,integer,integer,integer)`. Audit actor, time, old and new state in the same transaction. Reject core/feedback keys, unknown keys, invalid limits and nonexistent orgs.
- [ ] Re-run the same locked command and verify all TAP output. Mutation check global precedence and core rejection: invert each condition, confirm the owning tests fail, restore, and re-run green.

### Task 3 — privileges and operator access (AC-PLN-003)

**Files:** `supabase/migrations/0532_plan_resolution.sql`, `supabase/tests/plans_permissions.test.sql`, `supabase/tests/0137_service_role_grants.test.sql`, `supabase/tests/0178_anon_executable_definers.test.sql`.

- [ ] Test direct writes by anon/authenticated/Admin and non-Operator RPC calls fail, active Operator RPC calls succeed, inactive Operator and other-org member reads fail, service role works only through its documented entry point, and Admin feedback writes still work only for its org.
- [ ] Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/plans_permissions.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql'`; verify failures first.
- [ ] Add explicit revoke/grant, RLS and active Operator checks; do not broaden anon-definer allow-list. Grant service role only the privileges required by inventory and service operations; make explicit exceptions in 0137 only where RPC-only writes are required, with tests.
- [ ] Re-run the same command; inspect all TAP, zero failures and parse errors. Mutation-check the Operator guard by bypassing it, show the test fails, then restore.

## S2 — server enforcement (0534): outline

**Goal / AC:** Refuse writes, RPCs, sync and jobs for disabled modules while retaining data (AC-PLN-005). First produce a reviewed catalogue mapping every existing gated key to its table writes, RPCs, edge handlers and job consumers, including service-role paths and the procurement basic/full boundary. The slice's own detailed plan must enumerate each exact path and failing test, introduce the enforcement migration and rollback, and prove both denial and restoration. Include typed `feature_off` and mutation checks. Detailed plan below (migration renumbered 0533→0534: the #1734 follow-ups took 0533).

## S2 — detailed plan (written 2026-11-03 against dev @ a3e54d3bb)

Corrections recorded at planning time:

- S1 is merged to `dev` (0530/0531/0532 shipped). #1734 follow-ups are in flight on
  `fix/1734-switches-s1-followups` and are treated as merged before S2 lands: migration 0533 widens the
  core (never-gatable) key list with `expense_claims`, `roles`, `budgets`, `tasks`
  (`assert_switchable_feature_key`, 0532:17). S2 therefore owns **`0534_feature_enforcement.sql`**; the
  S5 outline's `0534_plan_limits.sql` renumbers to the next free number when S5 is planned.
- The `org_features` CHECK registry already accepts every catalogue key (0531:5-15), so overrides are
  storable for all keys today; the FE registry test (`pmo-portal/src/lib/features.dbRegistry.test.ts`)
  reads the CHECK from the latest migration, and 0534 must not break that equivalence.
- `service_role` bypasses RLS (`rolbypassrls`; stated in 0173_project_create_origination_sod.sql:45),
  so table conjuncts gate client roles only — every service path self-gates in code (§Jobs and edges).

### S2.0 — Inventory per switch key (shipped code; "gate" = enforcement that exists today)

Gate legend — **RLS** = `org_feature_enabled` conjoined onto write policies by 0081's DO block
(0081:135-214; the feature→tables map is commented at 0081:44-62 and executed at 0081:149-190);
**RPC** = an explicit `org_feature_enabled` check inside the definer body. "—" = nothing yet; 0534 adds it.

| Key | Tables (creation site) | Write RPCs (latest definition) | Outbox/sync jobs | Edge functions | Gate today |
|---|---|---|---|---|---|
| `incidents` | incident_reports (0001:228) | none — direct PostgREST writes only (only guard: check_incident_reports_project_org trigger, 0043:38) | — | — | RLS (0081; policy set re-stated 0203:173) |
| `timesheets` | timesheets (0001:177), timesheet_entries (0001:193) | transition_timesheet (0007:51 → 0161:39 → 0516:268) | insert_timesheet_outbox_pending (0161:232, service-only), witness 0161:206, mirror hold 0162:45; inbound kinds `timesheet`+`employee` (feedKinds.ts:35-40); erpnext-sweep pass 6 (erpnext-sweep/index.ts:41-42) | adapter-dispatch (served push) | RLS (0081); RPC — |
| `crm` | companies (0001:40), contacts (0030:14), crm_activities (0030:45) | contacts_native_mirror_guard (0233:5) | inbound kinds `supplier`/`customer`/`contact` → `companies` domain (feedKinds.ts:28-30); erpnext-sweep pass 1 | erpnext-onboard (writes companies as service, erpnext-onboard/index.ts:110) | RLS (0081, re-stated 0097:59-140); RPC (0233:28) |
| `sales_pipeline` | none — projection over projects (get_sales_pipeline, 0020 → latest 0261_pipeline_hides_archived.sql:4) | transition_project (0461_lost_reason.sql:25) into pipeline-open statuses | — | — | — (OQ-3) |
| `procurement` | procurements (0001:92), procurement_items (0001:111), procurement_quotations (0001:123), procurement_documents (0001:138), procurement_invoices (0006:47), file tables (0028:20/78, 0036:21/56/85/114), purchase_requests/rfqs/purchase_orders/payments (0035:37/50/63/76), purchase_order_lines/revisions (0449:115/130), po_variations+lines (0474:27), subcontract_acceptances+lines (0470:18), procurement_invoice_lines (0472:20), procurement_create_intents (0406:2), procurement_import_runs (0399:2), procurement_erp_links (0360:75), vendor_withholding_slips+bills (0281:17) | create_procurement_with_items (0406:38), update_procurement_header (0393:158), procurement_item_values_editable (0393:83), transition_procurement (0362:154), create_procurement_quotation (0180:293), create_procurement_invoice (0481:75), create_payment (0481:132), guards 0449:148/177 | insert_procurement_outbox_pending (0393:114, service-only); native mirror guards 0481:192/222/261; inbound kinds purchase-* → `procurement` domain (feedKinds.ts:21-27) | adapter-dispatch | RLS (0081); RPC (0393:89, 0406:24, 0449:48); newer tables + the 0481 RPCs — |
| `procurement_full` | procurement_receipts (0006:36), procurement_receipt_files (0028:52) | create_procurement_receipt (0481:36) | ERP push of receipt commands (`goods-receipt` kind, adapter-dispatch/index.ts:250) | adapter-dispatch | wrongly RLS-gated as `procurement` (0081 map :54) — **re-boundary** to `procurement_full` in 0534 |
| `sales_invoices` | sales_invoices (0123:17), sales_invoice_authors (0132:57), sales_invoice_submit_authorizations (0132:103), progress_claims+lines+evidence (0250:259/293/519), progress_assessment_quantities (0250:112), boq_items (0250:40), views work_order_billing/work_order_billing_lines/sales_invoice_work_billed (0262:63/39, 0250:690 — no client writes), contract_rate_lines+assignees (0515:4), tm_claims+lines+sources (0516:6, select-only policies 0516:71-86) | create_native_sales_invoice (0275:189), transition_native_sales_invoice (0275:316), submit_sales_invoice (0275:561), claim_sales_invoice_author (0275:592), set_sales_invoice_received_date (0275:692), create_progress_claim (0347:2), record_progress_assessment (0337:498), assemble_tm_claim (0516:138), deselect_tm_source (0516:230) | sales-invoice ERP kind → `revenue` domain push (feedKinds.ts:32; see OQ-2 for the key split) | — | — (mirror guards 0125:14 fire only inside the gated writes) |
| `revenue` | incoming_payments (0123:41), erp_payment_ledger_mirror (0101:58, service-written) | record_native_receipt (0275:394), cancel_native_receipt (0275:482), native_revenue_doc_number (0275:122) | inbound kinds `sales-invoice`/`incoming-payment` → `revenue` domain (feedKinds.ts:32-33); erpnext-sweep pass 1 | external-invoice-pdf/-evidence (ERP console reads) | — (0081's map, 0081:50-58, lists no revenue table) |
| `budget_projection` | budget_projections (0137:104) | direct table writes under budget_projections_write (0137:144-151); read RPC get_budget_projection (0149) stays open | never pushed to ERP (0137:13) | — | — |
| `imprest` | imprest_plans (0422:300), imprest_plan_lines (0422), imprest_floats (0422:99), imprest_float_changes (0422), imprest_replenishments (0422:134), imprest_cash_counts (0424:22), imprest_posting_erp_mirror (0425:22), org_imprest_settings (0422:63) | establish_imprest_float (0422:188), decide_imprest_float_change (0422:251), transition_imprest_plan (0422:418), imprest_lock_float (0422:56), set_imprest_procurement_limit (0422:77), request_imprest_replenishment (0423:404), transition_imprest_replenishment (0423:452), record_imprest_count (0424:58) | enqueue_imprest_replenishment_posting (0425:91) → `expenses` domain kind `imprest-transfer` (feedKinds.ts:45-49) | imprest-cash-account (service write into imprest_floats, imprest-cash-account/index.ts:109) | — (AC-PLN-005's owning path) |
| `user_views` | user_views (0045:18) | PostgREST CRUD (0045:42-59) | — | compose-view (AI composer for views) | RLS (0081); edge — |
| `m365_integration` | ms_graph_connections (0106:15), m365_pkce_states (0108) | insert path is the definer lock-order RPC (0115:67), m365_delete_connection (0116:42), m365_link_record_folder (0338:31), link_m365_documents_batch (0375:12), m365_record_folder_sweep_save (0375:125) | m365-pkce-sweep cron (0112:31) — hygiene only, never gated | m365-token-custody; document-linking flows | disentitle cascade trigger (0113:144) + 0178_m365_member_gate.test.sql; link RPCs — |
| `clickup_sync` | none own — clickup_webhook_inbox (0143:24) is service-written raw input | — (tasks table is core) | clickup-sweep-tick (0094:46 → cron 0094:71), clickup-webhook-worker-tick (0143:58 → 0143:82) | clickup-webhook/-worker/-sweep/-onboard (write `tasks` as service, clickup-onboard/index.ts:283) | — (jobs only; `tasks` stays core) |
| `erp_sync` | seam: external_domain_ownership (0087:13), external_sync_watermarks (0089:7), external_command_outbox (0096:47), external_refs/-lineage/-master_records/-bindings/-project_bindings, erp_account_mirror/erp_actuals_snapshot (0101), budget_version_erp_mirror/budget_push_mirror_rows (0137), erp_sweep_lock/full_run, erp_connect_runs/staged/census/proposals (0480:11-48) | connect/apply RPCs are service-called (apply_connect_outcome 0480:404) | erpnext-sweep-tick (0102:46 → every minute 0356:14), odoo-sweep-tick (0421:154 → 0421:169) | erpnext/odoo onboard+webhook+sweep, external-connect/-link/-unlink/-set-company/-lists/-items/-companies/-invoice-* | tier-ownership checks only (erpnext-sweep/index.ts:390-443); entitlement — |
| `erp_purchases` | erp_purchase_documents (0335:9), erp_purchase_document_marks (0335), views erp_purchase_documents_linked / erp_purchase_orphans* | none — service-written, select policy only (0335:42) | erpnext-sweep purchases pass | — | — (read stays open; job gates, OQ-5) |
| `financial_statements` | erp_financial_statement_snapshot (0316:3), _dirty_date, _published_context, _report_batch, _report_pending (0316/0321), availability view (0390) | statement refresh batch writers (0321:268/273, definer, sweep-called) | erpnext-sweep statement handler (statementHandlerCadence.test.ts) | — | — (read RPC get_financial_statement 0321:1126 stays open, OQ-5) |
| `management_pack` | project_progress_entries (0245:9) | record_project_progress (0245:98) | — | — | — |
| `budget_phasing` | none shipped | none | — | — | registry-only (OQ-6) |
| `multi_currency` | fx_rates (0291:2) | direct update under fx_rates_update (0291:28) | — | — | — |
| `stock` | stock_items/units/warehouses/keepers (0412:37/26/51/64), stock_documents/lines/ledger/balances (0413:12/49/68/94), stock_reorder_levels (0418:4) | create/save/post/cancel_stock_document (0413:442/481/507/515, latest save 0416:81), set_stock_reorder_level (0418:23), set_stock_warehouse_keeper (0412:161); master data written direct under stock_master_writer() role predicate (0412:14) | inbound `goods-receipt` belongs to `procurement`, not stock (feedKinds.ts:22) | — | — |
| `api_access` | none shipped | none | — | — | registry-only (OQ-6) |
| `sso` | none shipped | none | — | — | registry-only (OQ-6) |
| `import_export` | none own (action key; 0081:64-66 reasoning stands) | import_budget_line_v2 (0397:36), start_procurement_import_run (0407:30), normalize_procurement_import_refs (0399:47), lookup_procurement_import_cases (0399:62), import_project_stage_history (0448:254) | — | — | — |
| `agent_assistant` | agent_threads/runs/events (0046:41/53/68), agent_usage (0047:19), agent_automation_fires (0078:15) — owner-scoped; 0081:69-72 skip note stands | — | agent-dispatch-tick (0082:32 → cron 0082:56) | agent-chat, agent-dispatch | — (edge/tick gates only) |
| `feedback_surveys` | feedback_surveys (0419) | admin_set_feedback_surveys (0419:29) | — | — | **excluded** — Admin-owned writer, out of switch controls (constraint; resolver branch 0532:53-64) |

Core (never gated; 0533 list): projects, dashboard, approvals, administration, expense_claims
(expense_claims 0247:48 + lines/files/advance_returns + enqueue_expense_posting 0270:187 and its two
triggers 0270:200/230 — the `expenses` domain minus `imprest-transfer` must never hold), roles,
budgets (budget_versions 0001:151 + line items + archive/intent tables + the `budget` push domain —
ERP receives a copy; PMO-side budget writes are core), tasks (tasks 0001:206 — ClickUp sync gates the
sync, not the table), meetings (0205:30).

### Jobs and edges — the exact hold semantics

Enforcement applies at **enqueue and pass start**, never mid-flight:

1. **Outbox enqueue gates** — insert_timesheet_outbox_pending (0161:232),
   insert_procurement_outbox_pending (0393:114) and the definer triggers that call them gain an
   entitlement check on their module key: a `feature_off` org never mints new commands.
2. **Sweep pass start, per org per domain** — if the domain's key resolves off, that org's outbox
   candidates for the domain take the existing domain-not-owned treatment: `held` for an operator with
   reason `feature-off:<key>` (mechanics precedent erpnext-sweep/index.ts:442); the inbound watermark
   (0089:7) is untouched, so the feed resumes exactly where it stopped on re-enable. Budget pass 5,
   timesheets pass 6 and expenses pass 7 re-assert their own gates (erpnext-sweep/index.ts:41-42).
3. **Edge function precondition** — per-module functions check `service_feature_enabled` first and
   return the typed refusal (HTTP 409, error code `feature_off`), before any ERP call.

**Service-role paths that must NOT be blocked (why, per path):**

- `claim_outbox_for_commit` / `confirm_outbox` / `quarantine_committing` (0096:137/233/164),
  `record_outbox_ref` (0096:210) and `release_outbox_hold` (0156:47): a command already claimed must
  reach a terminal state or a real ERP document strands mid-flight — the `held`/double-pay machinery
  (0096:56-61) exists because half-blocked money commands are worse than paused ones.
- Timesheet push finalize/witness paths (0161:206-306, 0164-0166): same terminal-state rule for
  already-minted sheet pushes.
- Core `expenses` postings (0270:187-242): expense claims are core (0533); only the `imprest-transfer`
  kind holds when `imprest` is off (feedKinds.ts:45-49 keeps it in the same domain on purpose — the
  split is per kind, never per domain, for this pass).
- Hygiene jobs never module-gated: m365_pkce_sweep_tick (0112:31) only clears abandoned PKCE states;
  error-events-purge (0171:53); telegram_notify_tick (0083:29) only drains an existing queue;
  ops_job_heartbeats. Blocking these manages hygiene, not entitlement.
- Native mirror guards (0123:117/146, 0481:192/222/261, 0099:136) fire inside client writes that are
  themselves gated — they must not gain their own refusal or the gated write becomes ambiguous.
- `feedback_surveys` Admin writer (0419:29) and every Operator switch RPC (0532:237-410): switching
  features must work regardless of the state being switched.
- Disconnect/unlink paths (`external-unlink`, `m365_delete_connection` 0116:42): an off feature must
  still be tearable-down; only new links refuse.

### Enforcement mechanics (0534 contents)

- **`assert_feature_on(p_org_id uuid, p_key text)`** — plpgsql security-definer helper, pinned
  search_path; raises `feature_off` with errcode P0001 unless `org_feature_enabled(p_org_id,p_key)` is
  true (the non-raising wrapper stays the RLS-side hook, 0532:127; the raising helper is the RPC-side
  twin). Revoked from public/anon/authenticated/service_role — callable only inside definers, so the
  0178 anon-executable allow-list is unchanged. Reads entitlement (`enabled`), never `display_enabled`
  — FR-PLN-005a keeps revenue's ERP-ownership rule display-only (resolver split, 0532:118-126).
- **`service_feature_enabled(p_org_id uuid, p_key text) returns boolean`** — service-only twin of
  `service_resolved_org_features` (0532:193-215): same `auth.role()` guard, non-raising, false on
  unknown org (fail closed). Sweeps and edge functions call this; cheap enough for hot loops.
- **RLS conjunct DO block** — mirrors 0081's mechanics exactly (read live pg_policies so the 0063
  is_active_member append survives; paren-wrap before AND-ing; preserve permissive/cmd; write commands
  only, 0081:135-214), over the **new** gated tables listed in S2.0. Idempotence guard: skip any
  policy whose qual/with_check already contains `org_feature_enabled`. Grant/permission surfaces are
  untouched, so 0137's service-grant inventory is unaffected.
- **Re-boundary — DEFERRED (Director ruling, 2026-11-03).** Receipts stay gated on `procurement`
  exactly as today; this slice does not move `procurement_receipts` / `procurement_receipt_files` (nor
  `create_procurement_receipt`) to `procurement_full`. Owner sign-off (#1720) and a live-org check come
  first. The original intent is kept below for that follow-up.
- **Re-boundary (deferred)** — procurement_receipts + procurement_receipt_files write policies switch their
  conjunct from `procurement` to `procurement_full` (targeted rebuild that first asserts the old
  conjunct text is present), and create_procurement_receipt (0481:36) checks `procurement_full`.
  Existing orgs are Enterprise (both keys on) so AC-PLN-016 compatibility is unaffected.
- **AND rule for ERP flows** — a domain's push/poll requires `erp_sync` AND the domain's module key
  (constraints: capability gates AND entitlement; entitlement never grants capability).
- **Import RPCs** get `import_export` ANDed with their entity's own key (budget import rides the core
  budgets key, so `import_export` alone there).

### Tasks (TDD — red first; each 2–5 min; run supabase from repo root)

1. **Red pgTAP** — create `supabase/tests/plans_feature_enforcement.test.sql` (house style:
   begin/plan/finish/rollback, namespaced `0534…` UUID fixtures, `set local role authenticated`):
   fixture org A on `starter` (plan-level off: procurement_full, revenue, budget_projection, imprest,
   stock, erp_sync/erp_purchases, financial_statements, management_pack, multi_currency, sso,
   api_access, clickup_sync, sales_pipeline, m365_integration, import_export all off by matrix) and
   org B on `enterprise`; plus override-level off rows for timesheets and agent_assistant. Assert
   `throws_ok(...'P0001', 'feature_off')` for: establish_imprest_float (AC-PLN-005),
   create_procurement_receipt (re-boundary: passes today under `procurement` — the red that proves the
   change), transition_timesheet, create_native_sales_invoice, record_native_receipt,
   create_stock_document, an fx_rates update, a budget_projections insert, record_project_progress,
   import_budget_line_v2, assemble_tm_claim. Then data-kept (FR-PLN-007): rows written while on stay
   readable after off (read policies untouched), and after re-enable the same org writes again
   successfully. Run `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db
   supabase/tests/plans_feature_enforcement.test.sql'` — every new assertion fails on the current
   schema; grep TAP for `not ok` and `Parse errors`.
2. **0534 §A helpers** — `0534_feature_enforcement.sql` adds assert_feature_on +
   service_feature_enabled (grants/revokes per above); create
   `supabase/migrations/rollback/0534_feature_enforcement_down.sql` skeleton. Re-run task 1's command —
   still red (helpers alone enforce nothing).
3. **0534 §B RLS conjuncts** — the DO block over the new tables (revenue, imprest, stock,
   budget_projections, project_progress_entries, fx_rates, incoming_payments, sales-invoice family
   tables that have client write policies; newer procurement tables without policies no-op safely).
   Re-run: the direct-insert assertions go green; RPC assertions stay red.
4. **0534 §C1 revenue/sales_invoices RPC gates** — 0275:189/316/394/482/561/592/692 + 0347:2 +
   0337:498 + 0516:138/230 gain `perform public.assert_feature_on(v_org,'<key>')` right after the org
   is resolved (receipts → `revenue`; invoice/claim/progress paths → `sales_invoices`; OQ-1/OQ-2).
   Re-run: revenue/sales_invoices cases green.
5. **0534 §C2 imprest family** — 0422:56/77/188/251/418, 0423:404/452, 0424:58 gated on `imprest`.
   AC-PLN-005's case goes green.
6. **0534 §C3 stock family** — 0413:442/481/507/515, 0418:23, 0412:161 on `stock`.
7. **0534 §C4 procurement re-boundary + remaining RPC gates** — receipts conjunct rebuild +
   0481:36 on `procurement_full`; 0481:75/132, 0180:293, 0362:154 on `procurement` (where not already
   gated). Re-run: full file green through here.
8. **0534 §C5 timesheets/m365/management-pack** — 0516:268 on `timesheets`; 0338:31, 0375:12/125 gain
   the `m365_integration` check on link/batch (0116:42 delete stays ungated); 0245:98 on
   `management_pack`.
9. **0534 §C6 import RPCs** — 0397:36, 0407:30, 0399:47/62, 0448:254 gain
   `assert_feature_on(org,'import_export')` ANDed with the entity key where one exists.
10. **Red deno tests for job/edge gates** — per touched function: erpnext-sweep (hold on
    entitlement-off domain, resume on re-enable, expenses/imprest kind split), odoo-sweep, clickup
    sweep/webhook-worker, agent_dispatch_tick gating (pgTAP side: call as superuser with
    agent_assistant off, assert no fire), m365-token-custody, imprest-cash-account, compose-view,
    agent-chat precondition, external-connect/onboard. Tests import the shipped handler
    (check-edge-fn-test-binding) and mock globalThis.fetch. Observe red.
11. **Implement the job/edge gates** — sweep pass-start entitlement check producing the
    `feature-off:<key>` hold; edge preconditions returning `feature_off`; agent_dispatch_tick and
    clickup ticks skip gated orgs. Deno tests green.
12. **Mutation checks** (each: break → the owning test goes red → restore → green): invert
    global-off precedence in assert_feature_on; drop the receipts re-boundary; make
    service_feature_enabled return true unconditionally; bypass the sweep hold for one domain.
13. **Full battery** — verify commands below, incl. sibling suites (0137, 0138, 0178 both,
    plans_resolution, plans_compatibility, 0178_m365_member_gate) and the FE registry test; no new
    tables ship, so the isolation-denominator manifest is untouched (assert via
    `node scripts/check-isolation-denominator.mjs --self-test`).

### Rollback

`supabase/migrations/rollback/0534_feature_enforcement_down.sql`: drop the two helpers; inverse DO
block stripping exactly the appended conjunct text (the migration's own appended string is a constant,
so the reverse matches on it verbatim); rebuild the receipts conjuncts back to `procurement`;
`notify pgrst, 'reload schema'`. As with 0081, the canonical pre-production reverse remains
`supabase db reset` (ADR-0006).

### Verify (exact commands)

From repo root, one DB-lock hold (reset+test MUST share one hold):

```
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db \
  supabase/tests/plans_feature_enforcement.test.sql \
  supabase/tests/0137_service_role_grants.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql \
  supabase/tests/0138_feature_flag_write_enforcement.test.sql \
  supabase/tests/plans_resolution.test.sql \
  supabase/tests/plans_compatibility.test.sql'
```

Inspect TAP for `not ok` and `Parse errors` (an aborted file reports 0 tests and looks green).
Edge functions: `scripts/deno-test-edge-fns.sh` for every touched function (agent-chat, compose-view,
m365-token-custody, imprest-cash-account, external-connect, erpnext-onboard, clickup-onboard,
clickup-webhook, clickup-webhook-worker, clickup-sweep, erpnext-sweep, odoo-sweep, adapter-dispatch).
FE (untouched by 0534, run to prove it): `scripts/with-test-lock.sh npx vitest run
pmo-portal/src/lib/features.dbRegistry.test.ts`. If any `.ts`/`.tsx` outside `supabase/functions`
changes: `npm run check:guards`, `scripts/with-test-lock.sh npm run typecheck`, eslint
`--max-warnings=0` on touched files. Agent prompt/tool changes would require the local eval harness —
S2 changes none.

### AC → test

| AC | Owning proof |
|---|---|
| AC-PLN-005 (imprest off refuses; data kept; re-enable restores) | `supabase/tests/plans_feature_enforcement.test.sql` |
| FR-PLN-006 refusal matrix (per-key write/RPC rows) | same file, one named assertion per S2.0 row |
| FR-PLN-007 data kept + restore | same file (read-policy invariance + re-enable writes) |
| FR-PLN-005a (revenue keys on entitlement, display rule untouched) | `plans_resolution.test.sql` (owns the resolver split) + the revenue refusal rows |
| Job hold/resume + kind split | erpnext-sweep deno tests (`erpnext-sweep/*.test.ts`) |
| Edge preconditions | each function's `index.test.ts` |
| agent automations gate | pgTAP case in `plans_feature_enforcement.test.sql` (tick call as superuser) |

### Open questions (each with a default so no task blocks)

1. **tm_claims attribution** — `assemble_tm_claim`/`deselect_tm_source` (0516:138/230) assemble
   billable time into client claims. Default: gate on `sales_invoices` (client-billing surface); the
   module→key mapping stays data-driven so the owner can amend (decision #2).
2. **revenue ↔ sales_invoices coupling** — a receipt (revenue) can reference an invoice
   (sales_invoices). Default: receipts gate on `revenue` alone; the invoice link stays data; no
   cross-key conjunct (the catalogue gives every tier `sales_invoices`, so shipped tiers never hit the
   split mid-flow).
3. **sales_pipeline write boundary** — projects are core, so 0534 gates only `transition_project`
   (0461:25) when `p_to` is a pipeline-open status, via a shared immutable status-list helper
   extracted next to get_sales_pipeline (0261:4) so RPC and read never drift. Default: that helper;
   reads stay open (0081 SELECT invariant).
4. **Hold vs skip for entitlement-off domains** — Default: `held` with reason `feature-off:<key>`
   reusing the domain-not-owned machinery (erpnext-sweep/index.ts:442): visible to ops, auto-resumes
   on re-enable, never silently drops a pending command.
5. **Server read-gating of disabled modules** — FR-PLN-006 enumerates writes/RPCs/jobs/edges; 0081's
   SELECT invariant deliberately never gates reads. Default: reads stay open in S2
   (get_financial_statement 0321:1126, get_sales_pipeline, erp purchase reads 0335:42); S3 hides
   nav/routes; server-side read refusal is a follow-up only if the owner asks.
6. **api_access / sso / budget_phasing** — no shipped surface (S2.0). Default: registry-only keys in
   S2; enforcement lands with their surfaces, and FR-PLN-014's completeness gate (S6) fails any future
   module that forgets its key.
7. **agent_assistant automation tick granularity** — Default: agent_dispatch_tick (0082:32) skips
   orgs whose `agent_assistant` resolves off (enqueue-side gate); telegram_notify_tick stays ungated
   (it only drains already-queued notifications).

## S3 — FE and console: outline

**Goal / AC:** Use the database effective projection for navigation and routes; present the Operator console and read-only Admin page (AC-PLN-008, 012, 013). First inventory route/nav gates, current deployment capability gates, repository APIs, actual test paths and translations. The slice's detailed plan must test loading, failure, invalidation, org changes and the current Admin feedback path. `agent_assistant` and `user_views` keep deployment kill switches as an additional AND. Run rendered review and UX proof.

## S3 — detailed plan (written 2026-11-03 against dev @ f10eeb699)

**Goal:** the app resolves every switch from the database projection, the Operator console drives
the whole registry, and an org Admin reads their plan — without any FE copy of the precedence order.

### S3.0 — Inventory (shipped code; the list this slice must satisfy)

**Resolution seam today.** `useOrgFeatures` (`src/hooks/useOrgFeatures.ts`) reads the
`org_features` TABLE and re-implements the revenue display rule in the FE (`useRevenueMode() ===
'native'`, OD-NAR-2). After 0532/0533 the DB owns that rule (`display_enabled`), so the FE copy is
deleted and the hook reads `resolved_org_features()` — ONE call, own org, per-org query key.

**Rail nav gates** (`src/components/shell/Rail.tsx` ALL_ITEMS; "was" = today's key):

| Rail item | Route | Was | S3 key |
|---|---|---|---|
| Sales Pipeline | `/sales` | `crm` | `sales_pipeline` |
| Procurement | `/procurement` | `procurement` | `procurement` |
| Stock | `/stock` | — (ungated) | `stock` |
| Timesheets | `/timesheets` | `timesheets` | `timesheets` |
| Site cash | `/imprest` | — | `imprest` |
| Companies / Contacts | `/companies`, `/contacts` | `crm` | `crm` |
| Suppliers (only without CRM) | `/companies?type=Vendor` | `unlessFeature: crm` | `unlessFeature: crm` |
| Incidents | `/incidents` | `incidents` | `incidents` |
| Receivables | `/finance/receivables` | `revenue` | `revenue` |
| Payables | `/finance/payables` | `procurement` | `procurement` |
| Reports | `/finance/reports` | `revenue` | `management_pack` |
| Statements | `/finance/statements` | — | `financial_statements` |
| My Views group | `/views/*` | env `userViews` only | `user_views` **AND** env `VITE_FEATURES_USERVIEWS` |
| Assistant toggle | ⌘J panel | env `agentAssistant` only | `agent_assistant` **AND** env `VITE_FEATURES_AGENT_ASSISTANT` |
| Dashboard, Projects, Equipment, Expenses, Approvals, Meetings, My Tasks, Finance hub, Administration | … | — | none: core (D5 + `core_feature_keys()`; equipment/meetings are not in the catalogue) |

**Route gates** (`src/App.tsx` appRouteConfig; today only incidents/revenue/procurement/user_views
are wrapped):

| Route(s) | S3 key |
|---|---|
| `/sales`, `/sales/:opportunityId` | `sales_pipeline` |
| `/procurement`, `/procurement/new`, `/procurement/:procurementId`, `…/:tab` | `procurement` |
| `/timesheets` | `timesheets` |
| `/companies`, `/companies/:companyId`, `/contacts`, `/contacts/:contactId` | `crm` |
| `/incidents`, `/incidents/:incidentId` | `incidents` |
| `/imprest`, `/imprest/:floatId` | `imprest` |
| `/stock`, `/stock/setup`, `/stock/documents`, `…/:documentId`, `…/edit`, `/stock/ledger`, `/stock/reorder`, `/stock/new/:kind` | `stock` |
| `/sales-invoices/:invoiceId` (legacy detail deep link) | `sales_invoices` |
| `/finance/receivables` | `revenue` |
| `/finance/payables` | `procurement` |
| `/finance/reports` | `management_pack` |
| `/finance/statements` | `financial_statements` |
| `/erp-purchases` | `erp_purchases` |
| `/views`, `/views/new`, `/views/:viewId/edit`, `/views/:viewId` | `user_views` (+ env AND) |
| `/administration/exchange-rates` (Admin section) | `multi_currency` |
| `/administration/*` (other sections), `/finance`, `/settings/profile`, `/reports` (redirect), `/sales-invoices` + `/incoming-payments` + `/revenue-by-project` (redirects) | none: core / redirect-only |

**Explicit non-gates, stated so they are decisions and not omissions:**

- `/integrations` (personal M365 connect) stays routable. It is the token-custody callback target and
  the only teardown surface; S2's rule is that an off feature must still be disconnectable
  (S2 detailed plan §"Service-role paths"), and the AccountMenu entry that leads to it already hides
  when `m365_integration` is false.
- `feedback_surveys` keeps its Admin-owned switch (`FeedbackSurveysSetting`, `admin_set_feedback_surveys`,
  migration 0419). It is excluded from the Operator console's override/plan controls and shown
  read-only there as "Admin-owned".
- `m365_integration`, `erp_sync`, `clickup_sync`, `import_export`, `api_access`, `sso`,
  `budget_phasing`, `budget_projection` have no nav item or route of their own today (S2.0
  inventory); they are driven from inside pages, so S3 gates no route for them. `budget_projection`
  ships a page component with no route (`pages/BudgetProjection.tsx` is reachable only from a
  project tab), so it is out of the route inventory on purpose.
- `aiComposer` (`VITE_FEATURES_AI_COMPOSER`) is an environment sub-flag, never an entitlement
  (constraints §; plan S1 note). It keeps its existing AND with `user_views` at its call sites.

**Deployment gates stay an additional AND.** `agent_assistant` and `user_views` resolve as
`db.enabled && envFlag`, implemented in ONE place (`useFeature`), so no caller can forget the AND.

**Operator page today.** `/administration/features` renders `pages/AdministrationFeatures.tsx` with
`isOperator` from the settled `useOperatorMembership()` (real JWT, never the preview role) and
`orgId` = the caller's own org. There is no org picker, no plan picker, and the toggle list is
driven by `FEATURE_KEYS_TOGGLEABLE` (six keys). `FeedbackSurveysSetting` is mounted from
`/administration/integrations`, unchanged.

**Unreadable today (the reason for 0537).** `plans`, `plan_features`, `org_plans` and
`global_features` revoke every API role (0530) and no read projection exists — so plan names,
limits, plan defaults, the all-orgs column and an org's assigned plan are all unreadable by the
console and by the Admin page. 0537 adds the three read-only projections (see Interfaces).

### S3.1 — Interfaces (migration 0537, read-only)

`supabase/migrations/0537_plan_read_projections.sql` + `rollback/0537_plan_read_projections_down.sql`:

- `operator_plan_catalogue()` → `(plan_id, plan_name, seat_limit, project_limit, ai_monthly_messages,
  feature_key, feature_enabled, global_enabled)`, one row per (plan, feature_key) ordered by plan
  then key. `stable security definer`, pinned `search_path = public`, guarded by
  `is_active_member()` + `is_operator()`; revoked from public/anon/service_role, granted to
  authenticated. Read-only (no write text) so 0178's write-text sweep is unaffected and its
  allow-list/count stay untouched.
- `operator_org_plan(p_org_id uuid)` → `text`: the org's stored plan id, `null` when unassigned
  (the resolver treats null as Enterprise). `unknown_org` (`23503`) for a missing org; same guard
  and grants.
- `resolved_org_plan()` → `(plan_id text, plan_name text, seat_limit integer, project_limit integer,
  ai_monthly_messages integer)` for the caller's own org only (`auth_org_id()`), active member
  required, null/absent assignment resolves to the Enterprise row. Signature is FROZEN: S4 consumes
  it. Same definer/search_path/grant rules.

**FE repository API** (`src/lib/repositories/contracts/admin.ts` → `OrgFeatureRepository`; DAL
`src/lib/db/orgFeatures.ts`; both re-exported through `repositories`):

| Method | RPC | Returns |
|---|---|---|
| `listOwn()` | `resolved_org_features()` | `{ display: Record<key,boolean>, states: Record<key,{enabled,displayEnabled,source}> }` |
| `listForOrg(orgId)` | `operator_resolved_org_features(uuid)` | same shape, selected org |
| `getPlanCatalogue()` | `operator_plan_catalogue()` | `{ plans: PlanRow[], defaults: Record<planId, Record<key,boolean>>, global: Record<key,boolean> }` |
| `getOrgPlan(orgId)` | `operator_org_plan(uuid)` | `string \| null` |
| `getOwnPlan()` | `resolved_org_plan()` | `PlanRow \| null` |
| `toggle({orgId,key,enabled})` | `operator_toggle_feature` | void (override set) |
| `clearOverride({orgId,key})` | `operator_clear_feature_override` | void |
| `setOrgPlan({orgId,planId})` | `operator_set_org_plan` | void |
| `setGlobal({key,enabled})` | `operator_set_global_feature` | void |
| `setPlanFeature({planId,key,enabled})` | `operator_set_plan_feature` | void |
| `setPlanLimits({planId,seatLimit,projectLimit,aiMonthlyMessages})` | `operator_set_plan_limits` | void |
| `setFeedbackSurveys(enabled)` | `admin_set_feedback_surveys` | unchanged |

Query keys (`src/hooks/useOrgFeatures.ts`): own `['orgFeatures','own',orgId]`, operator
`['orgFeatures','operator',orgId]`, `['planCatalogue']`, `['orgPlan',orgId]`,
`['operator','orgs']`; every mutation invalidates the `['orgFeatures']`, `['planCatalogue']` and
`['orgPlan']` prefixes. No cross-org shared cache.

**Generated types.** `src/lib/supabase/database.types.ts` predates S1 (it has no
`resolved_org_features`), so 0537's three functions, S1's three projections and the five S1 Operator
writers are added by hand in the generator's shape. The authoritative regen needs a database with
0537 applied, which is the lane's DB slot (heavy-load rule), not this worker's.

### S3.2 — UI

- `src/components/FeatureRoute.tsx` + new `src/components/FeatureUnavailable.tsx`: **off** renders
  the not-available state (AC-PLN-008; replaces today's redirect, kept honest by a link home);
  **loading** renders null (existing hold); **error** renders the unavailable state with a Retry,
  and never claims "not on your plan" while the answer is unknown.
- `pages/AdministrationFeatures.tsx`: Operator console — org picker (`operator_list_orgs`), plan
  picker (with the selected org's plan limits spelled out in its helper line), per-key effective state
  with source pill (global / override / plan / core), override switch + Clear, plan default for the
  selected org's plan, all-orgs switch (confirm before turning a global switch OFF), and a
  plan-defaults + limits editor (seats / active projects / AI messages per month; blank =
  unlimited / per contract). Admin-owned `feedback_surveys` and the core keys render read-only.
  Non-Operator renders the own-org read-only list (unchanged behaviour). A per-plan organisation count
  is deliberately NOT shown: the catalogue read does not carry one, and inventing it client-side
  would need a second cross-org read for decoration.
- `pages/YourPlan.tsx` (AC-PLN-013): read-only plan name, switches on, limits with usage shown as
  "Not tracked yet" until S5, no editable control. Mounted as the `plan` section of Administration
  (`/administration/plan`) for Admin/Executive viewers and Operators.
- Every Operator control is gated on the settled `useOperatorMembership()` projection (real JWT),
  the Admin page on `can('view','user')` — both clarity projections, with the RPC as the authority.

**Translation keys** (namespace `administration`, en + id, referenced only through literal `t()`):
`plan.*` (title, intro, planLabel, unlimited, perContract, notTrackedYet, usageHeading, limits.*,
switches.*, adminOwned, coreAlwaysOn, noPlan), `console.*` (title, organisation, selectOrganisation,
plan, selectPlan, orgsOnPlan, saving, saved, retry, loadFailed, effective, source, sourceGlobal,
sourceOverride, sourcePlan, sourceCore, override, clearOverride, cleared, planDefault, allOrgs,
globalConfirmTitle, globalConfirmBody, globalConfirmAction, planDefaults, planLimits, seats,
activeProjects, aiMessages, save, inheritedFromGlobal, adminOwnedRow, coreHeading),
`featureUnavailable.*` (title, body, retry, home). All in `public/locales/{en,id}/administration.json`.

### S3.3 — Tasks (TDD; each 2–5 min; FE gates only — no DB run in this lane)

1. **Red — resolution seam** (`src/auth/__tests__/useFeature.test.tsx`, AC-PLN-008): assert
   `resolved_org_features` is the ONLY read, `display_enabled` drives the answer, `enabled`
   false/`display_enabled` true and the reverse both behave as specified, core keys never query,
   `agent_assistant`/`user_views` go false when their env kill switch is off even though the DB
   says on. 2. **Green** — rewrite `useOrgFeatures`/`useFeature` on `repositories.orgFeature.listOwn()`
   with per-org keys, delete the FE revenue-ownership merge and `FEATURE_KEYS_TOGGLEABLE`-driven
   resolution copy.
3. **Red — route state** (`src/components/__tests__/FeatureRoute.test.tsx`): off → not-available
   state, no page, no redirect; loading → held; error → held with retry and no "not on plan" claim;
   on → page. 4. **Green** — `FeatureRoute` + `FeatureUnavailable`.
5. **Red — nav + palette** (`src/components/shell/__tests__/Rail.features.test.tsx`): every row of
   the S3.0 Rail table (absent when off, present when on), the env AND for My Views/Assistant, and
   the ⌘K palette following `MODULES[].feature`. 6. **Green** — Rail + `routeMatch.ts` + `App.tsx`
   route wrappers.
7. **Red — Operator console** (`pages/AdministrationFeatures.test.tsx`, AC-PLN-012): per-key state
   and source from `listForOrg`; override toggle calls `toggle`; Clear calls `clearOverride`; plan
   picker calls `setOrgPlan`; all-orgs OFF asks for confirmation then calls `setGlobal`; plan default
   calls `setPlanFeature`; limits editor calls `setPlanLimits`; every mutation invalidates the three
   prefixes; loading and error states hide the controls. 8. **Green** — the console.
9. **Red — Your plan** (`pages/YourPlan.test.tsx`, AC-PLN-013): lists plan, switches and limits, no
   `switch`/`textbox`/`button` control, usage reads "Not tracked yet", and an unavailable read shows
   the retry state. 10. **Green** — the page + Administration `plan` section.
11. **Red — repository seam** (`src/lib/repositories/admin.test.ts`, `composition.test.ts`,
    `src/lib/db/orgFeatures.test.ts`): every new method delegates to its RPC; the projection maps
    rows → `{display,states}`; unknown keys are dropped; `resolved_org_plan` null → no plan.
12. **Green** — DAL + repository wiring.
13. **Admin feedback path** — `src/lib/db/orgFeatures.feedback.test.ts` +
    `src/hooks/useFeedbackSurveys` unchanged and still green (its invalidate key is the
    `['orgFeatures']` prefix).
14. **0537 + rollback + pgTAP** — write `supabase/tests/plans_read_projections.test.sql` (Operator
    reads the catalogue with all four plans and every key; a non-Operator member and anon are
    refused; `operator_org_plan` unknown org → `23503`; `resolved_org_plan` returns the caller's own
    row, Enterprise when unassigned, and nothing for another org). Red-first ordering was kept in
    the file's own comments; the run lands in the lane's DB slot (heavy-load rule).
15. **Full battery** — the gate list below, plus sibling suites that mock the touched seams.

### S3.4 — Verify (exact commands)

From `pmo-portal/` under `scripts/with-test-lock.sh`: `npm run check:guards`, `npm run typecheck`,
`npx eslint --max-warnings=0` on the touched TS/TSX, and
`npx vitest run src/auth/__tests__/useFeature.test.tsx src/components/__tests__/FeatureRoute.test.tsx
src/components/shell/__tests__/Rail.features.test.tsx src/components/shell/__tests__/FeatureGate.route.test.tsx
src/lib/__tests__/features.test.ts src/lib/features.dbRegistry.test.ts src/lib/features.test.ts
src/lib/repositories/admin.test.ts src/lib/repositories/composition.test.ts src/lib/repositories/index.test.ts
src/lib/db/orgFeatures.feedback.test.ts pages/AdministrationFeatures.test.tsx
pages/__tests__/Administration.features.readonly.test.tsx pages/YourPlan.test.tsx
pages/AdministrationShell.test.tsx App.incidentRoutes.test.tsx`.
Lane DB slot (coordinator): `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db
supabase/tests/plans_read_projections.test.sql supabase/tests/plans_permissions.test.sql
supabase/tests/plans_resolution.test.sql supabase/tests/0178_anon_executable_definers.test.sql
supabase/tests/0137_service_role_grants.test.sql'`. Rendered review + `scripts/ux-proof.sh
/administration/features /administration/plan` are the coordinator's slot (heavy-load rule).

### AC → test (S3 rows)

| AC | Owning proof (S3) |
|---|---|
| AC-PLN-008 | `src/auth/__tests__/useFeature.test.tsx` (resolution) + `src/components/__tests__/FeatureRoute.test.tsx` (route state) + `src/components/shell/__tests__/Rail.features.test.tsx` (nav) |
| AC-PLN-012 | `pmo-portal/pages/AdministrationFeatures.test.tsx` |
| AC-PLN-013 | `pmo-portal/pages/YourPlan.test.tsx` |
| FR-PLN-005 (one resolver) | the three above, plus `src/lib/repositories/composition.test.ts` for the single RPC seam |
| 0537 projections | `supabase/tests/plans_read_projections.test.sql` |

## S4 — assistant and analytics: outline

**Goal / AC:** Follow resolved switches and emit a privacy-preserving missing-tool signal (AC-PLN-006, 007); register plan as analytics group property (FR-PLN-016). First inventory entities and named actions against keys, including write actions and both tool loops. Filter the generic `query_entity` entity catalogue and reject disabled entities on execution; filter named tools through the same mapping. Test the shipped handler, no message text in the single event, consent, org changes, and run agent evals. Add the missing stock read tool as needed.

## S5 — limits (0535 on renumber): outline

**Goal / AC:** Enforce seats and active projects and grant monthly credits exactly once (AC-PLN-009–011). First inventory the invite lifecycle, project status taxonomy, credit ledger and scheduler, including the transaction boundary around external invite issuance. Count active members plus pending invites inside the invite RPC under the organisation row lock, without a reservation table; prove concurrency and failure cleanup. Detailed plan owns the limits migration (this outline's `0534_plan_limits.sql` renumbers — 0534 is S2's enforcement migration, see the S2 detailed plan), rollback, monthly idempotency and per-contract behavior. Decide credit rollover and the invite transaction boundary before implementation; do not claim a SQL lock covers an external request after its transaction ends.

## S6 — completeness and one journey: outline

**Goal / AC:** CI catches unregistered modules and one cross-org journey verifies the full switch (AC-PLN-014, 015). First inventory route/nav/entity sources and assistant registrations so the gate discovers additions independently of its own catalogue. Detailed plan must include failing fixtures for each missing requirement, core modules, plan rows, read tools and draft-confirm write tools. Add one isolated Playwright journey: Operator disables stock in A; A loses nav, URL access and assistant tool while B remains enabled. Read `docs/e2e-parallel-conventions.md` before writing it.

## S6 — detailed plan (written 2026-11-03 against dev @ dd3a63816)

**Goal:** one CI gate makes the D13 rule mechanical — a module cannot ship with a route, a nav item or a
switch key that lacks its switch key (or an explicit core marking), its plan row, or an assistant read
path — and one cross-tenant Playwright journey proves the whole switch (AC-PLN-014, AC-PLN-015).

**Scope guard (binding, this slice):** no migration, no `db reset`, no pgTAP, no Docker, no e2e **run**.
The e2e is authored and handed to the coordinator; the guard is proved by its own fixtures.

### S6.0 — Inventory (shipped sources the gate reads; never a hand-kept list beside them)

| Surface | Source of truth on dev | What the gate discovers |
|---|---|---|
| Routes | `pmo-portal/App.tsx` → `appRouteConfig` (`useRoutes` data, NFR-M365SEP-008) | every `path` + whether the element is wrapped in `<FeatureRoute feature="…">` |
| Rail nav | `pmo-portal/src/components/shell/Rail.tsx` → `ALL_ITEMS` | every `to` + `feature` / `unlessFeature` |
| ⌘K palette modules | `pmo-portal/src/components/shell/routeMatch.ts` → `MODULES` | every `path` + `feature` |
| Switch registry | `pmo-portal/src/lib/features.ts` → `FEATURE_KEYS`, `CORE_FEATURES` | the gatable key set and the never-gatable set |
| Plan catalogue | `supabase/migrations/0530…`–`0531_plan_catalogue.sql` (+ later seed migrations) | `plans` ids, the `feature_tiers` × `plan_tiers` matrix, explicit `plan_features` rows, the latest `org_features_feature_key_check` list |
| Assistant read path | `supabase/functions/agent-chat/{entityCatalog,readEntities,actions,stockRead,draftInvoice,overdue,remindOverdue}.ts`, `pmo-portal/src/lib/viewspec/types.ts` (`ENTITY_WHITELIST`) | entity keys and tool names (tool = a `name: '<snake>'` literal in a file that also declares `inputSchema`) |
| Runtime key→surface map | `supabase/functions/agent-chat/featureSwitches.ts` **if S4 has merged** (`ENTITY_FEATURE_KEYS`, `TOOL_FEATURE_KEYS`) | the assistant's own mapping; until then a clearly-labelled pre-S4 fallback map lives in the guard |
| Enforcement baseline | **every** `supabase/migrations/*_enforcement.sql` — `0081_feature_flag_write_enforcement.sql` today, plus `0534_feature_enforcement.sql` **if S2 has merged** | gated write table → key (0081's `case tablename … end` mapping, S2's §B `values` list) and gated SECURITY DEFINER function → key (S2) |

On dev today the four module gates are only partly wired: `FeatureRoute` covers `incidents`, `revenue`,
`procurement` and `user_views`; Rail gates `crm`/`procurement`/`timesheets`/`incidents`/`revenue`;
`routeMatch.MODULES` carries only the three Finance keys; `featureSwitches.ts` is S4's and `0534` is S2's,
neither merged. Those are the S6 allowlist's entries (§S6.3) — each names its restoring slice, and a stale
entry fails.

### S6.1 — Interfaces

`scripts/check-module-completeness.mjs` — a Node 22 ESM guard with no dependencies, same shape as
`check-retention.mjs` / `check-unpaged-reads.mjs`:

- **Pure, exported** (unit-testable, no I/O): `parseRoutes`, `parseRail`, `parsePalette`, `parseFeatures`,
  `parsePlanCatalogue`, `parseAssistant`, `parseKeyMap`, `parseEnforcement`, `enforcementBaseline`,
  `policyCommands`, `check`.
- `check(input)` returns `string[]` errors; `main()` prints each as `module-completeness: <detail>` and
  exits 1. Every message names exactly what is missing and the file to fix.
- `--self-test` runs the fixtures below in-process (AC-PLN-014), printing `module-completeness self-test: OK`.
- Replay order: migrations applied by numeric prefix, `rollback/` ignored, SQL comments stripped (the
  `check-retention.mjs` `strip()` idiom).

Rule set (each failure names the missing artefact):

1. **Routes** — every `appRouteConfig` path except `*` is either `<FeatureRoute feature="<key>">` (key must
   be in `FEATURE_KEYS`) or listed in `CORE_ROUTES` (explicit core marking: path → module/reason). An
   unmarked path fails. A `CORE_ROUTES` entry matching no route is stale and fails.
2. **Rail** — every `ALL_ITEMS` item carries `feature`/`unlessFeature` (valid key) or is in `CORE_NAV`.
   Gaps and stale entries fail.
3. **Palette** — every `MODULES` entry carries `feature` (valid key) or is in `CORE_PALETTE`; an entry whose
   Rail twin is gated by a different key (or ungated) fails as a drift, naming both.
4. **Registry ↔ DB catalogue** — every `FEATURE_KEYS` key appears in the latest
   `org_features_feature_key_check` list; the two sets must be equal (a key in the DB but not the FE
   registry fails too). `CORE_FEATURES` keys must never appear in the gatable catalogue.
5. **Plan rows** — for every plan in `plans` × every `FEATURE_KEYS` key there is a `plan_features` row
   (from the `feature_tiers` × `plan_tiers` matrix or an explicit insert). Missing pairs fail as
   `plan <plan>: no plan_features row for switch key <key>`; a row for an unknown plan or key fails.
6. **Assistant read path** — every `FEATURE_KEYS` key has ≥1 mapped entity/tool and every mapped target
   exists in the discovered assistant inventory (an unknown entity/tool fails). The map is S4's
   `featureSwitches.ts` when present; before S4 a `LEGACY_ASSISTANT_PATHS` table (deleted with the
   fallback once S4 lands) states the same contract.
7. **Enforcement recreation (#1783 item 3)** — the baseline is **every** enforcement migration, folded by
   numeric order: `0081_feature_flag_write_enforcement.sql`'s live gated-table list (`case tablename … end`)
   *and* S2's `0534_feature_enforcement.sql` when it merges (its gated functions, key from the **raising**
   `assert_feature_on(... 'key')` or `raise exception 'feature_off' … detail = 'key'`, and its §B
   `(table, key)` values list). Any migration numbered **after** a gate's own migration that recreates one
   of those (a) functions, or (b) **write** policies — `create policy` or `alter policy` — on one of those
   tables, must carry the same gate in the same statement: `assert_feature_on` in a function body
   (`org_feature_enabled` only *returns false*, so it is never a function gate), `org_feature_enabled` in a
   policy predicate. Read policies (`for select`) and `as restrictive` policies are out of scope — 0081
   gates the permissive write policy, so a read or narrowing policy is not where the gate lives, and an
   `alter policy` that only names roles (`to …`) or renames keeps the predicate. A plain text check;
   deliberate exceptions (e.g. a receipt re-boundary that moves a conjunct to another key) go in
   `ALLOWLIST` with an `enforcement:<file>:<name>` id and a restore note, and a stale entry fails.

**Allowlist** — one exported array; each entry `{ ids, reason, restore }` where `ids` is one id or a list,
and an id is `route:<path>`, `nav:<path>`, `palette:<path>`, `assistant:<key>`, `plan:<plan>/<key>` or
`enforcement:<file>:<name>`. Exact id, or a trailing `*` prefix match. Every entry must suppress at least
one real gap — a stale entry is itself a failure, so the list cannot decay into "everything".

**Wiring:** `pmo-portal/package.json` gains
`"check:module-completeness": "node ../scripts/check-module-completeness.mjs && node ../scripts/check-module-completeness.mjs --self-test"`,
appended to `check:guards` (CI's `verify` job already runs `npm run check:guards`; the
`ci-integration-order.test.mjs` contract requires every `check:*` to be in that chain). No new CI step:
one home.

### S6.2 — Tasks (TDD; each 2–5 min)

1. **Red** — `scripts/check-module-completeness.test.mjs`: route fixtures (gated / unmarked / core /
   unknown key / stale core), Rail and palette fixtures incl. the drift case. **Green** — the three
   discovery parsers + rules 1–3.
2. **Red** — plan-catalogue fixtures in the same test file: matrix coverage, a missing (plan,key) pair, a
   stale key, a core key in the catalogue, a DB key missing from the FE registry. **Green** — rules 4–5.
3. **Red** — assistant fixtures: `featureSwitches.ts`-shaped map; the legacy fallback; a mapped entity/tool
   absent from the inventory; a key with no path. **Green** — rule 6.
4. **Red** — enforcement fixtures: a later `create or replace function` without the gate (fails, names
   file+function+key), with `assert_feature_on` (passes), with the wrong key (fails), a later write policy
   on a gated table without `org_feature_enabled` (fails); an allowlisted recreation passes, a stale
   allowlist entry fails. **Green** — rule 7.
5. **Red** — `--self-test` (AC-PLN-014): a fixture module with a route but no switch key, no plan row and
   no assistant read path must exit non-zero and name all three. **Green** — the self-test fixtures +
   runner.
6. **Green** — run against the real repo; record each dev gap as an allowlist entry with its reason and
   restoring slice; re-run until clean.
7. **E2E (authored, not run)** — `pmo-portal/e2e/serial/AC-PLN-015-switch-off-journey.spec.ts` per
   `docs/e2e-parallel-conventions.md` (serial lane: it mutates the org-global `org_features` override and
   creates a second tenant; the override is restored in a `finally` around every arm, the tenant in
   `afterAll`). The journey: Operator clears the seed
   org's `stock` override to OFF through `operator_toggle_feature` under his own JWT; an org-A user sees no
   Stock rail item, `/stock` renders the not-available state, and (served lane only) the assistant answers
   that stock is not on the plan; a freshly created org-B user still sees Stock and `/stock`. Assistant
   arm is annotated when the served lane is absent (never silently dropped, never asserted against a mock).
8. **Gates** — see §S6.4.

### S6.3 — Allowlist as built (each entry names its restoring slice)

Eleven entries, 79 ids; every id suppresses at least one real gap on dev (a stale id fails). The
real-repo run reports 86 gaps across those ids before the allowlist — 26 routes, 3 Rail items, 17
palette gaps (10 modules, 7 of which also drift from their gated Rail twin), 16 switch keys with no
assistant read path, and 24 write-policy recreations on tables 0081 gates.

- `route:<path>` × 25 — the module routes S3 wraps in `FeatureRoute` (`/sales*`, `/procurement*`,
  `/timesheets`, `/companies*`, `/contacts*`, `/imprest*`, `/stock*`, `/erp-purchases`,
  `/sales-invoices/:invoiceId`, `/finance/statements`, `/administration/exchange-rates`); reason "S3
  wires the route gate (AC-PLN-008)"; restore "delete when S3 lands its route table". The 26th route
  id is the next line's own entry.
- `route:/incoming-payments/:receiptId` (its own entry) — revenue detail route; S3 gates the redirects
  only; restore "gate on `revenue` or mark core with the owner's ruling".
- `nav:/stock`, `nav:/imprest` — one entry; reason "S3 gates the Rail from the resolved projection";
  restore "delete when S3 lands".
- `nav:/finance/statements` — its own entry (role-gated in the page, no switch key); same restore.
- The 10 palette twins (`/sales`, `/procurement`, `/stock`, `/timesheets`, `/companies`,
  `/companies?type=Vendor`, `/contacts`, `/incidents`, `/imprest`, `/finance/statements`) — reason "S3
  makes the ⌘K palette follow `MODULES[].feature`"; restore "delete when S3 lands the palette gates".
- `assistant:<key>` × 16 — 15 registry keys with no assistant read surface yet (`sales_pipeline`,
  `revenue`, `import_export`, `m365_integration`, `budget_projection`, `imprest`, `clickup_sync`,
  `erp_sync`, `erp_purchases`, `financial_statements`, `management_pack`, `budget_phasing`,
  `multi_currency`, `api_access`, `sso`) plus the Admin-owned `feedback_surveys` (deliberately no
  assistant surface, S4) — reason "no assistant read path yet (D13/S4)"; restore "delete when the module
  gains a read tool/entity".
- `enforcement:<file>:<policy>` × 24 — one entry per migration that re-created a write policy on a table
  0081 gates after 0081 landed (`0099` × 6, `0100` × 6, `0129` × 6, `0203` × 6). S6 adds no migration, so
  re-creating them is a later slice's change; each `restore` says to delete the id when its policy is
  next re-created carrying the conjunct (it then goes stale and the gate demands the deletion).
- Nothing is allowlisted for plan rows on dev: 0531 seeds all 25 keys × 4 plans (100 rows), and the
  guard's DB-key check proves the FE registry and `org_features_feature_key_check` are the same 25.

### S6.4 — Verify (exact commands; no heavy jobs)

From the repo root: `node scripts/check-module-completeness.mjs --self-test` and
`node scripts/check-module-completeness.mjs`; from `pmo-portal/`: `npm run check:guards` (runs the new
guard + self-test), then `scripts/with-test-lock.sh npm run typecheck` and
`npx eslint --max-warnings=0` on touched JS/TS. Script tests: `node --test scripts/check-module-completeness.test.mjs`.
The e2e is **not run** here; the coordinator runs it after S3/S4 merge in the serial lane
(`scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-PLN-015-switch-off-journey.spec.ts`).
All three arms are skipped on dev: (a) and (b) are `test.fixme` until S3 wires the `/stock` route and
Rail gates, and (c) needs the served-functions lane plus the agent-assistant flag. The skip carries ONE
justified entry in `scripts/check-e2e-skips.mjs` whose `reason` names the missing dependencies and whose
`restore` names S3 (`feat/plans-s3-console`); restoring the arms makes the entry stale and fails the
skip gate, so it cannot outlive its reason.

### S6.5 — Open questions and the defaults taken

1. **Core marking lives in the guard, not in `App.tsx`.** Default: the `CORE_ROUTES`/`CORE_NAV`/
   `CORE_PALETTE` tables in the guard (path → module/reason), because S3 rewrites both source files; a
   marker comment would collide and a stale entry still fails. When S3 lands, `CORE_ROUTES` shrinks to the
   D5 modules + redirects + auth/settings surfaces.
2. **Assistant coverage for registry-only keys.** Default: require a read path for every `FEATURE_KEYS`
   entry (the brief's literal rule) and allowlist the 16 keys with no surface, rather than weakening the
   rule to "keys that gate a route". When a module ships, its allowlist line disappears and the gate
   demands the tool.
3. **The enforcement baseline is what exists today, not what S2 will add.** Default: the rule reads
   **every** `*_enforcement.sql`, so it covers 0081's live gated-table list now and layers S2's 0534 on
   top when it merges. Consequence, recorded honestly: the write policies 0099/0100/0129/0203 re-created
   after 0081 are visible as gaps and carry 24 `enforcement:` allowlist ids. S6 adds no migration, so
   re-creating them belongs to a later slice; each id goes stale (and must be deleted) the moment its
   policy is re-created with the conjunct.
4. **E2E lane path.** Brief says `pmo-portal/e2e/…`; the isolation guard requires a `serial`-tagged spec in
   `e2e/serial/`. Default: `e2e/serial/AC-PLN-015-switch-off-journey.spec.ts` (the conventions are binding);
   the plan's ownership table row is updated to match.
5. **A route gated on the *wrong* (but registered) key is not a failure.** FR-PLN-015's letter is "carries a
   registered key"; deciding that `/stock/cycle-count` belongs to `stock` and not `crm` needs a path→module
   catalogue that does not exist yet (it is S3's route table). The guard checks the same class of thing where
   it *is* derivable — a palette entry drifting from its gated Rail twin. When S3 lands its route table, the
   table itself is the catalogue and this becomes checkable; do not hand-list paths here in the meantime.
6. **D13's draft-and-confirm half is not mechanised.** D13 also asks for a draft-confirm write tool where the
   screen writes; the gate enforces one read path per key only. "This screen writes" is not derivable from the
   route/registry sources (a page's mutations are not declared), so a rule here would need a per-module
   declaration that does not exist. Recorded as a narrowed scope, not a regression: FR-PLN-015 is read-only.

## Planned AC ownership (later slices finalize exact paths)

| AC | Owning test |
|---|---|
| 001–002, 004 | `supabase/tests/plans_resolution.test.sql` |
| 003 | `supabase/tests/plans_permissions.test.sql` |
| 005 | `supabase/tests/plans_feature_enforcement.test.sql` |
| 006–007 | `supabase/functions/agent-chat/index.test.ts` |
| 008 | `pmo-portal/src/auth/__tests__/useFeature.test.tsx` |
| 009–010 | `supabase/tests/plans_limits.test.sql` |
| 011 | `supabase/tests/plans_monthly_credits.test.sql` |
| 012 | `pmo-portal/pages/AdministrationFeatures.test.tsx` |
| 013 | `pmo-portal/pages/YourPlan.test.tsx` |
| 014 | `scripts/check-module-completeness.test.mjs` (+ the guard's `--self-test`) |
| 015 | `pmo-portal/e2e/serial/AC-PLN-015-switch-off-journey.spec.ts` |
| 016 | `supabase/tests/plans_compatibility.test.sql` (FE compatibility cases in the S3 plan) |

## Final gates per slice

For each eventual implementation PR, run from `pmo-portal/` `npm run check:guards`, `../scripts/with-test-lock.sh npm run typecheck`, `npx eslint --max-warnings=0` on exact changed TS/TSX paths, and directly touched Vitest files under the test lock. Run changed edge handler Deno tests; DB changes run only touched pgTAP plus 0137/0178 under one `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db …'` hold, inspect output for parse errors. Run touched e2e and UI proof for UI work, script tests for changed scripts. Security, spec and quality reviewers review each code slice; UI gets rendered review. Do not push or merge without the applicable owner checkpoint.
