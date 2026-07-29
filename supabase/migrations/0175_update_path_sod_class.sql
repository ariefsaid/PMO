-- 0175_update_path_sod_class.sql — close the UPDATE half of the create-path SoD class (slice 3).
-- docs/specs/create-path-sod-class.spec.md; proven by supabase/tests/0168_update_path_sod_class.test.sql.
-- Slice 1 = 0173 (`projects`), slice 2 = 0174 (the other five tables). Both closed INSERT only.
--
-- ── WHY THERE IS A SLICE 3 ───────────────────────────────────────────────────────────────────────
-- 0173/0174 declared the class closed. It was not. 0010 revoked the table-wide UPDATE on the three
-- procurement child tables and re-granted a narrower column list; 0075 mirrored that list verbatim.
-- The list still contained EXACTLY the dangerous columns, so every forgery 0174's header enumerates
-- stayed reachable in TWO requests instead of one. Demonstrated live against the local DB at 0174 as
-- a plain Project Manager:
--
--     update procurement_invoices   set status='Paid'                    -> UPDATE 1, status = Paid
--     update procurement_receipts   set status='Complete'                -> UPDATE 1, status = Complete
--     update procurement_quotations set is_selected=true, total_amount=1 -> UPDATE 1, is_selected = t
--
-- Those are verbatim the three outcomes 0174's header calls the defect ("a Paid invoice… a Complete
-- goods receipt driving 3-way match… a pre-selected quotation that never passed
-- select_procurement_quote"). And as an Engineer, on their own Draft sheet:
--
--     update timesheets set approved_by=<self>, approved_at=now()        -> UPDATE 1, forged approver
--
-- `transition_timesheet` Draft->Submitted does NOT clear approved_by/approved_at (0007's comment
-- says so deliberately: "Rework -> Draft leaves submitted_at/approved_by/approved_at as-is"), so the
-- forged approver survived into Submitted and was visible to approved_timesheet_for_push. 0174's own
-- trigger message — "the approver is stamped only by transition_timesheet" — was therefore FALSE.
-- This migration is what makes it true.
--
-- ── §1 THE THREE PROCUREMENT CHILD TABLES: THE ANSWER IS "NO CLIENT UPDATE AT ALL" ──────────────
-- Derived by reading every caller, not assumed (NFR-CPS-002). The full evidence:
--   • FE DAL — there is NO `.update()` on procurement_invoices / _receipts / _quotations anywhere in
--     pmo-portal/src or pmo-portal/pages. Every write goes through the definer RPCs:
--     procurementLifecycle.ts calls create_procurement_quotation / _receipt / _invoice /
--     capture_vendor_invoice, and repositories/index.ts routes quote selection to
--     select_procurement_quote. The `.update()` calls in procurementFiles.ts target the SEPARATE
--     *_files tables (procurement_quotation_files / _receipt_files / _invoice_files), untouched here.
--   • Edge functions — supabase/functions/adapter-dispatch/readModelWriters.ts writes all three via
--     `ctx.serviceClient` (service_role), which holds its own grants and is unaffected by a revoke
--     from `authenticated`.
--   • e2e — pmo-portal/e2e/serial/AC-ENA-0*.spec.ts touch these tables only through the `admin`
--     (service-role) client.
--   • Importers — scripts/import-historical.mjs is service-role; the FE has no bulk-import writer for
--     these tables (procurementImportSkip.ts only names them in a union type for skip reporting).
-- So the re-grant list is EMPTY, and after this migration the definer RPCs are the only client
-- INSERT and UPDATE path on all three tables. That is asserted directly (not inferred) in 0168 §A.
--
-- ⚑ STILL OPEN — DELETE. The claim 0174/0167/the spec make is "the definer RPCs are the ONLY write
-- path". That is now true for INSERT and UPDATE and FALSE for DELETE, so this migration deliberately
-- does NOT restore the unqualified wording; every copy of it is narrowed to "INSERT and UPDATE" and
-- points here. Verified live at 0175, as a plain Project Manager:
--
--     delete from procurement_invoices   where id=<a Paid invoice>       -> DELETE 1
--     delete from procurement_receipts   where id=<a Complete receipt>   -> DELETE 1
--     delete from procurement_quotations where id=<the selected quote>   -> DELETE 1
--     delete from timesheets             where id=<an Approved sheet>    -> DELETE 0   (closed: no
--                                                                          DELETE policy exists)
--
-- `authenticated` holds a table-level DELETE grant on the three child tables (0075) and each has a
-- permissive DELETE policy (procurement_invoices_delete / procurement_receipts_delete / the FOR ALL
-- procurement_quotations_write). No FE caller uses it — there is no `.delete()` on any of the three
-- in pmo-portal/src or pmo-portal/pages — so revoking it looks safe, BUT the right shape is an
-- ADR-0018/ADR-0019 decision (soft-archive vs Admin-only destructive delete vs a definer RPC), not a
-- grant tweak smuggled into an UPDATE-path slice. Left OPEN on purpose, with an assertion in 0168 §J
-- that pins the CURRENT state so closing it is a deliberate, test-visible act. Tracked in
-- docs/backlog.md ("procure-to-pay child rows are client-DELETE-able").
--
-- ⚑ ONE DELIBERATE CONTRACT CHANGE. erpnext_procurement_flip_rls.test.sql and
-- erpnext_money_flip_rls.test.sql asserted `lives_ok(update procurement_quotations set is_selected =
-- true)` under an ERPNext flip — ADR-0055 / FR-ENA-130 "Finding 8": the PMO enhancement column must
-- not be taken away when the domain flips to ERP ownership. That INTENT is preserved and is now
-- proven at the surviving layer: select_procurement_quote is postgres-owned, carries no flip guard,
-- and 0098's native-mirror guard pins only the ERP-owned columns — so is_selected still moves while
-- flipped (0168 §E). What is gone is the DIRECT table write, which had no caller and which skipped
-- select_procurement_quote's stage gate ('Vendor Quoted' only), its role gate (Admin/PM/Finance) and
-- its single-transaction header sync (total_value + vendor_id + stage). Those two assertions are
-- rewritten in place, with a pointer to 0168 §E.
--
-- ── §2 TIMESHEETS: NARROW, DO NOT REVOKE ────────────────────────────────────────────────────────
-- Here the answer IS a column list, because legitimate client UPDATEs exist:
--   • week_start_date — the owner may move their own Draft sheet's week; proven by
--     supabase/tests/0165_timesheet_entry_date_bound_to_sheet_week.test.sql "PARENT SIDE" (which
--     expects 23514 from the week-bounds trigger, and would silently degrade to a 42501 privilege
--     error if the column were withheld).
--   • status — supabase/tests/0125_ops_admin_disabled_reads_nothing.test.sql and
--     supabase/tests/0025_timesheet_sod.test.sql (MED-TS-2) both drive `update timesheets set status
--     = …` as `authenticated` to prove timesheets_update_own's USING / WITH CHECK.
--   • id / org_id / user_id — timesheets_update_own's WITH CHECK pins org_id = auth_org_id() AND
--     user_id = auth.uid() AND status = 'Draft', so these carry no authority of their own.
--   • submitted_at — kept granted deliberately: the policy confines any write to the caller's OWN
--     DRAFT sheet, and transition_timesheet OVERWRITES it on the way to Submitted
--     (`case when p_to = 'Submitted' then now() else submitted_at end`), so a forged value cannot
--     survive into a state where anything reads it. Withholding it would buy nothing and would break
--     the Draft-edit surface's future use of the column.
-- `approved_by` and `approved_at` are withheld: they are the SoD artifacts, written only by
-- transition_timesheet's Approved/Rejected branch, and nothing client-side ever sets them (there is
-- no `.update()` on `timesheets` in the FE at all — timesheets.ts/timesheetTransition.ts/
-- timesheetPush.ts only SELECT, INSERT a Draft, or call an RPC).
--
-- ── §3 THE INSERT-SIDE RESIDUAL OF THE SAME COLUMN ──────────────────────────────────────────────
-- 0174's timesheet guard blocked `approved_by` at create but not `approved_at`, and the INSERT grant
-- on timesheets is table-wide. Closing the UPDATE without it would leave the approval timestamp
-- forgeable on the other path. Added here so the pair is closed on both.
--
-- ── §4/§5 ONE PREDICATE, RESOLVED SAFELY ────────────────────────────────────────────────────────
-- actor_bypasses_rls() (0174) resolved `search_path = public, pg_catalog` — public FIRST, so a
-- relation named public.pg_roles would SHADOW the catalog and could make the function return NULL ->
-- coalesce -> false… or true, silently exempting every caller from every create-path guard. Reversed
-- to `pg_catalog, public`. It also relied on the implicit PUBLIC execute grant, so the standard
-- hardening step `revoke execute on all functions in schema public from public` would have turned
-- every client INSERT on four tables into a 42501 — an explicit grant is added. And 0173's inline
-- copy of the predicate (with the OTHER search_path semantics) is replaced by a call to the helper,
-- so there is exactly one thing to audit.
--
-- ── §6 audit_events INDEXES ─────────────────────────────────────────────────────────────────────
-- 0173/0174 turned audit_events from low-volume into one row per create on four tables (bulk imports
-- included). It carried only its PK, while audit_events_select filters on org_id. Built
-- non-CONCURRENTLY on purpose: the table is small today and CREATE INDEX CONCURRENTLY cannot run
-- inside the migration's transaction.
--
-- ── REVERSIBILITY (ADR-0006) ────────────────────────────────────────────────────────────────────
-- ⚑ NOT `supabase db reset` — v0.8.0 is in production and a reset there is destructive. The manual
-- reverse, statement for statement:
--   -- §1 (⚑ this RESTORES THE VULNERABLE STATE — it is the 0010/0075 grant that this file closes)
--   grant update (id, org_id, procurement_id, invoice_date, status, created_at)
--     on public.procurement_invoices to authenticated;
--   grant update (id, org_id, procurement_id, receipt_date, status, created_at)
--     on public.procurement_receipts to authenticated;
--   grant update (id, org_id, procurement_id, vendor_id, reference, total_amount, received_date,
--                 is_selected, file_url)
--     on public.procurement_quotations to authenticated;
--   -- §2 (⚑ likewise vulnerable: it re-exposes approved_by / approved_at)
--   grant update on public.timesheets to authenticated;
--   -- §3 re-apply 0174's body of assert_timesheet_origination_insert() (drops the approved_at branch)
--   -- §4 alter function public.actor_bypasses_rls() set search_path = public, pg_catalog;
--         revoke execute on function public.actor_bypasses_rls() from authenticated, anon;
--   -- §5 re-apply 0173's body of assert_project_origination_insert() (restores the inline lookup)
--   -- §6 drop index if exists public.audit_events_org_created_idx;
--         drop index if exists public.audit_events_entity_idx;
-- 0173's and 0174's own headers carried the same `supabase db reset` claim; both are corrected in
-- place by this change.

