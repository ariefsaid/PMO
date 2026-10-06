-- 0249_comments.sql — #790 comments on projects and tasks (AC-CMT-001..003).
-- One polymorphic table: a comment hangs off a project or a task (entity_type + entity_id, no FK — the INSERT
-- policy proves the parent exists and is readable by the caller). Plain text, no edit in v1, soft delete by the
-- author only (archived_at). Mentions are a uuid[] the client sends; the AFTER INSERT trigger notifies each
-- mentioned user through notify_workflow_user (0237), which already refuses another org's user, a disabled or
-- banned member, and the acting user.
-- Reversible via supabase/migrations/rollback/0249_comments_down.sql.

create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  entity_type text not null,
  entity_id   uuid not null,
  author_id   uuid not null references public.profiles(id) default auth.uid(),
  body        text not null,
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  constraint comments_entity_type_check check (entity_type in ('project', 'task')),
  constraint comments_body_len check (char_length(btrim(body)) between 1 and 4000),
  constraint comments_mentions_cap check (cardinality(mentions) <= 20)
);
create index comments_entity_idx on public.comments (org_id, entity_type, entity_id, created_at);
create index comments_author_idx on public.comments (author_id);

comment on table public.comments is
  '#790: plain-text comments on a project or task. Readable by whoever can read the parent; insert as yourself; '
  'only the author may soft-delete (archived_at). No edit in v1.';

-- 0074 idiom: the caller's real org overrides the seed-org default. No client sends org_id.
create trigger comments_stamp_org_id
  before insert on public.comments
  for each row execute function public.stamp_org_id();

-- The parent is readable by the caller. INVOKER: the projects / tasks read is the caller's own RLS
-- (projects_select / tasks_select = org_id = auth_org_id() and is_active_member()), so a parent in another
-- org — or one that does not exist — is simply not found. Reused, not re-derived.
create or replace function public.can_read_comment_parent(p_type text, p_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select case p_type
    when 'project' then exists (select 1 from public.projects p where p.id = p_id)
    when 'task'    then exists (select 1 from public.tasks t where t.id = p_id)
    else false end
$$;
revoke all     on function public.can_read_comment_parent(text, uuid) from public, anon;
grant  execute on function public.can_read_comment_parent(text, uuid) to authenticated;

alter table public.comments enable row level security;
alter table public.comments force row level security;

create policy comments_select on public.comments for select
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.can_read_comment_parent(entity_type, entity_id));
create policy comments_insert on public.comments for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
              and author_id = auth.uid()
              and public.can_read_comment_parent(entity_type, entity_id));
-- Soft delete only: the author archives a live comment of theirs. The grant below limits the update to archived_at.
create policy comments_update on public.comments for update
  using (org_id = public.auth_org_id() and public.is_active_member()
         and author_id = auth.uid() and archived_at is null)
  with check (author_id = auth.uid() and archived_at is not null);
-- No DELETE policy and no DELETE grant.

revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;
grant insert (entity_type, entity_id, author_id, body, mentions) on public.comments to authenticated;
grant update (archived_at) on public.comments to authenticated;

-- ── mention notifications ────────────────────────────────────────────────────────────────────────
create or replace function public.notify_comment_mentions() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_label text; v_user uuid;
begin
  if cardinality(new.mentions) = 0 then return new; end if;
  if new.entity_type = 'project' then
    select p.name into v_label from public.projects p where p.id = new.entity_id and p.org_id = new.org_id;
  else
    select t.name into v_label from public.tasks t where t.id = new.entity_id and t.org_id = new.org_id;
  end if;
  if v_label is null then return new; end if;
  for v_user in select distinct m from unnest(new.mentions) m loop
    -- notify_workflow_user refuses: another org's user, a non-active member, the author. Readers of the
    -- parent are exactly the active members of its org (projects_select / tasks_select), so that is the gate.
    perform public.notify_workflow_user(new.org_id, v_user, 'You were mentioned in a comment',
      left(new.body, 200), 'info', new.entity_type, new.entity_id, v_label);
  end loop;
  return new;
end; $$;
revoke execute on function public.notify_comment_mentions() from public, anon, authenticated;
create trigger comments_notify_mentions_trg
  after insert on public.comments
  for each row execute function public.notify_comment_mentions();
