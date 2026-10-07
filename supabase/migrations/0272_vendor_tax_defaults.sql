-- 0272_vendor_tax_defaults.sql — #876 slice 2: vendor tax set up in PMO (OD-VWH-1; DD-VWH-10..12; ADR-0084).
--
--   §1 companies: the vendor's default tax treatment (DD-VWH-11) — a form PRE-FILL only. No server path reads these
--      when a bill is recorded (DD-VWH-19): the bill's entered amounts are the authority, so changing a default never
--      re-states an old bill.
--   §2 companies_tax_defaults_guard (DD-VWH-16): the three columns change only through §3. `companies` carries
--      table-level INSERT/UPDATE grants to authenticated (0075) under a four-role UPDATE policy (0097), and a column
--      REVOKE cannot subtract from a table-level grant, so the rule is a trigger honouring §3's transaction-local flag
--      (the 0252 pattern). Converting companies to column grants was rejected: every FUTURE companies column would
--      silently become client-unwritable (0175's snapshot semantics). Exempt: the service role (ERP companies mirror,
--      importers) and a session with no JWT (migrations, seed, psql).
--   §3 set_vendor_tax_defaults(): SECURITY DEFINER; active member; Admin/Finance; own org; not Internal; audited.
--      Deliberately OUTSIDE companies_native_mirror_guard: ERPNext holds no such fact for PMO to mirror.
--   §4 organizations: input_vat_account, pph23_payable_account, pph4_2_payable_account (DD-VWH-12) on the
--      tax_prepaid_account precedent (0232): column UPDATE grant + the Admin-only organizations UPDATE policy, audited.
--      The dispatch checks each account in ERPNext on send (ADR-0084 §4).
--   §5 create_procurement_invoice / capture_vendor_invoice gain p_withheld_amount numeric default 0 (DD-VWH-10) and
--      p_withheld_pph_type text default null (OQ-VWH-6, Director 2026-10-07: the PPh type is stored on every bill that
--      withholds — a no-ERP org's monthly PPh return has no GL to read it from). A non-zero withholding must name
--      pph23 or pph4_2; with nothing withheld no type is kept. Bodies are 0238's verbatim plus the parameters;
--      signature change ⇒ drop + create (0238 precedent).
--   §5a procurement_invoices.withheld_pph_type: domain-checked, not client-writable (asserted in §7), pinned by the
--      procurement mirror guard (0269 §2's body plus one line). The ERP mirror stamps it on an ERP-bound create whose
--      amounts were entered in PMO (the dispatch validated the type); a template-path or ERPNext-originated bill keeps
--      NULL (the type lives on the ERPNext payable account). No pairing CHECK with withheld_amount: a later ERPNext
--      amendment that drops the deduction must not make the mirror's write fail.
--   §6 the procurement-invoice create audit (0178 L3) also records tax_amount, withheld_amount and withheld_pph_type
--      (0232 precedent).
--   §7 on-database asserts: hosted Supabase's grant defaults differ from local Docker, so the intended function and
--      column privileges are asserted HERE, on the database being migrated.
--
-- Rollback: supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql (revert the slice-2 adapter-dispatch first —
-- it reads §4's columns and sends §5's parameter).

-- §1 — the vendor's default tax treatment.
alter table public.companies
  add column default_vat_rate numeric(6,3),
  add column default_pph_type text,
  add column default_pph_rate numeric(6,3);

alter table public.companies
  add constraint companies_default_vat_rate_range
    check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100)),
  add constraint companies_default_pph_type_domain
    check (default_pph_type is null or default_pph_type in ('pph23', 'pph4_2')),
  add constraint companies_default_pph_pair
    check ((default_pph_type is null) = (default_pph_rate is null)),
  add constraint companies_default_pph_rate_range
    check (default_pph_rate is null or (default_pph_rate > 0 and default_pph_rate < 100));

comment on column public.companies.default_vat_rate is
  '#876 slice 2 (OD-VWH-1): the VAT rate (percent) a new bill from this vendor is pre-filled with. NULL = not set; '
  '0 = the vendor charges no VAT. Pre-fill only — never read by a write path. Set via set_vendor_tax_defaults().';
comment on column public.companies.default_pph_type is
  '#876 slice 2: the income tax withheld from this vendor by default — pph23 or pph4_2; NULL = none. Set together with '
  'default_pph_rate via set_vendor_tax_defaults().';
comment on column public.companies.default_pph_rate is
  '#876 slice 2: the PPh rate (percent, above 0 and below 100) that pre-fills the tax withheld on a new bill.';

-- §2 — the only-through-§3 rule.
create or replace function public.companies_tax_defaults_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('pmo.vendor_tax_defaults_write', true), '') = 'on'
     or auth.jwt() is null
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.default_vat_rate is not null or new.default_pph_type is not null or new.default_pph_rate is not null then
      raise exception 'vendor tax defaults are changed only through set_vendor_tax_defaults' using errcode = '42501';
    end if;
  elsif new.default_vat_rate is distinct from old.default_vat_rate
     or new.default_pph_type is distinct from old.default_pph_type
     or new.default_pph_rate is distinct from old.default_pph_rate then
    raise exception 'vendor tax defaults are changed only through set_vendor_tax_defaults' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.companies_tax_defaults_guard() from public, anon, authenticated;
