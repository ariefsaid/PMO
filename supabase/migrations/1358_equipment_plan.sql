-- 1358_equipment_plan.sql — #2700: the monthly equipment and service plan. SCHEMA + settings, category and plan RPCs.
-- Spec docs/specs/monthly-equipment-service-plan.spec.md (FR-EQP-001..011, 015..017) · plan docs/plans/2026-11-21-monthly-equipment-service-plan.md.
-- Proven by supabase/tests/equipment_plan_settings.test.sql, equipment_plan_draft.test.sql, equipment_plan_approval.test.sql.
-- The approving RPC (it creates the rental purchases) is in 1359.
--
-- Everything the client chooses is DATA (OD-SCOPE-2): the categories list, the approval step, the self-approval switch.
-- Default off: an organisation has no settings row and no plan rows until an Admin turns the plan on, and turning it on
-- needs purchase types (1350) on with an active is_rental type. No client role holds INSERT/UPDATE/DELETE: every write
-- goes through the security-definer RPCs below (ADR-0019). A plan commits no money; it only becomes Draft purchases (1359).
-- REVERSE: rollback/1358_equipment_plan_down.sql (after 1359's rollback; refused while a plan has created purchases).

create table public.org_equipment_plan_settings (
  org_id              uuid primary key references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  enabled             boolean not null default false,
  approval_step       text not null default 'spend_approvers' check (approval_step in ('spend_approvers', 'senior_role')),
  allow_self_approval boolean not null default false,
  updated_by          uuid,
  updated_at          timestamptz not null default now()
);
create table public.equipment_plan_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  name_id    text check (name_id is null or char_length(btrim(name_id)) between 1 and 60),
  position   integer not null default 0 check (position between 0 and 1000),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index equipment_plan_categories_org_name_uq on public.equipment_plan_categories (org_id, lower(btrim(name)));

create table public.equipment_plans (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  project_id    uuid not null references public.projects(id),
  plan_month    date not null check (plan_month = date_trunc('month', plan_month::timestamp)::date),
  status        text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Rejected')),
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  rejected_by   uuid references public.profiles(id),
  rejected_at   timestamptz,
  reject_reason text check (reject_reason is null or char_length(btrim(reject_reason)) between 1 and 500)
);
create unique index equipment_plans_org_project_month_uq on public.equipment_plans (org_id, project_id, plan_month);
create index equipment_plans_org_month_idx on public.equipment_plans (org_id, plan_month desc);

create table public.equipment_plan_lines (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade default '00000000-0000-0000-0000-000000000001',
  plan_id            uuid not null references public.equipment_plans(id) on delete cascade,
  work_order_id      uuid references public.work_orders(id),
  category_id        uuid references public.equipment_plan_categories(id),
  equipment_asset_id uuid references public.equipment_assets(id),
  description        text check (description is null or char_length(btrim(description)) between 1 and 500),
  quantity           numeric(14,2) not null check (quantity > 0),
  rate               numeric(14,2) not null check (rate >= 0),
  vendor_id          uuid not null references public.companies(id),
  date_from          date not null,
  date_to            date not null,
  procurement_id     uuid references public.procurements(id),
  created_at         timestamptz not null default now(),
  constraint equipment_plan_lines_dates check (date_to >= date_from),
  constraint equipment_plan_lines_what check (description is not null or equipment_asset_id is not null)
);
create unique index equipment_plan_lines_procurement_uq on public.equipment_plan_lines (procurement_id) where procurement_id is not null;
create index equipment_plan_lines_plan_idx on public.equipment_plan_lines (plan_id);

alter table public.org_equipment_plan_settings enable row level security; alter table public.org_equipment_plan_settings force row level security;
alter table public.equipment_plan_categories   enable row level security; alter table public.equipment_plan_categories   force row level security;
alter table public.equipment_plans             enable row level security; alter table public.equipment_plans             force row level security;
alter table public.equipment_plan_lines        enable row level security; alter table public.equipment_plan_lines        force row level security;

-- 0074 idiom: the caller's real org overrides the seed-org default. No client sends org_id.
create trigger equipment_plans_stamp_org_id before insert on public.equipment_plans for each row execute function public.stamp_org_id();
create trigger equipment_plan_lines_stamp_org_id before insert on public.equipment_plan_lines for each row execute function public.stamp_org_id();
create trigger equipment_plan_categories_stamp_org_id before insert on public.equipment_plan_categories for each row execute function public.stamp_org_id();
create trigger org_equipment_plan_settings_stamp_org_id before insert on public.org_equipment_plan_settings for each row execute function public.stamp_org_id();

-- Internal. An Engineer reads a project's plans when they raised a purchase on that project (the app keeps no other
-- project-membership list). A definer, so the caller's own purchase RLS does not hide the answer.
create function public.equipment_plan_engineer_on_project(p_project uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.procurements p
                  where p.project_id = p_project and p.requested_by_id = auth.uid() and p.org_id = public.auth_org_id())
