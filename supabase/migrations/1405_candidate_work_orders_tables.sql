-- 1405_candidate_work_orders_tables.sql — #2595: candidate work orders with an assessment checklist.
-- Spec docs/specs/candidate-work-orders.spec.md (FR-CWO-001..018); plan docs/plans/2026-11-21-candidate-work-orders.md.
-- Proven by supabase/tests/work_order_candidates.test.sql. Rollback: supabase/migrations/rollback/1405_candidate_work_orders_tables_down.sql.
--
-- A candidate is its own table (OD-CWO-1): `work_orders` and its status enum are untouched. Accepting a candidate
-- creates an ordinary Draft work order (1407). The organisation's assessment items are DATA: no item text is
-- coded here or seeded by any migration (OD-SCOPE-2).
-- This migration: the four tables, their guards, RLS and column grants, and the audit trail (FR-CWO-018).
-- Candidates are created and decided only through the RPCs of 1406 and 1407: no client INSERT grant on candidates and
-- no client UPDATE grant on status or any decision column.

-- ── §1 the organisation's checklist template ──────────────────────────────────────────────────────────────
create table public.work_order_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 200),
  position    integer not null default 0,
  required    boolean not null default true,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index work_order_checklist_items_org_idx on public.work_order_checklist_items (org_id, position) where archived_at is null;
create trigger work_order_checklist_items_stamp_org_id before insert on public.work_order_checklist_items
  for each row execute function public.stamp_org_id();

-- ── §2 candidates ─────────────────────────────────────────────────────────────────────────────────────────
create table public.work_order_candidates (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                    references public.organizations(id) on delete cascade,
  project_id      uuid not null references public.projects(id),
  title           text not null check (char_length(btrim(title)) between 1 and 200),
  description     text check (description is null or char_length(description) <= 2000),
  client_reference text check (client_reference is null or char_length(client_reference) <= 200),
  offered_on      date not null,
  status          text not null default 'assessing' check (status in ('assessing', 'accepted', 'rejected')),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) between 1 and 500),
  work_order_id   uuid unique references public.work_orders(id),
  replaces_id     uuid references public.work_order_candidates(id),
  created_by      uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  -- decision columns move with the status, all or none (FR-CWO-009)
  constraint work_order_candidates_decision_shape check (
    (status = 'assessing' and decided_by is null and decided_at is null and decision_reason is null and work_order_id is null)
    or (status = 'accepted' and decided_by is not null and decided_at is not null and decision_reason is not null and work_order_id is not null)
    or (status = 'rejected' and decided_by is not null and decided_at is not null and decision_reason is not null and work_order_id is null))
);
create index work_order_candidates_project_idx on public.work_order_candidates (org_id, project_id, created_at desc);
create index work_order_candidates_replaces_idx on public.work_order_candidates (replaces_id) where replaces_id is not null;
create index work_order_candidates_decided_by_idx on public.work_order_candidates (decided_by);
create trigger work_order_candidates_stamp_org_id before insert on public.work_order_candidates
  for each row execute function public.stamp_org_id();

-- ── §3 the candidate's own copy of the checklist (FR-CWO-002) ─────────────────────────────────────────────
create table public.work_order_candidate_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  candidate_id uuid not null references public.work_order_candidates(id) on delete cascade,
  template_item_id uuid references public.work_order_checklist_items(id),
  label       text not null check (char_length(btrim(label)) between 1 and 200),
  position    integer not null default 0,
  required    boolean not null default true,
  owner_id    uuid references public.profiles(id),
  target_date date,
  status      text not null default 'open' check (status in ('open', 'passed', 'failed', 'not_applicable')),
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index work_order_candidate_items_candidate_idx on public.work_order_candidate_items (candidate_id, position);
create index work_order_candidate_items_owner_idx on public.work_order_candidate_items (owner_id) where owner_id is not null;
create trigger work_order_candidate_items_stamp_org_id before insert on public.work_order_candidate_items
  for each row execute function public.stamp_org_id();

-- ── §4 proof files, one row per file (FR-CWO-005) ─────────────────────────────────────────────────────────
create table public.work_order_candidate_proofs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default coalesce(public.auth_org_id(), '00000000-0000-0000-0000-000000000001')
                references public.organizations(id) on delete cascade,
  item_id     uuid not null references public.work_order_candidate_items(id) on delete cascade,
  file_path   text not null,
  file_name   text check (file_name is null or char_length(file_name) <= 255),
  uploaded_by uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create index work_order_candidate_proofs_item_idx on public.work_order_candidate_proofs (item_id) where archived_at is null;
create trigger work_order_candidate_proofs_stamp_org_id before insert on public.work_order_candidate_proofs
  for each row execute function public.stamp_org_id();

