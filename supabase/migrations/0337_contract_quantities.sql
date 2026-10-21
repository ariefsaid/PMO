-- 0337_contract_quantities.sql — contract quantities, WO allocations and cumulative BAST.
-- Spec: docs/specs/progress-billing.spec.md §8; plan: docs/plans/2026-10-21-contract-quantities.md.
-- Reversal: rollback/0337_contract_quantities_down.sql.

-- Contract-line metadata and explicit earning basis.
alter table public.boq_items
  add column earning_basis text not null default 'unit_rate',
  add column line_no integer,
  add column import_key text,
  add constraint boq_items_earning_basis_check check (earning_basis in ('unit_rate','lump_sum')),
  add constraint boq_items_lump_sum_quantity check (earning_basis <> 'lump_sum' or quantity = 1),
  add constraint boq_items_project_import_key unique (project_id, import_key);
create index boq_items_project_line_order_idx on public.boq_items(project_id, line_no, created_at, id);

-- An allocation is a same-project link plus ordered quantity. Backfill before installing its state guards.
create table public.work_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  work_order_id uuid not null references public.work_orders(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  created_at timestamptz not null default now(),
  unique (work_order_id, boq_item_id)
);
insert into public.work_order_lines(org_id, work_order_id, boq_item_id, quantity)
select org_id, work_order_id, id, quantity from public.boq_items where work_order_id is not null;
create index work_order_lines_org_wo_idx on public.work_order_lines(org_id, work_order_id);
create index work_order_lines_boq_idx on public.work_order_lines(boq_item_id);

create or replace function public.check_work_order_line_scope() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_wo_project uuid; v_boq_project uuid; v_status public.work_order_status; v_latest numeric;
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.org_id is distinct from old.org_id
      or new.work_order_id is distinct from old.work_order_id or new.boq_item_id is distinct from old.boq_item_id) then
    raise exception 'allocation identity and parents cannot be changed' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    select status into v_status from public.work_orders where id=old.work_order_id for update;
    if exists(select 1 from public.work_order_acceptances a join public.work_order_acceptance_lines l on l.acceptance_id=a.id
       where a.work_order_id=old.work_order_id and a.status='Confirmed' and l.boq_item_id=old.boq_item_id) then
      raise exception 'an allocation with confirmed acceptance cannot be deleted' using errcode = '23514';
    end if;
    if v_status in ('Closed','Cancelled') then
      raise exception 'allocations are frozen after a work order closes or is cancelled' using errcode = '42501';
    end if;
    return old;
  end if;
  select project_id, status into v_wo_project, v_status from public.work_orders where id = new.work_order_id for update;
  select project_id into v_boq_project from public.boq_items where id = new.boq_item_id;
  if v_wo_project is null or v_boq_project is distinct from v_wo_project then
    raise exception 'the work order and contract line must belong to the same project' using errcode = '23514';
  end if;
  if v_status in ('Closed','Cancelled') then
    raise exception 'allocations are frozen after a work order closes or is cancelled' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce((select l.quantity from public.work_order_acceptances a join public.work_order_acceptance_lines l on l.acceptance_id=a.id
       where a.work_order_id=new.work_order_id and l.boq_item_id=new.boq_item_id and a.status='Confirmed'
       order by a.confirmed_at desc,a.id desc limit 1),0) into v_latest;
    if v_latest is not null and new.quantity < v_latest then
      raise exception 'allocation cannot be reduced below its latest confirmed acceptance' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.check_work_order_line_scope() from public, anon, authenticated;
create trigger work_order_lines_stamp_org before insert on public.work_order_lines
  for each row execute function public.stamp_org_id();
create trigger work_order_lines_zz_scope before insert or update or delete on public.work_order_lines
  for each row execute function public.check_work_order_line_scope();
alter table public.work_order_lines enable row level security;
alter table public.work_order_lines force row level security;
create policy work_order_lines_read on public.work_order_lines for select
  using (org_id=public.auth_org_id() and public.is_active_member());
create policy work_order_lines_insert on public.work_order_lines for insert with check
  (org_id=public.auth_org_id() and public.is_active_member()
   and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
   and exists(select 1 from public.work_orders w join public.boq_items b on b.project_id=w.project_id
     join public.projects p on p.id=w.project_id where w.id=work_order_lines.work_order_id and b.id=work_order_lines.boq_item_id
       and w.org_id=public.auth_org_id() and b.org_id=public.auth_org_id() and p.org_id=public.auth_org_id()));
