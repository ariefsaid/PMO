-- 0449_subcontract_po_lines.sql — #1513 S1: subcontract purchases carry BoQ lines on their PO; revision 1 freezes them.
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S1.
-- Proven by supabase/tests/subcontract_po_lines.test.sql and the 0178 allow-list.
-- ── REVERSE (also rollback/0449_subcontract_po_lines_down.sql; refused while rows exist, NFR-SCA-007) ──
--   do $$ begin if exists (select 1 from public.purchase_order_lines) or exists (select 1 from public.purchase_order_revisions)
--     then raise exception 'rollback refused: subcontract PO lines exist — export and remove them first'; end if; end $$;
--   drop trigger if exists purchase_orders_zz_subcontract_amount on public.purchase_orders;
--   drop function if exists public.issue_subcontract_po_lines(uuid);
--   drop function if exists public.set_subcontract_po_lines(uuid, jsonb);
--   drop table if exists public.purchase_order_revisions;   drop table if exists public.purchase_order_lines;
--   drop function if exists public.guard_purchase_order_subcontract_amount();
--   drop function if exists public.guard_purchase_order_revision();
--   drop function if exists public.guard_purchase_order_line();
--   drop function if exists public.po_effective_revision(uuid);
--   drop function if exists public.subcontract_po_lock(uuid);
--   restore create_procurement_with_items from 0406_procurement_atomic_create.sql:15-85;
--   drop trigger if exists procurements_zz_subcontract_flag on public.procurements;
--   drop function if exists public.guard_procurement_subcontract_flag();
--   alter table public.procurements drop column if exists is_subcontract;

-- §1 The flag: set at creation, never changed (OQ-1). No client column grant; the trigger binds definers and the owner too.
alter table public.procurements add column is_subcontract boolean not null default false;
create or replace function public.guard_procurement_subcontract_flag() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if new.is_subcontract is distinct from old.is_subcontract then
    raise exception 'whether a purchase is a subcontract is set when it is created' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_subcontract_flag() from public, anon, authenticated;
create trigger procurements_zz_subcontract_flag before update of is_subcontract on public.procurements
  for each row execute function public.guard_procurement_subcontract_flag();

-- §2 Creation key: 0406 body verbatim; each changed line is marked `-- 0449`.
create or replace function public.create_procurement_with_items(p_id uuid, p_header jsonb, p_items jsonb)
returns public.procurements language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id();
  v_parent public.procurements%rowtype; v_item record; v_existing public.procurement_items%rowtype;
  v_project uuid; v_vendor uuid; v_category public.budget_category;
  v_intent public.procurement_create_intents%rowtype;
  v_subcontract boolean;                                                                          -- 0449