$$;
revoke all on function public.equipment_plan_engineer_on_project(uuid) from public, anon, authenticated;

create policy org_equipment_plan_settings_select on public.org_equipment_plan_settings for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy equipment_plan_categories_select on public.equipment_plan_categories for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
-- Readers: Admin, Executive, Finance, Project Manager; the author; an Engineer on the project (FR-EQP-019).
create policy equipment_plans_select on public.equipment_plans for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and ((select public.auth_role()) in ('Admin', 'Executive', 'Finance', 'Project Manager')
              or created_by = (select auth.uid())
              or ((select public.auth_role()) = 'Engineer' and public.equipment_plan_engineer_on_project(project_id))));
create policy equipment_plan_lines_select on public.equipment_plan_lines for select
  using (org_id = (select public.auth_org_id()) and plan_id in (select id from public.equipment_plans));
revoke all on public.org_equipment_plan_settings, public.equipment_plan_categories, public.equipment_plans, public.equipment_plan_lines from public, anon, authenticated;
grant select on public.org_equipment_plan_settings, public.equipment_plan_categories, public.equipment_plans, public.equipment_plan_lines to authenticated;
grant all on public.org_equipment_plan_settings, public.equipment_plan_categories, public.equipment_plans, public.equipment_plan_lines to service_role;

-- Whether the feature is on for an org. Internal.
create function public.equipment_plan_enabled(p_org uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select enabled from public.org_equipment_plan_settings where org_id = p_org), false)
$$;
revoke all on function public.equipment_plan_enabled(uuid) from public, anon, authenticated;

-- The organisation's rental purchase type, found by the flag and never by name (#2697 FR-PTR-016). Null when none.
create function public.equipment_plan_rental_type(p_org uuid) returns uuid
  language sql stable security definer set search_path = pg_catalog, public as $$
  select t.id from public.purchase_types t
   where t.org_id = p_org and t.active and t.is_rental and public.purchase_types_enabled(p_org)
   order by t.position, t.name, t.id limit 1
$$;
revoke all on function public.equipment_plan_rental_type(uuid) from public, anon, authenticated;

-- Who may approve a plan (FR-EQP-010, FR-EQP-011). Reuses the spend-approver set and the spend-authority role rank.
-- The author is refused unless the organisation allows self-approval, for every role including Admin.
create function public.equipment_plan_approver_ok(p_plan_id uuid) returns boolean
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_role public.user_role := public.auth_role();
  v_plan public.equipment_plans%rowtype; v_set public.org_equipment_plan_settings%rowtype; v_has boolean;