create policy work_order_lines_update on public.work_order_lines for update using
  (org_id=public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id=public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy work_order_lines_delete on public.work_order_lines for delete using
  (org_id=public.auth_org_id() and public.is_active_member() and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.work_order_lines from public, anon, authenticated;
grant select on public.work_order_lines to authenticated;
grant insert (work_order_id, boq_item_id, quantity) on public.work_order_lines to authenticated;
grant update (quantity) on public.work_order_lines to authenticated;
grant delete on public.work_order_lines to authenticated;

-- Cumulative BAST records. Child tenancy is inherited from the header.
create table public.work_order_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  work_order_id uuid not null references public.work_orders(id),
  acceptance_date date not null,
  is_final boolean not null default false,
  status text not null default 'Draft' check(status in ('Draft','Confirmed','Withdrawn')),
  prepared_by uuid not null references public.profiles(id),
  prepared_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  confirm_basis text check(confirm_basis in ('standard','sole_operator')),
  withdrawn_at timestamptz,
  note text check(note is null or length(note)<=500),
  document_id uuid references public.project_documents(id),
  constraint work_order_acceptances_confirmation_pair check
    ((status='Confirmed') = (confirmed_by is not null and confirmed_at is not null and confirm_basis is not null)),
  constraint work_order_acceptances_withdraw_pair check ((status='Withdrawn') = (withdrawn_at is not null))
);
create index work_order_acceptances_org_project_idx on public.work_order_acceptances(org_id,project_id);
create index work_order_acceptances_latest_idx on public.work_order_acceptances(work_order_id,status,confirmed_at desc,id desc);
create index work_order_acceptances_document_idx on public.work_order_acceptances(document_id);
create unique index work_order_acceptances_one_final_idx on public.work_order_acceptances(work_order_id)
  where status='Confirmed' and is_final;
create table public.work_order_acceptance_lines (
  acceptance_id uuid not null references public.work_order_acceptances(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check(quantity>=0 and quantity<'Infinity'::numeric),
  primary key(acceptance_id,boq_item_id)
);
create index work_order_acceptance_lines_boq_idx on public.work_order_acceptance_lines(boq_item_id);
alter table public.work_order_acceptances enable row level security;
alter table public.work_order_acceptances force row level security;
alter table public.work_order_acceptance_lines enable row level security;
alter table public.work_order_acceptance_lines force row level security;
create policy work_order_acceptances_read on public.work_order_acceptances for select
  using(org_id=public.auth_org_id() and public.is_active_member());
create policy work_order_acceptance_lines_read on public.work_order_acceptance_lines for select using
  (exists(select 1 from public.work_order_acceptances a where a.id=acceptance_id and a.org_id=public.auth_org_id() and public.is_active_member()));
revoke all on public.work_order_acceptances, public.work_order_acceptance_lines from public, anon, authenticated;
grant select on public.work_order_acceptances, public.work_order_acceptance_lines to authenticated;

-- Replace the legacy single-WO link after backfill.
drop trigger boq_items_zz_check_work_order on public.boq_items;
drop function public.check_boq_item_work_order_same_project();
drop index public.boq_items_work_order_idx;
alter table public.boq_items drop column work_order_id;
revoke all on public.boq_items from authenticated, anon;
grant select on public.boq_items to authenticated;
grant insert (id,org_id,project_id,item_code,description,unit,quantity,rate,earning_basis,line_no,import_key) on public.boq_items to authenticated;
grant update (item_code,description,unit,quantity,rate,earning_basis,line_no) on public.boq_items to authenticated;
grant delete on public.boq_items to authenticated;

-- Closing value is a server-stamped net amount; original PO fields remain untouched.
alter table public.work_orders add column closing_value numeric(14,2)
  check(closing_value is null or (closing_value>=0 and closing_value<'Infinity'::numeric)),
  add column closing_acceptance_id uuid references public.work_order_acceptances(id),
  add constraint work_orders_closing_pair check((closing_value is null)=(closing_acceptance_id is null));
update public.record_history_config set captured=captured || '{"closing_value":"money","closing_acceptance_id":"ref"}'::jsonb
 where table_name='work_orders';

create or replace function public.guard_work_order_closing_value() returns trigger
 language plpgsql security definer set search_path=public as $$
begin
 if old.closing_value is not null and (new.closing_value is distinct from old.closing_value or new.closing_acceptance_id is distinct from old.closing_acceptance_id) then
   raise exception 'work-order closing value is immutable' using errcode='42501';
 end if;
 if new.closing_value is distinct from old.closing_value then
   if coalesce(current_setting('pmo.confirming_work_order_acceptance',true),'')<>'on' or old.closing_value is not null
      or new.status<>'Closed' or not exists(select 1 from public.work_order_acceptances a where a.id=new.closing_acceptance_id
       and a.work_order_id=new.id and a.project_id=new.project_id and a.org_id=new.org_id and a.status='Confirmed' and a.is_final) then
     raise exception 'closing value may only be written by final acceptance confirmation' using errcode='42501';
   end if;
 end if;
 return new;
end; $$;
revoke all on function public.guard_work_order_closing_value() from public,anon,authenticated;
create trigger work_orders_closing_guard before insert or update on public.work_orders for each row execute function public.guard_work_order_closing_value();

-- Confirmed acceptance data cannot be rewritten or deleted; drafts are only replaced by the RPC.
create or replace function public.guard_work_order_acceptance_immutable() returns trigger
 language plpgsql set search_path=public as $$
begin
 if tg_op='DELETE' then
   if old.status='Confirmed' or old.status='Withdrawn' then raise exception 'acceptance is immutable' using errcode='42501'; end if;
   raise exception 'acceptances are managed by their RPC' using errcode='42501';
 end if;
 if old.status<>'Draft' or (new.id,new.org_id,new.project_id,new.work_order_id) is distinct from (old.id,old.org_id,old.project_id,old.work_order_id) then
   raise exception 'acceptance is immutable' using errcode='42501';
 end if;
 return new;
end; $$;
create trigger work_order_acceptances_immutable before update or delete on public.work_order_acceptances for each row execute function public.guard_work_order_acceptance_immutable();
create or replace function public.guard_work_order_acceptance_line_immutable() returns trigger
 language plpgsql set search_path=public as $$
declare v_status text;
begin
 select status into v_status from public.work_order_acceptances where id=coalesce(new.acceptance_id,old.acceptance_id);
 if v_status is distinct from 'Draft' or (tg_op='DELETE' and coalesce(current_setting('pmo.replace_work_order_acceptance',true),'')<>'on') then raise exception 'acceptance lines are immutable outside draft replacement' using errcode='42501'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger work_order_acceptance_lines_immutable before update or delete on public.work_order_acceptance_lines for each row execute function public.guard_work_order_acceptance_line_immutable();
revoke all on function public.guard_work_order_acceptance_immutable() from public,anon,authenticated;
revoke all on function public.guard_work_order_acceptance_line_immutable() from public,anon,authenticated;

create or replace function public.prepare_work_order_acceptance(
 p_work_order_id uuid,p_acceptance_date date,p_is_final boolean,p_lines jsonb,
 p_document_id uuid default null,p_note text default null,p_acceptance_id uuid default null)
 returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.auth_org_id(); v_project uuid; v_status public.work_order_status; v_role user_role:=public.auth_role(); v_id uuid; v_doc_project uuid;
begin
 perform public.assert_is_active_member();
 if p_acceptance_date is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
   raise exception 'acceptance date and at least one quantity are required' using errcode='23502';
 end if;
 select project_id,status into v_project,v_status from public.work_orders where id=p_work_order_id and org_id=v_org for update;
 if not found then raise exception 'work order not found' using errcode='P0002'; end if;
 if v_status<>'Issued' then raise exception 'only an issued work order can prepare an acceptance' using errcode='42501'; end if;
 if not public.may_record_project_progress(v_project) then raise exception 'you may prepare an acceptance only on a project you manage, unless you are Finance, an Executive or an Admin' using errcode='42501'; end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric)
  where not coalesce(x.quantity>=0 and x.quantity<'Infinity'::numeric and x.quantity=round(x.quantity,3),false)) then
   raise exception 'acceptance quantities must be finite, nonnegative and have at most 3 decimals' using errcode='23514'; end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric) join public.boq_items b on b.id=x.boq_item_id
  where b.earning_basis='lump_sum' and x.quantity>1) then raise exception 'lump-sum acceptance quantity cannot exceed one' using errcode='23514'; end if;
 if exists(select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric)
  left join public.work_order_lines l on l.work_order_id=p_work_order_id and l.boq_item_id=x.boq_item_id
  where l.boq_item_id is null) then raise exception 'every acceptance line must be allocated to this work order' using errcode='23514'; end if;
 if (select count(*) from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric)) <>
    (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric)) then
   raise exception 'each contract line may appear once in an acceptance' using errcode='23514'; end if;
 if coalesce(p_is_final,false) and exists(select 1 from public.work_order_lines l where l.work_order_id=p_work_order_id
   and not exists(select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric) where x.boq_item_id=l.boq_item_id)) then
   raise exception 'a final acceptance must include every allocated contract line' using errcode='23514'; end if;
 if p_acceptance_id is null then
   insert into public.work_order_acceptances(org_id,project_id,work_order_id,acceptance_date,is_final,prepared_by,note,document_id)
   values(v_org,v_project,p_work_order_id,p_acceptance_date,p_is_final,auth.uid(),nullif(btrim(p_note),''),p_document_id) returning id into v_id;
 else
   select id into v_id from public.work_order_acceptances where id=p_acceptance_id and work_order_id=p_work_order_id and org_id=v_org and status='Draft' for update;
   if not found then raise exception 'draft acceptance not found' using errcode='P0002'; end if;
   perform set_config('pmo.replace_work_order_acceptance','on',true);
   delete from public.work_order_acceptance_lines where acceptance_id=v_id;
   perform set_config('pmo.replace_work_order_acceptance','',true);
   update public.work_order_acceptances set acceptance_date=p_acceptance_date,is_final=p_is_final,prepared_by=auth.uid(),prepared_at=now(),note=nullif(btrim(p_note),''),document_id=p_document_id where id=v_id;
 end if;
 insert into public.work_order_acceptance_lines(acceptance_id,boq_item_id,quantity)
 select v_id,x.boq_item_id,x.quantity from jsonb_to_recordset(p_lines) x(boq_item_id uuid,quantity numeric);
 perform public.log_audit('work_order_acceptance.prepare',v_org,auth.uid(),v_id,jsonb_build_object('project_id',v_project,'work_order_id',p_work_order_id,'is_final',p_is_final,'basis','prepared'));
 return v_id;
