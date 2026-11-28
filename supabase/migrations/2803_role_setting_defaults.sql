-- 2803_role_setting_defaults.sql — working defaults for the role settings (RR-3, owner ruling 28 Nov 2026).
-- Spec docs/specs/role-setting-defaults.spec.md (FR-RSD-001..008). Proven by
-- supabase/tests/2803_role_setting_defaults.test.sql. Rollback: rollback/2803_role_setting_defaults_down.sql
--
-- Owner ruling: an organisation's role settings work out of the box. While an Admin has set nothing the app uses a
-- working default keyed on built-in job-role keys; an explicit Admin value still wins. Defaults ship for every
-- organisation — existing (a backfill through the same seeder) and new (seed_org_defaults, 0213's seam).
--
-- Where the value lives:
--   FR-RSD-001 standard checks        rows of work_order_checklist_items (2680; Admin: set_work_order_check_template)
--   FR-RSD-002 request chain          rows of approval_chain_steps (1001/1841; Admin: mrq_set_chain)
--   FR-RSD-003 report validators      a default branch beside organizations.daily_report_validate_roles (2290)
--   FR-RSD-004 billing QC step        a default billing_step_templates row + org_billing_step_settings (1365/1770/1773)
--   FR-RSD-005 close-out owners       rows of closeout_checklist_templates.owner_job_role (1400/2040/2383)
--   FR-RSD-006 keeper fallback        a branch in stock_assert_keeper (0413/1322) — per warehouse, no override audit
--   FR-RSD-007 crew fallback          a branch in report_crew_tool's guard (1159/2041) — only crews naming no controller
--   FR-RSD-008 PCM scheduled reports  already shipped default-on (2580); re-verified, nothing to change.
--
-- Job-role semantics: holds_job_role (1840) fills a role by held key, or by the role's base access level for a person
-- holding no key — so the defaults are live in organisations that never turned built-in roles on, and exact once keys
-- are assigned. Surfaces that deliberately read the held key only (close-out owners via actor_holds_job_role, 2040;
-- standard-check assignment, 2680) keep their own shipped semantics; their defaults activate when keys are assigned.
--
-- Restated bodies, each from its latest definition at head: seed_org_defaults (2740, extended),
-- actor_has_role_capability (2290), dsr_validation_queue (2441), get_dsr_validation_route (2290),
-- stock_assert_keeper (1322), report_crew_tool (2041) — each guard line it carried stays.
-- drops: nothing; every rule each restated body carried stays.

-- ── §1 the seeder: one function, the new-org path AND the backfill ───────────────────────────────────────────
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_template uuid;
begin
  -- OD-SP-2 default win-probabilities (2740's list, verbatim). Idempotent: an org that tuned a stage keeps it.
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900),
    (p_org_id, 'Won, Pending KoM',    null),
    (p_org_id, 'Ongoing Project',     null),
    (p_org_id, 'On Hold',             null),
    (p_org_id, 'Close Out',           null),
    (p_org_id, 'Loss Tender',         null),
    (p_org_id, 'Declined',            null),
    (p_org_id, 'Internal Project',    null)
  on conflict (org_id, status) do nothing;

  -- FR-RSD-001: the four standard checks (engineer, storekeeper, control manager, HR officer — one day each).
  -- Only an org that keeps no list at all gets them: an emptied list (set_work_order_check_template archives every
  -- line) stays empty, and an Admin's list is never touched.
  insert into public.work_order_checklist_items (org_id, label, position, required, owner_job_role, target_days)
  select p_org_id, v.label, v.position, false, v.owner_job_role, v.target_days
    from (values (1, 'Engineering check on the work order (scope, drawings and unit rates)', 'engineer',                1),
                 (2, 'Material availability check',                                           'storekeeper',             1),
                 (3, 'Resources check (crews and equipment)',                                 'project_control_manager', 1),
                 (4, 'Social and land-status check',                                          'hr_officer',              1)
         ) as v(position, label, owner_job_role, target_days)
   where not exists (select 1 from public.work_order_checklist_items w where w.org_id = p_org_id);  -- mut:rsd_seed_checks_guard

  -- FR-RSD-002: the default approval chain — coordinator, control manager, then the construction manager for
  -- requests above plan. Steps keep the shipped decision rules: order, never-the-author, one person one step (1841).
  insert into public.approval_chain_steps (org_id, position, role, job_role, label, only_over_plan)
  select p_org_id, v.position, v.role::public.user_role, v.job_role, v.label, v.only_over_plan
    from (values (1, 'Engineer',        'material_coordinator',    'Material coordinator check', false),
                 (2, 'Project Manager', 'project_control_manager', 'Plan and quantity check',    false),
                 (3, 'Project Manager', 'construction_manager',    'Extra material approval',    true)
         ) as v(position, role, job_role, label, only_over_plan)   -- mut:rsd_chain_over_plan (step 3's only_over_plan)
   where not exists (select 1 from public.approval_chain_steps a where a.org_id = p_org_id);  -- mut:rsd_chain_admin_wins

  -- FR-RSD-005: the default close-out checklist — the certificates to the control manager, the material completion
  -- report to the storekeeper. The owner key is read by the held key only (actor_holds_job_role, 2040), as shipped.
  insert into public.closeout_checklist_templates (org_id, position, name, required, target_days, owner_job_role)
  select p_org_id, v.position, v.name, true, null::smallint, v.owner_job_role
    from (values (1, 'Quality acceptance letter',           'project_control_manager'),
                 (2, 'Mechanical acceptance certificate',   'project_control_manager'),
                 (3, 'Material completion report',          'storekeeper'),
                 (4, 'Certificate of completion',           'project_control_manager'),
                 (5, 'Close-out document',                  'project_control_manager')
         ) as v(position, name, owner_job_role)   -- mut:rsd_closeout_seed_owner
   where not exists (select 1 from public.closeout_checklist_templates t where t.org_id = p_org_id);

  -- FR-RSD-004: the default billing checklist — a QC report step owned by quality_inspector. Only an org with no
  -- template of its own and no default picked gets it; instantiate_work_order_billing_steps (1773) copies it at issue.
  if not exists (select 1 from public.billing_step_templates t where t.org_id = p_org_id)
     and not exists (select 1 from public.org_billing_step_settings s where s.org_id = p_org_id) then
    insert into public.billing_step_templates (org_id, name) values (p_org_id, 'Standard billing checklist')
      returning id into v_template;
    insert into public.billing_step_template_steps (org_id, template_id, position, name, owner_role, owner_role_key, target_days)
    values (p_org_id, v_template, 1, 'QC report', 'Engineer', 'quality_inspector', 1);
    insert into public.org_billing_step_settings (org_id, default_template_id) values (p_org_id, v_template);
  end if;
end $$;
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;

-- The backfill: every organisation that exists today gets the defaults; the guards skip orgs that keep their own.
select public.seed_org_defaults(o.id) from public.organizations o;

-- ── §2 daily-report validators: the working default beside the Admin's list (FR-RSD-003) ─────────────────────
-- The effective validator role keys: what the Admin set, else the default — the control manager and the quantity
-- surveyor. While nothing is set the default is judged by holds_job_role (held key, or no key and the base level);
-- an Admin-set list keeps 2290's key-only rule (its column guard guarantees it implies built-in roles on).
create function public.dsr_validate_role_keys(p_org uuid) returns text[]
  language sql stable security definer set search_path = pg_catalog, public as $$
  select case when cardinality(o.daily_report_validate_roles) > 0 then o.daily_report_validate_roles
              else array['project_control_manager', 'quantity_surveyor']::text[] end   -- mut:rsd_dsr_default_keys
    from public.organizations o
   where o.id = p_org
$$;
revoke all on function public.dsr_validate_role_keys(uuid) from public, anon;
grant execute on function public.dsr_validate_role_keys(uuid) to authenticated, service_role;

create function public.dsr_fills_validate_role(p_org uuid, p_profile uuid) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1
      from public.organizations o
     where o.id = p_org
       and case
             when cardinality(o.daily_report_validate_roles) > 0 then
               exists (select 1 from public.profiles pr
                        where pr.id = p_profile
                          and pr.built_in_role = any (o.daily_report_validate_roles))
             else public.holds_job_role(p_profile, 'quantity_surveyor')
                  or public.holds_job_role(p_profile, 'project_control_manager')    -- mut:rsd_dsr_default_includes
           end)
$$;
revoke all on function public.dsr_fills_validate_role(uuid, uuid) from public, anon;
grant execute on function public.dsr_fills_validate_role(uuid, uuid) to authenticated, service_role;

create or replace function public.actor_has_role_capability(p_capability text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select (
    p_capability = 'daily_report_validate'
    and exists (
      select 1
        from public.organizations o
       where o.id = public.auth_org_id()
         and public.dsr_fills_validate_role(o.id, auth.uid())  -- mut:dsr_validate_org_role
    )
  ) or coalesce(public.role_has_capability(public.actor_built_in_role(), p_capability), false)
$$;

create or replace function public.dsr_validation_queue()
returns table (report_id uuid, project_id uuid, work_order_id uuid, work_order_label text, work_date date, author_id uuid,
               author_name text, submitted_at timestamptz, total_revenue numeric, unrated_lines integer, age_days integer,
               waiting_for_validator boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_not_light();
  perform public.dsr_require_member();
  return query
  select d.id, d.project_id, d.work_order_id, coalesce(w.wo_number || ' · ', '') || w.title, d.work_date, d.author_id,
         a.full_name, d.submitted_at,
         case
           when public.dsr_may_see_revenue(d.project_id) then -- mut:dsr_queue_revenue_mask
             coalesce((select sum(public.dsr_line_amount(l.quantity, v.rate)) from public.dsr_progress_lines l
                       left join lateral public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id) v on true
                       where l.report_id = d.id), 0)
           else null::numeric
         end,
         (select count(*)::integer from public.dsr_progress_lines l
           where l.report_id = d.id and not exists (select 1 from public.dsr_line_rate(l.work_order_line_id, l.sub_stage, d.variant_id, d.work_date, d.area_id))),
         greatest(0, (public.equipment_org_today(d.org_id) - d.work_date) - 1),
         not exists (select 1 from public.profiles pr join public.projects p on p.id = d.project_id
                      where pr.org_id = d.org_id and pr.status = 'active' and pr.id <> d.author_id
                        and not public.is_light_role_key(pr.built_in_role)
                        and (pr.role in ('Admin','Finance')
                             or (pr.role = 'Project Manager' and p.project_manager_id = pr.id)
                             or public.dsr_fills_validate_role(d.org_id, pr.id)))  -- mut:dsr_validate_org_role
    from public.daily_site_reports d
    join public.work_orders w on w.id = d.work_order_id
    left join public.profiles a on a.id = d.author_id
   where d.org_id = public.auth_org_id() and d.status = 'submitted' and d.archived_at is null
     and public.dsr_may_validate(d.project_id)
   order by d.submitted_at, d.id
   limit 500;
end $$;

create or replace function public.get_dsr_validation_route(p_report_id uuid)
  returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = pg_catalog, public
as $$
declare
  v_uid            uuid := auth.uid();
  v_org            uuid;
  v_author         uuid;
  v_status         text;
  v_project        uuid;
  v_pm             uuid;
  v_pm_found       boolean := false;
  v_pm_name        text;
  v_pm_role        public.user_role;
  v_pm_active      boolean := false;
  v_pm_light       boolean := true;
  v_finance_admin  boolean;
  v_validate_roles text[];
begin
  if v_uid is null or not coalesce(public.is_active_member(), false) then
    raise exception 'your account is not an active member of this organisation, so it cannot read a validation route'
      using errcode = '42501';
  end if;

  select r.org_id, r.author_id, r.status, r.project_id
    into v_org, v_author, v_status, v_project
    from public.daily_site_reports r
   where r.id = p_report_id;

  if v_org is null or v_status is distinct from 'submitted' then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  select p.project_manager_id into v_pm
    from public.projects p
   where p.id = v_project and p.org_id = v_org;
  if not found then
    return jsonb_build_object('approvers', '[]'::jsonb, 'route_kind', 'unavailable');
  end if;

  if v_pm is not null then
    select pr.full_name, pr.role, (pr.status = 'active'), public.is_light_role_key(pr.built_in_role)
      into v_pm_name, v_pm_role, v_pm_active, v_pm_light
      from public.profiles pr
     where pr.id = v_pm and pr.org_id = v_org;
    v_pm_found := found;
  end if;

  -- 2803: the effective validator keys (the Admin's list, else the default), naming only keys an eligible active
  -- member fills — the Admin's list by the held key, the default by holds_job_role.
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
    into v_validate_roles
    from public.organizations o
    cross join lateral unnest(public.dsr_validate_role_keys(o.id)) k
   where o.id = v_org
     and exists (
       select 1
         from public.profiles pr
        where pr.org_id = v_org
          and pr.status = 'active'
          and pr.id <> v_author
          and not public.is_light_role_key(pr.built_in_role)
          and ((cardinality(o.daily_report_validate_roles) > 0 and pr.built_in_role = k)
               or (cardinality(o.daily_report_validate_roles) = 0 and public.holds_job_role(pr.id, k))));  -- mut:dsr_route_validate_roles

  if v_pm_found
     and v_pm_role = 'Project Manager'
     and v_pm_active
     and not v_pm_light
     and v_pm is distinct from v_author
     and btrim(coalesce(v_pm_name, '')) <> '' then
    return jsonb_build_object(
      'approvers', jsonb_build_array(
        jsonb_build_object('id', v_pm, 'name', v_pm_name, 'role', v_pm_role::text)),
      'route_kind', 'project_manager')
      || case when cardinality(v_validate_roles) > 0
              then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
              else '{}'::jsonb end;
  end if;

  select exists (
    select 1
      from public.profiles pr
     where pr.org_id = v_org
       and pr.status = 'active'
       and pr.role in ('Admin', 'Finance')
       and not public.is_light_role_key(pr.built_in_role)
       and pr.id <> v_author)
    into v_finance_admin;

  return jsonb_build_object(
    'approvers', '[]'::jsonb,
    'route_kind', case
      when v_finance_admin then 'finance_admin'
      when cardinality(v_validate_roles) > 0 then 'job_roles'
      else 'nobody'
    end)
    || case when cardinality(v_validate_roles) > 0
            then jsonb_build_object('validate_roles', to_jsonb(v_validate_roles))
            else '{}'::jsonb end;
end $$;

revoke all on function public.get_dsr_validation_route(uuid) from public, anon;
grant execute on function public.get_dsr_validation_route(uuid) to authenticated;

-- ── §3 the keeper fallback: a warehouse that names no keeper is kept by its storekeepers (FR-RSD-006) ─────────
create or replace function public.stock_assert_keeper(p_org uuid, p_warehouse uuid, p_uid uuid) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_keeper boolean; v_admin boolean;
begin
  if coalesce(current_setting('pmo.dsr_stock_post', true), '') = 'on' then return false; end if;   -- 2676 the validator's authority (dsr_may_validate) is the control; set only inside dsr_post_stock / dsr_reverse_stock
  v_keeper := exists (select 1 from public.stock_warehouse_keepers k
                       where k.org_id = p_org and k.warehouse_id = p_warehouse and k.user_id = p_uid);   -- mut:keeper
  if v_keeper then return false; end if;
  -- 2803 RR-3: no keeper named for THIS warehouse — any active member filling storekeeper keeps it for this action
  -- (held key, or no key and the Engineer level, 1840). It is the keeper right, not the Admin override: returning
  -- false records no override audit, and a warehouse that names any keeper keeps today's named-only rule.
  if not exists (select 1 from public.stock_warehouse_keepers k
                  where k.org_id = p_org and k.warehouse_id = p_warehouse)                             -- mut:rsd_keeper_scoped
     and exists (select 1 from public.stock_warehouses w where w.id = p_warehouse and w.org_id = p_org)
     and public.holds_job_role(p_uid, 'storekeeper') then                                              -- mut:rsd_keeper_default
    return false;
  end if;
  v_admin := coalesce(public.role_rank(public.auth_role()) >= 50, false);                               -- mut:keeper_admin
  if v_admin then return true; end if;
  raise exception 'STK_NOT_KEEPER: you do not keep this warehouse' using errcode = 'P0001';
end $$;

-- ── §4 the crew field-controller fallback: a crew naming no controller is looked after by a site supervisor ────
-- (FR-RSD-007; the chart's tool-damage report. The report RPC is restated from 2041 and the two photo gates from
-- their latest bodies — a damaged report cannot be made without them. Every later rule in each body is unchanged.)

create or replace function public.crew_tool_is_reporter() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and (public.crew_can_manage() or exists (
    select 1 from public.crews c where c.org_id = public.auth_org_id() and c.field_controller_id = auth.uid())
    or (exists (select 1 from public.crews c
                 where c.org_id = public.auth_org_id() and c.field_controller_id is null)    -- mut:rsd_tool_default
          and public.holds_job_role(auth.uid(), 'site_supervisor'))), false)
$$;
revoke all on function public.crew_tool_is_reporter() from public, anon;
grant execute on function public.crew_tool_is_reporter() to authenticated;

CREATE OR REPLACE FUNCTION public.crew_tool_can_report(p_line uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.crew_tool_lines l join public.crews c on c.id = l.crew_id
     where l.id = p_line and l.org_id = public.auth_org_id()
       and (public.crew_tool_may_manage(c.id) or c.field_controller_id = auth.uid()
            or (c.field_controller_id is null and public.holds_job_role(auth.uid(), 'site_supervisor')))), false)  -- mut:rsd_tool_default, mut:rsd_tool_named
$function$
;
CREATE OR REPLACE FUNCTION public.report_crew_tool(p_id uuid, p_line uuid, p_kind text, p_qty integer, p_note text, p_photos jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org uuid := public.auth_org_id(); v_uid uuid := auth.uid();
  v_line public.crew_tool_lines; v_crew public.crews;
  v_open integer; v_usable integer; v_today date; v_due date; v_days integer; v_coord uuid;
  v_project uuid; v_task uuid; v_msg record; v_photo jsonb; v_path text; v_n integer := 0; v_rcpt uuid; v_loc text;
begin
  perform public.assert_not_light();
  if v_org is null or v_uid is null or not public.is_active_member() then
    raise exception 'active organization required' using errcode = '42501';
  end if;
  if p_id is null or p_line is null or p_kind not in ('damaged', 'lost') or p_qty is null or p_qty < 1
     or (p_note is not null and char_length(p_note) > 500) or (p_photos is not null and jsonb_typeof(p_photos) <> 'array') then
    raise exception 'invalid tool report' using errcode = '22023';
  end if;

  -- FR-CTR-009: a retry returns the report it already made.
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id and r.org_id = v_org) then return p_id; end if;
  if exists (select 1 from public.crew_tool_reports r where r.id = p_id) then
    raise exception 'report id already used' using errcode = '23505';
  end if;

  -- FR-CTR-007: the line row lock serialises concurrent reports on it.
  select * into v_line from public.crew_tool_lines l where l.id = p_line and l.org_id = v_org for update;
  if v_line.id is null then raise exception 'tool line not found' using errcode = 'P0002'; end if;
  select * into v_crew from public.crews c where c.id = v_line.crew_id;
  -- 2803 RR-3: a crew that names no field controller is looked after by a site supervisor — any member filling
  -- site_supervisor (held key, or no key and the Engineer level, 1840) reports for it.
  if not (public.crew_tool_may_manage(v_crew.id) or v_crew.field_controller_id = v_uid
          or (v_crew.field_controller_id is null and public.holds_job_role(v_uid, 'site_supervisor'))) then  -- mut:rsd_tool_default, mut:rsd_tool_named
    raise exception 'CTR_NOT_ALLOWED: only the crew''s field controller or site supervisor, a crew manager or the keeper of its site store reports a tool' using errcode = '42501';
  end if;
  if v_line.archived_at is not null then
    raise exception 'CTR_LINE_ARCHIVED: this tool line is archived' using errcode = '23514';
  end if;

  -- FR-CTR-006 / OD-CTR-3: a damaged report carries at least one photo; every path is the caller's own report's.
  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    v_path := v_photo->>'path';
    if v_path is null or array_length(string_to_array(v_path, '/'), 1) <> 4
       or split_part(v_path, '/', 1) <> v_org::text or split_part(v_path, '/', 2) <> p_id::text
       or not public.crew_tool_photo_stored(v_path) then
      raise exception 'CTR_PHOTO: a photo path is not an uploaded file of this report' using errcode = '23514';
    end if;
    v_n := v_n + 1;
  end loop;
  if p_kind = 'damaged' and v_n = 0 then
    raise exception 'CTR_PHOTO_REQUIRED: add a photo of the damaged tool' using errcode = '23514';
  end if;

  select coalesce(sum(r.qty), 0) into v_open from public.crew_tool_reports r where r.line_id = v_line.id and r.status = 'open';
  v_usable := greatest(v_line.held_qty - v_open, 0);
  if p_qty > v_usable then
    raise exception 'CTR_QTY_EXCEEDS_USABLE: only % usable', v_usable using errcode = '23514', detail = v_usable::text;
  end if;

  select s.coordinator_id, s.task_due_days into v_coord, v_days from public.org_crew_tool_settings s where s.org_id = v_org;
  v_days := coalesce(v_days, 3);
  -- an ex-coordinator who left or was disabled means no coordinator
  if v_coord is not null and not (public.is_active_member(v_coord)
       and exists (select 1 from public.profiles p where p.id = v_coord and p.org_id = v_org)) then v_coord := null; end if;
  v_today := public.native_org_today(v_org);
  v_due := v_today + v_days;

  -- OQ-CTR-2: the rostered project, when exactly one work order roster covers the day (the exclusion constraint of 1035 allows one).
  select wo.project_id into v_project
    from public.work_order_crews r join public.work_orders wo on wo.id = r.work_order_id
   where r.crew_id = v_crew.id and wo.org_id = v_org
     and v_today between r.valid_from and coalesce(r.valid_to, 'infinity'::date)
   limit 1;
  if v_project is not null and public.task_domain_externally_owned(v_project) then v_project := null; end if;

  perform set_config('pmo.crew_tool_rpc', 'on', true);
  insert into public.crew_tool_reports (id, org_id, line_id, kind, qty, note, reported_by, reported_on, due_on)
  values (p_id, v_org, v_line.id, p_kind, p_qty, nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_today, v_due);

  select m.task_name into v_msg from public.crew_tool_message(
    public.crew_tool_org_locale(v_org), p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
  insert into public.tasks (org_id, project_id, name, description, assignee_id, end_date, crew_tool_report_id)
  values (v_org, v_project, left(v_msg.task_name, 200),
          nullif(btrim(coalesce(p_note, '')), ''), v_coord, v_due, p_id)
  returning id into v_task;
  update public.crew_tool_reports set task_id = v_task where id = p_id;

  for v_photo in select * from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    insert into public.crew_tool_report_files (org_id, report_id, title, file_path, uploaded_by_id)
    values (v_org, p_id, left(nullif(btrim(coalesce(v_photo->>'title', '')), ''), 200), v_photo->>'path', v_uid);
  end loop;

  -- FR-CTR-012/013: the coordinator is told; with none set, everyone who can write the equipment register is.
  for v_rcpt in
    select x from (
      select v_coord as x where v_coord is not null
      union all
      select p.id from public.profiles p
       where v_coord is null and p.org_id = v_org and p.status = 'active' and p.role in ('Admin', 'Project Manager')) s
  loop
    v_loc := public.crew_tool_locale(v_rcpt);
    select m.title, m.body into v_msg from public.crew_tool_message(v_loc, p_kind, v_line.name, p_qty, v_crew.name, v_due) m;
    perform public.notify_workflow_user(v_org, v_rcpt, v_msg.title, v_msg.body, 'info', 'task', v_task, v_line.name);
  end loop;

  perform public.log_audit('crew_tool.report', v_org, v_uid, p_id,
    jsonb_build_object('line_id', v_line.id, 'kind', p_kind, 'qty', p_qty, 'task_id', v_task));
  perform set_config('pmo.crew_tool_rpc', 'off', true);
  return p_id;
end $function$
;
