-- #911 vendor withholding slips (PMO-only evidence; never an ERP write).
-- Migration 0279: vendor withholding slips (PMO-only evidence; never an ERP write).

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
  check ((type_source='declared' and pph_type_at_record is null) or (type_source='bill' and pph_type_at_record is not null))
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
 if n<>h.invoice_count or n<1 or s<>h.withheld_amount or coalesce(bad,false)
    or exists(select 1 from public.vendor_withholding_slip_bills b where b.slip_id=sid
      and ((b.type_source='bill' and b.pph_type_at_record is distinct from h.pph_type)
        or (b.type_source='declared' and b.pph_type_at_record is not null)))
 then raise exception 'invalid retained slip snapshots' using errcode='23514'; end if;
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
 update public.vendor_withholding_slips as s set slip_number=btrim(p_slip_number),slip_date=p_slip_date,tax_period=p_tax_period,revision=s.revision+1,updated_at=clock_timestamp() where s.id=h.id returning s.revision into n;
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
 update public.vendor_withholding_slips as s set status='void',voided_by=a,voided_at=t,void_reason=btrim(p_reason),revision=s.revision+1,updated_at=t where s.id=h.id returning s.revision into n;
 update public.vendor_withholding_slip_bills as b set released_at=t where b.slip_id=h.id;
 perform public.log_audit('vendor_withholding_slip.void',h.org_id,a,h.id,jsonb_build_object('reason',btrim(p_reason),'invoice_ids',(select jsonb_agg(b.invoice_id) from public.vendor_withholding_slip_bills b where b.slip_id=h.id)));
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
  when 'sales_invoice' then return exists(select 1 from public.sales_invoices where id=p_entity_id);
  when 'procurement_invoice' then return exists(select 1 from public.procurement_invoices where id=p_entity_id);
  when 'vendor_withholding_slip' then return exists(select 1 from public.vendor_withholding_slips where id=p_entity_id);
  when 'vendor_withholding_slip_bill' then return exists(select 1 from public.vendor_withholding_slip_bills where id=p_entity_id);
  else raise exception 'record_history_visible: no visibility arm for entity type %',p_entity_type using errcode='P0001';
 end case;
end $$;
revoke all on function public.record_history_visible(text,uuid) from public,anon;
grant execute on function public.record_history_visible(text,uuid) to authenticated,service_role;

-- Register grains remain invoker-visible through the underlying source-table RLS.
create or replace view public.vendor_withholding_slip_register
with (security_invoker = true) as
with link_totals as (
 select b.slip_id, count(*)::integer visible_count,
        sum(b.withheld_at_record) snapshot_total,
        sum(i.withheld_amount) current_total,
        bool_or(i.id is null or p.id is null) source_missing,
        bool_or(i.withheld_amount is distinct from b.withheld_at_record
          or p.vendor_id is distinct from h.vendor_id
          or i.currency is distinct from h.currency
          or (b.pph_type_at_record is not null and i.withheld_pph_type is distinct from b.pph_type_at_record)
          or (b.pph_type_at_record is null and i.withheld_pph_type is not null and i.withheld_pph_type is distinct from h.pph_type)
          or coalesce(i.erp_docstatus,0)=2 or i.erp_cancelled_at is not null or p.status='Cancelled') mismatch,
        bool_or(b.type_source='declared') declared
 from public.vendor_withholding_slip_bills b
 join public.vendor_withholding_slips h on h.id=b.slip_id and h.org_id=b.org_id
 left join public.procurement_invoices i on i.id=b.invoice_id and i.org_id=b.org_id
 left join public.procurements p on p.id=b.procurement_id and p.org_id=b.org_id
 group by b.slip_id
)
select h.id slip_id,h.vendor_id,h.slip_number,h.slip_date,h.tax_period,h.pph_type,h.currency,
 h.tax_base,h.withheld_amount,h.status,
 case when h.status='void' then 'void'
      when coalesce(l.visible_count,0)<>h.invoice_count or coalesce(l.source_missing,false) then 'unavailable'
      when coalesce(l.mismatch,false) or l.snapshot_total<>h.withheld_amount or l.current_total<>h.withheld_amount then 'needs-review'
      else 'reconciled' end validation_state,
 h.invoice_count,coalesce(l.visible_count,0) visible_invoice_count,
 case when coalesce(l.visible_count,0)=h.invoice_count and not coalesce(l.source_missing,false) then l.snapshot_total end linked_withheld_at_record,
 case when coalesce(l.visible_count,0)=h.invoice_count and not coalesce(l.source_missing,false) then l.current_total end linked_withheld_current,
 case when coalesce(l.visible_count,0)=h.invoice_count and not coalesce(l.source_missing,false) then h.withheld_amount-l.current_total end difference,
 coalesce(l.declared,false) has_declared_type,h.created_by,h.created_at,h.revision,h.updated_at,h.voided_by,h.voided_at
