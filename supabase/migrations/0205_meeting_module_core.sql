-- 0205_meeting_module_core.sql — meetings, attendees, grants: the auth core of #526.
-- Spec: docs/specs/meeting-module.spec.md (§3.4 tables verbatim; FR-MTG-014..016, FR-MTG-030..034).
-- Rulings: OD-MTG-1/2 (owner, 2026-08-21) · DD-MTG-3/6/7 · DD-MTG-1..5. Proven by
-- supabase/tests/0205_meeting_access.test.sql (AC-MTG-101..124), mutation-verified.
--
-- ── THE ACCESS MODEL, AND WHY IT IS NOT THE SCHEMA-WIDE DEFAULT ────────────────────────────────
-- OD-MTG-1: **writing minutes is ordinary RBAC (every role, Engineer included); reading them is
-- ATTENDANCE, not role.** An Engineer must not read a peer's minute from a meeting they were not
-- present at — so `meetings_select` keys on the attendee join, the author, an explicit grant
-- (OD-MTG-2: view-only, named users, audit-logged), or Admin. ⛔ Taking the expensive direction NOW
-- is the point: widening later is a policy line; narrowing later is a migration over live client
-- notes. DD-MTG-7: a project's PM gets NO automatic read — the share panel pre-suggests them.
--
-- EDIT is narrower than CREATE on purpose: grants are VIEW-ONLY (OD-MTG-2), so a non-author
-- attendee reads and does not write; the minute's author (+ Admin) edits. "Everyone writes
-- meetings" (OD-MTG-1) is about CREATING and minuting your own — not editing a peer's record.
--
-- ── ⚑ THE RLS RECURSION, AND THE HOUSE CYCLE-BREAKER ───────────────────────────────────────────
-- meetings_select must consult meeting_attendees + meeting_access_grants; their own policies must
-- consult meetings ("visible iff the meeting is"). As plain subqueries that is
-- meetings→attendees→meetings: Postgres raises "infinite recursion detected in policy". The
-- helpers below are SECURITY DEFINER owned by postgres — the exact shape `is_active_member` (0062)
-- already uses to read FORCE-RLS'd `profiles` from inside policies, proven in production — so the
-- meetings policy reads the child tables without re-entering their policies, and the cycle never
-- closes. REVOKE/GRANT discipline per house rule (0185's lesson: hosted grants EXECUTE to
-- anon/authenticated by default — revoke first, grant back only what is meant).
-- ================================================================================================

-- ── §1 — tables (spec §3.4 verbatim, plus the grants table OD-MTG-2 adds) ───────────────────────
create table public.meetings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id)
                         default '00000000-0000-0000-0000-000000000001',
  project_id           uuid references public.projects(id),          -- nullable, exactly one (DD-MTG-4)
  title                text not null,
  occurred_at          timestamptz not null default now(),
  location             text,
  notes                jsonb not null default '[]'::jsonb,
  notes_text           text not null default '',                     -- trigger-maintained projection
  notes_search         tsvector,                                     -- trigger-maintained
  notes_schema_version smallint not null default 1,
  is_template          boolean not null default false,
  created_by_id        uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz
);

create table public.meeting_attendees (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id)
                 default '00000000-0000-0000-0000-000000000001',
  meeting_id   uuid not null references public.meetings(id) on delete cascade,
  profile_id   uuid references public.profiles(id),
  contact_id   uuid references public.contacts(id),
  display_name text,
  created_at   timestamptz not null default now(),
  -- FR-MTG-015: EXACTLY ONE of profile / contact / free-typed name; whitespace does not count.
  constraint meeting_attendees_exactly_one_identity check (
    (case when profile_id is not null then 1 else 0 end
     + case when contact_id is not null then 1 else 0 end
     + case when display_name is not null and btrim(display_name) <> '' then 1 else 0 end) = 1)
);

-- OD-MTG-2: the post-hoc share. A plain join row; deliberately THIN — view-only, named users,
-- no tiers, no links, no expiry ("add those when someone asks twice").
create table public.meeting_access_grants (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id)
               default '00000000-0000-0000-0000-000000000001',
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  constraint meeting_access_grants_one_per_user unique (meeting_id, user_id)
);

