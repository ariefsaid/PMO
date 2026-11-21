-- 1236_person_clearances.sql — #2707: per-person state of each clearance item (date done, optional expiry, short note).
-- No row = not done. Reverse: rollback/1236_person_clearances_down.sql.

create table public.person_clearances (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
               references public.organizations(id) on delete cascade,
  person_id  uuid not null references public.people(id) on delete restrict,
  item_id    uuid not null references public.clearance_items(id) on delete restrict,
  done_on    date not null,
  expires_on date,
  note       text check (note is null or char_length(note) <= 200),
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (person_id, item_id),
  constraint person_clearances_dates check (expires_on is null or expires_on >= done_on)
);
create index person_clearances_item on public.person_clearances (item_id);
create trigger person_clearances_stamp_org_id before insert on public.person_clearances for each row execute function public.stamp_org_id();

-- Same-organisation guard (person and item must belong to the row's org) and audit stamps. SECURITY DEFINER so the check sees
-- the rows whatever the caller may read; the policies still decide who may write (a trigger function, never callable).
create function public.person_clearances_guard() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.people p where p.id = new.person_id and p.org_id = new.org_id)
     or not exists (select 1 from public.clearance_items i where i.id = new.item_id and i.org_id = new.org_id) then
    raise exception 'person or checklist item not found' using errcode = '22023';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke all on function public.person_clearances_guard() from public, anon, authenticated;
create trigger person_clearances_z_guard_trg before insert or update on public.person_clearances
  for each row execute function public.person_clearances_guard();

alter table public.person_clearances enable row level security;
alter table public.person_clearances force row level security;

create policy person_clearances_select on public.person_clearances for select using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin','Project Manager','Finance','Executive'));
create policy person_clearances_insert on public.person_clearances for insert with check (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin','Project Manager'));
create policy person_clearances_update on public.person_clearances for update
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) in ('Admin','Project Manager'))
  with check (org_id = (select public.auth_org_id()));
create policy person_clearances_delete on public.person_clearances for delete using (
  org_id = (select public.auth_org_id()) and (select public.is_active_member())
  and (select public.auth_role()) in ('Admin','Project Manager'));

revoke all on public.person_clearances from public, anon, authenticated;
grant select, delete on public.person_clearances to authenticated;
grant insert (person_id, item_id, done_on, expires_on, note) on public.person_clearances to authenticated;
grant update (done_on, expires_on, note) on public.person_clearances to authenticated;