end; $$;
revoke all on function public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid) from public,anon;
grant execute on function public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid) to authenticated;

create or replace function public.withdraw_work_order_acceptance(p_id uuid) returns void
 language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.auth_org_id(); v_wo uuid; v_project uuid; v_preparer uuid;
begin
 perform public.assert_is_active_member();
 select work_order_id,project_id,prepared_by into v_wo,v_project,v_preparer from public.work_order_acceptances where id=p_id and org_id=v_org;
 if not found then raise exception 'acceptance not found' using errcode='P0002'; end if;
 perform 1 from public.work_orders where id=v_wo and org_id=v_org for update;
 perform 1 from public.work_order_acceptances where id=p_id for update;
 if not (auth.uid()=v_preparer or public.auth_role() in ('Admin','Finance')) then raise exception 'only the preparer, Admin or Finance may withdraw this acceptance' using errcode='42501'; end if;
 update public.work_order_acceptances set status='Withdrawn',withdrawn_at=now() where id=p_id and status='Draft';
 if not found then raise exception 'only a Draft acceptance can be withdrawn' using errcode='42501'; end if;
 perform public.log_audit('work_order_acceptance.withdraw',v_org,auth.uid(),p_id,jsonb_build_object('project_id',v_project,'work_order_id',v_wo));
end; $$;
revoke all on function public.withdraw_work_order_acceptance(uuid) from public,anon;
grant execute on function public.withdraw_work_order_acceptance(uuid) to authenticated;

create or replace function public.confirm_work_order_acceptance(p_id uuid) returns jsonb
 language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.auth_org_id(); v_wo uuid; v_project uuid; v_status public.work_order_status; v_preparer uuid; v_is_final boolean; v_doc uuid; v_basis text:='standard'; v_sole boolean:=false; v_net numeric; v_close numeric; v_currency text; v_dp numeric; v_doc_project uuid;
begin
 perform public.assert_is_active_member();
 select work_order_id into v_wo from public.work_order_acceptances where id=p_id and org_id=v_org;
 if not found then raise exception 'acceptance not found' using errcode='P0002'; end if;
 perform public.lock_work_order_billing(v_wo);
 select project_id,status,org_id,currency,coalesce(closing_value,case when tax_treatment='inclusive' then order_value-tax_amount else order_value end)
   into v_project,v_status,v_org,v_currency,v_net from public.work_orders where id=v_wo for update;
 if not found or v_org is distinct from public.auth_org_id() then raise exception 'work order not found' using errcode='P0002'; end if;
 select prepared_by,is_final,document_id into v_preparer,v_is_final,v_doc from public.work_order_acceptances where id=p_id and org_id=v_org for update;
 if not found then raise exception 'acceptance not found' using errcode='P0002'; end if;
 if v_status<>'Issued' then raise exception 'only an issued work order can confirm an acceptance' using errcode='42501'; end if;
 if public.auth_role() not in ('Admin','Finance') then raise exception 'only Admin or Finance may confirm an acceptance' using errcode='42501'; end if;
 if v_preparer=auth.uid() then
   select count(*)=1 and bool_or(p.id=auth.uid()) into v_sole from public.profiles p where p.org_id=v_org and public.is_active_member(p.id);
   if not coalesce(v_sole,false) then raise exception 'separation of duties: the preparer cannot confirm this acceptance' using errcode='42501'; end if;
   v_basis:='sole_operator';
 end if;
 select project_id into v_doc_project from public.project_documents d where d.id=v_doc and d.org_id=v_org and d.project_id=v_project and d.status in ('Issued','Approved') and nullif(btrim(d.file_path),'') is not null for update;
 if v_doc is null or not found then raise exception 'confirmation requires an Issued or Approved project document with a file' using errcode='23514'; end if;
 if v_is_final and exists(select 1 from public.work_order_lines l where l.work_order_id=v_wo and not exists(select 1 from public.work_order_acceptance_lines x where x.acceptance_id=p_id and x.boq_item_id=l.boq_item_id)) then
   raise exception 'a final acceptance must include every allocated contract line' using errcode='23514'; end if;
 select coalesce(sum(round(x.quantity*b.rate,2)),0) into v_close from public.work_order_acceptance_lines x join public.boq_items b on b.id=x.boq_item_id where x.acceptance_id=p_id;
 update public.work_order_acceptances set status='Confirmed',confirmed_by=auth.uid(),confirmed_at=now(),confirm_basis=v_basis where id=p_id;
 if v_is_final then
   if v_close>v_net then
     raise exception 'closing value % exceeds work-order net %',round(v_close,2),round(v_net,2) using errcode='BW001'; end if;
   perform set_config('pmo.confirming_work_order_acceptance','on',true);
   update public.work_orders set closing_value=v_close,closing_acceptance_id=p_id,status='Closed',closed_at=now() where id=v_wo;
   perform set_config('pmo.confirming_work_order_acceptance','',true);
   begin
     perform public.assert_work_order_invoiceable(v_org,v_wo,v_project,p_id::text,0,v_currency);
   exception when sqlstate 'BW001' then raise exception 'closing value % cannot close: billed and pending work exceeds this accepted value; %',round(v_close,2),sqlerrm using errcode='BW001'; end;
 end if;
 select coalesce((public.get_project_billing(v_project)->>'dp_billed')::numeric,0)-coalesce((public.get_project_billing(v_project)->>'dp_recovered')::numeric,0) into v_dp;
 perform public.log_audit('work_order_acceptance.confirm',v_org,auth.uid(),p_id,jsonb_build_object('project_id',v_project,'work_order_id',v_wo,'basis',v_basis,'is_final',v_is_final,'closing_value',case when v_is_final then v_close end,'dp_held',v_dp));
 return jsonb_build_object('closing_value',case when v_is_final then v_close end,'dp_held',v_dp);