-- ── §5 guards that bind every writer (not only the client roles) ──────────────────────────────────────────
-- Items: the candidate must be on the row's own org and still assessing (FR-CWO-006); a not-applicable item needs a
-- note; the owner is a member of the same org; position is appended on insert; identity columns never move.
create function public.check_work_order_candidate_item() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_status text; v_owner_org uuid;
begin
  select c.org_id, c.status into v_org, v_status from public.work_order_candidates c where c.id = new.candidate_id;
  if v_org is distinct from new.org_id then
    raise exception 'CWO_ITEM_CANDIDATE: the candidate is not in this organisation' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.candidate_id is distinct from old.candidate_id or new.org_id is distinct from old.org_id
                           or new.template_item_id is distinct from old.template_item_id) then
    raise exception 'CWO_ITEM_KEY: an assessment item keeps its candidate and template source' using errcode = '23514';
  end if;
  if v_status is distinct from 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate''s assessment is read-only' using errcode = '23514';
  end if;
  if new.status = 'not_applicable' and (new.note is null or btrim(new.note) = '') then
    raise exception 'CWO_NA_NOTE: marking an item not applicable needs a note' using errcode = '23514';
  end if;
  if new.owner_id is not null then
    select p.org_id into v_owner_org from public.profiles p where p.id = new.owner_id;
    if v_owner_org is distinct from new.org_id then
      raise exception 'CWO_ITEM_OWNER: the owner must be a member of this organisation' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' and new.position = 0 then
    select coalesce(max(i.position), 0) + 1 into new.position from public.work_order_candidate_items i where i.candidate_id = new.candidate_id;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
revoke all on function public.check_work_order_candidate_item() from public, anon, authenticated;
create trigger zz_work_order_candidate_items_check before insert or update on public.work_order_candidate_items
  for each row execute function public.check_work_order_candidate_item();

-- Proofs: the item's candidate is on the row's org and still assessing; the file sits under {org}/{candidate}/{proof}/.
create function public.check_work_order_candidate_proof() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_candidate uuid; v_status text;
begin
  select i.org_id, i.candidate_id, c.status into v_org, v_candidate, v_status
    from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
   where i.id = new.item_id;
  if v_org is distinct from new.org_id then
    raise exception 'CWO_PROOF_ITEM: the item is not in this organisation' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.item_id is distinct from old.item_id or new.file_path is distinct from old.file_path or new.org_id is distinct from old.org_id) then
    raise exception 'CWO_PROOF_KEY: a proof keeps its item and file' using errcode = '23514';
  end if;
  if v_status is distinct from 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate''s assessment is read-only' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and (array_length(string_to_array(new.file_path, '/'), 1) is distinct from 4
       or split_part(new.file_path, '/', 1) <> new.org_id::text or split_part(new.file_path, '/', 2) <> v_candidate::text
       or split_part(new.file_path, '/', 3) <> new.id::text) then
    raise exception 'CWO_PROOF_PATH: the file must be stored under {organisation}/{candidate}/{proof}/{name}' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.check_work_order_candidate_proof() from public, anon, authenticated;
create trigger zz_work_order_candidate_proofs_check before insert or update on public.work_order_candidate_proofs
  for each row execute function public.check_work_order_candidate_proof();

-- Candidate body edits happen only while assessing; the decision columns have no client grant (below) and this guard
-- refuses a body edit after the decision for every writer. The RPCs of 1406/1407 write status through update of status.
create function public.check_work_order_candidate_update() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id or new.org_id is distinct from old.org_id or new.project_id is distinct from old.project_id
     or new.created_at is distinct from old.created_at or new.replaces_id is distinct from old.replaces_id then
    raise exception 'CWO_KEY: a candidate keeps its identity, organisation, project and replaced candidate' using errcode = '42501';
  end if;
  if old.status <> 'assessing' then
    raise exception 'CWO_DECIDED: a decided candidate is never reopened or edited' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.check_work_order_candidate_update() from public, anon, authenticated;
create trigger zz_work_order_candidates_check before update on public.work_order_candidates
  for each row execute function public.check_work_order_candidate_update();

-- ── §6 audit trail (FR-CWO-018): who and when, for every create, item change, proof and decision ──────────
create function public.audit_work_order_candidate_row() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pick text[];
  v_before jsonb; v_after jsonb;
  v_entity uuid := new.id;
begin
  v_pick := case tg_table_name
    when 'work_order_candidates' then array['project_id', 'title', 'description', 'client_reference', 'offered_on', 'status', 'decided_by', 'decision_reason', 'work_order_id', 'replaces_id']
    when 'work_order_candidate_items' then array['candidate_id', 'label', 'required', 'owner_id', 'target_date', 'status', 'note']
    when 'work_order_candidate_proofs' then array['item_id', 'file_name', 'archived_at']
    else array['label', 'position', 'required', 'archived_at'] end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, to_jsonb(old) -> k) into v_before from unnest(v_pick) k;
  end if;
  select jsonb_object_agg(k, to_jsonb(new) -> k) into v_after from unnest(v_pick) k;
  if tg_op = 'UPDATE' and v_after = v_before then return null; end if;
  perform public.log_audit(
    case tg_table_name when 'work_order_candidates' then 'work_order_candidate.'
                       when 'work_order_candidate_items' then 'work_order_candidate_item.'
                       when 'work_order_candidate_proofs' then 'work_order_candidate_proof.'
                       else 'work_order_checklist_item.' end || lower(tg_op),
    new.org_id, auth.uid(), v_entity, jsonb_build_object('before', v_before, 'after', v_after));
  return null;