from public.vendor_withholding_slips h left join link_totals l on l.slip_id=h.id;

create or replace view public.vendor_withholding_bill_register
with (security_invoker = true) as
with reserved as (
 select b.org_id,b.invoice_id from public.vendor_withholding_slip_bills b where b.released_at is null group by b.org_id,b.invoice_id
), active_link as (
 select b.*,h.slip_number,h.slip_date,h.tax_period,h.pph_type,h.status slip_status,h.invoice_count,
        count(*) over(partition by h.id) visible_count,
        bool_or(i.withheld_amount is distinct from b.withheld_at_record or p.vendor_id is distinct from h.vendor_id
          or i.currency is distinct from h.currency
          or (b.pph_type_at_record is not null and i.withheld_pph_type is distinct from b.pph_type_at_record)
          or (b.pph_type_at_record is null and i.withheld_pph_type is not null and i.withheld_pph_type is distinct from h.pph_type)
          or coalesce(i.erp_docstatus,0)=2 or i.erp_cancelled_at is not null or p.status='Cancelled') over(partition by h.id) mismatch
 from public.vendor_withholding_slip_bills b
 join public.vendor_withholding_slips h on h.id=b.slip_id and h.org_id=b.org_id and h.status='active' and b.released_at is null
 join public.procurement_invoices i on i.id=b.invoice_id and i.org_id=b.org_id
 join public.procurements p on p.id=b.procurement_id and p.org_id=b.org_id
)
select i.id invoice_id,i.procurement_id,p.project_id,p.vendor_id,i.vi_number,i.reference_number,i.invoice_date,
 date_trunc('month',i.invoice_date)::date invoice_month,i.currency,i.withheld_pph_type,i.withheld_amount,
 i.erp_docstatus,i.erp_cancelled_at,p.status case_status,
 a.slip_id active_slip_id,a.slip_number,a.slip_date,a.tax_period,
 coalesce(a.pph_type_at_record,a.pph_type) resolved_pph_type,a.type_source,a.withheld_at_record linked_withheld_at_record,
 case when rs.invoice_id is not null and a.slip_id is null then 'unavailable'
      when a.slip_id is not null and (a.visible_count<>a.invoice_count) then 'unavailable'
      when a.slip_id is not null and (a.mismatch or i.withheld_amount<=0) then 'needs-review'
      when a.slip_id is not null then 'slipped'
      when i.withheld_amount=0 then 'not-required'
      when i.withheld_amount<0 then 'return-review'
      else 'not-recorded' end coverage_state,
 case when rs.invoice_id is not null and a.slip_id is null then array['source-unavailable']::text[]
      when a.slip_id is null then '{}'::text[] else array_remove(array[
   case when i.withheld_amount is distinct from a.withheld_at_record then 'amount-changed' end,
   case when p.vendor_id is distinct from (select vendor_id from public.vendor_withholding_slips where id=a.slip_id) then 'vendor-changed' end,
   case when i.withheld_pph_type is distinct from coalesce(a.pph_type_at_record,a.pph_type) then 'type-changed' end,
   case when i.currency is distinct from a.currency then 'currency-changed' end,
   case when coalesce(i.erp_docstatus,0)=2 or i.erp_cancelled_at is not null then 'bill-cancelled' end,
   case when p.status='Cancelled' then 'case-cancelled' end],null) end review_reasons
from public.procurement_invoices i join public.procurements p on p.id=i.procurement_id and p.org_id=i.org_id
left join active_link a on a.invoice_id=i.id and a.org_id=i.org_id
left join reserved rs on rs.invoice_id=i.id and rs.org_id=i.org_id;
revoke all on public.vendor_withholding_slip_register,public.vendor_withholding_bill_register from public,anon,authenticated;
grant select on public.vendor_withholding_slip_register,public.vendor_withholding_bill_register to authenticated;

create or replace function public.list_vendor_withholding_slips(
 p_vendor_id uuid default null,p_tax_period date default null,p_invoice_id uuid default null,
 p_before_period date default null,p_before_id uuid default null,p_limit integer default 50)
