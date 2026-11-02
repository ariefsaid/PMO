-- 0470_subcontract_acceptances.sql — #1513 S2: subcontract acceptance (Berita Acara) on a subcontract PO's BoQ lines.
-- Spec docs/specs/subcontract-acceptance.spec.md (signed 2026-11-01) · Plan docs/plans/2026-11-01-subcontract-acceptance.md S2.
-- Shape = ADR-0091 / 0337_contract_quantities.sql (header + lines, Draft/Confirmed/Withdrawn, immutability, prepare/withdraw/confirm
-- definers), with `po_id` for `work_order_id`, no final/closing acceptance (OQ-5) and no lump-sum rule.
-- Proven by supabase/tests/subcontract_acceptances.test.sql and the 0178 allow-list.
-- ── REVERSE (also rollback/0470_subcontract_acceptances_down.sql; refused while rows exist, NFR-SCA-007) ──
--   do $$ begin if exists (select 1 from public.subcontract_acceptances) or exists (select 1 from public.subcontract_acceptance_lines)
--     then raise exception 'rollback refused: subcontract acceptances exist — export and remove them first'; end if; end $$;
--   drop function if exists public.confirm_subcontract_acceptance(uuid);
--   drop function if exists public.withdraw_subcontract_acceptance(uuid);
--   drop function if exists public.prepare_subcontract_acceptance(uuid, date, jsonb, uuid, text, uuid);
--   drop function if exists public.subcontract_verified(uuid);
--   drop table if exists public.subcontract_acceptance_lines;  drop table if exists public.subcontract_acceptances;  (drops triggers)
--   drop function if exists public.guard_subcontract_acceptance_line_immutable();
--   drop function if exists public.guard_subcontract_acceptance_immutable();

-- §1 Tables. Child tenancy is inherited from the header; org_id is stamped by the definer, never the client (D6).
create table public.subcontract_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  project_id uuid not null references public.projects(id),
  po_id uuid not null references public.purchase_orders(id),
  acceptance_date date not null,
  status text not null default 'Draft' check (status in ('Draft','Confirmed','Withdrawn')),
  prepared_by uuid not null references public.profiles(id),
  prepared_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  confirm_basis text check (confirm_basis in ('standard','sole_operator')),
  withdrawn_at timestamptz,
  note text check (note is null or length(note) <= 500),
  document_id uuid references public.project_documents(id),
  constraint subcontract_acceptances_confirmation_pair check
    ((status = 'Confirmed') = (confirmed_by is not null and confirmed_at is not null and confirm_basis is not null)),
  constraint subcontract_acceptances_withdraw_pair check ((status = 'Withdrawn') = (withdrawn_at is not null))
);
create index subcontract_acceptances_org_project_idx on public.subcontract_acceptances (org_id, project_id);
create index subcontract_acceptances_latest_idx on public.subcontract_acceptances (po_id, status, confirmed_at desc, id desc);
create index subcontract_acceptances_document_idx on public.subcontract_acceptances (document_id);
create table public.subcontract_acceptance_lines (
  acceptance_id uuid not null references public.subcontract_acceptances(id),
  boq_item_id uuid not null references public.boq_items(id),
  quantity numeric(14,3) not null check (quantity >= 0 and quantity < 'Infinity'::numeric),
  primary key (acceptance_id, boq_item_id)
);
create index subcontract_acceptance_lines_boq_idx on public.subcontract_acceptance_lines (boq_item_id);

-- §2 Immutability: a Confirmed or Withdrawn acceptance never changes; a Draft's lines are replaced only by the prepare RPC.
create or replace function public.guard_subcontract_acceptance_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'Confirmed' or old.status = 'Withdrawn' then raise exception 'acceptance is immutable' using errcode = '42501'; end if;
    raise exception 'acceptances are managed by their RPC' using errcode = '42501';
  end if;
  if old.status <> 'Draft' or (new.id, new.org_id, new.project_id, new.po_id) is distinct from (old.id, old.org_id, old.project_id, old.po_id) then
    raise exception 'acceptance is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger subcontract_acceptances_immutable before update or delete on public.subcontract_acceptances
  for each row execute function public.guard_subcontract_acceptance_immutable();
create or replace function public.guard_subcontract_acceptance_line_immutable() returns trigger
  language plpgsql set search_path = public as $$
declare v_status text;
begin
  select status into v_status from public.subcontract_acceptances where id = coalesce(new.acceptance_id, old.acceptance_id);
  if v_status is distinct from 'Draft'
     or (tg_op = 'DELETE' and coalesce(current_setting('pmo.replace_subcontract_acceptance', true), '') <> 'on') then
    raise exception 'acceptance lines are immutable outside draft replacement' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger subcontract_acceptance_lines_immutable before update or delete on public.subcontract_acceptance_lines
  for each row execute function public.guard_subcontract_acceptance_line_immutable();