begin
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false)
     or not coalesce(public.org_feature_enabled(v_org, 'procurement'), false) then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if p_id is null or jsonb_typeof(p_header) is distinct from 'object'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_typeof(p_header->'title') is distinct from 'string'
     or exists (select 1 from jsonb_object_keys(p_header) k where k not in ('title','project_id','vendor_id','budget_category','is_subcontract'))   -- 0449
     or (p_header ? 'is_subcontract' and jsonb_typeof(p_header->'is_subcontract') is distinct from 'boolean')                                      -- 0449
     or exists (select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object'
          or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','name','description','quantity','rate'))
          or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'name') is distinct from 'string'
          or jsonb_typeof(x->'quantity') is distinct from 'number' or jsonb_typeof(x->'rate') is distinct from 'number'
          or (x ? 'description' and jsonb_typeof(x->'description') not in ('string','null'))) then
    raise exception 'Invalid procurement input' using errcode = '22023';
  end if;
  v_project := (p_header->>'project_id')::uuid; v_vendor := (p_header->>'vendor_id')::uuid;
  v_category := (p_header->>'budget_category')::public.budget_category;
  v_subcontract := coalesce((p_header->>'is_subcontract')::boolean, false);                       -- 0449
  if (v_project is not null and not exists (select 1 from public.projects where id=v_project and org_id=v_org))
     or (v_vendor is not null and not exists (select 1 from public.companies where id=v_vendor and org_id=v_org)) then
    raise exception 'Reference is not available' using errcode = '23503';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) x group by (x->>'id')::uuid having count(*) > 1) then
    raise exception 'Duplicate line ID' using errcode = '23505';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_intent from public.procurement_create_intents where procurement_id=p_id;
  if found and (v_intent.org_id is distinct from v_org or v_intent.actor_id is distinct from v_uid
      or v_intent.header is distinct from p_header or v_intent.items is distinct from p_items) then
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  insert into public.procurements (id,org_id,requested_by_id,title,project_id,vendor_id,budget_category,is_subcontract)   -- 0449
  values (p_id,v_org,v_uid,p_header->>'title',v_project,v_vendor,v_category,v_subcontract)                              -- 0449
  on conflict (id) do nothing;
  select * into v_parent from public.procurements where id=p_id for update;
  if v_parent.org_id is distinct from v_org or v_parent.requested_by_id is distinct from v_uid
     or v_parent.status <> 'Draft' then
    raise exception 'Procurement creation is not permitted' using errcode = '42501';
  end if;
  if v_parent.title is distinct from p_header->>'title' or v_parent.project_id is distinct from v_project
     or v_parent.vendor_id is distinct from v_vendor or v_parent.budget_category is distinct from v_category
     or v_parent.is_subcontract is distinct from v_subcontract then                                                     -- 0449
    raise exception 'Saved procurement differs from request' using errcode = '23505';
  end if;
  for v_item in select * from jsonb_to_recordset(p_items) as x(id uuid,name text,description text,quantity numeric,rate numeric) loop
    insert into public.procurement_items (id,org_id,procurement_id,name,description,quantity,rate)
    values (v_item.id,v_org,p_id,v_item.name,v_item.description,v_item.quantity,v_item.rate)
    on conflict (id) do nothing;
    select * into v_existing from public.procurement_items where id=v_item.id;
    if v_existing.org_id is distinct from v_org or v_existing.procurement_id is distinct from p_id
       or v_existing.name is distinct from v_item.name or v_existing.description is distinct from v_item.description
       or v_existing.quantity is distinct from round(v_item.quantity,2) or v_existing.rate is distinct from round(v_item.rate,2) then
      raise exception 'Saved procurement line differs from request' using errcode = '23505';
    end if;
  end loop;
  if exists (select 1 from public.procurement_items i where i.procurement_id=p_id and i.org_id=v_org
       and not exists (select 1 from jsonb_array_elements(p_items) x where (x->>'id')::uuid=i.id)) then
    raise exception 'Saved procurement lines differ from request' using errcode = '23505';
  end if;
  insert into public.procurement_create_intents (procurement_id,org_id,actor_id,header,items)
  values (p_id,v_org,v_uid,p_header,p_items) on conflict (procurement_id) do nothing;
  return v_parent;
end $$;
revoke all on function public.create_procurement_with_items(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.create_procurement_with_items(uuid,jsonb,jsonb) to authenticated;

-- §3 Tables. Lines and revisions are append-only; org_id is stamped from the parent, never the client (D6).
create table public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  revision integer not null check (revision >= 1),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  unit text not null check (length(btrim(unit)) between 1 and 20),
  amount numeric(14,2) generated always as (round(quantity * rate, 2)) stored,
  created_at timestamptz not null default now(),
  unique (po_id, revision, boq_item_id)
);
create index purchase_order_lines_org_po_idx on public.purchase_order_lines (org_id, po_id, revision);
create index purchase_order_lines_boq_idx on public.purchase_order_lines (boq_item_id);
create table public.purchase_order_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  po_id uuid not null references public.purchase_orders(id),
  procurement_id uuid not null references public.procurements(id),
  revision integer not null check (revision >= 1),
  status text not null default 'Issued' check (status = 'Issued'),
  total numeric(14,2) not null check (total >= 0),
  variation_id uuid,
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default clock_timestamp(),
  issue_basis text not null check (issue_basis in ('standard','sole_operator')),
  unique (po_id, revision)
);
create unique index purchase_order_revisions_one_lined_po on public.purchase_order_revisions (procurement_id) where revision = 1;
create index purchase_order_revisions_org_idx on public.purchase_order_revisions (org_id, procurement_id);

-- Line guard: stamp org, same-project BoQ item, frozen once the revision exists, delete only via the draft replace.
create or replace function public.guard_purchase_order_line() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
declare v_po_org uuid; v_project uuid; v_boq_org uuid; v_boq_project uuid; v_po uuid; v_rev integer;
begin
  if tg_op = 'DELETE' then v_po := old.po_id; v_rev := old.revision; else v_po := new.po_id; v_rev := new.revision; end if;
  if exists (select 1 from public.purchase_order_revisions r where r.po_id = v_po and r.revision = v_rev) then
    raise exception 'issued PO lines are immutable; raise a variation instead' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('pmo.replace_po_draft_lines', true), '') <> 'on' then
      raise exception 'PO lines are replaced as a set' using errcode = '42501';
    end if;
    return old;
  end if;
  select po.org_id, p.project_id into v_po_org, v_project
    from public.purchase_orders po join public.procurements p on p.id = po.procurement_id where po.id = new.po_id;
  select b.org_id, b.project_id into v_boq_org, v_boq_project from public.boq_items b where b.id = new.boq_item_id;
  if v_po_org is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  new.org_id := v_po_org;
  if v_boq_org is distinct from v_po_org or v_boq_project is distinct from v_project then
    raise exception 'the BoQ item is not on this purchase''s project' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_line() from public, anon, authenticated;