-- ============================================================================
-- 1. procurement_invoices / procurement_receipts / procurement_quotations (FR-CPS-030, UPDATE half).
--
-- Same Postgres semantics as 0008 A6 / 0010 / 0174: a column-level REVOKE against a table-level grant
-- is a NO-OP, so the table-wide grant must be revoked; and because 0010/0075 left a COLUMN-level
-- grant, that must be revoked too. `revoke update on <table>` removes both forms, so one statement
-- per table suffices — the pgTAP asserts BOTH information_schema views are empty afterwards.
--
-- No re-grant: see the header's caller survey. `anon` is re-asserted for the same reason 0174 gave —
-- so the resulting state does not depend on a reader also finding 0105.
-- ============================================================================
revoke update on public.procurement_invoices   from authenticated, anon;
revoke update on public.procurement_receipts   from authenticated, anon;
revoke update on public.procurement_quotations from authenticated, anon;

-- ============================================================================
-- 2. timesheets (FR-CPS-040, UPDATE half) — narrow to the client-editable columns.
--
-- Snapshot semantics (inherited from 0008 A6 / 0010 / 0174, deliberately unchanged): a column added
-- to timesheets in a FUTURE migration will NOT be updatable by `authenticated` until that migration
-- grants it explicitly. That is the forcing function this whole class exists for — 0075 re-mirrored
-- a list rather than re-deriving it, and that is how the UPDATE half survived slices 1 and 2.
-- ============================================================================
revoke update on public.timesheets from authenticated, anon;
grant  update (id, org_id, user_id, week_start_date, status, submitted_at)
  on public.timesheets to authenticated;