revoke all on function public.guard_subcontract_acceptance_immutable() from public, anon, authenticated;
revoke all on function public.guard_subcontract_acceptance_line_immutable() from public, anon, authenticated;

-- §3 RLS (D6): select only; org + active member, and the PO visible under the caller's own RLS (the Engineer purchasing scope,
-- 0350, is inherited). Lines read through their header, so the same conditions apply.
alter table public.subcontract_acceptances enable row level security;
alter table public.subcontract_acceptances force row level security;
alter table public.subcontract_acceptance_lines enable row level security;
alter table public.subcontract_acceptance_lines force row level security;
create policy subcontract_acceptances_read on public.subcontract_acceptances for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and exists (select 1 from public.purchase_orders po where po.id = po_id));
create policy subcontract_acceptance_lines_read on public.subcontract_acceptance_lines for select
  using (exists (select 1 from public.subcontract_acceptances a
                  where a.id = acceptance_id and a.org_id = public.auth_org_id() and public.is_active_member()));
revoke all on public.subcontract_acceptances, public.subcontract_acceptance_lines from public, anon, authenticated;
grant select on public.subcontract_acceptances, public.subcontract_acceptance_lines to authenticated;

-- §4 Verified quantity per line (PQ-8): the quantity on the latest Confirmed acceptance that includes the line (cumulative,
-- monotone by FR-SCA-014). Draft and Withdrawn never count. Invoker: the caller's RLS decides what is visible, so a PO the
-- caller cannot see yields no row, never a fabricated zero (NFR-SCA-005).
create or replace function public.subcontract_verified(p_po_id uuid)
  returns table (boq_item_id uuid, quantity numeric, acceptance_id uuid, confirmed_at timestamptz)
  language sql stable security invoker set search_path = public as $$
  select distinct on (l.boq_item_id) l.boq_item_id, l.quantity, a.id, a.confirmed_at
    from public.subcontract_acceptance_lines l
    join public.subcontract_acceptances a on a.id = l.acceptance_id
   where a.po_id = p_po_id and a.status = 'Confirmed'
   order by l.boq_item_id, a.confirmed_at desc, a.id desc
$$;
revoke all on function public.subcontract_verified(uuid) from public, anon;
grant execute on function public.subcontract_verified(uuid) to authenticated;

-- §5 prepare = 0337 prepare with po_id for work_order_id. Changed lines carry `-- 0470`. Lock order (D5): procurements row,
-- then subcontract_po_lock, then the acceptance row. The caller's authority is checked BEFORE any lock is taken.
create or replace function public.prepare_subcontract_acceptance(
  p_po_id uuid, p_acceptance_date date, p_lines jsonb,
  p_document_id uuid default null, p_note text default null, p_acceptance_id uuid default null)
  returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_proc public.procurements; v_project uuid; v_rev integer; v_id uuid;   -- 0470