create trigger companies_tax_defaults_guard before insert or update on public.companies
  for each row execute function public.companies_tax_defaults_guard();

-- §3 — the one client write path.
create or replace function public.set_vendor_tax_defaults(
  p_company_id uuid, p_vat_rate numeric default null, p_pph_type text default null, p_pph_rate numeric default null)
  returns public.companies language plpgsql security definer set search_path = public as $$
declare
  v_row  public.companies;
  v_from jsonb;
begin
  perform public.assert_is_active_member();
  if auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Admin or Finance can set a vendor''s tax defaults' using errcode = '42501';
  end if;
  select * into v_row from public.companies where id = p_company_id and org_id = auth_org_id() for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_row.type = 'Internal' then
    raise exception 'an internal company has no vendor tax defaults' using errcode = 'P0001';
  end if;
  v_from := jsonb_build_object('vat_rate', v_row.default_vat_rate, 'pph_type', v_row.default_pph_type,
                               'pph_rate', v_row.default_pph_rate);
  perform set_config('pmo.vendor_tax_defaults_write', 'on', true);
  update public.companies
     set default_vat_rate = p_vat_rate,
         default_pph_type = nullif(btrim(p_pph_type), ''),
         default_pph_rate = p_pph_rate
   where id = p_company_id
   returning * into v_row;
  -- Cleared at once: the flag is transaction-local, so leaving it on would let a later direct UPDATE in the same
  -- transaction past §2 (0252's rule; AC-VWH-022 proves it).
  perform set_config('pmo.vendor_tax_defaults_write', '', true);
  perform public.log_audit('company.tax_defaults.change', v_row.org_id, auth.uid(), v_row.id,
    jsonb_build_object('from', v_from,
                       'to', jsonb_build_object('vat_rate', v_row.default_vat_rate, 'pph_type', v_row.default_pph_type,
                                                'pph_rate', v_row.default_pph_rate)));
  return v_row;
end; $$;
revoke all on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) to authenticated;
comment on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) is
  '#876 slice 2 (DD-VWH-11): sets a vendor''s default tax treatment. Active Admin/Finance member of the company''s org; '
  'not Internal; audited (company.tax_defaults.change). The only client path past companies_tax_defaults_guard.';

-- §4 — the org's vendor-bill tax accounts.
alter table public.organizations
  add column input_vat_account text
    constraint organizations_input_vat_account_check
    check (input_vat_account is null or length(btrim(input_vat_account)) between 1 and 140),
  add column pph23_payable_account text
    constraint organizations_pph23_payable_account_check
    check (pph23_payable_account is null or length(btrim(pph23_payable_account)) between 1 and 140),
  add column pph4_2_payable_account text
    constraint organizations_pph4_2_payable_account_check
    check (pph4_2_payable_account is null or length(btrim(pph4_2_payable_account)) between 1 and 140);
grant update (input_vat_account, pph23_payable_account, pph4_2_payable_account) on public.organizations to authenticated;
-- The existing own-org, active-member, Admin-only organizations UPDATE policy applies (0231/0232).

create or replace function public.audit_org_vendor_tax_accounts() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.input_vat_account is distinct from old.input_vat_account
     or new.pph23_payable_account is distinct from old.pph23_payable_account
     or new.pph4_2_payable_account is distinct from old.pph4_2_payable_account then
    perform public.log_audit('org.vendor_tax_accounts.change', new.id, auth.uid(), new.id,
      jsonb_build_object(
        'from', jsonb_build_object('input_vat', old.input_vat_account, 'pph23', old.pph23_payable_account,
                                   'pph4_2', old.pph4_2_payable_account),
        'to',   jsonb_build_object('input_vat', new.input_vat_account, 'pph23', new.pph23_payable_account,
                                   'pph4_2', new.pph4_2_payable_account)));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_vendor_tax_accounts() from public, anon, authenticated;
create trigger organizations_audit_vendor_tax_accounts after update on public.organizations
  for each row execute function public.audit_org_vendor_tax_accounts();

-- §5a — the PPh type on the bill (OQ-VWH-6).
alter table public.procurement_invoices
  add column withheld_pph_type text
    constraint procurement_invoices_withheld_pph_type_domain
    check (withheld_pph_type is null or withheld_pph_type in ('pph23', 'pph4_2'));
comment on column public.procurement_invoices.withheld_pph_type is
  '#876 slice 2 (OQ-VWH-6): the income tax type withheld on this bill — pph23 or pph4_2; NULL when nothing is withheld '
  'or the type is not known to PMO (an ERPNext template-path bill: the type is the ERPNext payable account). Written by '
  'create_procurement_invoice / capture_vendor_invoice and by the ERP mirror on an entered-amount create.';

