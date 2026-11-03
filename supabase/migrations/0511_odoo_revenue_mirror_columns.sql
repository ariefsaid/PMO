-- 0511_odoo_revenue_mirror_columns.sql (#1506 O3 C3; AC-OCI-013, AC-OCI-030, AC-OCI-070 partial; FR-OCI-014, 022a, 024, 100)
-- What the Odoo tier adds to the sales_invoices mirror for a pushed invoice (C3-T1, after reading 0123/0188/0275/0498): the invoice's
-- money already has columns (amount = Odoo's grand total, tax_amount, erp_outstanding_amount = Odoo's residual), so only the facts that
-- have no column yet are added:
--   odoo_state      the Odoo move's state at the last read (draft | posted | cancel)
--   odoo_attention  why the invoice needs a person: Odoo's total differs from the figure PMO sent, a posted line lacks the project's
--                   cost account, or the read-back could not be trusted. NULL = nothing to look at. Nothing is deleted or reversed.
--   odoo_sent_total the figure PMO sent, kept beside Odoo's amount when they differ (PMO's number is never silently replaced)
--   odoo_read_at    when the row was last read from Odoo (the as-of age the screens show)
-- Tombstones and the credit-note link arrive with the inbound feed (0513, C6). Written only by the service-role mirror writer: the
-- guard below pins the four columns against every non-service caller (history, ownership and the 0498 pair pin are unchanged).
-- Reversal: rollback/0511_odoo_revenue_mirror_columns_down.sql.

alter table public.sales_invoices
  add column odoo_state text check (odoo_state in ('draft','posted','cancel')),
  add column odoo_attention text check (odoo_attention in ('total-mismatch','cost-account-missing','money-unreadable','lines-unreadable')),
  add column odoo_sent_total numeric(14,2),
  add column odoo_read_at timestamptz;
comment on column public.sales_invoices.odoo_attention is
  'Why an Odoo-held invoice needs a person (set by the mirror writer only). The invoice is never changed or reversed automatically.';

comment on column public.sales_invoices.native_lines is
  '#784 DD-NAR-8: the lines of a PMO invoice as raised - [{item_code, description, qty, rate, amount}]; amount = round(qty x rate, 2). Fixed at creation. #1506: an Odoo-tier invoice draft (pmo_native false, no Odoo document yet) keeps its lines here until its approval pushes them in one command; written by the dispatch only.';

-- Draft edits and the dispatch-only submit clearance share this row lock. Checking the clearance and
-- updating the lines in one RPC prevents an edit that passed an earlier read from changing the
-- invoice after an approval has begun.
create or replace function public.update_odoo_sales_invoice_draft(
  p_org_id uuid,
  p_si_id uuid,
  p_actor_id uuid,
  p_update_native_lines boolean,
  p_native_lines jsonb,
  p_amount numeric,
  p_update_reference_number boolean,
  p_reference_number text
) returns void
language plpgsql set search_path = public as $$
declare
  v_row public.sales_invoices;
  v_actor_org uuid;
  v_actor_role text;
