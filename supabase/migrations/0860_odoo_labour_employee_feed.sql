-- 0860_odoo_labour_employee_feed.sql (#1510 L2, O7; ADR-0059 Posture B, D5)
--
-- The Odoo employee mirror for labour hours. PMO never creates an Odoo employee (D6); the Odoo sweep reads `hr.employee`
-- and this migration supplies the two machine writers:
--   1. apply_odoo_employees          — mirror one page into the SHIPPED `erp_employees` table (0136 §2) and PROPOSE a link
--                                      when the work email matches exactly one ACTIVE PMO profile. It never confirms and never
--                                      re-points a `confirmed`/`rejected` row (FR-OLH-003/004, AC-OLH-010/011).
--   2. finish_odoo_employee_census   — tombstone (`erp_cancelled_at`) an employee the census no longer sees; never delete,
--                                      never touch the link (FR-OLH-003).
--   3. confirm_erp_employee_link     — 0148's body with AC-OLH-012's replacement rule: a second confirm for one profile
--                                      DEMOTES the first instead of colliding on the 0136 partial-unique index. The invariant
--                                      (at most one `confirmed` employee per profile) is unchanged; only the mechanism is.
--
-- `erp_employees` predates this migration: no table is created here and no schema changes at all — in particular NO unique index
-- on `(org_id, employee_number)`. The shipped ERPNext-era table leaves a duplicated person number OPEN rather than guessing
-- (`supabase/tests/erp_connect_setup.test.sql`, "an ERP person number shared by two rows is left open, never guessed") and its
-- feed writes rows one at a time with a plain insert, so a unique index here would turn a handled ERPNext data condition into a
-- hard 23505 feed failure and re-point the shipped contract. The Odoo writer below therefore does an explicit SELECT-then-write
-- per row (`claim_erp_sweep_lock` already serialises the per-org writers, so no index arbiter is needed).
--
-- The proposal is a PROPOSAL for a reason (OQ-TSP-10(C)): `work_email` is Desk-editable in the ERP, so auto-confirming would
-- let anyone with Desk access silently re-point a PMO user's cost identity. Only `confirm_erp_employee_link`, called by an
-- in-org Admin, authorizes a push (FR-OLH-005).
--
-- Public repo: fixtures elsewhere use invented names and `@example.com` addresses; nothing here names a client or a host.
-- Reversal: rollback/0860_odoo_labour_employee_feed_down.sql (restores 0148's confirm body, drops both new functions).

-- ── 1. The page writer + the proposal ───────────────────────────────────────────────────────────────────────────────
-- Service-role only (the sweep). Every statement is org-filtered: service_role bypasses RLS, so this function is the tenancy
-- boundary for `erp_employees`, exactly as 0421's `apply_odoo_master_page` is for the directory mirror.
create or replace function public.apply_odoo_employees(p_org_id uuid, p_rows jsonb, p_cursor text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;

  -- Strict parse: a row missing the id, the name or a well-formed Odoo `write_date` is skipped WHOLE, never partly written
  -- (the 0421 `parsePage` rule). One row per Odoo id even if the page repeats it (the newest `write_date` wins), so one page can
  -- never write two rows for one employee.
  --
  -- Then one SELECT-then-write per row:
  --   * a row whose link is already `confirmed` or `rejected` is left byte-identical — a Desk-editable email must never
  --     re-point a cost identity (FR-OLH-004, AC-OLH-011) — and is NEVER duplicated: an existing number is never inserted again;
  --   * an older page never overwrites a newer one (FR-OLH-003);
  --   * a number shared by two shipped (ERPNext-era) rows is mirrored onto the longest-standing one only, deterministic by id:
  --     the shipped "left open, never guessed" contract stays untouched, and the row is still never deleted.
  with page as (
    select distinct on (r->>'external_id')
           r->>'external_id' as employee_number,
           btrim(r->>'name') as employee_name,
           nullif(btrim(r->>'work_email'), '') as work_email,
           case when r->>'active' = 'true' then 'active' else 'inactive' end as erp_status,  -- no cast: a malformed value can never raise
           r->>'write_date' as erp_modified
      from jsonb_array_elements(p_rows) r
     where r->>'external_id' ~ '^[0-9]+$'
       and nullif(btrim(r->>'name'), '') is not null
       and r->>'write_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
       and jsonb_typeof(r->'active') = 'boolean'
     order by r->>'external_id', r->>'write_date' desc
  ),
  target as (
    select p.*, e.id as existing_id
      from page p
      left join lateral (
        select x.id from public.erp_employees x
         where x.org_id = p_org_id and x.employee_number = p.employee_number
         order by x.id
         limit 1
      ) e on true
  ),
  updated as (
    update public.erp_employees e
       set employee_name    = t.employee_name,
           work_email       = t.work_email,
           erp_status       = t.erp_status,
           erp_modified     = t.erp_modified,
           erp_cancelled_at = null                      -- a returning id clears its tombstone (0421's rule)
      from target t
     where e.id = t.existing_id
       and e.link_state in ('unlinked', 'proposed')     -- never re-point a decided link
       and (e.erp_modified is null or t.erp_modified > e.erp_modified)
    returning 1
  ),
  inserted as (
    insert into public.erp_employees
      (org_id, employee_number, employee_name, work_email, erp_status, erp_modified, erp_cancelled_at)
    select p_org_id, t.employee_number, t.employee_name, t.work_email, t.erp_status, t.erp_modified, null
      from target t
     where t.existing_id is null                         -- never a second row for a number the mirror already holds
    returning 1
  )
  select count(*) into v_n
    from (select * from updated union all select * from inserted) w;

  -- The proposal (FR-OLH-004): exactly one ACTIVE profile in the org whose email matches, and no other employee already
  -- CONFIRMED for that profile. `link_state='unlinked'` in the predicate means a proposed/confirmed/rejected row is never
  -- re-proposed over. Nothing here confirms.
  with unique_match as (
    select e.id as employee_id, (array_agg(p.id))[1] as profile_id
      from public.erp_employees e
      join public.profiles p
        on p.org_id = e.org_id
       and p.status = 'active'
       and lower(btrim(p.email)) = lower(btrim(e.work_email))
     where e.org_id = p_org_id
       and e.link_state = 'unlinked'
       and e.erp_cancelled_at is null
       and e.work_email is not null
     group by e.id
    having count(*) = 1
  )
  update public.erp_employees e
     set link_state = 'proposed',
         profile_id = m.profile_id,
         link_proposed_reason = 'work-email-exact-match'
    from unique_match m
   where e.id = m.employee_id
     and e.org_id = p_org_id
     and not exists (select 1 from public.erp_employees c
                      where c.org_id = p_org_id and c.link_state = 'confirmed' and c.profile_id = m.profile_id);

  -- The cursor moves only here (the 0421 rule: a failure leaves it where it was), under its own domain so it can never be
  -- confused with a directory kind's cursor or the census's.
  if p_cursor is not null then
    insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
    values (p_org_id, 'odoo', 'labour:employee', p_cursor, now())
    on conflict (org_id, external_tier, domain) do update
      set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  end if;

  return v_n;
end $$;
revoke all on function public.apply_odoo_employees(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_odoo_employees(uuid, jsonb, text) to service_role;

-- ── 2. The census finish: tombstone, never delete ───────────────────────────────────────────────────────────────────
-- Kept separate from `finish_odoo_census` (0421): that one walks `external_master_records` by kind; this one walks
-- `erp_employees`. `p_seen` is the ids the census read this run; a live row whose number is not among them is tombstoned.
-- The link columns are never touched — an employee who left the ERP is still whose cost the posted hours became.
create or replace function public.finish_odoo_employee_census(p_org_id uuid, p_run text, p_seen jsonb, p_cursor text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  perform public.assert_odoo_activated(p_org_id);
  if p_seen is null or jsonb_typeof(p_seen) <> 'array' then
    raise exception 'seen ids must be a JSON array' using errcode = '22023';
  end if;

  -- An employee row with NO number is not an Odoo-mirrored row (the ERPNext-era shape) and is never tombstoned by this pass.
  update public.erp_employees
     set erp_cancelled_at = now()
   where org_id = p_org_id
     and erp_cancelled_at is null
     and employee_number is not null
     and employee_number not in (select jsonb_array_elements_text(p_seen));
  get diagnostics v_n = row_count;

  -- The cursor moves only here (the 0421 rule: a failure leaves it where it was), under its own domain so it can never be
  -- confused with a directory kind's cursor.
  if p_cursor is not null then
    insert into public.external_sync_watermarks (org_id, external_tier, domain, watermark_cursor, updated_at)
    values (p_org_id, 'odoo', 'labour:employee', p_cursor, now())
    on conflict (org_id, external_tier, domain) do update
      set watermark_cursor = excluded.watermark_cursor, updated_at = now();
  end if;

  return v_n;
end $$;
revoke all on function public.finish_odoo_employee_census(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_odoo_employee_census(uuid, text, jsonb, text) to service_role;

-- ── 3. The confirm path: 0148's body + AC-OLH-012's replacement rule ───────────────────────────────────────────────
-- Everything 0148 asserts stays: caller must be an active Admin of the employee's own org (SECURITY DEFINER bypasses RLS),
-- the target profile must be in the same org, and `linked_by`/`linked_at` are server-resolved (no parameter can forge them).
-- NEW: a second confirm for one profile demotes the previously confirmed employee first, so the 0136 partial-unique index
-- keeps its invariant (one confirmed employee per profile) instead of raising 23505 at the confirming Admin.
create or replace function public.confirm_erp_employee_link(p_erp_employee_id uuid, p_profile_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org uuid;
  v_actor uuid := auth.uid();
  v_target_org uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Load + lock the row (serializes a concurrent confirm on the SAME Employee). P0002 if absent.
  select e.org_id into v_org from public.erp_employees e where e.id = p_erp_employee_id for update;
  if v_org is null then
    raise exception 'employee not found' using errcode = 'P0002';
  end if;

  -- Org + Admin re-assertion — MUST STAY (SECURITY DEFINER bypasses RLS entirely; without this any authenticated caller, in
  -- ANY org, could confirm ANY org's Employee link). `is_active_member()` is part of it: this function is reachable directly
  -- over PostgREST, so a just-disabled Admin holding a still-valid JWT must not keep re-pointing a cost identity.
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- The PMO user being linked must be in the SAME org (never link across tenants).
  select p.org_id into v_target_org from public.profiles p where p.id = p_profile_id;
  if v_target_org is distinct from v_org then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- AC-OLH-012: one confirmed employee per profile. A second confirm REPLACES the first (the row returns to a clean
  -- unlinked state, so it is not stranded as a confirmed link the Admin can no longer see).
  update public.erp_employees
     set link_state = 'unlinked',
         profile_id = null,
         linked_by  = null,
         linked_at  = null
   where org_id = v_org
     and profile_id = p_profile_id
     and link_state = 'confirmed'
     and id <> p_erp_employee_id;

  update public.erp_employees
     set profile_id = p_profile_id,
         link_state = 'confirmed',
         linked_by  = v_actor,
         linked_at  = now()
   where id = p_erp_employee_id;

  perform public.log_audit(
    'confirm_erp_employee_link',
    v_org,
    v_actor,
    p_erp_employee_id,
    jsonb_build_object('profile_id', p_profile_id)
  );
end;
$$;
revoke all     on function public.confirm_erp_employee_link(uuid, uuid) from public;
grant  execute on function public.confirm_erp_employee_link(uuid, uuid) to   authenticated;
revoke execute on function public.confirm_erp_employee_link(uuid, uuid) from anon;

-- ── 4. Self-assertion: neither machine writer is reachable by a client role ────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.apply_odoo_employees(uuid,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.apply_odoo_employees(uuid,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.finish_odoo_employee_census(uuid,text,jsonb,text)', 'execute')
     or has_function_privilege('anon', 'public.finish_odoo_employee_census(uuid,text,jsonb,text)', 'execute') then
    raise exception 'the Odoo employee writers must be service-role only';
  end if;
end $$;