end $$;
revoke all on function public.audit_work_order_candidate_row() from public, anon, authenticated;
create trigger zz_work_order_candidates_audit after insert or update on public.work_order_candidates
  for each row execute function public.audit_work_order_candidate_row();
create trigger zz_work_order_candidate_items_audit after insert or update on public.work_order_candidate_items
  for each row execute function public.audit_work_order_candidate_row();
create trigger zz_work_order_candidate_proofs_audit after insert or update on public.work_order_candidate_proofs
  for each row execute function public.audit_work_order_candidate_row();
create trigger zz_work_order_checklist_items_audit after insert or update on public.work_order_checklist_items
  for each row execute function public.audit_work_order_candidate_row();

-- ── §7 who may assess a candidate: Admin, Engineer, or the project's Project Manager (FR-CWO-003) ─────────
-- Invoker: it reads the candidate and project under the caller's own RLS, so it can never widen a read.
create function public.wo_candidate_can_assess(p_candidate uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.work_order_candidates c join public.projects p on p.id = c.project_id
     where c.id = p_candidate and c.status = 'assessing'
       and c.org_id = (select public.auth_org_id()) and (select public.is_active_member())
       and ((select public.auth_role()) in ('Admin', 'Engineer') or p.project_manager_id = (select auth.uid())))
$$;
revoke all on function public.wo_candidate_can_assess(uuid) from public, anon;
grant execute on function public.wo_candidate_can_assess(uuid) to authenticated;

-- An item's owner may also work their own item while the candidate is assessing.
create function public.wo_candidate_item_can_edit(p_item uuid) returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.work_order_candidate_items i join public.work_order_candidates c on c.id = i.candidate_id
     where i.id = p_item and c.status = 'assessing' and i.org_id = (select public.auth_org_id())
       and (select public.is_active_member())
       and (public.wo_candidate_can_assess(i.candidate_id) or i.owner_id = (select auth.uid())))
$$;
revoke all on function public.wo_candidate_item_can_edit(uuid) from public, anon;
grant execute on function public.wo_candidate_item_can_edit(uuid) to authenticated;

-- ── §8 RLS and grants ─────────────────────────────────────────────────────────────────────────────────────
alter table public.work_order_checklist_items enable row level security;
alter table public.work_order_checklist_items force row level security;
alter table public.work_order_candidates enable row level security;
alter table public.work_order_candidates force row level security;
alter table public.work_order_candidate_items enable row level security;
alter table public.work_order_candidate_items force row level security;
alter table public.work_order_candidate_proofs enable row level security;
alter table public.work_order_candidate_proofs force row level security;

-- Reads follow the work-order readers (work_orders_select): active members of the org.
create policy work_order_checklist_items_select on public.work_order_checklist_items for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_candidates_select on public.work_order_candidates for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_candidate_items_select on public.work_order_candidate_items for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy work_order_candidate_proofs_select on public.work_order_candidate_proofs for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

-- Body edit of a candidate while assessing: the assessors. Status and the decision columns are not granted.
create policy work_order_candidates_update on public.work_order_candidates for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_can_assess(id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy work_order_candidate_items_insert on public.work_order_candidate_items for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.wo_candidate_can_assess(candidate_id));
create policy work_order_candidate_items_update on public.work_order_candidate_items for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_item_can_edit(id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

create policy work_order_candidate_proofs_insert on public.work_order_candidate_proofs for insert
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member())
              and public.wo_candidate_item_can_edit(item_id));
create policy work_order_candidate_proofs_update on public.work_order_candidate_proofs for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.wo_candidate_item_can_edit(item_id))
  with check (org_id = (select public.auth_org_id()) and (select public.is_active_member()));

revoke all on public.work_order_checklist_items, public.work_order_candidates,
              public.work_order_candidate_items, public.work_order_candidate_proofs from public, anon, authenticated;
grant select on public.work_order_checklist_items, public.work_order_candidates,
                public.work_order_candidate_items, public.work_order_candidate_proofs to authenticated;
grant update (title, description, client_reference, offered_on) on public.work_order_candidates to authenticated;
grant insert (candidate_id, label, required, owner_id, target_date, note) on public.work_order_candidate_items to authenticated;
grant update (status, note, owner_id, target_date) on public.work_order_candidate_items to authenticated;
grant insert (id, item_id, file_path, file_name) on public.work_order_candidate_proofs to authenticated;
grant update (archived_at) on public.work_order_candidate_proofs to authenticated;
grant all on public.work_order_checklist_items, public.work_order_candidates,
             public.work_order_candidate_items, public.work_order_candidate_proofs to service_role;