end; $$;
revoke all on function public.confirm_work_order_acceptance(uuid) from public,anon;
grant execute on function public.confirm_work_order_acceptance(uuid) to authenticated;


-- Latest shipped readers with the closing-value substitution.
create or replace function public.assert_work_order_invoiceable(
  p_org_id uuid, p_work_order_id uuid, p_project_id uuid, p_record_id text, p_billed numeric, p_currency text)
  returns void language plpgsql volatile set search_path = public as $$
declare
  v_org      uuid;
  v_project  uuid;
  v_status   public.work_order_status;
  v_currency text;
  v_label    text;
  v_net      numeric;
  v_existing numeric;
  v_unknown  boolean;
begin
  -- Taken FIRST, so every read below sees each billing write that committed before this one (DD-BWO-5).
  perform public.lock_work_order_billing(p_work_order_id);

  select wo.org_id, wo.project_id, wo.status, wo.currency, coalesce(wo.wo_number, wo.title),
         case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end
    into v_org, v_project, v_status, v_currency, v_label, v_net
    from public.work_orders wo where wo.id = p_work_order_id;
  if not found or v_org is distinct from p_org_id then
    raise exception 'work order not found' using errcode = 'BW001';
  end if;
  if v_project is distinct from p_project_id then
    raise exception 'the work order must be on the same project as the invoice' using errcode = 'BW001';
  end if;
  if v_status not in ('Issued', 'Closed') then
    raise exception 'work order % is %: only an issued or closed work order can be invoiced', v_label, v_status
      using errcode = 'BW001';
  end if;
  if p_currency is not null and p_currency is distinct from v_currency then
    raise exception 'this invoice is in % but work order % is in %: a work order is invoiced in its own currency',
      p_currency, v_label, v_currency using errcode = 'BW001';
  end if;
  -- `< 'Infinity'` is what rejects NaN (NaN sorts above every value) — the 0169/0193 construction.
  if p_billed is null or not (p_billed > '-Infinity'::numeric and p_billed < 'Infinity'::numeric) then
    raise exception 'the invoice amount could not be read, so it cannot be checked against work order %', v_label
      using errcode = 'BW001';
  end if;
  -- A claim is never negative and a down payment bills 0: a negative amount would only open room on the work order.
  if p_billed < 0 then
    raise exception 'an invoice cannot bill a negative amount against work order %', v_label using errcode = 'BW001';
  end if;

  with lines as (
    -- what the views count (mirrored invoices + unraised claims), minus the record being written
    select l.record_id::text as record_id, l.billed, l.currency
      from public.work_order_billing_lines l
     where l.org_id = p_org_id and l.work_order_id = p_work_order_id and l.record_id::text <> lower(p_record_id)
    union all
    -- ERP commands still in flight (not yet mirrored, or an edit/amend not yet read back). A claim's own command is
    -- excluded: the claim already counts at gross. A command with no line array rebuilds no body and moves no money.
    select lower(o.pmo_record_id), public.invoice_command_line_total(o.payload), v_currency
      from public.external_command_outbox o
     where o.org_id = p_org_id and o.domain = 'revenue'
       and o.state in ('pending', 'committing', 'committed', 'quarantined', 'held')
       and o.payload ->> 'erp_doc_kind' = 'sales-invoice'
       and jsonb_typeof(o.payload -> 'items') = 'array'
       and (o.operation in ('create', 'update') or (o.operation = 'transition' and o.payload ->> 'verb' = 'amend'))
       and lower(o.pmo_record_id) <> lower(p_record_id)
       -- Joined on the uuid so the primary keys can seek. The CASE (evaluated in order) turns an id that is not a uuid's
       -- text into NULL instead of a cast error — the same rows the text comparison matched, and only those.
       and not exists (select 1 from public.progress_claims pc
                        where pc.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                           then lower(o.pmo_record_id)::uuid end
                          and pc.org_id = p_org_id)
       and lower(coalesce(nullif(btrim(o.payload ->> 'workOrderId'), ''),
                          (select si.work_order_id::text from public.sales_invoices si
                            where si.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                               then lower(o.pmo_record_id)::uuid end
                              and si.org_id = p_org_id))) = p_work_order_id::text
  ), per_record as (
    -- an invoice with an edit in flight counts at the larger of its mirrored and its pending amount
    select record_id, max(billed) as billed,
           bool_or(billed is null or currency is distinct from v_currency) as unknown
      from lines group by record_id
  )
  select coalesce(sum(billed), 0), coalesce(bool_or(unknown), false)
    into v_existing, v_unknown
    from per_record;

  if v_unknown then
    raise exception 'an invoice on work order % has no amount or is in another currency, so what is still to invoice cannot be checked',
      v_label using errcode = 'BW001';
  end if;
  if v_existing + p_billed > v_net then
    raise exception 'this invoice would bill % against work order % (worth % excl. tax, with % already invoiced or in draft): only % is still to invoice',
      round(p_billed, 2), v_label, round(v_net, 2), round(v_existing, 2), round(greatest(v_net - v_existing, 0), 2)
      using errcode = 'BW001';
  end if;