-- ============================================================================
-- 3. timesheets create guard — add the approved_at branch (0174 §4 covered approved_by only).
-- Body is otherwise byte-for-byte 0174's, including the BYPASSRLS exemption and the two existing
-- messages, which other tests assert verbatim.
-- ============================================================================
create or replace function public.assert_timesheet_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  if new.status <> 'Draft' then
    raise exception
      'timesheets.status "%" is not the origination status: a timesheet is created as a Draft, and Submitted / Approved / Rejected are reached only through transition_timesheet, which enforces that nobody approves their own timesheet',
      new.status
      using errcode = 'P0001';
  end if;

  if new.approved_by is not null then
    raise exception
      'timesheets.approved_by cannot be set when a timesheet is created: the approver is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet'
      using errcode = 'P0001';
  end if;

  if new.approved_at is not null then
    raise exception
      'timesheets.approved_at cannot be set when a timesheet is created: the approval timestamp is stamped only by transition_timesheet, which enforces that nobody approves their own timesheet'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

-- ============================================================================
-- 4. actor_bypasses_rls() — resolution order + an explicit execute grant (see the header §4/§5 note).
-- `alter function … set search_path` replaces the setting without re-stating the body, so the
-- SECURITY INVOKER property and the comment from 0174 both survive untouched.
-- ============================================================================
alter function public.actor_bypasses_rls() set search_path = pg_catalog, public;