returns table(slip_id uuid,vendor_id uuid,slip_number text,slip_date date,tax_period date,pph_type text,currency text,
 tax_base text,withheld_amount text,status text,validation_state text,invoice_count integer,visible_invoice_count integer,
 linked_withheld_at_record text,linked_withheld_current text,difference text,has_declared_type boolean,created_by uuid,
 created_at timestamptz,revision integer,updated_at timestamptz,voided_by uuid,voided_at timestamptz)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if (p_before_period is null)<>(p_before_id is null) then raise exception using errcode='22023'; end if;
 return query select r.slip_id,r.vendor_id,r.slip_number,r.slip_date,r.tax_period,r.pph_type,r.currency,
  r.tax_base::text,r.withheld_amount::text,r.status,r.validation_state,r.invoice_count,r.visible_invoice_count,
  r.linked_withheld_at_record::text,r.linked_withheld_current::text,r.difference::text,r.has_declared_type,r.created_by,
  r.created_at,r.revision,r.updated_at,r.voided_by,r.voided_at
 from public.vendor_withholding_slip_register r
 where (p_vendor_id is null or r.vendor_id=p_vendor_id) and (p_tax_period is null or r.tax_period=p_tax_period)
 and (p_invoice_id is null or exists(select 1 from public.vendor_withholding_slip_bills b where b.slip_id=r.slip_id and b.invoice_id=p_invoice_id))
 and (p_before_period is null or (r.tax_period,r.slip_id)<(p_before_period,p_before_id))
 order by r.tax_period desc,r.slip_id desc limit greatest(1,least(coalesce(p_limit,50),100));
end $$;

create or replace function public.list_vendor_withholding_bills(
 p_vendor_id uuid default null,p_pph_type text default null,p_currency text default null,p_invoice_ids uuid[] default null,
 p_candidates_only boolean default false,p_after_date date default null,p_after_id uuid default null,
 p_after_null_date boolean default false,p_limit integer default 50)
returns table(invoice_id uuid,procurement_id uuid,project_id uuid,vendor_id uuid,vi_number text,reference_number text,
 invoice_date date,invoice_month date,currency text,withheld_pph_type text,withheld_amount text,erp_docstatus smallint,
 erp_cancelled_at timestamptz,case_status text,active_slip_id uuid,slip_number text,slip_date date,tax_period date,
 resolved_pph_type text,type_source text,linked_withheld_at_record text,coverage_state text,review_reasons text[])
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if (p_after_id is null and (p_after_date is not null or p_after_null_date)) or (p_after_id is not null and not p_after_null_date and p_after_date is null) then raise exception using errcode='22023'; end if;
 if coalesce(cardinality(p_invoice_ids),0)>100 then raise exception using errcode='22023'; end if;
 return query select r.invoice_id,r.procurement_id,r.project_id,r.vendor_id,r.vi_number,r.reference_number,r.invoice_date,r.invoice_month,
  r.currency,r.withheld_pph_type,r.withheld_amount::text,r.erp_docstatus,r.erp_cancelled_at,r.case_status::text,r.active_slip_id,
  r.slip_number,r.slip_date,r.tax_period,r.resolved_pph_type,r.type_source,r.linked_withheld_at_record::text,r.coverage_state,r.review_reasons
 from public.vendor_withholding_bill_register r
 where (p_vendor_id is null or r.vendor_id=p_vendor_id) and (p_pph_type is null or r.withheld_pph_type=p_pph_type or r.withheld_pph_type is null)
 and (p_currency is null or r.currency=p_currency) and (p_invoice_ids is null or r.invoice_id=any(p_invoice_ids))
 and (not p_candidates_only or (r.withheld_amount>0 and coalesce(r.erp_docstatus,0)<>2 and r.erp_cancelled_at is null and r.case_status<>'Cancelled' and r.coverage_state='not-recorded'))
 and (p_after_id is null or (not p_after_null_date and ((r.invoice_date>p_after_date) or (r.invoice_date=p_after_date and r.invoice_id>p_after_id) or r.invoice_date is null)) or (p_after_null_date and r.invoice_date is null and r.invoice_id>p_after_id))
 order by r.invoice_date asc nulls last,r.invoice_id asc limit greatest(1,least(coalesce(p_limit,50),100));
end $$;

