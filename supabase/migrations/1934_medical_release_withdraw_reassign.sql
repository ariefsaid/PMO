-- 1934_medical_release_withdraw_reassign.sql — a medical release can always move forward.
-- (a) medical_release_create (restated from 1751, the only migration that defines it) refuses a release whose fixed decider would
--     be its opener (MR_SOD_DECIDER): the opener never decides, so it could never be decided.
-- (b) medical_release_withdraw: an Admin or the people team (medical_release_can_enter, 1751) withdraws a Pending or Deferred
--     release with a reason, never their own; the row goes and the reason, person, date and state are audited, which lifts the
--     roster block (medical_release_blocks reads the rows).
-- (c) medical_release_reassign: an Admin moves the decider to the person's current direct manager when the fixed decider is no
--     longer an active member; the new decider is never the opener or the person. Audited.
-- medical_releases_visible (restated from 1751) adds two screen hints, own and decider_active; dropped and created again for the
-- new return type.
-- drops: medical_releases_visible's return list gains own and decider_active (the line naming can_decide is rewritten); every select line is kept.
-- Proven by supabase/tests/1751_medical_release.test.sql. Rollback: rollback/1934_medical_release_withdraw_reassign_down.sql

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
  -- The opener never decides (MR_SOD): a release whose only possible decider is its opener could never be decided (1934).
  if v_decider = auth.uid() then                                                                            -- mut:sod_decider
    raise exception 'MR_SOD_DECIDER: you are this person''s direct manager, so you could never decide a release you open; ask an Admin to open it, or set another manager first' using errcode = '42501';
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

create function public.medical_release_withdraw(p_id uuid, p_reason text) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_rel public.medical_releases;
        v_reason text := nullif(btrim(p_reason), '');
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() or not public.medical_release_can_enter() then         -- mut:withdraw_right
    raise exception 'MR_WITHDRAW_RIGHT: only an Admin or the people team can withdraw a release' using errcode = '42501';
  end if;
  select * into v_rel from public.medical_releases r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'MR_NOT_FOUND: no such release' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.people w where w.id = v_rel.person_id and w.profile_id = v_uid) then       -- mut:withdraw_self
    raise exception 'MR_WITHDRAW_SELF: you cannot withdraw your own release' using errcode = '42501';
  end if;
  if v_rel.status = 'Approved' then
    raise exception 'MR_DECIDED: this release is already approved' using errcode = '23514';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'MR_WITHDRAW_REASON: say why the release is withdrawn' using errcode = '22023';
  end if;
  delete from public.medical_releases where id = p_id;
  perform public.log_audit('medical_release.withdraw', v_org, v_uid, p_id,
    jsonb_build_object('person_id', v_rel.person_id, 'release_date', v_rel.release_date, 'status', v_rel.status, 'reason', v_reason));
end $$;
revoke all on function public.medical_release_withdraw(uuid, text) from public, anon;
grant execute on function public.medical_release_withdraw(uuid, text) to authenticated;

create function public.medical_release_reassign(p_id uuid) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_rel public.medical_releases; v_new uuid; v_profile uuid;
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() or public.auth_role() is distinct from 'Admin' then     -- mut:reassign_admin
    raise exception 'MR_REASSIGN_RIGHT: only an Admin can reassign who decides a release' using errcode = '42501';
  end if;
  select * into v_rel from public.medical_releases r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'MR_NOT_FOUND: no such release' using errcode = 'P0002';
  end if;
  if v_rel.status = 'Approved' then
    raise exception 'MR_DECIDED: this release is already approved' using errcode = '23514';
  end if;
  if public.is_active_member(v_rel.decider_id) then                                                        -- mut:reassign_inactive
    raise exception 'MR_DECIDER_ACTIVE: the deciding manager is still active and decides this release' using errcode = '23514';
  end if;
  select coalesce(w.manager_id, lp.manager_id), w.profile_id into v_new, v_profile
    from public.people w left join public.profiles lp on lp.id = w.profile_id where w.id = v_rel.person_id;
  if v_new is null or not public.is_active_member(v_new) then
    raise exception 'MR_REASSIGN_NO_MANAGER: this person has no active direct manager; set one first' using errcode = '23514';
  end if;
  if v_new = v_rel.entered_by or v_new = v_profile then
    raise exception 'MR_REASSIGN_SOD: the current manager opened this release or is the person; set another manager first' using errcode = '42501';
  end if;
  update public.medical_releases set decider_id = v_new where id = p_id;
  perform public.log_audit('medical_release.reassign', v_org, v_uid, p_id,
    jsonb_build_object('person_id', v_rel.person_id, 'from', v_rel.decider_id, 'to', v_new));
  return v_new;
end $$;
revoke all on function public.medical_release_reassign(uuid) from public, anon;
grant execute on function public.medical_release_reassign(uuid) to authenticated;

drop function public.medical_releases_visible();
create function public.medical_releases_visible()
  returns table (id uuid, person_id uuid, person_name text, release_date date, status text, note text,
                 decided_at timestamptz, decision_note text, can_decide boolean, own boolean, decider_active boolean)
  language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.person_id, w.name, r.release_date, r.status, r.note, r.decided_at, r.decision_note,
         (r.status <> 'Approved' and r.decider_id = (select auth.uid())
            and r.entered_by <> (select auth.uid())
            and not exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid())))
         -- 1934: the release is the caller's own (never withdrawn by them), and whether its fixed decider is still active (an Admin
         -- reassigns only an inactive decider). Screen hints only: medical_release_withdraw and medical_release_reassign decide.
         , exists (select 1 from public.people me where me.id = r.person_id and me.profile_id = (select auth.uid()))
         , exists (select 1 from public.profiles d where d.id = r.decider_id and d.status = 'active')
    from public.medical_releases r join public.people_directory w on w.id = r.person_id
   order by (r.status <> 'Approved') desc, r.release_date desc, r.id
$$;
revoke all on function public.medical_releases_visible() from public, anon;
grant execute on function public.medical_releases_visible() to authenticated;