grant execute on function public.actor_bypasses_rls() to authenticated, anon;

-- ============================================================================
-- 5. M-2 — one definition of the predicate. 0173 inlined the pg_roles lookup under
-- `search_path = public`, i.e. with the exact resolution-order weakness §4 just fixed in the shared
-- helper; the inline copy would NOT have been fixed by that alter. Replaced by a call, so the two
-- can never drift again. Every other branch of the function is byte-for-byte 0173's — the three
-- messages are asserted verbatim by supabase/tests/0166_project_create_sod.test.sql.
-- ============================================================================
create or replace function public.assert_project_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- Server-side authority (postgres / service_role / supabase_admin): exempt. See 0173's header.
  if public.actor_bypasses_rls() then
    return new;
  end if;

  -- FR-PCS-001: origination status only. A won/on-hand project is reached through the state machine.
  if new.status not in ('Leads','Internal Project') then
    raise exception
      'projects.status "%" is not an origination status: a project can only be created as a Lead or an Internal Project, and a won project is reached only by winning the deal',
      new.status
      using errcode = 'P0001';
  end if;

  -- FR-PCS-002: the win artifacts are written by transition_project, never supplied at create.
  if new.decided_at is not null then
    raise exception
      'projects.decided_at cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  if new.customer_contract_ref is not null then
    raise exception
      'projects.customer_contract_ref cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  if new.contract_date is not null then
    raise exception
      'projects.contract_date cannot be set when a project is created: the win artifacts (decided_at, customer_contract_ref, contract_date) are recorded only by winning the deal'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

-- ============================================================================
-- 6. audit_events indexes (see the header §6 note). `if not exists` keeps the migration re-runnable.
-- ============================================================================
create index if not exists audit_events_org_created_idx
  on public.audit_events (org_id, created_at desc);

create index if not exists audit_events_entity_idx
  on public.audit_events (entity_id);
