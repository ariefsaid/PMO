-- 0106_sales_invoices_mirror_guard_author.sql (Luna money audit — BLOCK 3)
-- sales_invoices_native_mirror_guard (0104) pinned every native field EXCEPT author_user_id — the
-- column landed in 0105 (after 0104's guard), so the guard's `is distinct from` denial set never
-- included it. On a revenue-flipped org an authenticated user could therefore UPDATE author_user_id
-- to someone else and then self-approve (defeating the submit_sales_invoice approver≠author SoD).
--
-- This migration re-creates the guard WITH author_user_id in the pinned denial set. service_role
-- still bypasses (coalesce(auth.jwt()->>'role','')='service_role' early-return) so the read-model
-- writer can stamp it on a genuine create. No schema change; trigger/function swap only.
--
-- Reversibility (pre-production): `supabase db reset`. Manual reverse: re-run 0104's original
-- sales_invoices_native_mirror_guard() body (without the author_user_id line).

create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
drop trigger if exists sales_invoices_native_mirror_guard_trg on public.sales_invoices;
create trigger sales_invoices_native_mirror_guard_trg
  before update on public.sales_invoices for each row execute function public.sales_invoices_native_mirror_guard();