begin
  perform public.assert_is_active_member();
  if p_acceptance_date is null or p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'acceptance date and at least one quantity are required' using errcode = '23502';
  end if;
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;                                          -- 0470
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;                                  -- 0470
  select * into v_proc from public.procurements where id = v_po.procurement_id and org_id = v_org;                               -- 0470
  v_project := v_proc.project_id;                                                                                                -- 0470
  if v_project is null or not public.may_record_project_progress(v_project) then                                                 -- 0470 gate kept (0245:55)
    raise exception 'you may prepare an acceptance only on a project you manage, unless you are Finance, an Executive or an Admin' using errcode = '42501'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id for update;                                       -- 0470 D5 row first
  perform public.subcontract_po_lock(p_po_id);                                                                                   -- 0470 D5 then the PO
  if v_proc.status::text in ('Cancelled','Rejected') then                                                                        -- 0470 PQ-12
    raise exception 'this purchase is closed' using errcode = '42501'; end if;
  v_rev := public.po_effective_revision(p_po_id);                                                                                -- 0470
  if v_rev is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'; end if;                        -- 0470
  if p_document_id is not null and not exists (select 1 from public.project_documents d where d.id = p_document_id and d.org_id = v_org and d.project_id = v_project) then
    raise exception 'the document must belong to this purchase''s project' using errcode = '23514'; end if;                      -- 0470
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)
    where not coalesce(x.quantity >= 0 and x.quantity < 'Infinity'::numeric and x.quantity = round(x.quantity, 3), false)) then
    raise exception 'acceptance quantities must be finite, nonnegative and have at most 3 decimals' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)                                      -- 0470 effective revision
    left join public.purchase_order_lines l on l.po_id = p_po_id and l.revision = v_rev and l.boq_item_id = x.boq_item_id
    where l.boq_item_id is null) then raise exception 'every acceptance line must be on the PO''s effective BoQ lines' using errcode = '23514'; end if;
  if (select count(*) from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)) <>
     (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)) then
    raise exception 'each contract line may appear once in an acceptance' using errcode = '23514'; end if;
  if exists (select 1 from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric)                                      -- 0470 FR-SCA-014
             join public.subcontract_verified(p_po_id) v on v.boq_item_id = x.boq_item_id where x.quantity < v.quantity) then
    raise exception 'a cumulative verified quantity cannot go below the last confirmed acceptance' using errcode = '23514'; end if;
  if p_acceptance_id is null then
    insert into public.subcontract_acceptances (org_id, project_id, po_id, acceptance_date, prepared_by, note, document_id)       -- 0470
    values (v_org, v_project, p_po_id, p_acceptance_date, auth.uid(), nullif(btrim(p_note), ''), p_document_id) returning id into v_id;
  else
    select id into v_id from public.subcontract_acceptances where id = p_acceptance_id and po_id = p_po_id and org_id = v_org and status = 'Draft' for update;   -- 0470
    if not found then raise exception 'draft acceptance not found' using errcode = 'P0002'; end if;
    perform set_config('pmo.replace_subcontract_acceptance', 'on', true);                                                         -- 0470
    delete from public.subcontract_acceptance_lines where acceptance_id = v_id;
    perform set_config('pmo.replace_subcontract_acceptance', '', true);                                                           -- 0470
    update public.subcontract_acceptances set acceptance_date = p_acceptance_date, prepared_by = auth.uid(), prepared_at = now(),
      note = nullif(btrim(p_note), ''), document_id = p_document_id where id = v_id;
  end if;
  insert into public.subcontract_acceptance_lines (acceptance_id, boq_item_id, quantity)                                          -- 0470
  select v_id, x.boq_item_id, x.quantity from jsonb_to_recordset(p_lines) x(boq_item_id uuid, quantity numeric);
  perform public.log_audit('subcontract_acceptance.prepare', v_org, auth.uid(), v_id, jsonb_build_object('project_id', v_project, 'po_id', p_po_id));   -- 0470
  return v_id;
end $$;
revoke all on function public.prepare_subcontract_acceptance(uuid, date, jsonb, uuid, text, uuid) from public, anon;
grant execute on function public.prepare_subcontract_acceptance(uuid, date, jsonb, uuid, text, uuid) to authenticated;

