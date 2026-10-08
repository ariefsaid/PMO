-- #911 vendor withholding slips (PMO-only evidence; never an ERP write).
-- Placeholder 0278 as assigned by the signed build brief.

-- Composite targets required by tenant-preserving foreign keys. These are additive keys.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.companies'::regclass and contype='u' and conkey = (select array_agg(attnum order by attnum) from pg_attribute where attrelid='public.companies'::regclass and attname in ('org_id','id'))) then
    alter table public.companies add constraint bupot_companies_org_id_id_uq unique (org_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.procurements'::regclass and contype='u' and conkey = (select array_agg(attnum order by attnum) from pg_attribute where attrelid='public.procurements'::regclass and attname in ('org_id','id'))) then
    alter table public.procurements add constraint bupot_procurements_org_id_id_uq unique (org_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.procurement_invoices'::regclass and contype='u' and conkey = (select array_agg(attnum order by attnum) from pg_attribute where attrelid='public.procurement_invoices'::regclass and attname in ('org_id','id'))) then
    alter table public.procurement_invoices add constraint bupot_invoices_org_id_id_uq unique (org_id,id);
  end if;
end $$;

create table public.vendor_withholding_slips (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  vendor_id uuid not null,
  slip_number text not null,
  slip_date date not null,
  tax_period date not null,
  pph_type text not null check (pph_type in ('pph23','pph4_2')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  tax_base numeric(14,2) not null,
  withheld_amount numeric(14,2) not null,
  invoice_count integer not null check (invoice_count between 1 and 100),
  status text not null default 'active' check (status in ('active','void')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  create_payload jsonb not null,
  unique (org_id,id),
  foreign key (org_id,vendor_id) references public.companies(org_id,id) on delete restrict,
  check (slip_number = btrim(slip_number) and length(slip_number) between 1 and 100 and slip_number !~ '[[:cntrl:]]'),
  check (tax_base > 0 and tax_base < 'Infinity'::numeric and tax_base <= 999999999999.99),
  check (withheld_amount > 0 and withheld_amount < 'Infinity'::numeric and withheld_amount <= 999999999999.99 and withheld_amount <= tax_base),
  check (tax_period = date_trunc('month',tax_period)::date),
  check ((status='active' and voided_by is null and voided_at is null and void_reason is null)
      or (status='void' and voided_by is not null and voided_at is not null and length(btrim(void_reason)) between 1 and 500))
);
create unique index vendor_withholding_slips_number_uq on public.vendor_withholding_slips(org_id,lower(btrim(slip_number))) where status='active';
create index vendor_withholding_slips_register_idx on public.vendor_withholding_slips(org_id,tax_period desc,id desc);
create index vendor_withholding_slips_vendor_idx on public.vendor_withholding_slips(org_id,vendor_id,tax_period desc,id desc);

create table public.vendor_withholding_slip_bills (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  slip_id uuid not null,
  invoice_id uuid not null,
  procurement_id uuid not null,
  withheld_at_record numeric(14,2) not null check (withheld_at_record > 0 and withheld_at_record < 'Infinity'::numeric),
  pph_type_at_record text check (pph_type_at_record in ('pph23','pph4_2')),
  type_source text not null check (type_source in ('bill','declared')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  unique(slip_id,invoice_id),
  foreign key(org_id,slip_id) references public.vendor_withholding_slips(org_id,id) on delete restrict,
  foreign key(org_id,invoice_id) references public.procurement_invoices(org_id,id) on delete restrict,
  foreign key(org_id,procurement_id) references public.procurements(org_id,id) on delete restrict,
  check ((type_source='declared' and pph_type_at_record is null) or type_source='bill')
);
create unique index vendor_withholding_slip_bills_active_invoice_uq on public.vendor_withholding_slip_bills(org_id,invoice_id) where released_at is null;
create index vendor_withholding_slip_bills_slip_idx on public.vendor_withholding_slip_bills(org_id,slip_id,invoice_id);
create index vendor_withholding_slip_bills_procurement_idx on public.vendor_withholding_slip_bills(org_id,procurement_id,invoice_id);
create index vendor_withholding_slip_bills_invoice_history_idx on public.vendor_withholding_slip_bills(org_id,invoice_id,slip_id);

alter table public.vendor_withholding_slips enable row level security;
alter table public.vendor_withholding_slips force row level security;
alter table public.vendor_withholding_slip_bills enable row level security;
alter table public.vendor_withholding_slip_bills force row level security;
revoke all on public.vendor_withholding_slips,public.vendor_withholding_slip_bills from public,anon,authenticated;
grant select (id,org_id,vendor_id,slip_number,slip_date,tax_period,pph_type,currency,tax_base,withheld_amount,invoice_count,status,revision,created_by,created_at,updated_at,voided_by,voided_at,void_reason) on public.vendor_withholding_slips to authenticated;
grant select on public.vendor_withholding_slip_bills to authenticated;
create policy vendor_withholding_slips_select on public.vendor_withholding_slips for select to authenticated using
 (vendor_withholding_slips.org_id=public.auth_org_id() and public.is_active_member() and exists(select 1 from public.companies c where c.id=vendor_withholding_slips.vendor_id and c.org_id=vendor_withholding_slips.org_id));
create policy vendor_withholding_slip_bills_select on public.vendor_withholding_slip_bills for select to authenticated using
 (vendor_withholding_slip_bills.org_id=public.auth_org_id() and public.is_active_member() and exists(select 1 from public.procurement_invoices i where i.id=vendor_withholding_slip_bills.invoice_id and i.org_id=vendor_withholding_slip_bills.org_id));

create or replace function public.assert_vendor_withholding_slip_integrity() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare sid uuid; h public.vendor_withholding_slips%rowtype; n integer; s numeric; bad boolean;
begin
 sid := case when tg_table_name='vendor_withholding_slips' then coalesce(new.id,old.id) else coalesce(new.slip_id,old.slip_id) end;
 select * into h from public.vendor_withholding_slips where id=sid;
 if not found then return null; end if;
 select count(*),coalesce(sum(withheld_at_record),0),bool_or(org_id<>h.org_id or currency<>h.currency or (pph_type_at_record is not null and pph_type_at_record<>h.pph_type))
 into n,s,bad from public.vendor_withholding_slip_bills where slip_id=sid;
 if n<>h.invoice_count or n<1 or s<>h.withheld_amount or coalesce(bad,false) then raise exception 'invalid retained slip snapshots' using errcode='23514'; end if;
 if (h.status='active' and exists(select 1 from public.vendor_withholding_slip_bills where slip_id=sid and released_at is not null))
 or (h.status='void' and exists(select 1 from public.vendor_withholding_slip_bills where slip_id=sid and released_at is distinct from h.voided_at)) then raise exception 'invalid slip release state' using errcode='23514'; end if;
 return null;
end $$;
revoke all on function public.assert_vendor_withholding_slip_integrity() from public,anon,authenticated;
create constraint trigger vendor_withholding_slips_integrity after insert or update or delete on public.vendor_withholding_slips deferrable initially deferred for each row execute function public.assert_vendor_withholding_slip_integrity();
create constraint trigger vendor_withholding_slip_bills_integrity after insert or update or delete on public.vendor_withholding_slip_bills deferrable initially deferred for each row execute function public.assert_vendor_withholding_slip_integrity();

-- Authenticated writers: the JWT, never caller arguments, supplies org and actor.
create or replace function public.record_vendor_withholding_slip(
 p_slip_id uuid,p_vendor_id uuid,p_slip_number text,p_slip_date date,p_tax_period date,p_pph_type text,
 p_tax_base numeric,p_withheld_amount numeric,p_invoice_ids uuid[],p_declared_invoice_ids uuid[] default '{}')
returns table(slip_id uuid,revision integer)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_org uuid:=public.auth_org_id(); v_actor uuid:=auth.uid(); v_tz text; v_payload jsonb; v_existing public.vendor_withholding_slips%rowtype;
 v_count integer; v_sum numeric; v_vendor uuid; v_currency text; v_currency_count integer; v_bad integer; v_today date; v_month date; v_unknown uuid[];
begin
 perform public.assert_is_active_member();
 if v_actor is null or public.auth_role() not in ('Admin','Finance') then raise exception using errcode='42501',detail='bupot-not-permitted'; end if;
 if v_org is null or p_slip_id is null or p_vendor_id is null or p_slip_date is null or p_tax_period is null
    or p_pph_type is null or p_pph_type not in ('pph23','pph4_2') or p_slip_number is null or length(btrim(p_slip_number)) not between 1 and 100
    or btrim(p_slip_number) ~ '[[:cntrl:]]' or p_tax_base is null or p_withheld_amount is null
    or p_tax_base<>round(p_tax_base,2) or p_withheld_amount<>round(p_withheld_amount,2)
    or p_tax_base<=0 or p_withheld_amount<=0 or p_tax_base>999999999999.99 or p_withheld_amount>p_tax_base
    or p_tax_base='NaN'::numeric or p_withheld_amount='NaN'::numeric
    or coalesce(cardinality(p_invoice_ids),0) not between 1 and 100
    or exists(select 1 from unnest(p_invoice_ids) x where x is null)
    or (select count(distinct x) from unnest(p_invoice_ids) x)<>cardinality(p_invoice_ids)
    or exists(select 1 from unnest(coalesce(p_declared_invoice_ids,'{}')) x where x is null)
    or (select count(distinct x) from unnest(coalesce(p_declared_invoice_ids,'{}')) x)<>cardinality(coalesce(p_declared_invoice_ids,'{}'))
 then raise exception using errcode='23514',detail='bupot-invalid-facts'; end if;
 select coalesce(default_timezone,'UTC') into v_tz from public.organizations where id=v_org;
 v_today := (now() at time zone coalesce(v_tz,'UTC'))::date; v_month:=date_trunc('month',v_today)::date;
 if p_slip_date>v_today or p_tax_period>v_month or p_tax_period<>date_trunc('month',p_tax_period)::date then raise exception using errcode='23514',detail='bupot-invalid-facts'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vendor-withholding-slip:'||v_org::text,0));
 v_payload:=jsonb_build_object('vendor_id',p_vendor_id,'slip_number',btrim(p_slip_number),'slip_date',p_slip_date,'tax_period',p_tax_period,'pph_type',p_pph_type,'tax_base',p_tax_base::text,'withheld_amount',p_withheld_amount::text,'invoice_ids',(select jsonb_agg(x order by x) from unnest(p_invoice_ids) x),'declared_invoice_ids',(select jsonb_agg(x order by x) from unnest(coalesce(p_declared_invoice_ids,'{}')) x));
 select * into v_existing from public.vendor_withholding_slips h where h.org_id=v_org and h.id=p_slip_id;
 if found then
   if v_existing.create_payload=v_payload then return query select p_slip_id,v_existing.revision; return; end if;
   raise exception using errcode='23505',detail='bupot-intent-conflict';
 end if;
 if exists(select 1 from public.vendor_withholding_slips h where h.id=p_slip_id) then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 if not exists(select 1 from public.companies c where c.id=p_vendor_id and c.org_id=v_org and c.type='Vendor') then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 perform 1 from public.procurements p join public.procurement_invoices i on i.procurement_id=p.id and i.org_id=p.org_id
  where p.org_id=v_org and i.id=any(p_invoice_ids) order by p.id for share of p;
 perform 1 from public.procurement_invoices i where i.org_id=v_org and i.id=any(p_invoice_ids) order by i.id for update;
 select count(*)::integer,coalesce(sum(i.withheld_amount),0),(array_agg(p.vendor_id))[1],(array_agg(i.currency))[1],
        count(*) filter(where i.withheld_pph_type is not null and i.withheld_pph_type<>p_pph_type)::integer,
        count(distinct i.currency)::integer
 into v_count,v_sum,v_vendor,v_currency,v_bad,v_currency_count from public.procurement_invoices i join public.procurements p on p.id=i.procurement_id and p.org_id=i.org_id
 where i.org_id=v_org and i.id=any(p_invoice_ids) and p.vendor_id=p_vendor_id and i.withheld_amount>0
  and coalesce(i.erp_docstatus,0)<>2 and i.erp_cancelled_at is null and p.status<>'Cancelled';
 if v_count<>cardinality(p_invoice_ids) or v_vendor is distinct from p_vendor_id or v_bad<>0 or v_currency_count<>1 then raise exception using errcode='23514',detail='bupot-ineligible-bill'; end if;
 select array_agg(i.id order by i.id) into v_unknown from public.procurement_invoices i where i.org_id=v_org and i.id=any(p_invoice_ids) and i.withheld_pph_type is null;
 if coalesce(v_unknown,'{}') is distinct from coalesce((select array_agg(x order by x) from unnest(coalesce(p_declared_invoice_ids,'{}')) x),'{}') then raise exception using errcode='23514',detail='bupot-type-confirmation'; end if;
 if v_sum<>p_withheld_amount then raise exception using errcode='23514',detail='bupot-amount-mismatch'; end if;
 if exists(select 1 from public.procurement_invoices i where i.org_id=v_org and i.id=any(p_invoice_ids) and i.currency is distinct from v_currency) then raise exception using errcode='23514',detail='bupot-ineligible-bill'; end if;
 insert into public.vendor_withholding_slips(id,org_id,vendor_id,slip_number,slip_date,tax_period,pph_type,currency,tax_base,withheld_amount,invoice_count,created_by,create_payload)
 values(p_slip_id,v_org,p_vendor_id,btrim(p_slip_number),p_slip_date,p_tax_period,p_pph_type,v_currency,p_tax_base,p_withheld_amount,v_count,v_actor,v_payload);
 insert into public.vendor_withholding_slip_bills(org_id,slip_id,invoice_id,procurement_id,withheld_at_record,pph_type_at_record,type_source,currency)
 select v_org,p_slip_id,i.id,i.procurement_id,i.withheld_amount,i.withheld_pph_type,case when i.withheld_pph_type is null then 'declared' else 'bill' end,i.currency
 from public.procurement_invoices i where i.org_id=v_org and i.id=any(p_invoice_ids) order by i.id;
 perform public.log_audit('vendor_withholding_slip.record',v_org,v_actor,p_slip_id,jsonb_build_object('invoice_ids',p_invoice_ids,'tax_base',p_tax_base,'withheld_amount',p_withheld_amount,'pph_type',p_pph_type));
 return query select p_slip_id,1;
exception when unique_violation then raise exception using errcode='23505',detail=case when sqlerrm like '%number%' then 'bupot-number-conflict' else 'bupot-bill-covered' end;
end $$;

create or replace function public.correct_vendor_withholding_slip(p_slip_id uuid,p_expected_revision integer,p_slip_number text,p_slip_date date,p_tax_period date,p_reason text)
returns table(slip_id uuid,revision integer) language plpgsql security definer set search_path=pg_catalog,public as $$
declare h public.vendor_withholding_slips%rowtype; a uuid:=auth.uid(); n integer; v_tz text; v_today date;
begin
 perform public.assert_is_active_member(); if a is null or public.auth_role() not in ('Admin','Finance') then raise exception using errcode='42501',detail='bupot-not-permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vendor-withholding-slip:'||public.auth_org_id()::text,0));
 select * into h from public.vendor_withholding_slips where id=p_slip_id and org_id=public.auth_org_id() for update;
 if not found then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 if h.status<>'active' then raise exception using errcode='23514',detail='bupot-voided'; end if;
 if h.revision<>p_expected_revision then raise exception using errcode='40001',detail='bupot-stale'; end if;
 select coalesce(default_timezone,'UTC') into v_tz from public.organizations where id=public.auth_org_id();
 v_today := (now() at time zone coalesce(v_tz,'UTC'))::date;
 if p_reason is null or p_slip_number is null or p_slip_date is null or p_tax_period is null
    or length(btrim(p_reason)) not between 1 and 500 or length(btrim(p_slip_number)) not between 1 and 100
    or btrim(p_slip_number) ~ '[[:cntrl:]]' or p_slip_date>v_today or p_tax_period>date_trunc('month',v_today)::date
    or p_tax_period<>date_trunc('month',p_tax_period)::date then raise exception using errcode='23514',detail='bupot-invalid-facts'; end if;
 if h.slip_number=btrim(p_slip_number) and h.slip_date=p_slip_date and h.tax_period=p_tax_period then return query select h.id,h.revision; return; end if;
 update public.vendor_withholding_slips set slip_number=btrim(p_slip_number),slip_date=p_slip_date,tax_period=p_tax_period,revision=revision+1,updated_at=clock_timestamp() where id=h.id returning public.vendor_withholding_slips.revision into n;
 perform public.log_audit('vendor_withholding_slip.correct',h.org_id,a,h.id,jsonb_build_object('reason',btrim(p_reason),'from',jsonb_build_object('number',h.slip_number,'date',h.slip_date,'period',h.tax_period),'to',jsonb_build_object('number',btrim(p_slip_number),'date',p_slip_date,'period',p_tax_period)));
 return query select h.id,n;
end $$;

create or replace function public.void_vendor_withholding_slip(p_slip_id uuid,p_expected_revision integer,p_reason text)
returns table(slip_id uuid,revision integer) language plpgsql security definer set search_path=pg_catalog,public as $$
declare h public.vendor_withholding_slips%rowtype; a uuid:=auth.uid(); t timestamptz:=clock_timestamp(); n integer;
begin
 perform public.assert_is_active_member(); if a is null or public.auth_role() not in ('Admin','Finance') then raise exception using errcode='42501',detail='bupot-not-permitted'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vendor-withholding-slip:'||public.auth_org_id()::text,0));
 select * into h from public.vendor_withholding_slips where id=p_slip_id and org_id=public.auth_org_id() for update;
 if not found then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 if h.status='void' and h.revision=p_expected_revision+1 and h.void_reason=btrim(p_reason) and h.voided_by=a then return query select h.id,h.revision; return; end if;
 if h.status<>'active' then raise exception using errcode='23514',detail='bupot-voided'; end if;
 if h.revision<>p_expected_revision then raise exception using errcode='40001',detail='bupot-stale'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 500 then raise exception using errcode='23514',detail='bupot-invalid-facts'; end if;
 update public.vendor_withholding_slips set status='void',voided_by=a,voided_at=t,void_reason=btrim(p_reason),revision=revision+1,updated_at=t where id=h.id returning public.vendor_withholding_slips.revision into n;
 update public.vendor_withholding_slip_bills set released_at=t where slip_id=h.id;
 perform public.log_audit('vendor_withholding_slip.void',h.org_id,a,h.id,jsonb_build_object('reason',btrim(p_reason),'invoice_ids',(select jsonb_agg(invoice_id) from public.vendor_withholding_slip_bills where slip_id=h.id)));
 return query select h.id,n;
end $$;

revoke all on function public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[]) from public,anon,service_role;
revoke all on function public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text) from public,anon,service_role;
revoke all on function public.void_vendor_withholding_slip(uuid,integer,text) from public,anon,service_role;
grant execute on function public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[]) to authenticated;
grant execute on function public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text) to authenticated;
grant execute on function public.void_vendor_withholding_slip(uuid,integer,text) to authenticated;