end; $$;

create or replace function public.assert_work_order_invoiceable(
  p_org_id uuid, p_work_order_id uuid, p_project_id uuid, p_record_id text, p_billed numeric, p_currency text)
  returns void language plpgsql volatile set search_path = public as $$
declare
  v_org      uuid;
  v_project  uuid;
  v_status   public.work_order_status;
  v_currency text;
  v_label    text;
  v_net      numeric;
  v_existing numeric;
  v_unknown  boolean;
begin
  -- Taken FIRST, so every read below sees each billing write that committed before this one (DD-BWO-5).
  perform public.lock_work_order_billing(p_work_order_id);

  select wo.org_id, wo.project_id, wo.status, wo.currency, coalesce(wo.wo_number, wo.title),
         coalesce(wo.closing_value, case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount else wo.order_value end)
    into v_org, v_project, v_status, v_currency, v_label, v_net
    from public.work_orders wo where wo.id = p_work_order_id;
  if not found or v_org is distinct from p_org_id then
    raise exception 'work order not found' using errcode = 'BW001';
  end if;
  if v_project is distinct from p_project_id then
    raise exception 'the work order must be on the same project as the invoice' using errcode = 'BW001';
  end if;
  if v_status not in ('Issued', 'Closed') then
    raise exception 'work order % is %: only an issued or closed work order can be invoiced', v_label, v_status
      using errcode = 'BW001';
  end if;
  if p_currency is not null and p_currency is distinct from v_currency then
    raise exception 'this invoice is in % but work order % is in %: a work order is invoiced in its own currency',
      p_currency, v_label, v_currency using errcode = 'BW001';
  end if;
  -- `< 'Infinity'` is what rejects NaN (NaN sorts above every value) — the 0169/0193 construction.
  if p_billed is null or not (p_billed > '-Infinity'::numeric and p_billed < 'Infinity'::numeric) then
    raise exception 'the invoice amount could not be read, so it cannot be checked against work order %', v_label
      using errcode = 'BW001';
  end if;
  -- A claim is never negative and a down payment bills 0: a negative amount would only open room on the work order.
  if p_billed < 0 then
    raise exception 'an invoice cannot bill a negative amount against work order %', v_label using errcode = 'BW001';
  end if;

  with lines as (
    -- what the views count (mirrored invoices + unraised claims), minus the record being written
    select l.record_id::text as record_id, l.billed, l.currency
      from public.work_order_billing_lines l
     where l.org_id = p_org_id and l.work_order_id = p_work_order_id and l.record_id::text <> lower(p_record_id)
    union all
    -- ERP commands still in flight (not yet mirrored, or an edit/amend not yet read back). A claim's own command is
    -- excluded: the claim already counts at gross. A command with no line array rebuilds no body and moves no money.
    select lower(o.pmo_record_id), public.invoice_command_line_total(o.payload), v_currency
      from public.external_command_outbox o
     where o.org_id = p_org_id and o.domain = 'revenue'
       and o.state in ('pending', 'committing', 'committed', 'quarantined', 'held')
       and o.payload ->> 'erp_doc_kind' = 'sales-invoice'
       and jsonb_typeof(o.payload -> 'items') = 'array'
       and (o.operation in ('create', 'update') or (o.operation = 'transition' and o.payload ->> 'verb' = 'amend'))
       and lower(o.pmo_record_id) <> lower(p_record_id)
       -- Joined on the uuid so the primary keys can seek. The CASE (evaluated in order) turns an id that is not a uuid's
       -- text into NULL instead of a cast error — the same rows the text comparison matched, and only those.
       and not exists (select 1 from public.progress_claims pc
                        where pc.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                           then lower(o.pmo_record_id)::uuid end
                          and pc.org_id = p_org_id)
       and lower(coalesce(nullif(btrim(o.payload ->> 'workOrderId'), ''),
                          (select si.work_order_id::text from public.sales_invoices si
                            where si.id = case when lower(o.pmo_record_id) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                               then lower(o.pmo_record_id)::uuid end
                              and si.org_id = p_org_id))) = p_work_order_id::text
  ), per_record as (
    -- an invoice with an edit in flight counts at the larger of its mirrored and its pending amount
    select record_id, max(billed) as billed,
           bool_or(billed is null or currency is distinct from v_currency) as unknown
      from lines group by record_id
  )
  select coalesce(sum(billed), 0), coalesce(bool_or(unknown), false)
    into v_existing, v_unknown
    from per_record;

  if v_unknown then
    raise exception 'an invoice on work order % has no amount or is in another currency, so what is still to invoice cannot be checked',
      v_label using errcode = 'BW001';
  end if;
  if v_existing + p_billed > v_net then
    raise exception 'this invoice would bill % against work order % (worth % excl. tax, with % already invoiced or in draft): only % is still to invoice',
      round(p_billed, 2), v_label, round(v_net, 2), round(v_existing, 2), round(greatest(v_net - v_existing, 0), 2)
      using errcode = 'BW001';
  end if;
end; $$;

create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               join public.boq_items b on b.id=x.boq_item_id and b.project_id=p_project_id
              where b.earning_basis='lump_sum' and x.quantity_to_date>1) then
    raise exception 'lump-sum assessment quantity cannot exceed one' using errcode='23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  -- ⚑ 0252: the derived writer is the one path allowed to change a quantity-measured month's percent.
  perform set_config('pmo.derived_pct_write', 'on', true);
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;
  -- Clear the flag at once: it is transaction-local, so leaving it on would let a later direct UPDATE in the
  -- same transaction slip past the guard.
  perform set_config('pmo.derived_pct_write', '', true);

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;

