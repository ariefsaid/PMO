# Record change history — spec (#719)

**Status:** proposed, 2026-09-29. **Authority:** `docs/decisions.md` OD-MARGIN-2 (value-change history wanted, deferred); ADR-0016 (`can()` is UX, RLS is enforcement), ADR-0017 (repository seam), ADR-0018 (soft-archive), ADR-0019 (definer RPC / restrictive policy + pgTAP proof); migrations `0074` (org stamp attached by list), `0076` (`audit_events` / `log_audit`), `0063` (active-member conjunction).
**IDs:** `FR-CHG-###`, `NFR-CHG-###`, `AC-CHG-###` (the `FR-HIST-*` prefix is already taken by onboarding-tooling).

## Job story

When a number, date, status or name on a record looks wrong, I want to see who changed it, when, and what it was before, so I can settle it from the record itself without asking around.

## What exists today (grounded)

- `audit_events` (`0076`) records ~35 distinct security-relevant actions, written only by `log_audit()` from definer RPCs and two AFTER DELETE triggers. Its single SELECT policy is **own-org Admin or Operator only**, and no screen reads it. Only a handful carry old and new values: `project.contract_value.set`, the `*.transition` actions, `work_order.value.set`.
- Ordinary edits (rename a company, move a task date, edit a contact, change a budget line) overwrite in place. Rows keep `updated_at` / `last_update` and nothing else. `procurement_status_events` records procurement status steps only; `procurementHistory.ts` unions it with child-record creation into a timeline on the procurement page.
- Record SELECT visibility on the first-set tables is org-scoped and active-member (`*_select` policies, `0063` conjunction), with **no column-level SELECT revoke** on any of them. Some later tables are narrower (meetings use access grants), so the design must not hard-wire "org-wide".

## Scope

### First set (recommended, by business value and by "is a person's edit the source of truth")

