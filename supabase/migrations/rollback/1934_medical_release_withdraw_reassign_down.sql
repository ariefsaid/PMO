-- Reverse of 1934: the 1751 bodies; the two new functions go.
drop function if exists public.medical_release_withdraw(uuid, text);
drop function if exists public.medical_release_reassign(uuid);
create or replace function public.medical_release_create(p_person_id uuid, p_date date, p_note text) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_id uuid; v_decider uuid;
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() or not public.medical_release_can_enter() then
    raise exception 'MR_FORBIDDEN: only the people team can open a medical release' using errcode = '42501';
  end if;
  if not exists (select 1 from public.people w where w.id = p_person_id and w.org_id = v_org) then
    raise exception 'MR_REF: the person is not in this organisation' using errcode = '23514';
  end if;
  -- The deciding manager is fixed now: people.manager_id, else the manager of the linked login.
  select coalesce(w.manager_id, lp.manager_id) into v_decider
    from public.people w left join public.profiles lp on lp.id = w.profile_id where w.id = p_person_id;
  if v_decider is null then
    raise exception 'MR_NO_MANAGER: set this person''s direct manager first' using errcode = '23514';
  end if;
  begin
    insert into public.medical_releases (person_id, release_date, note, entered_by, decider_id)
    values (p_person_id, p_date, nullif(btrim(p_note), ''), auth.uid(), v_decider) returning id into v_id;
  exception when unique_violation then
    raise exception 'MR_EXISTS: this person already has a release for that date' using errcode = '23514';
  end;
  perform public.log_audit('medical_release.create', v_org, auth.uid(), v_id, jsonb_build_object('person_id', p_person_id));
  return v_id;
end $$;
revoke all on function public.medical_release_create(uuid, date, text) from public, anon;
grant execute on function public.medical_release_create(uuid, date, text) to authenticated;

drop function public.medical_releases_visible();
create function public.medical_releases_visible()
  returns table (id uuid, person_id uuid, person_name text, release_date date, status text, note text,
                 decided_at timestamptz, decision_note text, can_decide boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.person_id, w.name, r.release_date, r.status, r.note, r.decided_at, r.decision_note,
         (r.status <> 'Approved' and r.decider_id = (select auth.uid())
            and r.entered_by <> (select auth.uid())
            and not exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid())))
    from public.medical_releases r join public.people_directory w on w.id = r.person_id
   order by (r.status <> 'Approved') desc, r.release_date desc, r.id
$$;
revoke all on function public.medical_releases_visible() from public, anon;
grant execute on function public.medical_releases_visible() to authenticated;