create or replace function public.transition_work_order(
  p_id uuid,
  p_to public.work_order_status,
  p_over_commit_ack boolean default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from       public.work_order_status;
  v_org        uuid;
  v_project    uuid;
  v_value      numeric;
  v_set_by     uuid;
  v_set_at     timestamptz;
  v_number     text;
  v_role       user_role := auth_role();
  v_ceiling    numeric;
  v_treatment  text;      -- #513: this work order's own tax basis
  v_tax        numeric;   -- #513: this work order's own tax amount
  v_net        numeric;   -- #513: v_value normalised to net
  v_committed  numeric;
  v_exceeds    boolean := false;
  v_ack_by     uuid;
  v_ack_at     timestamptz;
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Issued','Cancelled'),
    'Issued',    jsonb_build_array('Closed','Cancelled'),
    'Closed',    jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  -- Load + lock the work order. The witness pair is read under the SAME lock as the value it
  -- witnesses — a concurrent set_work_order_value takes that lock too, so they cannot be read torn.
  -- ⚑ #513: this row's OWN tax facts are read under the SAME lock as its value, for the same reason
  -- the witness pair is — a basis read separately from the figure it describes can be read torn.
  select status, org_id, project_id, order_value, order_value_set_by, order_value_set_at, wo_number,
         tax_treatment, tax_amount
    into v_from, v_org, v_project, v_value, v_set_by, v_set_at, v_number,
         v_treatment, v_tax
    from public.work_orders where id = p_id for update;
  if v_from is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org transitions.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this active-membership gate MUST stay — see the twin comment in set_work_order_value.
  perform public.assert_is_active_member();

  -- Coarse role gate (the transition_project shape: revenue is not procurement, so there is no
  -- per-transition matrix). SECURITY: MUST stay — without it any authenticated user may issue.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality: (from,to) must be in the data map and not a no-op.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- The acknowledgement is meaningful ONLY on the issue step. Accepting it elsewhere would let a
  -- client attach it to every call and turn it into noise.
  if p_to is distinct from 'Issued' and p_over_commit_ack is not null then
    raise exception
      'the over-commitment acknowledgement applies only to issuing a work order, not to a % transition',
      p_to
      using errcode = 'P0001';
  end if;

  if p_to = 'Issued' then
    -- ── THE MONEY SoD. SECURITY: this block MUST stay. Without it one person sets the value on a
    -- Draft, issues it alone, and books client revenue at a figure NOBODY ELSE EVER APPROVED.
    -- Every clause is TOTAL (`is distinct from`, an explicit `is null` branch, helpers that all
    -- coalesce to FALSE) because a NULL-valued condition does not fire an `if` — the exact defect
    -- 0176 §6 had to repair in four other guards.
    --   (i)   there is money on the row              -> otherwise there is nothing to ratify;
    --   (ii)  the ISSUER does not themselves hold won-value authority -> a Finance/Exec/Admin issuer
    --         is already the accountable party and needs nobody;
    --   (iii) the value was authored by a DISTINCT, ACTIVE person who may approve THIS issuer's work.
    --         The direction matters and is easy to get backwards: the question is not "may the issuer
    --         approve the author?" but "did someone with authority OVER THE ISSUER put their name on
    --         this number?" A PM whose line manager set the value is cleared; a PM whose PEER set it
    --         is not.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                   -- never witnessed -> FAIL CLOSED
             or v_set_by is null                                   -- unattributed    -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()           -- issuer authored it themselves
             or not public.is_active_member(v_set_by)              -- witness offboarded / banned
             or not public.may_approve_work_of(v_set_by, auth.uid()) )
    then
      if v_set_at is null or v_set_by is null then
        raise exception
          'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif v_set_by is not distinct from auth.uid() then
        raise exception
          'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif not public.is_active_member(v_set_by) then
        -- Ordered BEFORE the seniority branch: an offboarded peer is offboarded first and not-senior
        -- second, and the operator needs "get someone who is still here".
        raise exception
          'this work order''s value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      else
        raise exception
          'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      end if;
    end if;

    -- ── THE DRAWDOWN, COMPUTED UNDER THE PARENT'S LOCK (DD-WO-2). Locking the project row is what
    -- serializes two concurrent issues on the SAME project: without it both read the same committed
    -- total, both decide they fit, and the pair lands over the ceiling with no acknowledgement.
    -- ⚑ #513: EVERY figure below is NET. Before this, the gate compared a work order's stated
    -- `order_value` against a `contract_value` with no tax basis at all, so an exclusive WO under an
    -- inclusive ceiling made the drawdown look SMALLER than it is — the control UNDER-detected the
    -- over-commitment it exists to detect, and nobody was ever asked to acknowledge it. The
    -- normalisation here is byte-identical to `get_project_drawdown`'s (§3), deliberately: a gate
    -- that computes the drawdown differently from the screen showing it is worse than either being
    -- wrong alone, because the two disagree and neither is visibly at fault.
    select (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                 else p.contract_value end)
      into v_ceiling
      from public.projects p where p.id = v_project for update;
    if v_ceiling is null then
      raise exception 'work order parent project not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(coalesce(wo.closing_value,case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                             else wo.order_value end)), 0)
      into v_committed
      from public.work_orders wo
     where wo.project_id = v_project and wo.status in ('Issued','Closed');

    v_net := case when v_treatment = 'inclusive' then coalesce(v_value, 0) - coalesce(v_tax, 0)
                  else coalesce(v_value, 0) end;

    v_exceeds := (v_committed + v_net) > v_ceiling;

    -- FAIL CLOSED: the acknowledgement is never assumed. `is not true` covers both NULL (the caller
    -- said nothing) and false (the caller explicitly declined) — a `= false` test would let an
    -- omitted parameter through.
    if v_exceeds and p_over_commit_ack is not true then
      raise exception
        'issuing this work order would commit % against a contract ceiling of % (already committed: %): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
        v_committed + v_net, v_ceiling, v_committed
        using errcode = 'P0001';
    end if;

    -- The mirror of fail-closed: an acknowledgement with nothing to acknowledge is refused rather
    -- than accepted-and-ignored. If it were ignored, a client could send it unconditionally and the
    -- stamp would stop meaning "a person looked at an over-commitment and chose it".
    if p_over_commit_ack is not null and not v_exceeds then
      raise exception
        'there is no over-commitment to acknowledge: committing % leaves the contract ceiling of % intact',
        v_committed + v_net, v_ceiling
        using errcode = 'P0001';
    end if;

    if v_exceeds then
      v_ack_by := auth.uid();
      v_ack_at := now();
    end if;

    -- Mint the document number (once) and stamp the issue. `coalesce` rather than an unconditional
    -- mint so a re-run can never burn a second number on the same row.
    update public.work_orders set
      status             = p_to,
      wo_number          = coalesce(wo_number, public.next_procurement_doc_number(v_org, 'WO')),
      issued_by          = auth.uid(),
      issued_at          = now(),
      over_commit_ack_by = v_ack_by,
      over_commit_ack_at = v_ack_at
    where id = p_id;

  elsif p_to = 'Closed' then
    if exists(select 1 from public.work_order_lines l where l.work_order_id=p_id) then
      raise exception 'this work order has contract lines: close it by confirming its final BAST' using errcode='42501';
    end if;
    update public.work_orders set status = p_to, closed_at = now() where id = p_id;
  else  -- 'Cancelled'
    update public.work_orders set status = p_to, cancelled_at = now() where id = p_id;
  end if;

  perform public.log_audit('work_order.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',               v_from::text,
                                              'to',                 p_to::text,
                                              'project_id',         v_project,
                                              'order_value',        v_value,
                                              'order_value_set_by', v_set_by,
                                              'order_value_set_at', v_set_at,
                                              'contract_ceiling',   v_ceiling,
                                              'committed_before',   v_committed,
                                              'over_commit_ack_by', v_ack_by));