create or replace function public.get_vendor_withholding_slip(p_slip_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare h public.vendor_withholding_slip_register%rowtype; b jsonb;
begin
 select * into h from public.vendor_withholding_slip_register where slip_id=p_slip_id;
 if not found then raise exception using errcode='P0002',detail='bupot-not-found'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('invoice_id',r.invoice_id,'procurement_id',r.procurement_id,'vi_number',r.vi_number,'invoice_date',r.invoice_date,'currency',r.currency,'withheld_at_record',l.withheld_at_record::text,'pph_type_at_record',l.pph_type_at_record,'type_source',l.type_source,'released_at',l.released_at,'coverage_state',r.coverage_state) order by r.invoice_id),'[]'::jsonb)
 into b from public.vendor_withholding_slip_bills l left join public.vendor_withholding_bill_register r on r.invoice_id=l.invoice_id where l.slip_id=p_slip_id;
 return jsonb_build_object('header',to_jsonb(h)-'tax_base'-'withheld_amount'||jsonb_build_object('tax_base',h.tax_base::text,'withheld_amount',h.withheld_amount::text),'bills',b);
end $$;
revoke all on function public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer) from public,anon;
revoke all on function public.list_vendor_withholding_bills(uuid,text,text,uuid[],boolean,date,uuid,boolean,integer) from public,anon;
revoke all on function public.get_vendor_withholding_slip(uuid) from public,anon;
grant execute on function public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer) to authenticated;
grant execute on function public.list_vendor_withholding_bills(uuid,text,text,uuid[],boolean,date,uuid,boolean,integer) to authenticated;
grant execute on function public.get_vendor_withholding_slip(uuid) to authenticated;

-- Register APIs are invoker surfaces; writers remain authenticated-only definer RPCs.

do $$ begin
 if not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slips'::regclass)
    or not (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.vendor_withholding_slip_bills'::regclass) then
   raise exception '0279: business tables must force RLS';
 end if;
 if has_table_privilege('anon','public.vendor_withholding_slips','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.vendor_withholding_slips','INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.vendor_withholding_slip_bills','INSERT,UPDATE,DELETE') then
   raise exception '0279: unexpected client table grants';
 end if;
 if has_function_privilege('anon','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE')
    or has_function_privilege('service_role','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE')
    or not has_function_privilege('authenticated','public.record_vendor_withholding_slip(uuid,uuid,text,date,date,text,numeric,numeric,uuid[],uuid[])','EXECUTE')
    or has_function_privilege('anon','public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text)','EXECUTE')
    or has_function_privilege('service_role','public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.correct_vendor_withholding_slip(uuid,integer,text,date,date,text)','EXECUTE')
    or has_function_privilege('anon','public.void_vendor_withholding_slip(uuid,integer,text)','EXECUTE')
    or has_function_privilege('service_role','public.void_vendor_withholding_slip(uuid,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.void_vendor_withholding_slip(uuid,integer,text)','EXECUTE') then
   raise exception '0279: unexpected writer execute grants';
 end if;
 if not has_function_privilege('authenticated','public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.list_vendor_withholding_bills(uuid,text,text,uuid[],boolean,date,uuid,boolean,integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_vendor_withholding_slip(uuid)','EXECUTE')
    or has_function_privilege('anon','public.list_vendor_withholding_slips(uuid,date,uuid,date,uuid,integer)','EXECUTE')
    or has_function_privilege('anon','public.list_vendor_withholding_bills(uuid,text,text,uuid[],boolean,date,uuid,boolean,integer)','EXECUTE')
    or has_function_privilege('anon','public.get_vendor_withholding_slip(uuid)','EXECUTE') then
   raise exception '0279: unexpected reader execute grants';
 end if;
 if (select count(*) from pg_trigger where tgname in ('vendor_withholding_slips_integrity','vendor_withholding_slip_bills_integrity','vendor_withholding_slips_zz_record_change','vendor_withholding_slip_bills_zz_record_change') and not tgisinternal)<>4 then
   raise exception '0279: required deferred integrity/history triggers missing';
 end if;
 if to_regclass('public.vendor_withholding_slips_number_uq') is null
    or to_regclass('public.vendor_withholding_slips_register_idx') is null
    or to_regclass('public.vendor_withholding_slips_vendor_idx') is null
    or to_regclass('public.vendor_withholding_slip_bills_active_invoice_uq') is null
    or to_regclass('public.vendor_withholding_slip_bills_slip_idx') is null
    or to_regclass('public.vendor_withholding_slip_bills_procurement_idx') is null
    or to_regclass('public.vendor_withholding_slip_bills_invoice_history_idx') is null then
   raise exception '0279: required evidence and paging indexes missing';
 end if;
 if has_function_privilege('anon','public.assert_vendor_withholding_slip_integrity()','EXECUTE')
    or has_function_privilege('authenticated','public.assert_vendor_withholding_slip_integrity()','EXECUTE') then
   raise exception '0279: trigger integrity helper must not be client-callable';
 end if;
end $$;

notify pgrst,'reload schema';
