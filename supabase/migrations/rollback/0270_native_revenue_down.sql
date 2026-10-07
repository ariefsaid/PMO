-- Rollback for 0270_native_revenue.sql (#784). Precondition (data, not schema): no PMO invoice or receipt exists —
--   select count(*) from public.sales_invoices where pmo_native;    -- must be 0
--   select count(*) from public.incoming_payments where pmo_native; -- must be 0
-- Dropping the columns with PMO rows present would leave them indistinguishable from mirror rows (and would drop the
-- DD-NAR-16 ERP opening stamps Finance reconciles against).

-- §7
drop trigger if exists external_domain_ownership_revenue_employable on public.external_domain_ownership;
drop function if exists public.assert_revenue_employable();
-- §5b — restore the ERP-path sales-invoice gates (0133 §B/§D/§E) and the received-date writer (0244), verbatim.
-- create-or-replace keeps their grants. Restored BEFORE §2's SoD helper is dropped (the 0270 bodies call it).
create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row      public.sales_invoices;
  v_uid      uuid := auth.uid();
  v_authors  int;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- (0124/0130 predicates preserved) org + still-an-active-member; the ROLE set is the revenue write
  -- set (finding 3, owner ruling 2026-07-20) rather than the four master-data money roles.
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_si_id;

  -- (0127 §B, preserved) FAIL CLOSED on an unknown author.
  if v_authors = 0 and v_row.author_user_id is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- (0132 DEFECT 1, preserved) NOBODY WHO EVER WROTE THE BODY MAY APPROVE.
  if v_row.author_user_id = v_uid
     or exists (select 1 from public.sales_invoice_authors a
                 where a.sales_invoice_id = p_si_id and a.user_id = v_uid)
  then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  return v_row;
end; $$;

create or replace function public.claim_sales_invoice_author(p_si_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row  public.sales_invoices;
  v_uid  uuid := auth.uid();
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  -- No PMO row yet: nothing to protect, and no submit can race an invoice that does not exist.
  if not found then
    return;
  end if;

  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Refuse while ANY submit clearance is OUTSTANDING (granted within the TTL, invoice not yet at ERP —
  -- docstatus 1 = submitted, 2 = cancelled, both meaning the clearance is consumed or moot and the
  -- amend path must stay open).
  if exists (
    select 1 from public.sales_invoice_submit_authorizations s
     where s.sales_invoice_id = p_si_id
       and s.authorized_at > now() - public.si_submit_clearance_ttl()
       and coalesce(v_row.erp_docstatus, 0) < 1
  ) then
    raise exception 'a submit authorization is outstanding for this sales invoice — its body cannot be rewritten'
      using errcode = '55006',  -- object_in_use
            detail = 'si-submit-in-progress';
  end if;

  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  values (v_row.org_id, p_si_id, v_uid)
  on conflict do nothing;
end; $$;

create or replace function public.grant_sales_invoice_submit_clearance(
  p_si_id uuid,
  p_actor_id uuid,
  p_clearance_id uuid
) returns public.sales_invoices
language plpgsql security definer set search_path = public as $$
declare
  v_row        public.sales_invoices;
  v_actor_org  uuid;
  v_actor_role user_role;
  v_active     boolean;
  v_authors    int;
begin
  if p_actor_id is null or p_clearance_id is null then
    raise exception 'grant_sales_invoice_submit_clearance requires an actor and a clearance id'
      using errcode = '22023';
  end if;

  -- The SAME lock claim_sales_invoice_author takes — the serialization point for the whole rule.
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  -- The actor's own org/role/active-membership (the auth_org_id()/auth_role()/is_active_member()
  -- predicates, re-expressed for an explicit actor because service_role has no auth.uid()).
  select p.org_id, p.role, (p.status = 'active' and (u.banned_until is null or u.banned_until <= now()))
    into v_actor_org, v_actor_role, v_active
    from public.profiles p join auth.users u on u.id = p.id
   where p.id = p_actor_id;

  if v_actor_org is null
     or v_row.org_id is distinct from v_actor_org
     or v_actor_role not in ('Admin','Finance')
     or not coalesce(v_active, false)
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_authors
    from public.sales_invoice_authors a
   where a.sales_invoice_id = p_si_id;

  -- (0127 §B, preserved) FAIL CLOSED on an unknown author.
  if v_authors = 0 and v_row.author_user_id is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- (0132 DEFECT 1, preserved) NOBODY WHO EVER WROTE THE BODY MAY APPROVE.
  if v_row.author_user_id = p_actor_id
     or exists (select 1 from public.sales_invoice_authors a
                 where a.sales_invoice_id = p_si_id and a.user_id = p_actor_id)
  then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  -- Record THIS dispatch's clearance while the row is still locked. A body rewrite arriving after this
  -- commit is refused by §D; one that arrived before it is already in the author set checked above.
  insert into public.sales_invoice_submit_authorizations
    (sales_invoice_id, clearance_id, org_id, user_id, authorized_at)
  values (p_si_id, p_clearance_id, v_row.org_id, p_actor_id, now())
  on conflict (sales_invoice_id, clearance_id) do update
    set authorized_at = excluded.authorized_at;

  return v_row;
end; $$;

create or replace function public.set_sales_invoice_received_date(p_si_id uuid, p_received_date date)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row public.sales_invoices;
begin
  select * into v_row from public.sales_invoices where id = p_si_id for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  -- Org comes from the row; same revenue write set as submit/cancel (Admin + Finance); offboarded
  -- members refused (0130).
  if v_row.org_id is distinct from auth_org_id()
     or auth_role() not in ('Admin','Finance')
     or not is_active_member()
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_row.status = 'Cancelled' then
    raise exception 'cannot record a receipt date on a cancelled invoice' using errcode = '23514';
  end if;
  if p_received_date is not null and v_row.invoice_date is not null and p_received_date < v_row.invoice_date then
    raise exception 'the received date cannot be before the invoice date' using errcode = '23514';
  end if;
  update public.sales_invoices set received_date = p_received_date where id = p_si_id
    returning * into v_row;
  return v_row;
end; $$;

-- §5, §4, §3
drop trigger if exists incoming_payments_not_on_native_invoice on public.incoming_payments;
drop function if exists public.incoming_payments_not_on_native_invoice();
drop function if exists public.cancel_native_receipt(uuid);
drop function if exists public.record_native_receipt(uuid, numeric, numeric, numeric, text, date);
drop function if exists public.transition_native_sales_invoice(uuid, text);
drop function if exists public.create_native_sales_invoice(uuid, uuid, jsonb, uuid);
-- §2
drop function if exists public.native_invoice_restate(uuid);
drop function if exists public.assert_sales_invoice_approver(uuid, uuid, uuid);
drop function if exists public.native_revenue_doc_number(uuid, text, date);
drop function if exists public.native_org_today(uuid);
drop function if exists public.native_invoice_settled(uuid, uuid);
drop function if exists public.native_invoice_gross(numeric, numeric, text);

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
