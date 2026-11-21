-- 1200 (#2709): the built-in role catalogue — 28 stable role keys in three tiers, each mapped to ONE of today's five
-- base access levels (public.user_role), plus the role capabilities that differ from the base level.
-- Rollback: supabase/migrations/rollback/1200_builtin_role_catalogue_down.sql
--
-- profiles.role (the five-value enum) is NOT touched and keeps driving every existing policy and RPC. This migration adds
-- reference data and pure read helpers only; nothing here changes what any existing person can do.
-- built_in_role_base(key) is the ONE key -> base-level mapping (frontend mirror: pmo-portal/src/auth/builtInRoles.ts;
-- the parity test compares the two seeds below with that file).

create table public.built_in_roles (
  key          text primary key check (key ~ '^[a-z][a-z_]*$'),
  base_level   public.user_role not null,
  tier         text not null check (tier in ('manager', 'officer', 'field')),
  function_key text not null check (btrim(function_key) <> ''),
  sort_order   integer not null unique,
  name_en      text not null check (btrim(name_en) <> ''),
  name_id      text not null check (btrim(name_id) <> '')
);

comment on table public.built_in_roles is
  '#2709 global catalogue of the 28 built-in roles. key is stable and never reused; names are the default English and '
  'Bahasa Indonesia labels (a client renames them in #2712). base_level is the single access level the role starts from.';

create table public.built_in_role_capabilities (
  role_key   text not null references public.built_in_roles(key),
  capability text not null check (capability in (
    'sees_prices', 'stock_post', 'stock_approve', 'daily_report_enter', 'daily_report_validate',
    'crew_time_approve', 'billing_stage_run', 'invoice_raise', 'people_documents_view', 'medical_documents_view')),
  primary key (role_key, capability)
);

comment on table public.built_in_role_capabilities is
  '#2709 the differences from the base level, as data other features read through role_has_capability / '
  'actor_has_role_capability. A role holds a capability only if a row says so.';

alter table public.built_in_roles enable row level security;
alter table public.built_in_roles force row level security;
alter table public.built_in_role_capabilities enable row level security;
alter table public.built_in_role_capabilities force row level security;

create policy built_in_roles_select on public.built_in_roles for select to authenticated using (true);
create policy built_in_role_capabilities_select on public.built_in_role_capabilities for select to authenticated using (true);

revoke all on public.built_in_roles, public.built_in_role_capabilities from public, anon, authenticated;
grant select on public.built_in_roles, public.built_in_role_capabilities to authenticated;

-- key, base level, tier, function, sort order, English name, Bahasa Indonesia name (ONE tuple per line: the parity test parses this).
insert into public.built_in_roles (key, base_level, tier, function_key, sort_order, name_en, name_id) values
('executive','Executive','manager','leadership',10,'Executive','Eksekutif'),
('administrator','Admin','manager','administration',20,'Administrator','Administrator'),
('project_manager','Project Manager','manager','project',30,'Project Manager','Manajer Proyek'),
('deputy_project_manager','Project Manager','manager','project',40,'Deputy Project Manager','Wakil Manajer Proyek'),
('project_administrator','Engineer','officer','project',50,'Project Administrator','Administrator Proyek'),
('project_control_manager','Project Manager','manager','project_control',60,'Project Control Manager','Manajer Pengendalian Proyek'),
('engineer','Engineer','officer','project_control',70,'Engineer','Insinyur'),
('planner','Engineer','officer','project_control',80,'Planner','Perencana'),
('quantity_surveyor','Engineer','officer','project_control',90,'Quantity Surveyor','Juru Ukur Kuantitas'),
('billing_officer','Finance','officer','project_control',100,'Billing Officer','Petugas Penagihan'),
('construction_manager','Project Manager','manager','construction',110,'Construction Manager','Manajer Konstruksi'),
('site_supervisor','Engineer','officer','construction',120,'Site Supervisor','Pengawas Lapangan'),
('foreman','Engineer','field','construction',130,'Foreman','Mandor'),
('material_coordinator','Engineer','officer','materials',140,'Material Coordinator','Koordinator Material'),
('storekeeper','Engineer','officer','materials',150,'Storekeeper','Penjaga Gudang'),
('procurement_manager','Project Manager','manager','procurement',160,'Procurement Manager','Manajer Pengadaan'),
('buyer','Engineer','officer','procurement',170,'Buyer','Pembeli'),
('finance_manager','Finance','manager','finance',180,'Finance Manager','Manajer Keuangan'),
('finance_officer','Finance','officer','finance',190,'Finance Officer','Petugas Keuangan'),
('quality_manager','Project Manager','manager','quality',200,'Quality Manager','Manajer Mutu'),
('quality_inspector','Engineer','officer','quality',210,'Quality Inspector','Inspektur Mutu'),
('safety_manager','Project Manager','manager','safety',220,'Safety Manager','Manajer K3'),
('safety_officer','Engineer','officer','safety',230,'Safety Officer','Petugas K3'),
('equipment_manager','Project Manager','manager','equipment',240,'Equipment Manager','Manajer Peralatan'),
('equipment_officer','Engineer','officer','equipment',250,'Equipment Officer','Petugas Peralatan'),
('hr_manager','Project Manager','manager','hr',260,'HR Manager','Manajer SDM'),
('hr_officer','Engineer','officer','hr',270,'HR Officer','Petugas SDM'),
('field_user','Engineer','field','field',280,'Field user','Pengguna Lapangan');

-- role key, capability (ONE tuple per line: the parity test parses this).
insert into public.built_in_role_capabilities (role_key, capability) values
('executive','sees_prices'),
('administrator','sees_prices'),
('project_manager','sees_prices'),
('deputy_project_manager','sees_prices'),
('project_control_manager','sees_prices'),
('construction_manager','sees_prices'),
('procurement_manager','sees_prices'),
('finance_manager','sees_prices'),
('quality_manager','sees_prices'),
('safety_manager','sees_prices'),
('equipment_manager','sees_prices'),
('hr_manager','sees_prices'),
('buyer','sees_prices'),
('finance_officer','sees_prices'),
('billing_officer','sees_prices'),
('storekeeper','stock_post'),
('material_coordinator','stock_approve'),
('quantity_surveyor','daily_report_enter'),
('site_supervisor','daily_report_validate'),
('project_control_manager','daily_report_validate'),
('construction_manager','crew_time_approve'),
('billing_officer','billing_stage_run'),
('finance_manager','invoice_raise'),
('finance_officer','invoice_raise'),
('administrator','people_documents_view'),
('hr_manager','people_documents_view'),
('hr_officer','people_documents_view'),
('administrator','medical_documents_view'),
('hr_manager','medical_documents_view'),
('hr_officer','medical_documents_view');

-- ── The ONE mapping helper and the read helpers. NULL / unknown key -> NULL or false, never a level. ──
create function public.built_in_role_base(p_key text) returns public.user_role
  language sql stable set search_path = pg_catalog, public as $$
  select r.base_level from public.built_in_roles r where r.key = p_key
$$;

create function public.built_in_role_tier(p_key text) returns text
  language sql stable set search_path = pg_catalog, public as $$
  select r.tier from public.built_in_roles r where r.key = p_key
$$;

-- Managers approve; officers prepare. Field roles do neither.
create function public.built_in_role_may_approve(p_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(public.built_in_role_tier(p_key) = 'manager', false)
$$;

create function public.built_in_role_may_prepare(p_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(public.built_in_role_tier(p_key) = 'officer', false)
$$;

-- A manager stands in for a manager, never upward: the actor's base level must rank at or above the absent manager's.
create function public.built_in_role_may_stand_in(p_actor_key text, p_absent_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select coalesce(
    public.built_in_role_tier(p_actor_key) = 'manager'
    and public.built_in_role_tier(p_absent_key) = 'manager'
    and public.role_rank(public.built_in_role_base(p_actor_key)) >= public.role_rank(public.built_in_role_base(p_absent_key)),
    false)
$$;

create function public.role_has_capability(p_key text, p_capability text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select exists (select 1 from public.built_in_role_capabilities c where c.role_key = p_key and c.capability = p_capability)
$$;

-- Price visibility: a person holding NO built-in role (every existing person) sees prices exactly as today. The hiding
-- itself is a separate setting (#2699); this only answers the question for it.
create function public.built_in_role_sees_prices(p_key text) returns boolean
  language sql stable set search_path = pg_catalog, public as $$
  select case when p_key is null then true else public.role_has_capability(p_key, 'sees_prices') end
$$;

revoke all on function public.built_in_role_base(text), public.built_in_role_tier(text),
  public.built_in_role_may_approve(text), public.built_in_role_may_prepare(text),
  public.built_in_role_may_stand_in(text, text), public.role_has_capability(text, text),
  public.built_in_role_sees_prices(text) from public, anon;
grant execute on function public.built_in_role_base(text), public.built_in_role_tier(text),
  public.built_in_role_may_approve(text), public.built_in_role_may_prepare(text),
  public.built_in_role_may_stand_in(text, text), public.role_has_capability(text, text),
  public.built_in_role_sees_prices(text) to authenticated, service_role;