create index meetings_org_occurred_idx    on public.meetings (org_id, occurred_at desc);
create index meetings_project_idx         on public.meetings (project_id);
create index meetings_created_by_idx      on public.meetings (created_by_id);
create index meetings_notes_search_idx    on public.meetings using gin (notes_search);
create index meeting_attendees_meeting_idx on public.meeting_attendees (meeting_id);
create index meeting_attendees_profile_idx on public.meeting_attendees (profile_id);
-- Hot path: listMeetingsForContact inner-joins meeting_attendees by contact_id on EVERY ContactDetail
-- view (DD-MTG-6 union). Without this it is a seq scan per contact view (quality review, 2026-08-24).
create index meeting_attendees_contact_idx on public.meeting_attendees (contact_id);
create index meeting_access_grants_meeting_idx on public.meeting_access_grants (meeting_id);
create index meeting_access_grants_user_idx    on public.meeting_access_grants (user_id);

-- ── §1b — grants: EXPLICIT, because this repo revoked the auto-grant defaults (0075/0194) ───────
-- RLS is the filter; the grant is the reach. Shaped by intent, not uniformity:
--   meetings           full DML — policies mediate each verb.
--   meeting_attendees  no UPDATE grant: a row is added or removed, never edited.
--   meeting_access_grants  no UPDATE grant AND no UPDATE policy — the dead-proof pair (the #552
--   lesson inverted: make the unreachable verb unreachable at BOTH layers on purpose).
--   anon: nothing.
grant select, insert, update, delete on public.meetings              to authenticated;
grant select, insert, delete         on public.meeting_attendees     to authenticated;
grant select, insert, delete         on public.meeting_access_grants to authenticated;
grant all on public.meetings, public.meeting_attendees, public.meeting_access_grants to service_role;

-- ── §2 — the cycle-breaking visibility helpers ──────────────────────────────────────────────────
create or replace function public.is_meeting_attendee(p_meeting_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  -- org-scoped internally (security review LOW-4): every caller already conjoins org, but the
  -- name promises attendance and the next reuse without an org conjunct would be a cross-tenant read.
  select exists (select 1 from public.meeting_attendees a
                  where a.meeting_id = p_meeting_id and a.profile_id = auth.uid()
                    and a.org_id = auth_org_id())
$$;
create or replace function public.has_meeting_grant(p_meeting_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meeting_access_grants g
                  where g.meeting_id = p_meeting_id and g.user_id = auth.uid()
                    and g.org_id = auth_org_id())
$$;
-- The child-table policies' side of the cycle: may the caller read this meeting? Same disjuncts as
-- meetings_select, evaluated OUTSIDE the policy engine so children can consult it safely.
create or replace function public.can_read_meeting(p_meeting_id uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m
     where m.id = p_meeting_id
       and m.org_id = auth_org_id()
       and (auth_role() = 'Admin'
            or m.created_by_id = auth.uid()
            or public.is_meeting_attendee(m.id)
            or public.has_meeting_grant(m.id)))
$$;
revoke all on function public.is_meeting_attendee(uuid)  from public;
revoke all on function public.has_meeting_grant(uuid)    from public;
revoke all on function public.can_read_meeting(uuid)     from public;
grant execute on function public.is_meeting_attendee(uuid) to authenticated, service_role;
grant execute on function public.has_meeting_grant(uuid)   to authenticated, service_role;
grant execute on function public.can_read_meeting(uuid)    to authenticated, service_role;

-- ── §3 — RLS: meetings ──────────────────────────────────────────────────────────────────────────
alter table public.meetings enable row level security;
alter table public.meetings force  row level security;

-- ⛔ READ = attendance ∪ author ∪ grant ∪ Admin. NEVER a role shortcut beyond Admin, and NEVER a
-- project-scope disjunct (DD-MTG-7) — the owner's rule verbatim: an Engineer must not read a
-- peer's minute from a meeting they were not present at, and neither must that project's PM.
create policy meetings_select on public.meetings for select
  using (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() = 'Admin'
         or created_by_id = (select auth.uid())
         or public.is_meeting_attendee(id)
         or public.has_meeting_grant(id)));