create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines
  for each row execute function public.guard_purchase_order_line();

-- Revisions are append-only too.
create or replace function public.guard_purchase_order_revision() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'issued PO revisions are immutable' using errcode = '42501';
  end if;
  new.org_id := (select po.org_id from public.purchase_orders po where po.id = new.po_id);
  if new.org_id is null then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_revision() from public, anon, authenticated;
create trigger purchase_order_revisions_guard before insert or update or delete on public.purchase_order_revisions
  for each row execute function public.guard_purchase_order_revision();

-- RLS (D6): select only, org + active member, and the parent PO visible under the caller's own RLS.
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force row level security;
alter table public.purchase_order_revisions enable row level security;
alter table public.purchase_order_revisions force row level security;
create policy purchase_order_lines_read on public.purchase_order_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
create policy purchase_order_revisions_read on public.purchase_order_revisions for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
revoke all on public.purchase_order_lines, public.purchase_order_revisions from public, anon, authenticated;
grant select on public.purchase_order_lines, public.purchase_order_revisions to authenticated;

-- §4 Lock, effective revision, amount guard.
create or replace function public.subcontract_po_lock(p_po_id uuid) returns void
  language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('subcontract-po:' || p_po_id::text, 0))
$$;
revoke all on function public.subcontract_po_lock(uuid) from public, anon, authenticated;

create or replace function public.po_effective_revision(p_po_id uuid) returns integer
  language sql stable security invoker set search_path = public as $$
  select max(r.revision) from public.purchase_order_revisions r where r.po_id = p_po_id and r.status = 'Issued'
$$;
revoke all on function public.po_effective_revision(uuid) from public, anon;
grant execute on function public.po_effective_revision(uuid) to authenticated;

create or replace function public.guard_purchase_order_subcontract_amount() returns trigger
  language plpgsql set search_path = public, pg_catalog as $$
declare v_total numeric;
begin
  select r.total into v_total from public.purchase_order_revisions r
   where r.po_id = new.id and r.revision = (select max(x.revision) from public.purchase_order_revisions x where x.po_id = new.id);
  if found and new.amount is distinct from v_total
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then          -- PQ-11: the ERP mirror records ERP truth (ADR-0048)
    raise exception 'a subcontract PO''s amount is the total of its effective BoQ lines (%); change it by a PO revision', v_total
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_purchase_order_subcontract_amount() from public, anon, authenticated;
create trigger purchase_orders_zz_subcontract_amount before update of amount on public.purchase_orders
  for each row execute function public.guard_purchase_order_subcontract_amount();

-- §5 Writers. Order (D5): procurements row FOR UPDATE, then the PO advisory lock.
create or replace function public.set_subcontract_po_lines(p_po_id uuid, p_lines jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements; v_po public.purchase_orders; v_n integer;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if not v_proc.is_subcontract then raise exception 'only a subcontract purchase has BoQ lines' using errcode = '42501'; end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may set PO lines' using errcode = '42501'; end if;
  if exists (select 1 from public.purchase_order_revisions r where r.po_id = p_po_id) then
    raise exception 'PO lines are frozen once issued; raise a variation instead' using errcode = '42501'; end if;
  if exists (select 1 from public.purchase_order_revisions r join public.purchase_orders o on o.id = r.po_id
              where o.procurement_id = v_proc.id and r.po_id <> p_po_id)
     or exists (select 1 from public.purchase_order_lines l join public.purchase_orders o on o.id = l.po_id
              where o.procurement_id = v_proc.id and l.po_id <> p_po_id) then
    raise exception 'a subcontract purchase has one PO with BoQ lines' using errcode = '23505'; end if;      -- PQ-3
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'at least one BoQ line is required' using errcode = '23502'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric, unit text)
              where not coalesce(x.quantity > 0 and x.quantity = round(x.quantity, 3) and x.rate >= 0
                                 and x.rate = round(x.rate, 2) and length(btrim(x.unit)) between 1 and 20, false)) then
    raise exception 'quantity above zero (3 decimals), rate zero or more (2 decimals) and a unit are required' using errcode = '23514'; end if;
  perform set_config('pmo.replace_po_draft_lines', 'on', true);
  delete from public.purchase_order_lines where po_id = p_po_id and revision = 1;
  perform set_config('pmo.replace_po_draft_lines', '', true);
  insert into public.purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit)
  select p_po_id, 1, x.boq_item_id, x.quantity, x.rate, btrim(x.unit)
    from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric, rate numeric, unit text);
  get diagnostics v_n = row_count;
  perform public.log_audit('purchase_order_lines.set', v_org, auth.uid(), p_po_id, jsonb_build_object('procurement_id', v_proc.id, 'lines', v_n));
  return v_n;