-- §6 withdraw = 0337 withdraw with po_id: the procurement row, then the PO lock, then the acceptance row.
create or replace function public.withdraw_subcontract_acceptance(p_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_po uuid; v_proc uuid; v_project uuid; v_preparer uuid;                               -- 0470
begin
  perform public.assert_is_active_member();
  select a.po_id, a.project_id, a.prepared_by, po.procurement_id into v_po, v_project, v_preparer, v_proc                          -- 0470
    from public.subcontract_acceptances a join public.purchase_orders po on po.id = a.po_id where a.id = p_id and a.org_id = v_org;
  if not found then raise exception 'acceptance not found' using errcode = 'P0002'; end if;
  if not (auth.uid() = v_preparer or public.auth_role() in ('Admin','Finance')) then
    raise exception 'only the preparer, Admin or Finance may withdraw this acceptance' using errcode = '42501'; end if;
  perform 1 from public.procurements where id = v_proc and org_id = v_org for update;                                              -- 0470 D5
  perform public.subcontract_po_lock(v_po);                                                                                        -- 0470 D5
  perform 1 from public.subcontract_acceptances where id = p_id for update;
  update public.subcontract_acceptances set status = 'Withdrawn', withdrawn_at = now() where id = p_id and status = 'Draft';
  if not found then raise exception 'only a Draft acceptance can be withdrawn' using errcode = '42501'; end if;
  perform public.log_audit('subcontract_acceptance.withdraw', v_org, auth.uid(), p_id, jsonb_build_object('project_id', v_project, 'po_id', v_po));   -- 0470
end $$;
revoke all on function public.withdraw_subcontract_acceptance(uuid) from public, anon;
grant execute on function public.withdraw_subcontract_acceptance(uuid) to authenticated;

-- §7 confirm = the head confirm (0339) reduced to the subcontract case: no closing value, no work-order billing (OQ-5). The
-- sole-operator block and the document check are 0337's, verbatim.
create or replace function public.confirm_subcontract_acceptance(p_id uuid) returns uuid
  language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.auth_org_id(); v_po uuid; v_proc public.procurements; v_acc public.subcontract_acceptances;           -- 0470
        v_project uuid; v_preparer uuid; v_doc uuid; v_basis text := 'standard'; v_sole boolean := false; v_rev integer;
begin
  perform public.assert_is_active_member();
  if public.auth_role() not in ('Admin','Finance') then raise exception 'only Admin or Finance may confirm an acceptance' using errcode = '42501'; end if;
  select a.po_id into v_po from public.subcontract_acceptances a where a.id = p_id and a.org_id = v_org;                           -- 0470
  if not found then raise exception 'acceptance not found' using errcode = 'P0002'; end if;
  select p.* into v_proc from public.procurements p join public.purchase_orders po on po.procurement_id = p.id                       -- 0470 D5 row first
   where po.id = v_po and po.org_id = v_org for update of p;
  perform public.subcontract_po_lock(v_po);                                                                                        -- 0470 D5 then the PO
  select * into v_acc from public.subcontract_acceptances where id = p_id and org_id = v_org for update;                            -- 0470 then the acceptance
  if not found then raise exception 'acceptance not found' using errcode = 'P0002'; end if;
  v_project := v_acc.project_id; v_preparer := v_acc.prepared_by; v_doc := v_acc.document_id;
  if v_acc.status <> 'Draft' then raise exception 'only a Draft acceptance can be confirmed' using errcode = '42501'; end if;       -- 0470
  if v_proc.status::text in ('Cancelled','Rejected') then raise exception 'this purchase is closed' using errcode = '42501'; end if;   -- 0470 PQ-12
  v_rev := public.po_effective_revision(v_po);                                                                                     -- 0470
  if v_rev is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'; end if;                          -- 0470
  if v_preparer = auth.uid() then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then raise exception 'separation of duties: the preparer cannot confirm this acceptance' using errcode = '42501'; end if;
    v_basis := 'sole_operator';
  end if;
  perform 1 from public.project_documents d where d.id = v_doc and d.org_id = v_org and d.project_id = v_project and d.status in ('Issued','Approved') and nullif(btrim(d.file_path), '') is not null for update;
  if v_doc is null or not found then raise exception 'confirmation requires an Issued or Approved project document with a file' using errcode = '23514'; end if;
  if exists (select 1 from public.subcontract_acceptance_lines x where x.acceptance_id = p_id                                      -- 0470 effective revision
             and not exists (select 1 from public.purchase_order_lines l where l.po_id = v_po and l.revision = v_rev and l.boq_item_id = x.boq_item_id)) then
    raise exception 'an accepted line is no longer on the PO''s effective BoQ lines' using errcode = '23514'; end if;
  if exists (select 1 from public.subcontract_acceptance_lines x join public.subcontract_verified(v_po) v on v.boq_item_id = x.boq_item_id   -- 0470 FR-SCA-014 re-check
             where x.acceptance_id = p_id and x.quantity < v.quantity) then
    raise exception 'a cumulative verified quantity cannot go below the last confirmed acceptance' using errcode = '23514'; end if;
  update public.subcontract_acceptances set status = 'Confirmed', confirmed_by = auth.uid(), confirmed_at = clock_timestamp(), confirm_basis = v_basis where id = p_id;
  perform public.log_audit('subcontract_acceptance.confirm', v_org, auth.uid(), p_id, jsonb_build_object('project_id', v_project, 'po_id', v_po, 'basis', v_basis));   -- 0470
  return p_id;
end $$;
revoke all on function public.confirm_subcontract_acceptance(uuid) from public, anon;
grant execute on function public.confirm_subcontract_acceptance(uuid) to authenticated;

-- Closing self-assertion: FORCE RLS, no client DML, internals not client-executable, no anon execute.
do $$
declare t text;
begin
  foreach t in array array['subcontract_acceptances','subcontract_acceptance_lines'] loop
    if not (select c.relforcerowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '0470: % lacks FORCE RLS', t;
    end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '0470: % holds a client DML grant', t;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.guard_subcontract_acceptance_immutable()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_subcontract_acceptance_line_immutable()', 'EXECUTE') then
    raise exception '0470: an internal function is client-executable';
  end if;
  if has_function_privilege('anon', 'public.prepare_subcontract_acceptance(uuid,date,jsonb,uuid,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.withdraw_subcontract_acceptance(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_subcontract_acceptance(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.subcontract_verified(uuid)', 'EXECUTE') then
    raise exception '0470: a subcontract acceptance function is anon-executable';
  end if;
end $$;