begin
  if p_org_id is null or p_si_id is null or p_actor_id is null
     or p_update_native_lines is null or p_update_reference_number is null
     or (not p_update_native_lines and not p_update_reference_number)
     or (p_update_native_lines and (
       p_native_lines is null or jsonb_typeof(p_native_lines) is distinct from 'array'
       or p_amount is null or p_amount < 0
     )) then
    raise exception 'invalid Odoo invoice draft update' using errcode = '22023';
  end if;

  select * into v_row
    from public.sales_invoices
   where org_id = p_org_id and id = p_si_id
   for update;
  if not found then
    raise exception 'invoice-draft-missing' using errcode = 'P0002';
  end if;

  select p.org_id, p.role::text into v_actor_org, v_actor_role
    from public.profiles p
   where p.id = p_actor_id and p.status = 'active';
  if v_actor_org is distinct from p_org_id
     or v_actor_role not in ('Admin','Finance')
     or not exists (
       select 1 from public.external_domain_ownership o
        where o.org_id = p_org_id and o.external_tier = 'odoo' and o.domain = 'revenue'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_row.pmo_native is distinct from false or v_row.status is distinct from 'Draft' or v_row.erp_docstatus is not null
     or exists (
       select 1 from public.external_refs r
        where r.org_id = p_org_id and r.domain = 'revenue' and r.external_tier = 'odoo' and r.pmo_record_id = p_si_id::text
     ) then
    raise exception 'invoice-not-a-draft' using errcode = '55000';
  end if;

  if (coalesce(v_row.erp_docstatus, 0) < 1 and exists (
       select 1 from public.sales_invoice_submit_authorizations s
        where s.sales_invoice_id = p_si_id and s.authorized_at > now() - public.si_submit_clearance_ttl()
     )) or exists (
       select 1 from public.external_command_outbox o
        where o.org_id = p_org_id and o.domain = 'revenue' and o.pmo_record_id = p_si_id::text
     ) then
    raise exception 'invoice-approval-started' using errcode = '55006';
  end if;

  update public.sales_invoices
     set native_lines = case when p_update_native_lines then p_native_lines else v_row.native_lines end,
         amount = case when p_update_native_lines then p_amount else v_row.amount end,
         reference_number = case when p_update_reference_number then p_reference_number else v_row.reference_number end,
         author_user_id = p_actor_id
   where org_id = p_org_id and id = p_si_id;

  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  values (p_org_id, p_si_id, p_actor_id)
  on conflict (sales_invoice_id, user_id) do nothing;
end; $$;

revoke all on function public.update_odoo_sales_invoice_draft(uuid,uuid,uuid,boolean,jsonb,numeric,boolean,text) from public, anon, authenticated;
grant execute on function public.update_odoo_sales_invoice_draft(uuid,uuid,uuid,boolean,jsonb,numeric,boolean,text) to service_role;
comment on function public.update_odoo_sales_invoice_draft(uuid,uuid,uuid,boolean,jsonb,numeric,boolean,text) is
  'Atomically updates an Odoo-tier PMO invoice draft under the same invoice-row lock used by submit clearances; service-role dispatcher only.';

-- The catalog gate fails on an unclassified column: these are read-side facts, not history events.
update public.record_history_config
   set omit_cols = omit_cols || array['odoo_state','odoo_attention','odoo_sent_total','odoo_read_at']
 where entity_type = 'sales_invoice';

-- Mirror guard: 0498 body verbatim + the Odoo-fact pin.
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  -- 0511 (#1506 C3): the Odoo facts are written only by the service-role mirror writer. Pinned before the externally-owned early
  -- return, so a person never sets them directly, whoever owns revenue (the client UPDATE grant is already revoked, 0176; this is the trigger layer).
  if new.odoo_state is distinct from old.odoo_state
     or new.odoo_attention is distinct from old.odoo_attention
     or new.odoo_sent_total is distinct from old.odoo_sent_total
     or new.odoo_read_at is distinct from old.odoo_read_at then
    raise exception 'the Odoo facts of an invoice are written only by the mirror' using errcode = '42501';
  end if;
  -- 0498 (#1602): the pair columns are written only by accept_invoice_pairs (a definer, current_user = postgres, flag set
  -- in its own transaction). Pinned before the externally-owned early return: a person never sets them directly.
  if (new.paired_erp_invoice_id is distinct from old.paired_erp_invoice_id
      or new.paired_at is distinct from old.paired_at
      or new.paired_by is distinct from old.paired_by
      or new.paired_filled is distinct from old.paired_filled)
     and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on') then
    raise exception 'an invoice is paired only by accepting a proposed pair' using errcode = '42501';
  end if;
  -- A paired copy counts through its ERP invoice: no native status, amount or balance write, even if PMO later owns revenue again.
  if old.paired_erp_invoice_id is not null and new.paired_erp_invoice_id is not distinct from old.paired_erp_invoice_id
     and (new.status is distinct from old.status or new.amount is distinct from old.amount
          or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
          or new.overpaid_amount is distinct from old.overpaid_amount
          or new.native_lines is distinct from old.native_lines) then
    raise exception 'a paired invoice counts through its ERP invoice and cannot be changed in PMO' using errcode = '42501';
  end if;
  if new.erp_project is distinct from old.erp_project then
    raise exception 'ERP project provenance is read-only' using errcode = '42501';
  end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or (new.project_id is distinct from old.project_id and current_user <> 'postgres')
     or (new.billing_kind is distinct from old.billing_kind and current_user <> 'postgres') -- 0410 (#1471): only the definer RPCs change it
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
     or (new.work_order_id is distinct from old.work_order_id    -- 0193 (#498): which scope grant this bills
         and not (current_user = 'postgres' and coalesce(current_setting('pmo.invoice_pairing', true), '') = 'on')) -- 0498: accept fills an empty one, unpair clears what it filled
     or new.pmo_native is distinct from old.pmo_native           -- 0275 (#784)
     or new.pmo_number is distinct from old.pmo_number           -- 0275 (#784)
     or new.native_lines is distinct from old.native_lines       -- 0275 (#784)
     or new.approved_by_id is distinct from old.approved_by_id   -- 0275 (#784)
     or new.approved_at is distinct from old.approved_at         -- 0275 (#784)
     or new.overpaid_amount is distinct from old.overpaid_amount -- 0275 (#784, DD-NAR-17)
     or new.erp_opening_amount is distinct from old.erp_opening_amount -- 0275 (#784, DD-NAR-16)
     or new.erp_opening_at is distinct from old.erp_opening_at   -- 0275 (#784, DD-NAR-16)
     or (old.pmo_native and new.received_date is distinct from old.received_date) -- 0275: a PMO invoice is frozen whole
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;