begin
  if v_uid is null or v_org is null or not coalesce(public.is_active_member(), false) then return false; end if;
  select * into v_plan from public.equipment_plans where id = p_plan_id and org_id = v_org;
  if not found then return false; end if;
  select * into v_set from public.org_equipment_plan_settings where org_id = v_org;
  if not found or not v_set.enabled then return false; end if;
  if v_plan.created_by = v_uid and not v_set.allow_self_approval then return false; end if;
  if v_set.approval_step = 'senior_role' then
    return coalesce(public.holds_spend_approval_authority(v_role), false);
  end if;
  -- spend_approvers: the project's list, else the org's senior set, else an Admin (DD-APR-4).
  select exists (select 1 from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
                  where sa.org_id = v_org and sa.project_id = v_plan.project_id and pf.status = 'active'
                    and public.holds_spend_approval_authority(pf.role)) into v_has;
  if v_has then
    return exists (select 1 from public.spend_approvers where org_id = v_org and project_id = v_plan.project_id and profile_id = v_uid);
  end if;
  select exists (select 1 from public.spend_approvers sa join public.profiles pf on pf.id = sa.profile_id
                  where sa.org_id = v_org and sa.project_id is null and pf.status = 'active'
                    and public.holds_spend_approval_authority(pf.role)) into v_has;
  if v_has then
    return exists (select 1 from public.spend_approvers where org_id = v_org and project_id is null and profile_id = v_uid);
  end if;
  return v_role = 'Admin';
end $$;
revoke all on function public.equipment_plan_approver_ok(uuid) from public, anon;
grant execute on function public.equipment_plan_approver_ok(uuid) to authenticated;

-- Guard: a plan's lines change only while the plan is Draft; dates sit in the plan's month; references belong to the
-- plan's organisation and project. The approval path may set procurement_id on a line of a Submitted plan, nothing else.
create function public.guard_equipment_plan_line() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_plan public.equipment_plans%rowtype; v_plan_id uuid;
begin
  if tg_op = 'DELETE' then v_plan_id := old.plan_id; else v_plan_id := new.plan_id; end if;
  select * into v_plan from public.equipment_plans where id = v_plan_id;
  if tg_op = 'UPDATE' and v_plan.status = 'Submitted' and old.procurement_id is null and new.procurement_id is not null
     and (to_jsonb(new) - 'procurement_id') = (to_jsonb(old) - 'procurement_id') then
    return new;
  end if;
  if v_plan.status is distinct from 'Draft' then
    raise exception 'EQP_LOCKED: the plan is not a Draft, so its lines cannot change' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.date_from < v_plan.plan_month or new.date_to >= (v_plan.plan_month + interval '1 month')::date then
    raise exception 'EQP_DATE_RANGE: a line''s dates must be inside the plan''s month' using errcode = '22023';
  end if;
  if new.work_order_id is not null and not exists (select 1 from public.work_orders w where w.id = new.work_order_id
        and w.org_id = v_plan.org_id and w.project_id = v_plan.project_id and w.status <> 'Cancelled') then
    raise exception 'EQP_REFERENCE: the work order is not available on this project' using errcode = '23503';
  end if;
  if not exists (select 1 from public.companies c where c.id = new.vendor_id and c.org_id = v_plan.org_id) then
    raise exception 'EQP_REFERENCE: the vendor is not available' using errcode = '23503';
  end if;
  if new.category_id is not null and not exists (select 1 from public.equipment_plan_categories k
        where k.id = new.category_id and k.org_id = v_plan.org_id and (k.active or (tg_op = 'UPDATE' and old.category_id = new.category_id))) then
    raise exception 'EQP_REFERENCE: the category is not available' using errcode = '23503';
  end if;
  if new.equipment_asset_id is not null and not exists (select 1 from public.equipment_assets a
        where a.id = new.equipment_asset_id and a.org_id = v_plan.org_id and a.archived_at is null) then
    raise exception 'EQP_REFERENCE: the equipment is not available' using errcode = '23503';
  end if;
  return new;
end $$;
revoke all on function public.guard_equipment_plan_line() from public, anon, authenticated;
create trigger equipment_plan_lines_guard before insert or update or delete on public.equipment_plan_lines
  for each row execute function public.guard_equipment_plan_line();