-- The procurement mirror guard ENUMERATES its denial set (0196 §4), so the new column must be named. Body is 0269 §2's
-- verbatim plus one line; the trigger binds by OID, so `create or replace` keeps it.
create or replace function public.procurement_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.vi_number             is distinct from old.vi_number
     or new.invoice_date          is distinct from old.invoice_date
     or new.reference_number      is distinct from old.reference_number
     or new.amount                is distinct from old.amount
     or new.po_id                 is distinct from old.po_id
     or new.status                is distinct from old.status
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.erp_docstatus         is distinct from old.erp_docstatus
     or new.erp_modified          is distinct from old.erp_modified
     or new.erp_amended_from      is distinct from old.erp_amended_from
     or new.erp_cancelled_at      is distinct from old.erp_cancelled_at
     or new.currency              is distinct from old.currency   -- 0187 (#478)
     or new.tax_treatment         is distinct from old.tax_treatment -- 0196 (#505)
     or new.tax_amount            is distinct from old.tax_amount    -- 0196 (#505)
     or new.tax_rate              is distinct from old.tax_rate      -- 0196 (#505)
     or new.tax_template          is distinct from old.tax_template  -- 0196 (#505)
     or new.withheld_amount       is distinct from old.withheld_amount -- 0269 (#876)
     or new.withheld_pph_type     is distinct from old.withheld_pph_type -- 0272 (#876 slice 2)
     or new.id                    is distinct from old.id
     or new.procurement_id        is distinct from old.procurement_id
     or new.org_id                is distinct from old.org_id
     or new.created_at            is distinct from old.created_at
  then
    raise exception 'procurement_invoices native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §5 — standalone bills may record tax withheld (DD-VWH-10) and its type (OQ-VWH-6). 0238's bodies plus the two
-- parameters.
drop function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text);
drop function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text);
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0,
  p_withheld_pph_type text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  if coalesce(p_withheld_amount, 0) <> 0
     and (p_withheld_pph_type is null or btrim(p_withheld_pph_type) not in ('pph23', 'pph4_2')) then
    raise exception 'a vendor invoice that withholds tax must state the withholding type: pph23 or pph4_2'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref,
     withheld_amount, withheld_pph_type)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''),
            coalesce(p_withheld_amount, 0),
            case when coalesce(p_withheld_amount, 0) <> 0 then btrim(p_withheld_pph_type) end)
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text) from public;
grant  execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text) from anon;

create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0,
  p_withheld_pph_type text default null)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template,
    p_tax_base_numerator => p_tax_base_numerator,
    p_tax_base_denominator => p_tax_base_denominator,
    p_external_ref   => p_external_ref,
    p_withheld_amount => p_withheld_amount,
    p_withheld_pph_type => p_withheld_pph_type);

  return v_invoice;
end; $$;
revoke all     on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) from public;
grant  execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text) from anon;

-- §6 — the create audit states the VAT and the tax withheld (0178 L3 body + two keys).
create or replace function public.audit_procurement_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',          new.status::text,
                                              'amount',          new.amount,
                                              'vi_number',       new.vi_number,
                                              'procurement_id',  new.procurement_id,
                                              'tax_amount',      new.tax_amount,
                                              'withheld_amount', new.withheld_amount,
                                              'withheld_pph_type', new.withheld_pph_type));
  return new;
end; $$;

-- §7 — on-database asserts.
do $$
declare
  v_fn  regprocedure;
  v_col text;
begin
  foreach v_fn in array array[
    'public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric,text)'::regprocedure,
    'public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text)'::regprocedure,
    'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)'::regprocedure] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0272: % is executable by anon on this database — revoke it before applying', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0272: % lost its authenticated EXECUTE grant', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.companies_tax_defaults_guard()'::regprocedure,
                              'public.audit_org_vendor_tax_accounts()'::regprocedure] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0272: trigger function % is executable by a client role on this database', v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.companies'::regclass
                   and tgname = 'companies_tax_defaults_guard' and tgenabled <> 'D') then
    raise exception '0272: companies_tax_defaults_guard is not attached and enabled';
  end if;
  if has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_pph_type', 'INSERT')
     or has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_pph_type', 'UPDATE')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_pph_type', 'INSERT')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_pph_type', 'UPDATE') then
    raise exception '0272: procurement_invoices.withheld_pph_type would be client-writable on this database (see 0174/0175)';
  end if;
  foreach v_col in array array['input_vat_account','pph23_payable_account','pph4_2_payable_account'] loop
    if has_column_privilege('anon', 'public.organizations', v_col, 'UPDATE')
       or has_column_privilege('anon', 'public.organizations', v_col, 'INSERT')
       or has_column_privilege('authenticated', 'public.organizations', v_col, 'INSERT') then
      raise exception '0272: organizations.% would be writable beyond the Admin column grant on this database (see 0192)', v_col;
    end if;
    if not has_column_privilege('authenticated', 'public.organizations', v_col, 'UPDATE') then
      raise exception '0272: organizations.% is missing its authenticated UPDATE column grant', v_col;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