-- The generic history capture owns these two tables; each field is classified exactly once.
insert into public.record_history_config(entity_type,table_name,parent_type,parent_col,parent_via,captured,flag_cols,omit_cols) values
('vendor_withholding_slip','vendor_withholding_slips',null,null,null,
 '{"vendor_id":"ref","slip_number":"text","slip_date":"date","tax_period":"date","pph_type":"enum","currency":"text","tax_base":"money","withheld_amount":"money","invoice_count":"number","status":"enum","voided_at":"timestamp","voided_by":"ref"}',
 '{void_reason}','{id,org_id,created_at,created_by,updated_at,revision,create_payload}'),
('vendor_withholding_slip_bill','vendor_withholding_slip_bills','vendor_withholding_slip','slip_id',null,
 '{"slip_id":"ref","invoice_id":"ref","procurement_id":"ref","withheld_at_record":"money","pph_type_at_record":"enum","type_source":"enum","currency":"text","released_at":"timestamp"}',
 '{}','{id,org_id,created_at}');
create trigger vendor_withholding_slips_zz_record_change after insert or update on public.vendor_withholding_slips for each row execute function public.record_change_capture();
create trigger vendor_withholding_slip_bills_zz_record_change after insert or update on public.vendor_withholding_slip_bills for each row execute function public.record_change_capture();

