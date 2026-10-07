-- Rollback for 0270_native_revenue.sql (#784). Precondition (data, not schema): no PMO invoice or receipt exists —
--   select count(*) from public.sales_invoices where pmo_native;    -- must be 0
--   select count(*) from public.incoming_payments where pmo_native; -- must be 0
-- Dropping the columns with PMO rows present would leave them indistinguishable from mirror rows (and would drop the
-- DD-NAR-16 ERP opening stamps Finance reconciles against).

-- §7
drop trigger if exists external_domain_ownership_revenue_employable on public.external_domain_ownership;
drop function if exists public.assert_revenue_employable();
-- §5, §4, §3, §2
drop function if exists public.cancel_native_receipt(uuid);
drop function if exists public.record_native_receipt(uuid, numeric, numeric, numeric, text, date);
drop function if exists public.transition_native_sales_invoice(uuid, text);
drop function if exists public.create_native_sales_invoice(uuid, uuid, jsonb, uuid);
drop function if exists public.native_invoice_settled(uuid);

-- §6 — restore the guards' previous bodies (0193 for sales_invoices, 0232 for incoming_payments), verbatim.
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
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create or replace function public.incoming_payments_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.ip_number is distinct from old.ip_number
     or new.customer_id is distinct from old.customer_id
     or new.sales_invoice_id is distinct from old.sales_invoice_id
     or new.reference_number is distinct from old.reference_number
     or new.date is distinct from old.date
     or new.amount is distinct from old.amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.received_amount is distinct from old.received_amount
     or new.withheld_amount is distinct from old.withheld_amount
     or new.withholding_slip_number is distinct from old.withholding_slip_number
     or new.currency is distinct from old.currency               -- 0187 (#478)
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'incoming_payments native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §8 — restore 0128's write policies and their 0177/0178 comments.
drop policy if exists sales_invoices_insert on public.sales_invoices;
create policy sales_invoices_insert on public.sales_invoices for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists sales_invoices_update on public.sales_invoices;
create policy sales_invoices_update on public.sales_invoices for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
drop policy if exists sales_invoices_delete on public.sales_invoices;
create policy sales_invoices_delete on public.sales_invoices for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_insert on public.incoming_payments;
create policy incoming_payments_insert on public.incoming_payments for insert
  with check (org_id = auth_org_id() and is_active_member()
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
drop policy if exists incoming_payments_update on public.incoming_payments;
create policy incoming_payments_update on public.incoming_payments for update
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance'));
drop policy if exists incoming_payments_delete on public.incoming_payments;
create policy incoming_payments_delete on public.incoming_payments for delete
  using (org_id = auth_org_id() and is_active_member() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and not public.domain_externally_owned(auth_org_id(), 'revenue'));
comment on policy sales_invoices_delete on public.sales_invoices is
  'DEAD SINCE 0177 and kept deliberately: the DELETE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants DELETE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole deleter is the '
  'service-role mirror writer; every delete is audited by sales_invoices_audit_delete.';
comment on policy incoming_payments_delete on public.incoming_payments is
  'DEAD SINCE 0177 and kept deliberately — see the comment on sales_invoices_delete.';
comment on policy incoming_payments_update on public.incoming_payments is
  'DEAD SINCE 0178 and kept deliberately: the UPDATE grant to authenticated/anon is revoked, so this '
  'policy is never reached. It stays as the second layer if a future migration re-grants UPDATE — '
  'dropping it would make such a re-grant fully open instead of 4-role gated. The sole updater is the '
  'service-role mirror writer. Mirrors the comment 0177 put on incoming_payments_delete.';

-- §1
drop index if exists public.incoming_payments_org_pmo_number_uidx;
drop index if exists public.sales_invoices_native_draft_idx;
drop index if exists public.sales_invoices_org_pmo_number_uidx;
alter table public.incoming_payments
  drop constraint if exists incoming_payments_pmo_native_shape,
  drop column if exists cancelled_at,
  drop column if exists pmo_number,
  drop column if exists pmo_native;
alter table public.sales_invoices
  drop constraint if exists sales_invoices_erp_opening_shape,
  drop constraint if exists sales_invoices_overpaid_amount_shape,
  drop constraint if exists sales_invoices_pmo_native_shape,
  drop column if exists erp_opening_at,
  drop column if exists erp_opening_amount,
  drop column if exists overpaid_amount,
  drop column if exists approved_at,
  drop column if exists approved_by_id,
  drop column if exists native_lines,
  drop column if exists pmo_number,
  drop column if exists pmo_native;
