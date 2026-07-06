-- 0060_agent_attachments.sql — per-conversation agent attachments (ADR-0053, Tier-2 I4).
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual rollback:
--   drop policy if exists storage_objects_agent_attachments_write on storage.objects;
--   drop policy if exists storage_objects_agent_attachments_read on storage.objects;
--   delete from storage.buckets where id = 'agent-attachments';
--   drop policy if exists agent_attachments_update on agent_attachments;
--   drop policy if exists agent_attachments_insert on agent_attachments;
--   drop policy if exists agent_attachments_select on agent_attachments;
--   drop trigger if exists agent_attachments_stamp_thread_scope on agent_attachments;
--   drop function if exists stamp_agent_attachment_thread_scope();
--   drop table if exists agent_attachments;

create table agent_attachments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  owner_id              uuid not null references profiles(id) default auth.uid(),
  thread_id             uuid not null references agent_threads(id) on delete cascade,
  storage_path          text,
  mime_type             text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  size_bytes            integer not null check (size_bytes > 0 and size_bytes <= 8388608),
  original_filename     text not null check (length(trim(original_filename)) > 0),
  extracted_text_status text not null default 'pending'
                          check (extracted_text_status in ('pending','ready','failed','skipped')),
  extracted_text        text,
  extracted_text_chars  integer check (extracted_text_chars is null or extracted_text_chars >= 0),
  created_at            timestamptz not null default now(),
  archived_at           timestamptz
);

create index agent_attachments_owner_created_idx on agent_attachments (owner_id, created_at desc);
create index agent_attachments_thread_idx on agent_attachments (thread_id);
create index agent_attachments_org_idx on agent_attachments (org_id);

-- Inherit org/owner/path from the parent thread when the client leaves the row at defaults.
-- Explicit spoofed org_id/owner_id/storage_path values are preserved so the WITH CHECK policy
-- rejects them instead of silently rewriting them.
create or replace function stamp_agent_attachment_thread_scope()
  returns trigger language plpgsql set search_path = public as $$
declare
  v_org uuid;
  v_owner uuid;
begin
  select t.org_id, t.owner_id into v_org, v_owner
    from public.agent_threads t
   where t.id = new.thread_id;

  if new.org_id is null
     or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    new.org_id := v_org;
  end if;

  if new.owner_id is null or new.owner_id = auth.uid() then
    new.owner_id := v_owner;
  end if;

  if new.storage_path is null then
    new.storage_path := 'org/' || new.org_id::text || '/agent-attachments/' || new.id::text;
  end if;

  return new;
end; $$;

create trigger agent_attachments_stamp_thread_scope
  before insert on agent_attachments
  for each row execute function stamp_agent_attachment_thread_scope();

alter table agent_attachments enable row level security;
alter table agent_attachments force row level security;

create policy agent_attachments_select on agent_attachments for select
  using (owner_id = auth.uid() and org_id = auth_org_id());

create policy agent_attachments_insert on agent_attachments for insert
  with check (
    owner_id = auth.uid()
    and org_id = auth_org_id()
    and storage_path = 'org/' || auth_org_id()::text || '/agent-attachments/' || id::text
    and exists (
      select 1 from agent_threads t
       where t.id = agent_attachments.thread_id
         and t.owner_id = auth.uid()
         and t.org_id = auth_org_id()
    )
  );

create policy agent_attachments_update on agent_attachments for update
  using (owner_id = auth.uid() and org_id = auth_org_id())
  with check (
    owner_id = auth.uid()
    and org_id = auth_org_id()
    and storage_path = 'org/' || auth_org_id()::text || '/agent-attachments/' || id::text
  );

alter table agent_attachments
  alter column storage_path set not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'agent-attachments',
    'agent-attachments',
    false,
    8388608,
    array['application/pdf','image/png','image/jpeg','image/webp']
  ) on conflict (id) do nothing;

-- Path pattern: org/{org_id}/agent-attachments/{attachment_id}
create policy storage_objects_agent_attachments_read on storage.objects
  for select
  using (
    bucket_id = 'agent-attachments'
    and auth.uid() is not null
    and split_part(name, '/', 1) = 'org'
    and split_part(name, '/', 2) = auth_org_id()::text
    and split_part(name, '/', 3) = 'agent-attachments'
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (
      select 1 from public.agent_attachments aa
       where aa.id::text = split_part(name, '/', 4)
         and aa.owner_id = auth.uid()
         and aa.org_id = auth_org_id()
         and aa.storage_path = name
    )
  );

create policy storage_objects_agent_attachments_write on storage.objects
  for all
  using (
    bucket_id = 'agent-attachments'
    and auth.uid() is not null
    and split_part(name, '/', 1) = 'org'
    and split_part(name, '/', 2) = auth_org_id()::text
    and split_part(name, '/', 3) = 'agent-attachments'
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (
      select 1 from public.agent_attachments aa
       where aa.id::text = split_part(name, '/', 4)
         and aa.owner_id = auth.uid()
         and aa.org_id = auth_org_id()
         and aa.storage_path = name
    )
  )
  with check (
    bucket_id = 'agent-attachments'
    and auth.uid() is not null
    and split_part(name, '/', 1) = 'org'
    and split_part(name, '/', 2) = auth_org_id()::text
    and split_part(name, '/', 3) = 'agent-attachments'
    and array_length(string_to_array(name, '/'), 1) = 4
    and exists (
      select 1 from public.agent_attachments aa
       where aa.id::text = split_part(name, '/', 4)
         and aa.owner_id = auth.uid()
         and aa.org_id = auth_org_id()
         and aa.storage_path = name
    )
  );