-- Guard: the plan's identity never changes; status moves only along Draft > Submitted > Approved | Rejected > Draft.
create function public.guard_equipment_plan() returns trigger
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'EQP_LOCKED: a plan cannot be deleted' using errcode = '55000';
  end if;
  if new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.plan_month is distinct from old.plan_month or new.created_by is distinct from old.created_by then
    raise exception 'EQP_LOCKED: the project, month and author of a plan do not change' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'Draft' and new.status = 'Submitted') or (old.status = 'Submitted' and new.status in ('Approved', 'Rejected'))
       or (old.status = 'Rejected' and new.status = 'Draft')) then
    raise exception 'EQP_STATE: a % plan cannot become %', old.status, new.status using errcode = '55000';
  end if;
  if old.status in ('Approved') then
    raise exception 'EQP_LOCKED: an approved plan has created its purchases and cannot change' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_equipment_plan() from public, anon, authenticated;
create trigger equipment_plans_guard before update or delete on public.equipment_plans
  for each row execute function public.guard_equipment_plan();

-- ── Admin RPCs: settings and categories ─────────────────────────────────────────────────────────────
create function public.set_equipment_plan_settings(p_enabled boolean, p_approval_step text, p_allow_self_approval boolean) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'EQP_ADMIN_ONLY: only an Admin can change the monthly plan settings' using errcode = '42501';
  end if;
  if p_enabled is null or p_allow_self_approval is null or p_approval_step is null or p_approval_step not in ('spend_approvers', 'senior_role') then
    raise exception 'EQP_INVALID: check the monthly plan settings' using errcode = '22023';
  end if;
  if p_enabled then
    if not public.purchase_types_enabled(v_org) then
      raise exception 'EQP_PREREQ: turn on purchase types first' using errcode = '55000';
    end if;
    if public.equipment_plan_rental_type(v_org) is null then
      raise exception 'EQP_PREREQ: purchase types need an active rental type first' using errcode = '55000';
    end if;
  end if;
  insert into public.org_equipment_plan_settings (org_id, enabled, approval_step, allow_self_approval, updated_by, updated_at)
  values (v_org, p_enabled, p_approval_step, p_allow_self_approval, auth.uid(), now())
  on conflict (org_id) do update set enabled = excluded.enabled, approval_step = excluded.approval_step,
    allow_self_approval = excluded.allow_self_approval, updated_by = excluded.updated_by, updated_at = now();
end $$;

