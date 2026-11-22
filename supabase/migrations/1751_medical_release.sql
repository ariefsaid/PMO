-- 1751_medical_release.sql — a medical release per person and date, modelled on leave requests (1240/1241).
-- Spec docs/specs/medical-release.spec.md. The people team creates a release; the person's direct manager approves it or
-- defers it with a reason; each decision is audited and the worker is told (notify_person, 1750). Nothing happens until a
-- release exists, so no setting. A release holds a decision and a short note only: never medical content.
-- Reverse: supabase/migrations/rollback/1751_medical_release_down.sql

create table public.medical_releases (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                  references public.organizations(id) on delete cascade,
  person_id     uuid not null references public.people(id),
  release_date  date not null,
  status        text not null default 'Pending' check (status in ('Pending', 'Approved', 'Deferred')),
  note          text check (note is null or char_length(note) <= 500),
  entered_by    uuid not null references public.profiles(id),
  -- the deciding direct manager, fixed when the release is opened: a later change of the person's manager grants nothing
  decider_id    uuid not null references public.profiles(id),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_at    timestamptz not null default now(),
  constraint medical_releases_one_per_day unique (person_id, release_date)
);
create index medical_releases_org_status_idx on public.medical_releases (org_id, status);
create trigger medical_releases_stamp_org_id before insert on public.medical_releases
  for each row execute function public.stamp_org_id();

-- The people team: the Admin level or the one people-documents gate (actor_has_person_documents_access, 1536). Reads the
-- gate only; adds no read of any medical document.
create function public.medical_release_can_enter() returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select true from public.profiles p
                    where public.assert_not_light() and public.is_active_member() and p.id = auth.uid()
                      and (p.role = 'Admin' or public.actor_has_person_documents_access())), false)
$$;
revoke all on function public.medical_release_can_enter() from public, anon;
grant execute on function public.medical_release_can_enter() to authenticated;

alter table public.medical_releases enable row level security;
alter table public.medical_releases force row level security;
-- Read by the person, whoever entered it, the people team and the direct manager. Rostering users read a state word via
-- medical_release_holds, never the row or its note.
create policy medical_releases_select on public.medical_releases for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (entered_by = (select auth.uid())
              or exists (select 1 from public.people w where w.id = person_id and w.profile_id = (select auth.uid()))
              or (select public.medical_release_can_enter())
              or decider_id = (select auth.uid())));
revoke all on public.medical_releases from public, anon, authenticated;
grant select on public.medical_releases to authenticated;
-- A field (light) account reads no release state.
create policy light_account_scope_select on public.medical_releases as restrictive for select to authenticated
  using ((select public.actor_is_light()) is not true);
grant all on public.medical_releases to service_role;

create function public.medical_release_create(p_person_id uuid, p_date date, p_note text) returns uuid
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

-- The person and whoever entered the release never decide it (SoD, any role including Admin); only the manager fixed at
-- creation (decider_id) does, whatever the person's manager is later changed to.
-- A Deferred release can be decided again; an Approved one cannot.
create function public.medical_release_decide(p_id uuid, p_decision text, p_note text) returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_org uuid := public.auth_org_id(); v_rel public.medical_releases; v_profile uuid;
begin
  perform public.assert_not_light();
  if v_org is null or not public.is_active_member() then
    raise exception 'MR_FORBIDDEN: not an active member' using errcode = '42501';
  end if;
  if p_decision not in ('Approved', 'Deferred') then
    raise exception 'MR_DECISION: decide Approved or Deferred' using errcode = '22023';
  end if;
  select * into v_rel from public.medical_releases r where r.id = p_id and r.org_id = v_org for update;
  if not found then
    raise exception 'MR_NOT_FOUND: no such release' using errcode = 'P0002';
  end if;
  select w.profile_id into v_profile from public.people w where w.id = v_rel.person_id;
  if v_rel.entered_by = v_uid or coalesce(v_profile = v_uid, false) then
    raise exception 'MR_SOD: you cannot decide your own release, or one you entered' using errcode = '42501';
  end if;
  if v_rel.decider_id is distinct from v_uid then
    raise exception 'MR_FORBIDDEN: only the person''s direct manager can decide this release' using errcode = '42501';
  end if;
  if v_rel.status = 'Approved' then
    raise exception 'MR_DECIDED: this release is already approved' using errcode = '23514';
  end if;
  if p_decision = 'Deferred' and nullif(btrim(p_note), '') is null then
    raise exception 'MR_NOTE: give a reason when deferring' using errcode = '23514';
  end if;
  update public.medical_releases set status = p_decision, decided_by = v_uid, decided_at = now(),
         decision_note = nullif(btrim(p_note), '') where id = p_id;
  perform public.log_audit('medical_release.' || lower(p_decision), v_org, v_uid, p_id, '{}'::jsonb);
  perform public.notify_person(v_rel.person_id, 'medical_release',
    case when p_decision = 'Approved' then 'Your return to work is released' else 'Your return to work is deferred' end,
    case when p_decision = 'Approved' then 'You can be rostered again.'
         else 'Talk to your direct manager before you are rostered again.' end,
    '/attendance');
  return p_decision;
end $$;
revoke all on function public.medical_release_decide(uuid, text, text) from public, anon;
grant execute on function public.medical_release_decide(uuid, text, text) to authenticated;

-- Does a release that is not approved hold this worker for any day up to p_last_day (null = open-ended) on or after its
-- date? One rule, read by the guards in 1752 and the holds list. Not callable by clients.
create function public.medical_release_blocks(p_worker uuid, p_last_day date) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.medical_releases r
                  where r.person_id = p_worker and r.status <> 'Approved'
                    and coalesce(p_last_day, 'infinity'::date) >= r.release_date)
$$;
revoke all on function public.medical_release_blocks(uuid, date) from public, anon, authenticated;

-- Roster screens: people held on that date, as a state word only (pending or deferred). Scoped to rostering roles: the
-- people team (through the one gate, 1536), the person's direct manager, a crew manager, and whoever can record attendance
-- for a crew the person is placed in or loaned to that day. Everyone else gets no rows.
-- A FIELD ACCOUNT MAY CALL THIS (a foreman ticks their own crew's roster): it carries no assert_not_light guard and calls no
-- guarded helper, so the people-team and direct-manager tests are written inline. A field account qualifies only through
-- attendance_can_record for a crew the person is in that day; the sweep allowlists it as a field path.
create function public.medical_release_holds(p_date date) returns table (person_id uuid, state text)
  language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (r.person_id) r.person_id, lower(r.status)
    from public.medical_releases r
   where public.is_active_member() and r.org_id = public.auth_org_id()
     and r.status <> 'Approved' and p_date >= r.release_date
     and (exists (select 1 from public.profiles me
                   where me.id = auth.uid() and (me.role = 'Admin' or public.actor_has_person_documents_access()))
          or public.crew_can_manage()
          or r.decider_id = auth.uid()
          or exists (select 1 from (
                       select m.crew_id from public.crew_members m
                        where m.worker_id = r.person_id and p_date between m.valid_from and coalesce(m.valid_to, 'infinity'::date)
                       union
                       select l.home_crew_id from public.crew_loans l
                        where l.worker_id = r.person_id and p_date between l.valid_from and l.valid_to
                       union
                       select l.host_crew_id from public.crew_loans l
                        where l.worker_id = r.person_id and p_date between l.valid_from and l.valid_to) c
                      where public.attendance_can_record(c.crew_id)))
   order by r.person_id, r.release_date desc
$$;
revoke all on function public.medical_release_holds(date) from public, anon;
grant execute on function public.medical_release_holds(date) to authenticated;

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
