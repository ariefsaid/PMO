-- 0109_sales_ar_active_member_and_inflight_link_guard.sql
-- Luna re-audit money round: BLOCK #10 (offboarded users can still read AR data) and the DB half of
-- BLOCK #11 (cross-org link pre-flight is TOCTOU-prone).
--
-- Reversibility (ADR-0006): `supabase db reset`. Manual reverse:
--   -- §1: re-create the 0104 policies WITHOUT the `and is_active_member()` conjunct.
--   drop trigger if exists projects_block_inflight_external_delete        on public.projects;
--   drop trigger if exists companies_block_inflight_external_delete       on public.companies;
--   drop trigger if exists sales_invoices_block_inflight_external_delete  on public.sales_invoices;
--   drop function if exists public.block_delete_with_inflight_external_command();
--   drop index if exists public.external_command_outbox_inflight_idx;

-- ============================================================================
-- §1 — BLOCK #10: conjoin is_active_member() into the revenue policies (FR-INV-003).
--
-- 0104 built `sales_invoices` / `incoming_payments` from the 0100 template, which predates 0063's
-- conjunction pass, so its policies gate on `org_id = auth_org_id()` alone. Every other business
-- table additionally requires `is_active_member()` (0062) — a disabled/offboarded user
-- (`admin_set_user_status` sets status='disabled', 0065) holding a still-valid JWT could therefore
-- keep reading invoice amounts, outstanding balances, customers and payment allocations.
--
-- 0063's mechanical pass ran BEFORE these tables existed, so it never covered them; the conjunct is
-- appended here in the same INLINE idiom 0097 used for the companies/contacts flip (predicates
-- preserved verbatim, only `and is_active_member()` added). All five commands are covered — a
-- disabled user must not WRITE either (the C1 gap 0063 documents: a select-only pass silently leaves
-- the write policies open).
-- ============================================================================

drop policy if exists sales_invoices_select on public.sales_invoices;
drop policy if exists sales_invoices_insert on public.sales_invoices;
drop policy if exists sales_invoices_update on public.sales_invoices;
drop policy if exists sales_invoices_delete on public.sales_invoices;

create policy sales_invoices_select on sales_invoices for select
  using (org_id = auth_org_id() and is_active_member());
create policy sales_invoices_insert on sales_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy sales_invoices_update on sales_invoices for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy sales_invoices_delete on sales_invoices for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

drop policy if exists incoming_payments_select on public.incoming_payments;
drop policy if exists incoming_payments_insert on public.incoming_payments;
drop policy if exists incoming_payments_update on public.incoming_payments;
drop policy if exists incoming_payments_delete on public.incoming_payments;

create policy incoming_payments_select on incoming_payments for select
  using (org_id = auth_org_id() and is_active_member());
create policy incoming_payments_insert on incoming_payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
create policy incoming_payments_update on incoming_payments for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy incoming_payments_delete on incoming_payments for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));

-- ============================================================================
-- §2 — BLOCK #11 (DB half): a linked row may not be deleted while an external money command
-- referencing it is still IN FLIGHT.
--
-- The window: `dispatchFactory.assertRevenueLinksSameOrg` validates customerId/projectId/
-- salesInvoiceId BEFORE any ERP work, then the ERP POST creates REAL money, and only then does the
-- mirror writer try to insert the PMO row. An Admin deleting the linked project/customer/invoice in
-- between produced ERP money that no PMO row could ever reference, with finalization hard-failing on
-- the missing FK forever.
--
-- A row lock cannot span the ERP HTTP call (a stateless edge function holds no transaction across
-- it), so the window is closed from the OTHER side: while this command's outbox row is unresolved,
-- the rows it names are undeletable. Combined with the pre-flight (before) and the mirror writer's
-- tolerate-and-null (after, readModelWriters.ts BLOCK #11), the only residual exposure is a delete
-- landing between the pre-flight SELECT and the outbox INSERT — and that case now degrades to "the
-- money is mirrored with that one link nulled" (the Unassigned / on-account bucket) instead of
-- "invisible money".
--
-- Scope: the revenue money path's three links (the finding's exploit). The payload key is passed per
-- trigger so the function stays table-agnostic; `external_command_outbox.payload` is the command
-- record persisted at INSERT (adapter-dispatch/index.ts), whose revenue keys are exactly
-- projectId / customerId / salesInvoiceId.
-- ============================================================================

-- Bounds the guard's scan to unresolved rows only (confirmed/failed rows are the overwhelming
-- majority over time and are irrelevant here).
create index if not exists external_command_outbox_inflight_idx
  on public.external_command_outbox (org_id)
  where state in ('pending','committing','committed','quarantined','held');

create or replace function public.block_delete_with_inflight_external_command() returns trigger
  language plpgsql set search_path = public as $$
declare
  v_payload_key text := TG_ARGV[0];
  v_inflight int;
begin
  -- 'confirmed' (fully mirrored) and 'failed' (never committed to ERP) are RESOLVED — they hold no
  -- claim on this row. Everything else may still finalize into a mirror that needs the FK.
  select count(*) into v_inflight
    from public.external_command_outbox o
   where o.org_id = OLD.org_id
     and o.state in ('pending','committing','committed','quarantined','held')
     and o.payload ->> v_payload_key = OLD.id::text;

  if v_inflight > 0 then
    raise exception
      'cannot delete %.% — % external money command(s) referencing it are still in flight; resolve the outbox first',
      TG_TABLE_NAME, OLD.id, v_inflight
      using errcode = '55006';  -- object_in_use
  end if;
  return OLD;
end; $$;

create trigger projects_block_inflight_external_delete
  before delete on public.projects
  for each row execute function public.block_delete_with_inflight_external_command('projectId');

create trigger companies_block_inflight_external_delete
  before delete on public.companies
  for each row execute function public.block_delete_with_inflight_external_command('customerId');

create trigger sales_invoices_block_inflight_external_delete
  before delete on public.sales_invoices
  for each row execute function public.block_delete_with_inflight_external_command('salesInvoiceId');
