-- 2040_material_coordinator_rights.sql — the Material Coordinator job role's stock rights, by job-role key (access level unchanged).
-- A person who HOLDS the material_coordinator key (actor_holds_job_role, below) may also: post a stock count difference or a
-- loss (an adjustment) that someone else drafted; record a client reservation or its release; see, per stock location, whether it
-- holds stock with no guard cover recorded (yes or no, no value or cost). A close-out item may name an owner job role; a holder of
-- that key attaches its document and marks it done. Everyone who could act before still can; a person with no job role is judged by
-- access level exactly as before; nobody else gains anything. The author of a write-off still never posts it (FR-STK-062).
-- Restated from the latest migration defining each: stock_assert_writeoff_approver (0416), csr_assert_recorder (1163),
-- get_stock_at_risk (1441, with the field-account guard 1530 added to the live body), lock_closeout_item (1401), set_closeout_checklist and instantiate_work_order_closeout_items (1830).
-- drops: the two refusal lines that named only a Project Manager (they now name the Material Coordinator too); lock_closeout_item's
-- item read, not-found test and two role tests (rewritten so the item's owner job role is read first and its holder passes them);
-- the close-out insert column lists (they now carry the owner job role). Nothing else is removed.
-- Proven by supabase/tests/2040_material_coordinator_rights.test.sql. Rollback: rollback/2040_material_coordinator_rights_down.sql

-- ── §0 the one "the signed-in person holds this job role key" test the job-role rights of this round read ─────────────────────────
-- The 1845 held-only shape: holds_job_role decides (active member, catalogue key) AND the person holds that very key, so a person with
-- no job role yet is never let in by access level here: every right below widens to the named job role only.
create function public.actor_holds_job_role(p_key text) returns boolean
  language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(public.holds_job_role(auth.uid(), p_key)
                  and public.actor_built_in_role() is not distinct from p_key, false)                     -- mut:rr_held_only
$$;
comment on function public.actor_holds_job_role(text) is
  'True when the signed-in person is active and holds exactly this job-role key (not by access level). Null or unknown key: false.';
revoke all on function public.actor_holds_job_role(text) from public, anon;
grant execute on function public.actor_holds_job_role(text) to authenticated, service_role;

-- ── §1 write-off: rank >= 20, or the Material Coordinator key; never the author ─────────────────────────────────────────────────────
create or replace function public.stock_assert_writeoff_approver(p_doc public.stock_documents, p_uid uuid) returns void
  language plpgsql stable security definer set search_path = public as $$
declare v_self_ok boolean; v_rank_ok boolean;
begin
  v_self_ok := p_doc.created_by is distinct from p_uid;                                                   -- mut:selfapprove
  if not v_self_ok then raise exception 'STK_SELF_APPROVE: a write-off must be posted by someone other than its author' using errcode = 'P0001'; end if;
  v_rank_ok := coalesce(public.role_rank(public.auth_role()) >= 20, false)                                -- mut:writeoff_rank
               or coalesce(public.actor_holds_job_role('material_coordinator'), false);           -- mut:rr_mc_writeoff
  if not v_rank_ok then raise exception 'STK_RANK: only a Project Manager or above, or the Material Coordinator, posts a write-off' using errcode = 'P0001'; end if;
end $$;

-- ── §2 client reservation and release ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.csr_assert_recorder() returns void
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (coalesce(public.role_rank(public.auth_role()) >= 20, false)
          or coalesce(public.actor_holds_job_role('material_coordinator'), false)) then                -- mut:rr_mc_reserve
    raise exception 'CSR_FORBIDDEN: only a Project Manager or above, or the Material Coordinator, records a reservation or release' using errcode = '42501'; end if;
end $$;

-- ── §3 stock at risk: a money-free "no guard cover" flag for the Material Coordinator; values stay behind the cost gate ──────────────
create or replace function public.get_stock_at_risk()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid;
  v_cost boolean;
  v_flag boolean;
  v_rows jsonb;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  v_org := public.auth_org_id();
  v_cost := public.stock_can_see_cost();                                                                -- mut:atrisk_cost
  v_flag := v_cost or coalesce(public.actor_holds_job_role('material_coordinator'), false);       -- mut:rr_mc_cover
  with held as (
    select b.warehouse_id, sum(b.value_on_hand) as value_held
      from public.stock_balances b
     where b.org_id = v_org and b.qty_on_hand > 0
     group by b.warehouse_id)
  select coalesce(jsonb_agg(
           jsonb_build_object('warehouse_id', w.id, 'warehouse_code', w.code, 'warehouse_name', w.name,
                              'warehouse_kind', w.kind, 'project_id', w.project_id, 'project_name', p.name)
           || case when v_flag then jsonb_build_object('uncovered', w.cover_value is null) else '{}'::jsonb end
           || case when v_cost then jsonb_build_object(
                    'stock_value', h.value_held::text,
                    'cover_value', w.cover_value::text,
                    'at_risk', (case when w.cover_value is null then h.value_held
                                     else greatest(h.value_held - w.cover_value, 0::numeric) end)::text)
                  else '{}'::jsonb end
           order by (case when v_cost then
                       case when w.cover_value is null then h.value_held
                            else greatest(h.value_held - w.cover_value, 0::numeric) end end) desc nulls last,
                    w.code, w.id), '[]'::jsonb)
    into v_rows
    from held h
    join public.stock_warehouses w on w.id = h.warehouse_id and w.org_id = v_org
    left join public.projects p on p.id = w.project_id;
  return v_rows;
end $$;

-- ── §4 close-out items may name an owner job role (a catalogue key); its holder records the item ─────────────────────────────────────
alter table public.closeout_checklist_templates add column owner_job_role text references public.built_in_roles(key);
alter table public.work_order_closeout_items add column owner_job_role text references public.built_in_roles(key);
comment on column public.work_order_closeout_items.owner_job_role is
  'A job-role key whose holder (held, not by access level) may attach the item''s document and mark it done, besides Finance, an Admin '
  'and the project''s manager. Copied from the organisation''s checklist when the work order is issued; null names no owner.';

create or replace function public.set_closeout_checklist(p_items jsonb) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_role user_role := public.auth_role();
  v_item jsonb;
  v_pos  int := 0;
  v_days text;
  v_owner text;
begin
  perform public.assert_not_light();
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role <> 'Admin' then
    raise exception 'only an Admin can set the organisation''s close-out checklist' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'the close-out checklist is a list of at most 20 items' using errcode = '22023', detail = 'items-shape';
  end if;
  -- One list per organisation: serialise concurrent replacements on the organisation row.
  perform 1 from public.organizations o where o.id = v_org for update;
  delete from public.closeout_checklist_templates t where t.org_id = v_org;
  for v_item in select x from jsonb_array_elements(p_items) x loop
    v_pos := v_pos + 1;
    if jsonb_typeof(v_item) <> 'object' or coalesce(btrim(v_item ->> 'name'), '') = '' or length(btrim(v_item ->> 'name')) > 120 then
      raise exception 'every close-out item needs a name of 1 to 120 characters' using errcode = '23514', detail = 'item-name-invalid';
    end if;
    v_days := nullif(btrim(v_item ->> 'target_days'), '');
    if v_days is not null and (v_days !~ '^[0-9]{1,3}$' or v_days::int not between 1 and 365) then
      raise exception 'COT_TARGET_DAYS: a target is a whole number of days from 1 to 365' using errcode = '23514', detail = 'item-target-invalid';
    end if;
    v_owner := nullif(btrim(coalesce(v_item ->> 'owner_job_role', '')), '');
    if v_owner is not null and public.built_in_role_base(v_owner) is null then
      raise exception 'COT_OWNER_ROLE: the owner is not a job role' using errcode = '23514', detail = 'item-owner-invalid';
    end if;
    insert into public.closeout_checklist_templates (org_id, position, name, required, target_days, owner_job_role)
    values (v_org, v_pos, btrim(v_item ->> 'name'), coalesce((v_item ->> 'required')::boolean, true), v_days::smallint, v_owner);
  end loop;
  perform public.log_audit('closeout_checklist.set', v_org, auth.uid(), v_org, jsonb_build_object('items', v_pos));
  return v_pos;
end; $$;

create or replace function public.instantiate_work_order_closeout_items() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.work_order_closeout_items (org_id, work_order_id, project_id, position, name, required, started_on, target_days, due_on, owner_job_role)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.required,
         public.native_org_today(new.org_id),   -- every item is current from the issue day; a done required item restarts the next required one
         t.target_days,
         public.native_org_today(new.org_id) + t.target_days,   -- calendar days from the issue day; null target gives null
         t.owner_job_role
    from public.closeout_checklist_templates t
   where t.org_id = new.org_id;
  return new;
end; $$;

create or replace function public.lock_closeout_item(p_item uuid) returns public.work_order_closeout_items
  language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid      := public.auth_org_id();
  v_role   user_role := public.auth_role();
  v_wo     uuid;
  v_status public.work_order_status;
  v_pm     uuid;
  v_i      public.work_order_closeout_items;
  v_owner  text;
  v_owns   boolean;
begin
  perform public.assert_not_light();
  perform public.assert_is_active_member();
  select i.work_order_id, i.owner_job_role into v_wo, v_owner from public.work_order_closeout_items i where i.id = p_item and i.org_id = v_org;
  v_owns := found and v_owner is not null and coalesce(public.actor_holds_job_role(v_owner), false);  -- mut:rr_closeout_owner
  if not v_owns and (v_role is null or v_role not in ('Admin','Finance','Project Manager')) then
    raise exception 'only Finance, an Admin or the project''s manager can record close-out items' using errcode = '42501';
  end if;
  if v_wo is null then raise exception 'close-out item not found' using errcode = 'P0002'; end if;
  -- Same row lock as transition_work_order and confirm_work_order_acceptance.
  select w.status into v_status from public.work_orders w where w.id = v_wo and w.org_id = v_org for update;
  if v_status is distinct from 'Issued' then
    raise exception 'close-out items change only while the work order is issued' using errcode = '55000', detail = 'work-order-not-issued';
  end if;
  if v_role = 'Project Manager' and not v_owns then
    select p.project_manager_id into v_pm from public.work_orders w join public.projects p on p.id = w.project_id where w.id = v_wo;
    if v_pm is distinct from auth.uid() then
      raise exception 'only the project''s manager can record close-out items' using errcode = '42501';
    end if;
  end if;
  select * into v_i from public.work_order_closeout_items i where i.id = p_item for update;
  if v_i.done_on is not null then
    raise exception 'this close-out item is already done' using errcode = '55000', detail = 'item-already-done';
  end if;
  return v_i;
end; $$;