-- OD-MTG-1: EVERY role creates — no role list at all, the org floor + membership carry it.
create policy meetings_insert on public.meetings for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and (project_id is null
         or exists (select 1 from public.projects p
                     where p.id = meetings.project_id and p.org_id = auth_org_id())));

-- Edit = the author or Admin (grants are view-only; an attendee reads, they do not rewrite).
create policy meetings_update on public.meetings for update
  using (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() = 'Admin' or created_by_id = (select auth.uid())))
  with check (org_id = auth_org_id() and public.is_active_member()
    and (auth_role() = 'Admin' or created_by_id = (select auth.uid()))
    and (project_id is null
         or exists (select 1 from public.projects p
                     where p.id = meetings.project_id and p.org_id = auth_org_id())));

-- FR-MTG-016: soft-archive is the normal path (archived_at via update); hard delete Admin-only.
create policy meetings_delete on public.meetings for delete
  using (org_id = auth_org_id() and public.is_active_member() and auth_role() = 'Admin');

-- created_by_id is an AUTHORIZATION INPUT (the update policy reads it) — stamped and pinned,
-- the 0204 created_by pattern exactly, and for the same reason.
create or replace function public.stamp_meeting_created_by()
  returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if (select auth.uid()) is not null then new.created_by_id := (select auth.uid()); end if;
  return new;
end; $$;
create trigger meetings_stamp_created_by
  before insert on public.meetings
  for each row execute function public.stamp_meeting_created_by();

create or replace function public.pin_meeting_created_by()
  returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.created_by_id := old.created_by_id;
  new.updated_at := now();
  return new;
end; $$;
create trigger meetings_aa_pin_created_by
  before update on public.meetings
  for each row execute function public.pin_meeting_created_by();

-- FR-MTG (persistence): notes_text + notes_search are trigger-maintained projections of the JSON
-- body — the search surface never trusts the client's copy of either.
create or replace function public.project_meeting_notes()
  returns trigger language plpgsql security invoker set search_path = public as $$
declare v_text text;
begin
  select coalesce(string_agg(x.t, E'\n'), '') into v_text
    from (select jsonb_array_elements(case when jsonb_typeof(new.notes) = 'array'
                                           then new.notes else '[]'::jsonb end) ->> 'text' as t) x
   where x.t is not null;
  new.notes_text   := v_text;
  -- INFO-7: bound the tsvector input — >1MB of tokenizable text raises 54000 with no classifier
  -- branch. Search truncates at ~900k chars; notes_text keeps the whole body. Own-row only, no
  -- cross-user reach, but a legible failure beats a raw Postgres error.
  new.notes_search := to_tsvector('simple', left(new.title || ' ' || v_text, 900000));
  -- FR-MTG-005: the schema version is SERVER-written on every insert and update — a client-supplied
  -- value never sticks. `authenticated` holds table-wide UPDATE, so without this line a raw PATCH
  -- sets it freely and future readers branch on a lie (spec-review C-class find, 2026-08-24).
  new.notes_schema_version := 1;
  return new;
end; $$;
create trigger meetings_ab_project_notes
  before insert or update on public.meetings
  for each row execute function public.project_meeting_notes();

-- ── §4 — RLS: attendees (visible iff the meeting is; edited by the author) ─────────────────────
alter table public.meeting_attendees enable row level security;
alter table public.meeting_attendees force  row level security;

create policy meeting_attendees_select on public.meeting_attendees for select
  using (org_id = auth_org_id() and public.is_active_member() and public.can_read_meeting(meeting_id));

-- The attendee list is part of the minute: its AUTHOR (or Admin) maintains it — by ADD and REMOVE
-- only. ⚑ Deliberately NO update policy, matching the absent UPDATE grant: the first draft was
-- `FOR ALL`, whose update arm was a DEAD LAYER over the select/insert/delete grant — the exact
-- policy-without-reach shape #552 exists to kill, caught in review the same day it was written.
-- An attendee row is immutable; changing who attended is remove + add, which the audit story wants
-- anyway.
create policy meeting_attendees_insert on public.meeting_attendees for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and exists (select 1 from public.meetings m where m.id = meeting_attendees.meeting_id
                 and m.org_id = auth_org_id()
                 and (m.created_by_id = (select auth.uid()) or auth_role() = 'Admin'))
    -- LOW-5: the seated identity must be in-org too (mirrors the grants table). Inert single-tenant;
    -- exactly the row that goes wrong when org_id starts varying at the B2B seam.
    and (profile_id is null or exists (select 1 from public.profiles pr
           where pr.id = meeting_attendees.profile_id and pr.org_id = auth_org_id()))
    and (contact_id is null or exists (select 1 from public.contacts ct
           where ct.id = meeting_attendees.contact_id and ct.org_id = auth_org_id())));