create function public.upsert_equipment_plan_category(p_id uuid, p_name text, p_name_id text, p_position integer)
  returns public.equipment_plan_categories language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id(); v_row public.equipment_plan_categories%rowtype;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'EQP_ADMIN_ONLY: only an Admin can change plan categories' using errcode = '42501';
  end if;
  if not public.equipment_plan_enabled(v_org) then
    raise exception 'EQP_OFF: the monthly plan is not turned on' using errcode = '55000';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60
     or (p_name_id is not null and char_length(btrim(p_name_id)) not between 1 and 60) then
    raise exception 'EQP_INVALID: a category needs a name of 1 to 60 characters' using errcode = '22023';
  end if;
  if exists (select 1 from public.equipment_plan_categories where org_id = v_org and lower(btrim(name)) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'EQP_DUPLICATE: a category with that name exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into public.equipment_plan_categories (org_id, name, name_id, position)
    values (v_org, btrim(p_name), nullif(btrim(p_name_id), ''), coalesce(p_position, 0)) returning * into v_row;
  else
    update public.equipment_plan_categories set name = btrim(p_name), name_id = nullif(btrim(p_name_id), ''), position = coalesce(p_position, position)
     where id = p_id and org_id = v_org returning * into v_row;
    if not found then raise exception 'EQP_UNAVAILABLE: category not available' using errcode = '23503'; end if;
  end if;
  return v_row;
end $$;

create function public.set_equipment_plan_category_active(p_id uuid, p_active boolean) returns void
  language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'EQP_ADMIN_ONLY: only an Admin can change plan categories' using errcode = '42501';
  end if;
  if not public.equipment_plan_enabled(public.auth_org_id()) then
    raise exception 'EQP_OFF: the monthly plan is not turned on' using errcode = '55000';
  end if;
  update public.equipment_plan_categories set active = coalesce(p_active, active) where id = p_id and org_id = public.auth_org_id();
  if not found then raise exception 'EQP_UNAVAILABLE: category not available' using errcode = '23503'; end if;
end $$;

-- ── Plan RPCs: draft, submit, reopen, reject ────────────────────────────────────────────────────────
-- Common gate: signed in, active member, plan on, a role that can raise purchases (UX mirrors can()).
create function public.equipment_plan_gate() returns uuid
  language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.auth_org_id();
begin
  if auth.uid() is null or v_org is null or not coalesce(public.is_active_member(), false) then
    raise exception 'EQP_DENIED: the monthly plan is not permitted' using errcode = '42501';
  end if;
  if not public.equipment_plan_enabled(v_org) then
    raise exception 'EQP_OFF: the monthly plan is not turned on' using errcode = '55000';
  end if;
  if public.auth_role() not in ('Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer') then
    raise exception 'EQP_DENIED: your role cannot plan equipment' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function public.equipment_plan_gate() from public, anon, authenticated;

-- Create or update the Draft plan of one project and month, replacing its lines. p_lines is a jsonb array of
-- {id, work_order_id, category_id, equipment_asset_id, description, quantity, rate, vendor_id, date_from, date_to}.
-- A second save for the same project and month updates that plan (never a duplicate); only its author may.
create function public.save_equipment_plan(p_id uuid, p_project uuid, p_month date, p_lines jsonb)
  returns public.equipment_plans language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype; v_line jsonb;
begin
  if p_id is null or p_project is null or p_month is null or p_month <> date_trunc('month', p_month::timestamp)::date
     or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'EQP_INVALID: a plan needs a project, the first day of a month and up to 200 lines' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x where jsonb_typeof(x) <> 'object'
       or exists (select 1 from jsonb_object_keys(x) k where k not in ('id','work_order_id','category_id','equipment_asset_id','description','quantity','rate','vendor_id','date_from','date_to'))
       or jsonb_typeof(x->'id') is distinct from 'string' or jsonb_typeof(x->'quantity') is distinct from 'number'
       or jsonb_typeof(x->'rate') is distinct from 'number' or jsonb_typeof(x->'vendor_id') is distinct from 'string'
       or jsonb_typeof(x->'date_from') is distinct from 'string' or jsonb_typeof(x->'date_to') is distinct from 'string') then
    raise exception 'EQP_INVALID: check the plan lines' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects where id = p_project and org_id = v_org) then
    raise exception 'EQP_REFERENCE: the project is not available' using errcode = '23503';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('eqplan:' || v_org || p_project || p_month, 0));
  select * into v_plan from public.equipment_plans where org_id = v_org and project_id = p_project and plan_month = p_month for update;
  if not found then
    insert into public.equipment_plans (id, org_id, project_id, plan_month, created_by) values (p_id, v_org, p_project, p_month, auth.uid())
    returning * into v_plan;
  end if;
  if v_plan.created_by is distinct from auth.uid() then
    raise exception 'EQP_DENIED: only the author can change this plan' using errcode = '42501';
  end if;
  if v_plan.status <> 'Draft' then
    raise exception 'EQP_LOCKED: the plan is not a Draft, so it cannot change' using errcode = '55000';
  end if;
  delete from public.equipment_plan_lines where plan_id = v_plan.id;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.equipment_plan_lines (id, org_id, plan_id, work_order_id, category_id, equipment_asset_id, description, quantity, rate, vendor_id, date_from, date_to)
    values ((v_line->>'id')::uuid, v_org, v_plan.id, (v_line->>'work_order_id')::uuid, (v_line->>'category_id')::uuid,
            (v_line->>'equipment_asset_id')::uuid, nullif(btrim(v_line->>'description'), ''), (v_line->>'quantity')::numeric,
            (v_line->>'rate')::numeric, (v_line->>'vendor_id')::uuid, (v_line->>'date_from')::date, (v_line->>'date_to')::date);
  end loop;
  return v_plan;