end $$;
revoke all on function public.set_subcontract_po_lines(uuid, jsonb) from public, anon;
grant execute on function public.set_subcontract_po_lines(uuid, jsonb) to authenticated;

create or replace function public.issue_subcontract_po_lines(p_po_id uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_proc public.procurements; v_po public.purchase_orders;
        v_total numeric; v_ceiling numeric;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;          -- D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                     -- D5 then the PO
  if not v_proc.is_subcontract then raise exception 'only a subcontract purchase has BoQ lines' using errcode = '42501'; end if;
  if v_proc.status::text in ('Cancelled','Rejected') then                                          -- PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.auth_role() not in ('Admin','Finance','Project Manager') then
    raise exception 'only a Project Manager, Finance or an Admin may issue PO lines' using errcode = '42501'; end if;
  if exists (select 1 from public.purchase_order_revisions r where r.po_id = p_po_id) then
    raise exception 'PO lines are already issued' using errcode = '42501'; end if;
  select sum(l.amount) into v_total from public.purchase_order_lines l where l.po_id = p_po_id and l.revision = 1;
  if v_total is null then raise exception 'at least one BoQ line is required' using errcode = '23502'; end if;
  if exists (select 1 from public.procurement_invoices i where i.procurement_id = v_proc.id                -- PQ-4
              and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null) then
    raise exception 'a vendor bill already exists on this purchase; BoQ lines cannot be issued after billing' using errcode = '23514'; end if;
  v_ceiling := coalesce(v_proc.approved_total_value, nullif(v_proc.total_value, 0));                       -- PQ-2
  if v_ceiling is null then
    raise exception 'record the purchase''s value or approval before issuing its BoQ lines' using errcode = '23514';
  end if;
  if v_total > v_ceiling then
    raise exception 'the BoQ lines total % exceeds the purchase''s approved value %', v_total, v_ceiling using errcode = '23514';
  end if;
  if public.domain_externally_owned(v_proc.org_id, 'procurement')                                 -- PQ-11
     and v_po.amount is not null and v_po.amount is distinct from v_total then
    raise exception 'the BoQ lines total % must equal the ERP purchase order amount %', v_total, v_po.amount using errcode = '23514';
  end if;
  insert into public.purchase_order_revisions (org_id, po_id, procurement_id, revision, total, issued_by, issue_basis)
  values (v_org, p_po_id, v_proc.id, 1, v_total, auth.uid(), 'standard');
  if not public.domain_externally_owned(v_proc.org_id, 'procurement') then                        -- PQ-11: a connected PO's amount is the ERP's
    update public.purchase_orders set amount = v_total, status = case when status = 'Draft' then 'Issued' else status end
     where id = p_po_id;                                        -- the revision row above makes the amount guard agree
  end if;
  perform public.log_audit('purchase_order_revision.issue', v_org, auth.uid(), p_po_id, jsonb_build_object('revision', 1, 'total', v_total));
  return 1;
end $$;
revoke all on function public.issue_subcontract_po_lines(uuid) from public, anon;
grant execute on function public.issue_subcontract_po_lines(uuid) to authenticated;

-- Closing self-assertion: FORCE RLS, no client DML, internals not client-executable.
do $$
declare t text;
begin
  foreach t in array array['purchase_order_lines','purchase_order_revisions'] loop
    if not (select c.relforcerowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0449: % lacks FORCE RLS', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '0449: % holds a client DML grant', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.subcontract_po_lock(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_purchase_order_line()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_purchase_order_revision()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_purchase_order_subcontract_amount()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_procurement_subcontract_flag()', 'EXECUTE') then
    raise exception '0449: an internal function is client-executable';
  end if;
end $$;