create policy meeting_attendees_delete on public.meeting_attendees for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and exists (select 1 from public.meetings m where m.id = meeting_attendees.meeting_id
                 and m.org_id = auth_org_id()
                 and (m.created_by_id = (select auth.uid()) or auth_role() = 'Admin')));

-- 0030's org-stamp idiom, verbatim shape: inherit from the parent; an EXPLICIT foreign org_id is
-- preserved so the spoof hits WITH CHECK instead of being silently rewritten (AC-MTG-018 class).
create or replace function public.stamp_meeting_attendee_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select m.org_id into new.org_id from public.meetings m where m.id = new.meeting_id;
  end if;
  return new;
end; $$;
create trigger meeting_attendees_stamp_org
  before insert on public.meeting_attendees
  for each row execute function public.stamp_meeting_attendee_org();

-- ── §5 — RLS: grants (anyone who can READ may share; view-only; audit-logged) ──────────────────
alter table public.meeting_access_grants enable row level security;
alter table public.meeting_access_grants force  row level security;

create policy meeting_access_grants_select on public.meeting_access_grants for select
  using (org_id = auth_org_id() and public.is_active_member() and public.can_read_meeting(meeting_id));

-- OD-MTG-2: "anyone who can already read a minute can share it."
create policy meeting_access_grants_insert on public.meeting_access_grants for insert
  with check (org_id = auth_org_id() and public.is_active_member()
    and public.can_read_meeting(meeting_id)
    and exists (select 1 from public.profiles pr
                 where pr.id = meeting_access_grants.user_id and pr.org_id = auth_org_id()));

-- Revoke = the granter, the meeting's author, or Admin.
create policy meeting_access_grants_delete on public.meeting_access_grants for delete
  using (org_id = auth_org_id() and public.is_active_member()
    and (granted_by = (select auth.uid()) or auth_role() = 'Admin'
         or exists (select 1 from public.meetings m
                     where m.id = meeting_access_grants.meeting_id
                       and m.created_by_id = (select auth.uid()))));
-- ⚑ No UPDATE policy AT ALL: a grant is created and revoked, never edited — the thin shape is load-bearing.

create or replace function public.stamp_meeting_grant()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select m.org_id into new.org_id from public.meetings m where m.id = new.meeting_id;
  end if;
  -- granted_by is provenance the audit trail reads: overwrite, never trust (the 0204 stamp rule).
  if (select auth.uid()) is not null then new.granted_by := (select auth.uid()); end if;
  return new;
end; $$;
create trigger meeting_access_grants_stamp
  before insert on public.meeting_access_grants
  for each row execute function public.stamp_meeting_grant();

-- OD-MTG-2: "who opened a minute to whom is exactly the thing that needs a trail."
create or replace function public.audit_meeting_grant_insert()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('meeting.grant.create', new.org_id, auth.uid(), new.meeting_id,
                           jsonb_build_object('user_id', new.user_id, 'granted_by', new.granted_by));
  return new;
end; $$;
create or replace function public.audit_meeting_grant_delete()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('meeting.grant.revoke', old.org_id, auth.uid(), old.meeting_id,
                           jsonb_build_object('user_id', old.user_id, 'granted_by', old.granted_by));
  return old;
end; $$;
revoke all on function public.audit_meeting_grant_insert() from public;
revoke all on function public.audit_meeting_grant_delete() from public;
create trigger meeting_access_grants_audit_insert
  after insert on public.meeting_access_grants
  for each row execute function public.audit_meeting_grant_insert();
create trigger meeting_access_grants_audit_delete
  after delete on public.meeting_access_grants
  for each row execute function public.audit_meeting_grant_delete();