| Table | Why in | Parent (for roll-up on the parent's History) |
|---|---|---|
| `projects` | contract value, dates, status, PM, client: the disputes that start "who changed this?" | none |
| `budget_versions`, `budget_line_items` | money; edits after activation are the most argued about | project |
| `work_orders` | client drawdown ceiling; value set is money-path | project |
| `procurements` (+ `purchase_requests`, `rfqs`, `purchase_orders`, `payments`) | vendor, amount, dates; today only status is logged | project |
| `tasks` | date and assignee moves; highest edit rate, so it stress-tests volume | project |
| `companies`, `contacts` | rename / retype / re-parent; contact edits are the issue's own example | none (contacts: company) |

Explicitly **later** (each needs its own visibility or classification pass): `meetings` and children (grant-based visibility), `timesheets` and entries (own-row visibility, SoD-approved rows), `project_documents` (existing `project_document.update` audit plus file content), `profiles` (roles and status are authorization inputs), `crm_activities`, `incident_reports`, integration/binding tables (already audited via `audit_events`, secrets adjacent), agent tables, `user_views`.

**Out of scope:** DELETE capture (a hard-deleted record has no page; `audit_events` already logs `company.delete`, `project.delete`, and the document deletes for Admins); revert / restore-previous-value; field-level diff for file or free-text bodies; export (see Q3); undo of a change; notifications on change; a global cross-record activity feed; back-filling history before the migration; adding `created_by` columns.

## Design

### D1. One generic capture: `record_changes` + one trigger function

New table `public.record_changes` (append-only, `FORCE RLS`, one SELECT policy, `select` granted to `authenticated` and nothing else, TRUNCATE revoked; same write-path contract as `audit_events`):

```
seq          bigint generated always as identity   -- total order; created_at ties inside one txn
id           uuid primary key default gen_random_uuid()
org_id       uuid not null                          -- from NEW.org_id, after the stamp trigger
entity_type  text not null                          -- 'project','company',... (registry key, not table name)
entity_id    uuid not null
parent_type  text, parent_id uuid                   -- roll-up target (project for tasks, work orders, ...)
op           text not null check (op in ('insert','update'))
actor_id     uuid                                   -- null = system / integration
changes      jsonb not null default '{}'            -- {col: {"old":…,"new":…}} ; flagged cols: {"changed":true}
currency     text                                   -- NEW.currency when the table has one (money formatting)
created_at   timestamptz not null default now()
index (org_id, entity_type, entity_id, seq desc)    -- the tab query
index (org_id, parent_type, parent_id, seq desc)    -- the project roll-up
```

**One row per statement-row, not per column**: one edit = one actor and one time, so the tab shows one line group per save and writes 1 row, not N.

`record_change_capture()` is an **AFTER INSERT OR UPDATE ... FOR EACH ROW** trigger function, `SECURITY DEFINER`, owner `postgres`, `set search_path = public`. AFTER, so it sees `NEW` after the `0074` org stamp and the `0215` org checks. It:

1. Reads its registry row (below) by `TG_TABLE_NAME`.
2. On UPDATE, diffs `to_jsonb(OLD)` vs `to_jsonb(NEW)` over the **captured** columns only with `is distinct from`. If nothing captured changed, it writes nothing (so `updated_at` touches, sweeps and no-op saves are free).
3. On INSERT, writes one `op='insert'` row with empty `changes` (records who created it and when; imported rows included).
4. Excluded-`flag` columns appear as `{"changed":true}` with no values; excluded-`omit` columns never appear.
5. Inserts directly (it is the sole writer; `log_audit` has a different shape).

**Actor.** `auth.uid()` is live inside a definer function, so JWT callers, definer RPCs (`set_project_contract_value`, `transition_*`) and the task cascades all attribute correctly. Service-role writers (sync jobs, import loader, edge functions) have `auth.uid() is null`; for them the trigger honors a transaction-local `app.actor_id` setting (the trigger analogue of `p_actor_id` in the admin-connect RPCs) **only when `auth.uid() is null`**, so a JWT-carrying user can never override attribution. If neither exists, `actor_id` is null and the UI shows "System".

**Registry.** `record_history_config(entity_type, table_name, parent_col, parent_type, captured jsonb of col → kind, flag_cols text[], omit_cols text[])`: a code-owned table, no client grants, seeded by the migration. `kind` is one of `text | number | money | date | timestamp | enum | ref | bool` and drives UI formatting. **Allowlist by classification, not blanket capture**: every column of a tracked table must be classified captured / flag / omit. A pgTAP catalog gate fails when a new column is unclassified, or a config table lacks the trigger, or a trigger exists off-config. This repeats the `0074` lesson (a trigger attached by list silently misses whatever is added later; nothing notices) with the gate that lesson calls for.

**Column classes (rule, per-table lists are fixed in the plan's task 1):**
- **omit:** `id`, `org_id`, `created_at`, `updated_at`, `last_update`; anything a trigger, job or roll-up computes (the source edit is recorded instead); external-sync mirror columns (`erp_*`, source stamps); secrets and tokens (none live on first-set tables; the rule stands for later tables).
- **flag** (changed, no values): free-text bodies (`tasks.description`, `notes`), and personal contact data (`contacts.email`, `phone`, `notes`), so the history says "phone changed" without keeping the number after the field is corrected or erased (Q2).
- **captured:** everything else the viewer can already read.

**Column-level rule (no leak of unreadable values).** A captured column must be `SELECT`-able by `authenticated` on the source table. A pgTAP gate asserts `has_column_privilege('authenticated', tbl, col, 'SELECT')` for every captured column, so if a future migration revokes column SELECT the gate fails until the column is moved to `omit`. Today none is revoked.

### D2. Visibility = the record's own RLS, evaluated per history row

Copying the org predicate onto `record_changes` would leak the moment a tracked table gets a narrower policy. Instead the single SELECT policy is:

```
using (org_id = auth_org_id() and is_active_member()
       and record_history_visible(entity_type, entity_id))
```

`record_history_visible(text, uuid)` is `SECURITY INVOKER`, `STABLE`, a static `CASE entity_type` with one `select exists (select 1 from <table> where id = p_id)` arm per tracked table (**no dynamic SQL**). It runs as the caller, so the source table's own RLS decides. Adding a table to the registry requires adding its arm (the catalog gate checks this too). A history row whose source row is gone (hard delete) is therefore unreadable, which is right: no page shows it and `audit_events` keeps the delete for Admins.

Rejected: one history table per entity (N policies to keep in step); reading history through a definer RPC that re-checks (a second authorization implementation to diverge).

### D3. Relationship to `audit_events`: keep separate; the History view unions on read, for Admins only

`audit_events` is Admin/Operator-only by design and its `detail` shapes vary per action; loosening it to record viewers would expose credit grants, integration and agent-denial rows. So `record_changes` is separate.

Overlap: the generic trigger will capture the same column changes that four audit actions describe (`contract_value`, `status`, work-order value, budget-version update). Showing both would double every such event. Rule: **the History tab reads `record_changes` for everyone**; for a caller who can already read `audit_events` (Admin) it additionally merges rows whose `entity_id` matches **and whose action is not a field-change already covered** (today: `project_document.create/update`, `meeting.grant.*`, integration cleanups) rendered as "did X" lines. Delete actions have no record page. Net effect: for the first set the merge adds little, which is why the union is a read-side concern in one repository function (`recordHistory.list`), not a schema coupling, and can grow as audit actions become record-bound. Non-Admins see no audit-only lines and no placeholder for them.

### D4. Grants and definer hygiene (hosted Supabase grants EXECUTE on `public` functions to `anon` / `authenticated` by default; local Docker does not)

- `record_change_capture()`: `revoke all ... from public, anon, authenticated`. Trigger functions are checked for EXECUTE at `CREATE TRIGGER`, not at fire time, so no client grant is needed.
- `record_history_visible()`: predicate for a policy evaluated as the caller, so `authenticated` needs EXECUTE; `revoke ... from public, anon`, `grant execute ... to authenticated`. It returns only what the caller's own RLS on the source table already permits.
- `record_changes` and `record_history_config`: no INSERT / UPDATE / DELETE / TRUNCATE to any client role (privilege-denied 42501, not policy-denied); config table gets no client grant at all.
- The migration ends with a `do $$` self-assertion in the `0211` style (`has_function_privilege` for `anon`, `authenticated`, `service_role`; raise on mismatch) so the deployed database, not only the local one, is proven.
- pgTAP checks use the **hosted grant shape**: explicitly grant EXECUTE to `anon` / `authenticated` on a scratch copy of the default-privilege environment, or assert the catalog ACL directly, so the proof does not certify only a local database whose defaults differ.
- Post-deploy: run the existing anon-key probe and isolation probe, and add both new tables and both functions to `scripts/isolation-probe-denominator.json` (the denominator gate fails the PR otherwise).

### D5. History UI

Shared `RecordHistory` component (`pmo-portal/src/components/history/RecordHistory.tsx`) backed by a repository `recordHistoryRepository.list({entityType, entityId, includeChildren, cursor})` (`src/lib/repositories/recordHistory.ts`, over `src/lib/db/recordChanges.ts`); `org_id` is never sent.

- **Placement.** A `History` tab on the project record (`/projects/:id/history`, added to `TAB_VALUES` in `ProjectDetail.tsx`; the project tab also lists child changes, filterable All / Project / Budget / Work orders / Procurement / Tasks) and on the procurement record (`ProcurementDetails.tsx` `ProcTab`). Company and contact pages have no tab bar (Card sections), so History is a collapsed `Card` section at the end, which keeps their structure.
- **Row.** Newest first, grouped per event: `Actor name · relative + absolute time` then one line per field `Field label: old → new`. `insert` renders "Created". `archived_at` set / cleared renders as "Archived" / "Restored" (ADR-0018). Flagged fields render "Field label changed". System events render "System". An actor whose profile is unresolvable renders "Unknown user".
- **Formatting.** By registry `kind`: `money` with `formatCurrency(value, event.currency)`; `date` with `formatDateOnly`; `timestamp` with `formatDate`; `number` with `formatNumber`; `enum` via the module's existing status label helpers; `ref` (client, PM, assignee, vendor) resolved through already-cached option lists, falling back to "Unavailable" rather than a raw uuid; empty old value renders "empty".
- **i18n.** New namespace `public/locales/{en,id}/history.json`; field labels `history.field.<entity_type>.<column>`, with a humanized-column fallback so an unlabelled column never renders blank. `id` is populated in the same change (the gate stages `id` completeness against namespaces that ship `id`).
- **States.** Loading, empty ("No changes recorded yet. Changes made before <migration date> are not shown."), error (with retry), and pagination by `seq` cursor, 50 events per page ("Load older"). Read-only: no `can()` write gating needed; visibility is RLS, and a viewer with no record access never reaches the page.

## Functional requirements (EARS)

- **FR-CHG-001:** When a row of a tracked table is updated and at least one captured column changes value, the system shall append exactly one `record_changes` row holding, per changed captured column, the old and new value, with the actor and the time.
- **FR-CHG-002:** When an update changes no captured column (including `updated_at`-only or no-op saves), the system shall append nothing.
- **FR-CHG-003:** When a row of a tracked table is inserted, the system shall append one `insert` event carrying the actor and time and no column values.
- **FR-CHG-004:** Where a column is classified `flag`, the system shall record that it changed and shall not store its old or new value; where `omit`, the system shall not record it.
- **FR-CHG-005:** When the writer is an authenticated user (directly or through a definer RPC), the system shall record `auth.uid()` as actor; where `auth.uid()` is null, the system shall record the transaction-local `app.actor_id` when set, else null. While `auth.uid()` is not null, the system shall ignore `app.actor_id`.
- **FR-CHG-006:** The system shall stamp each event's `org_id` from the changed row and `parent_type` / `parent_id` from the registry.
- **FR-CHG-007:** While a user can read a record under its table's RLS, the system shall let that user read that record's history events; while they cannot, the system shall return none, including for events written while they could.
- **FR-CHG-008:** The system shall reject any client INSERT, UPDATE, DELETE or TRUNCATE on `record_changes` with a privilege error.
- **FR-CHG-009:** When a soft-archived record is archived or restored, the system shall capture the `archived_at` change as an ordinary event.
- **FR-CHG-010:** When a user opens a History surface, the client shall list events newest first, 50 per page, each as actor, time, and `field: old → new` lines with localized labels and values formatted through the shared format helpers.
- **FR-CHG-011:** Where the caller can also read `audit_events`, the History view shall merge non-duplicative audit lines for the record; where the caller cannot, it shall show none.
- **FR-CHG-012:** When a project History is opened, the client shall include child-record events (`parent_type='project'`) and allow filtering by entity kind.

## Non-functional requirements

- **NFR-CHG-001 Append-only.** No client role holds INSERT/UPDATE/DELETE/TRUNCATE; `record_changes` has `FORCE RLS` and exactly one policy, SELECT. There is no update path for a correction: a wrong event stays and a later event supersedes it.
- **NFR-CHG-002 Visibility by RLS, not the FE.** Every read path (tab, agent tools, any future export) goes through the `record_changes` policy; the FE adds no filtering that stands in for it.
- **NFR-CHG-003 No unreadable values.** A captured column must be column-SELECT-able by `authenticated` (gated in pgTAP); classification is allowlist-complete (gated).
- **NFR-CHG-004 Tenancy.** `org_id` is on every row and in the policy and both indexes; a user in another org reads zero rows and cannot cause a write into this org's history. The FE never sends `org_id`.
- **NFR-CHG-005 Write overhead.** A tracked-table UPDATE adds at most one small indexed INSERT and only when a captured column changed; the diff is over a fixed column list, not a whole-row compare of large values (flag/omit columns are never serialized).
- **NFR-CHG-006 Storage and retention.** Estimate ~0.3 KB per event with indexes. First-set edit volume is well under 10^5 events per org per year, so no automatic purge in v1 (indefinite retention, append-only). Revisit at 5M rows per org: partition by `created_at` (monthly), keeping `(org_id, entity_type, entity_id, seq)` local indexes. Org offboarding removes history the same way it removes the org's other rows.
- **NFR-CHG-007 Bulk volume.** An import of N rows writes N tiny `insert` events (no values); a bulk UPDATE statement writes one event per changed row. Neither runs in the client's critical path beyond the same transaction. Events written by the import loader carry its actor when `app.actor_id` is set, else "System".
- **NFR-CHG-008 Atomicity.** History is written in the same transaction as the change; a rolled-back change leaves no event, and a failed history insert fails the change (no silent audit gap).
- **NFR-CHG-009 Portfolio accounting.** The new tables, functions and tab route are added to the isolation-probe denominator and the QA `routes × oracles` matrix (`docs/qa-portfolio.md`).
- **NFR-CHG-010 Accessibility and i18n.** The tab is keyboard-operable (existing `Tabs`), old/new are conveyed as text (never color alone), and works in `en` and `id` at 390px.

## Acceptance criteria and owning proof

Owning layers follow ADR-0010: pgTAP for capture and visibility, Vitest for the component and repository, one Playwright journey.

| ID | Given / When / Then | Owner (file) |
|---|---|---|
| **AC-CHG-001** | Given a project as PM, when PM updates `name` and `end_date` in one statement, then exactly one event exists with both old and new values, the PM as actor, and `parent_id` null. | pgTAP `supabase/tests/record_changes_capture.test.sql` |
| **AC-CHG-002** | Given a row, when an update touches only `updated_at` / `last_update` or sets a column to its current value, then no event is written. | same file |
| **AC-CHG-003** | Given an insert of a company, then one `insert` event with the actor and empty `changes` exists. | same file |
| **AC-CHG-004** | Given a contact, when `phone` changes, then the event says `{"changed":true}` for `phone` and the old and new numbers appear nowhere in the row (`changes::text` search). Given an `omit` column changes alone, no event. | `record_changes_classification.test.sql` |
| **AC-CHG-005** | Given `set_project_contract_value` (definer RPC) run by Finance on a won project, then the event actor is Finance. Given a service-role update with `app.actor_id` set, the actor is that id; with it unset, null. Given a JWT user who sets `app.actor_id` to another user's id, the actor is still the JWT user. | `record_changes_actor.test.sql` |
| **AC-CHG-006** | Given a task under a project, when its end date moves, then the event's `parent_type/parent_id` are the project. | `record_changes_capture.test.sql` |
| **AC-CHG-007** | Given an org-A member who can read project P, then they read P's events. Given an **org-B user** (cross-org negative), then they read zero events for P and cannot insert one with org A's `org_id`. | `record_changes_visibility.test.sql` |
| **AC-CHG-008** | Given a **lower-privilege role** (Engineer) and a **deactivated member** (negatives): the Engineer reads events for records they can read (history read = record read), the deactivated member reads zero. Given a source row hidden from the caller by a narrower policy added inside the test's transaction, the caller reads zero events for it (the CASE arm follows source RLS). | same file |
| **AC-CHG-009** | Given any client role (`authenticated`, `anon`), when it INSERTs, UPDATEs, DELETEs or TRUNCATEs `record_changes` (or reads `record_history_config`), then it gets 42501 (`throws_ok` with the exact code, never `null`). | `record_changes_grants.test.sql` |
| **AC-CHG-010** | Given the function ACL, then `anon` and `authenticated` cannot EXECUTE `record_change_capture`; `anon` cannot EXECUTE `record_history_visible`; checked against explicit grants mirroring the hosted default, not only the local defaults. | same file |
| **AC-CHG-011** | Given the catalog, then every registry table has the trigger, every trigger is in the registry, every column of a tracked table is classified, every captured column is `SELECT`-able by `authenticated`, and every registry entity has a `record_history_visible` arm; the gate has a planted-defect self-test (an unclassified column, a missing trigger) that turns it red. | `record_changes_catalog_gate.test.sql` |
| **AC-CHG-012** | Given a soft-archive then restore of a company, then two events show `archived_at` set then cleared. | `record_changes_capture.test.sql` |
| **AC-CHG-013** | Given a transaction that changes a row then rolls back, then no event remains. | same file |
| **AC-CHG-014** | Given an update of 500 rows in one statement, then 500 events exist, each with the correct old and new value, and the statement completes within the suite's timing envelope. | `record_changes_bulk.test.sql` |
| **AC-CHG-015** | Given events for money, date, enum, ref, flagged and insert kinds, when `RecordHistory` renders, then each line reads `Actor · time`, `Label: old → new` with `formatCurrency`, `formatDateOnly`, localized enum, and resolved-or-"Unavailable" ref, in en and id; system and unknown actors render their localized names. | Vitest `pmo-portal/src/components/history/__tests__/RecordHistory.test.tsx` |
| **AC-CHG-016** | Given loading, empty, error and 51-event states, then the tab shows skeleton, the empty copy, an error with retry, and "Load older" fetching the next 50 by `seq` cursor. | same file |
| **AC-CHG-017** | Given the repository, when an Admin loads a record, then non-duplicative audit lines merge into the timeline; when a non-Admin loads it, none appear. | Vitest `src/lib/repositories/__tests__/recordHistory.test.ts` |
| **AC-CHG-018** | Given `/projects/:id/history` and the procurement History tab, then each deep-links, is keyboard-operable, and the project tab filters child kinds. | Vitest `pages/project-detail/__tests__/ProjectDetail.history.test.tsx`, `pages/__tests__/ProcurementDetails.history.test.tsx` |
| **AC-CHG-019** | Given a PM edits a project's client and end date on its edit form, when they open the project History tab, then the top entry shows their name, "just now" and both changes as `old → new`; a second edit appears above it. | Playwright `pmo-portal/e2e/AC-CHG-019-project-change-history.spec.ts` (`@e2e-isolation: dedicated-row`, its own seed project) |

The e2e journey asserts the goal (the edit is visible with who/what/old→new); it never asserts internals such as row counts.

## Migration and rollback

- One forward migration `0219_record_change_history.sql` (next free number at time of writing; confirm at build with `scripts/renumber-migration.sh` if it collides): the two tables, two functions, the seeded registry, the trigger attach by list (a `do $$` that drops then creates each trigger, re-runnable, the `0074` shape), the grants and the closing ACL self-assertion. Additive: no existing table's columns, policies or grants change.
- Reversibility (ADR-0006 pre-production): `supabase db reset`. Staged rollback at `supabase/migrations/rollback/0219_record_change_history_down.sql` (a subdirectory so reset never applies it): drop the triggers, both functions, both tables. Rolling back loses history, which is the accepted cost; it never touches business rows.
- Deploy: DB-only until the UI ships. Ship data layer first (migration plus pgTAP, Director-dispatched since it adds a permissions surface: full security review including a mutation check: replace the policy predicate with `true`, then set the actor to a caller argument, and both must turn tests red), then the tab UI (factory-eligible).
- Production push of the migration is owner-gated per `docs/environments.md`; after it, run the anon-key probe and the isolation probe.

## Risks

1. **Write amplification on tasks** (highest edit rate, cascades in `0209`). Mitigated by no-op suppression, captured-only diff, and one row per statement-row; watch the bulk-update AC as the tripwire.
2. **A tracked table gains a narrower policy or a revoked column later.** Both are covered by gates (D1, D2), but only for tables in the registry; the gate cannot see a table nobody registered. Adding a table is a registry change plus an arm plus a classification, reviewed as one unit.
3. **PII persistence.** Old values of names, titles and amounts stay after correction. Contact email/phone/notes are `flag` for this reason; company and contact names are captured (business identifiers).
4. **History as evidence.** Users will rely on it; the tab must say when history begins (empty-state copy) and that DELETEs and pre-migration edits are not shown.
5. **Service-role writers without `app.actor_id`** show as "System" even when a human triggered them. Acceptable in v1; the import loader and the sync edge functions are the ones to wire first.

## Open questions (recommended defaults)

- **Q1: first set, or all business tables at once?** Default: the first set above; the registry, gate and `flag/omit` classification make each later table a small reviewed change, and the tables left out are exactly the ones with narrower visibility or authorization meaning.
- **Q2: capture contact email/phone values?** Default: no (`flag` only). Owner may prefer full values for support disputes; that is a one-line registry change and a retention decision (right-to-erasure would then need a redaction path, which append-only forbids).
- **Q3: export?** Default: none in v1. If wanted, a read of the same policy-scoped table (CSV of the visible events) with no new privilege, added after the UI settles.
- **Q4: capture DELETE?** Default: no; the hard deletes are Admin-only, the record page is gone, and `audit_events` already logs the important ones. Revisit if Admins ask for a recycle-bin history.
- **Q5: merged audit lines for Admins, or `record_changes` only?** Default: the read-side merge (D3), since the issue asks for it; if it proves noisy, drop the merge without touching the schema.
- **Q6: retention.** Default: indefinite in v1, with the 5M-rows-per-org partition trigger. A stated legal retention period, if the owner has one, overrides this.
- **Q7: project History includes child-record events by default?** Default: yes with kind filters; the project is where the "who moved this date / changed this budget line" question is asked.

## Boundaries

No change to any existing table's columns, RLS policies or grants; no new record route; no write UI; no removal or loosening of `audit_events`. Existing `procurementHistory.ts` progression timeline stays as is (it tells the lifecycle story; the new tab tells the field-edit story). Keep one owning proof per AC at the lowest sufficient layer.