end; $$;


create or replace function public.api_client_request_guard()
  returns void
  language plpgsql
  security invoker
  set search_path = ''
as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  -- ACTIVE-ADMIN TIER (`pmo load`, #796) — keep in step with scripts/pmo.mjs LOAD_TABLES / LOAD_RPCS.
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then
    return; -- not an OAuth API client: nothing to decide here
  end if;

  if coalesce(headers ->> 'accept-profile', 'public') <> 'public'
     or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may use the public schema only';
  end if;

  -- `Prefer: resolution=merge-duplicates|ignore-duplicates` turns a POST into an upsert (an UPDATE on
  -- conflict), which would let a POST-only grant edit rows. The CLI never sends it; refuse it everywhere.
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501',
      message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;

  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then
      return;
    end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  else
    target := substr(path, 2); -- exact table name; anything longer matches no list entry
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then
      return;
    end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then
      return;
    end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then
        return;
      end if;
    end if;
  end if;

  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end;
$$;



-- Allocation-based claim scope; all shipped lock/evidence/recovery/cap logic is retained.
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  -- ⚑ 0262 (OD-BILL-1, DD-BWO-5): the work order's billing lock BEFORE the project row lock — the order every billing
  --   writer uses, so a claim and a native invoice on one work order cannot deadlock.
  if p_work_order_id is not null then
    perform public.lock_work_order_billing(p_work_order_id);
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or (p_work_order_id is not null and not exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id and wl.work_order_id=p_work_order_id)) or (p_work_order_id is null and exists(select 1 from public.work_order_lines wl where wl.boq_item_id=b.id))) then
      raise exception 'every line must be allocated to the selected work order, or have no allocation for a project-level claim'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    -- ⚑ 0262 (OD-BILL-1, DD-BWO-4): a claim reserves its gross against its work order when it is created.
    if p_work_order_id is not null then
      perform public.assert_work_order_invoiceable(v_org, p_work_order_id, p_project_id, v_id::text, v_gross, v_currency);
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;



-- Billing view now uses the stamped close value in place of the original PO net.
create or replace view public.work_order_billing with (security_invoker = true) as
  select wo.id as work_order_id, wo.org_id, wo.project_id, wo.status, wo.wo_number, wo.title, wo.closed_at, wo.currency,
         coalesce(wo.closing_value,case when wo.tax_treatment='inclusive' then wo.order_value-wo.tax_amount else wo.order_value end) as order_net,
         coalesce(sum(l.billed) filter(where l.submitted),0) as invoiced,
         coalesce(sum(l.billed) filter(where not l.submitted),0) as pending,
         coalesce(sum(l.billed) filter(where l.paid),0) as paid,
         coalesce(wo.closing_value,case when wo.tax_treatment='inclusive' then wo.order_value-wo.tax_amount else wo.order_value end)-coalesce(sum(l.billed),0) as remaining,
         coalesce(bool_and(l.billed is not null and l.currency=wo.currency) filter(where l.record_id is not null),true) as figures_complete,
         count(l.record_id)::int as line_count,(count(l.record_id) filter(where l.submitted and not l.paid))::int as unpaid_count
    from public.work_orders wo left join public.work_order_billing_lines l on l.work_order_id=wo.id and l.org_id=wo.org_id
   group by wo.id;
revoke all on public.work_order_billing from public,anon,authenticated;
grant select on public.work_order_billing to authenticated;

-- SECURITY INVOKER summary: aggregate each relation independently, then join facts by contract line.
create or replace function public.get_project_billing(p_project_id uuid)
 returns jsonb language sql stable security invoker set search_path=public as $$