create or replace function public.record_history_visible(p_entity_type text,p_entity_id uuid) returns boolean
language plpgsql stable security invoker set search_path=public as $$
begin
 case p_entity_type
  when 'project' then return exists(select 1 from public.projects where id=p_entity_id);
  when 'budget_version' then return exists(select 1 from public.budget_versions where id=p_entity_id);
  when 'budget_line_item' then return exists(select 1 from public.budget_line_items where id=p_entity_id);
  when 'work_order' then return exists(select 1 from public.work_orders where id=p_entity_id);
  when 'procurement' then return exists(select 1 from public.procurements where id=p_entity_id);
  when 'purchase_request' then return exists(select 1 from public.purchase_requests where id=p_entity_id);
  when 'rfq' then return exists(select 1 from public.rfqs where id=p_entity_id);
  when 'purchase_order' then return exists(select 1 from public.purchase_orders where id=p_entity_id);
  when 'payment' then return exists(select 1 from public.payments where id=p_entity_id);
  when 'task' then return exists(select 1 from public.tasks where id=p_entity_id);
  when 'company' then return exists(select 1 from public.companies where id=p_entity_id);
  when 'contact' then return exists(select 1 from public.contacts where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;

do $$ begin
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slips'::regclass)
    or not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slip_bills'::regclass) then
   raise exception '0278: business tables must force RLS';
 end if;
 if has_table_privilege('anon','public.vendor_withholding_slips','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.vendor_withholding_slips','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.vendor_withholding_slip_bills','INSERT,UPDATE,DELETE') then
   raise exception '0278: unexpected client table grants';
 end if;
 if has_function_privilege('anon','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE')
    or has_function_privilege('service_role','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE')
    or not has_function_privilege('authenticated','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE') then
   raise exception '0278: unexpected writer execute grants';
 end if;
 if (select count(*) from pg_trigger where tgname in ('vendor_withholding_slips_integrity','vendor_withholding_slip_bills_integrity','vendor_withholding_slips_zz_record_change','vendor_withholding_slip_bills_zz_record_change') and not tgisinternal)<>4 then
   raise exception '0278: required deferred integrity/history triggers missing';
 end if;
end $$;

notify pgrst,'reload schema';