end $$;

create function public.submit_equipment_plan(p_id uuid) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype;
begin
  select * into v_plan from public.equipment_plans where id = p_id and org_id = v_org for update;
  if not found then raise exception 'EQP_NOT_FOUND: the plan is not available' using errcode = '23503'; end if;
  if v_plan.created_by is distinct from auth.uid() then
    raise exception 'EQP_DENIED: only the author can submit this plan' using errcode = '42501';
  end if;
  if v_plan.status = 'Submitted' then return v_plan; end if;
  if v_plan.status <> 'Draft' then raise exception 'EQP_STATE: only a Draft plan can be submitted' using errcode = '55000'; end if;
  if not exists (select 1 from public.equipment_plan_lines where plan_id = p_id) then
    raise exception 'EQP_INVALID: add at least one line before submitting' using errcode = '22023';
  end if;
  update public.equipment_plans set status = 'Submitted', submitted_at = now() where id = p_id returning * into v_plan;
  return v_plan;
end $$;

create function public.reopen_equipment_plan(p_id uuid) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype;
begin
  select * into v_plan from public.equipment_plans where id = p_id and org_id = v_org for update;
  if not found then raise exception 'EQP_NOT_FOUND: the plan is not available' using errcode = '23503'; end if;
  if v_plan.created_by is distinct from auth.uid() then
    raise exception 'EQP_DENIED: only the author can reopen this plan' using errcode = '42501';
  end if;
  if v_plan.status <> 'Rejected' then raise exception 'EQP_STATE: only a rejected plan can be reopened' using errcode = '55000'; end if;
  update public.equipment_plans set status = 'Draft', reject_reason = null, rejected_by = null, rejected_at = null where id = p_id returning * into v_plan;
  return v_plan;
end $$;

create function public.reject_equipment_plan(p_id uuid, p_reason text) returns public.equipment_plans
  language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_org uuid := public.equipment_plan_gate(); v_plan public.equipment_plans%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'EQP_INVALID: give a reason of 1 to 500 characters' using errcode = '22023';
  end if;
  select * into v_plan from public.equipment_plans where id = p_id and org_id = v_org for update;
  if not found then raise exception 'EQP_NOT_FOUND: the plan is not available' using errcode = '23503'; end if;
  if not public.equipment_plan_approver_ok(p_id) then
    raise exception 'EQP_NOT_APPROVER: you cannot approve or reject this plan' using errcode = '42501';
  end if;
  if v_plan.status <> 'Submitted' then raise exception 'EQP_STATE: only a submitted plan can be rejected' using errcode = '55000'; end if;
  update public.equipment_plans set status = 'Rejected', rejected_by = auth.uid(), rejected_at = now(), reject_reason = btrim(p_reason)
   where id = p_id returning * into v_plan;
  return v_plan;
end $$;

revoke all on function public.set_equipment_plan_settings(boolean,text,boolean), public.upsert_equipment_plan_category(uuid,text,text,integer),
  public.set_equipment_plan_category_active(uuid,boolean), public.save_equipment_plan(uuid,uuid,date,jsonb),
  public.submit_equipment_plan(uuid), public.reopen_equipment_plan(uuid), public.reject_equipment_plan(uuid,text) from public, anon;
grant execute on function public.set_equipment_plan_settings(boolean,text,boolean), public.upsert_equipment_plan_category(uuid,text,text,integer),
  public.set_equipment_plan_category_active(uuid,boolean), public.save_equipment_plan(uuid,uuid,date,jsonb),
  public.submit_equipment_plan(uuid), public.reopen_equipment_plan(uuid), public.reject_equipment_plan(uuid,text) to authenticated;