with p as (
 select pr.id,pr.org_id,pr.currency,case when pr.tax_treatment='inclusive' then pr.contract_value-coalesce(pr.tax_amount,0) else pr.contract_value end contract_net
 from public.projects pr where pr.id=p_project_id
), counted as (
 select w.is_down_payment,w.net,w.recovery from public.sales_invoice_work_billed w join p on p.id=w.project_id
 where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency=p.currency
), claims as (
 select pc.id,pc.kind,pc.gross_amount,pc.dp_recovery_amount,pc.work_order_id,si.status
 from public.progress_claims pc left join public.sales_invoices si on si.id=pc.id and si.org_id=pc.org_id
 where pc.project_id=p_project_id and pc.withdrawn_at is null and si.status is distinct from 'Cancelled'
), claimed_line as (
 select l.boq_item_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id group by l.boq_item_id
), claimed_alloc as (
 select l.boq_item_id,c.work_order_id,sum(l.quantity) claimed from public.progress_claim_lines l join claims c on c.id=l.claim_id
 where c.work_order_id is not null group by l.boq_item_id,c.work_order_id
), latest as (
 select e.id,e.month,e.pct_complete from public.project_progress_entries e where e.project_id=p_project_id
 and e.month<=public.org_current_month((select o.default_timezone from public.organizations o where o.id=public.auth_org_id()),now()) order by e.month desc limit 1
), assessed as (select q.boq_item_id,q.quantity_to_date from public.progress_assessment_quantities q join latest l on l.id=q.entry_id),
latest_bast as (
 select distinct on (a.work_order_id) a.work_order_id,a.id,a.is_final
 from public.work_order_acceptances a where a.status='Confirmed'
 order by a.work_order_id,a.confirmed_at desc,a.id desc
), allocation as (
 select wl.boq_item_id,wl.work_order_id,wl.quantity,wo.status,
   coalesce(ca.claimed,0) claimed,al.quantity accepted,coalesce(lb.is_final,false) final
 from public.work_order_lines wl join public.work_orders wo on wo.id=wl.work_order_id
 left join claimed_alloc ca on ca.boq_item_id=wl.boq_item_id and ca.work_order_id=wl.work_order_id
 left join latest_bast lb on lb.work_order_id=wl.work_order_id
 left join public.work_order_acceptance_lines al on al.acceptance_id=lb.id and al.boq_item_id=wl.boq_item_id
 where wl.org_id=public.auth_org_id() and wo.status<>'Cancelled'
), agg as (
 select b.id,b.earning_basis,b.line_no,b.created_at,b.quantity contract_quantity,b.rate,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status in ('Issued','Closed')),0) ordered_quantity,
  coalesce((select sum(a.quantity) from allocation a where a.boq_item_id=b.id and a.status='Issued'),0) issued_ordered,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.final and a.status='Closed'),0) closed_final,
  coalesce((select sum(a.accepted) from allocation a where a.boq_item_id=b.id and a.accepted is not null),0) accepted_quantity,
  coalesce(cl.claimed,0) claimed_quantity,coalesce(a.quantity_to_date,0) assessed_quantity,
  coalesce((select jsonb_agg(jsonb_build_object('workOrderId',x.work_order_id,'boqItemId',x.boq_item_id,'quantity',x.quantity,'claimedQuantity',x.claimed,'acceptedQuantity',x.accepted,'final',x.final) order by x.work_order_id)
    from allocation x where x.boq_item_id=b.id),'[]'::jsonb) allocations
 from public.boq_items b left join claimed_line cl on cl.boq_item_id=b.id left join assessed a on a.boq_item_id=b.id where b.project_id=p_project_id
), lines as (
 select a.*,
  a.closed_final+least(greatest(a.assessed_quantity-a.closed_ordered,0),greatest(a.contract_quantity-a.closed_final,0)) earned_quantity,
  greatest(a.contract_quantity-a.issued_ordered-a.closed_final,0) contract_balance
 from (select agg.*,coalesce((select sum(x.quantity) from allocation x join public.work_orders w on w.id=x.work_order_id where x.boq_item_id=agg.id and w.status='Closed'),0) closed_ordered from agg) a
)
select jsonb_build_object(
 'currency',p.currency,'contract_net',p.contract_net,
 'work_billed',coalesce((select sum(net+recovery) from counted where not is_down_payment),0),
 'dp_billed',coalesce((select sum(net) from counted where is_down_payment),0),
 'dp_recovered',coalesce((select sum(recovery) from counted where not is_down_payment),0),
 'not_submitted',coalesce((select sum(gross_amount-dp_recovery_amount) from claims where status is null or status='Draft'),0),
 'assessment',(select jsonb_build_object('month',l.month,'pct_complete',l.pct_complete) from latest l),
 'earned_value',coalesce((select sum(round(earned_quantity*rate,2)) from lines),0),
 'boq',coalesce((select jsonb_agg(jsonb_build_object('boq_item_id',id,'claimed_quantity',claimed_quantity,'assessed_quantity',assessed_quantity,
   'earning_basis',earning_basis,'line_no',line_no,'ordered_quantity',ordered_quantity,'accepted_quantity',accepted_quantity,'closed_final',closed_final,
   'earned_quantity',earned_quantity,'contract_balance',contract_balance,'allocations',allocations) order by line_no nulls last,created_at,id)
   from lines),'[]'::jsonb)) from p
$$;
revoke all on function public.get_project_billing(uuid) from public,anon;
grant execute on function public.get_project_billing(uuid) to authenticated;

-- Preserve 0197 INVOKER drawdown contract with effective net.
create or replace function public.get_project_drawdown(p_project_id uuid)
  returns table (committed numeric, draft numeric, ceiling numeric, currency text, basis text)
  language sql stable security invoker set search_path = public as $$
  -- `wo.tax_treatment` is a flat NOT NULL on work_orders (0193), so its branch is total. The
  -- project's is conditional (§1), and `is not distinct from` is NOT needed: a NULL treatment only
  -- ever accompanies contract_value = 0, where net and gross are the same number anyway.
  select coalesce(sum(coalesce(wo.closing_value, case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end))
                  filter (where wo.status in ('Issued','Closed')), 0)::numeric,
         coalesce(sum(coalesce(wo.closing_value, case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end))
                  filter (where wo.status = 'Draft'), 0)::numeric,
         (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
               else p.contract_value end)::numeric,
         p.currency,
         'net'::text
    from public.projects p
    left join public.work_orders wo on wo.project_id = p.id
   where p.id = p_project_id
   group by p.id, p.contract_value, p.tax_treatment, p.tax_amount, p.currency
$$;
revoke all on function public.get_project_drawdown(uuid) from public;
grant execute on function public.get_project_drawdown(uuid) to authenticated;
revoke execute on function public.get_project_drawdown(uuid) from anon;

do $$
begin
  if has_table_privilege('anon','public.work_order_lines','select')
     or has_table_privilege('anon','public.work_order_acceptances','select')
     or has_table_privilege('anon','public.work_order_acceptance_lines','select') then
    raise exception '0337: anon can read a contract quantity table';
  end if;
  if has_table_privilege('authenticated','public.work_order_acceptances','insert')
     or has_table_privilege('authenticated','public.work_order_acceptance_lines','insert') then
    raise exception '0337: authenticated can write an acceptance table directly';
  end if;
  if has_function_privilege('anon','public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid)','execute')
     or has_function_privilege('anon','public.withdraw_work_order_acceptance(uuid)','execute')
     or has_function_privilege('anon','public.confirm_work_order_acceptance(uuid)','execute') then
    raise exception '0337: anon can execute a BAST write RPC';
  end if;
  if not has_function_privilege('authenticated','public.prepare_work_order_acceptance(uuid,date,boolean,jsonb,uuid,text,uuid)','execute')
     or not has_function_privilege('authenticated','public.withdraw_work_order_acceptance(uuid)','execute')
     or not has_function_privilege('authenticated','public.confirm_work_order_acceptance(uuid)','execute') then
    raise exception '0337: an authenticated BAST RPC grant is missing';
  end if;
  if has_function_privilege('authenticated','public.check_work_order_line_scope()','execute')
     or has_function_privilege('authenticated','public.guard_work_order_closing_value()','execute') then
    raise exception '0337: an internal trigger function is client executable';
  end if;
end $$;
