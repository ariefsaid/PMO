-- 1307_stock_handover_confirmations.sql — #2690 (spec docs/specs/stock-two-step-transfer.spec.md FR-TST-040..044).
-- Proven by supabase/tests/1307_stock_handover_confirmations.test.sql.
--   §1 stock_handover_confirmations: name, time, counted quantities, photo of the goods and of the signer (or one photo of signed paper).
--      Written only by the transfer RPCs; immutable; read by whoever reads the transfer.
--   §2 the private bucket stock-handover, path {org}/{transfer}/{confirmation}/{filename} (the 1030 stock-documents pattern).
-- ── REVERSE (rollback/1307_stock_handover_confirmations_down.sql): drop the policies, helpers, bucket row and table.

-- §1 ---------------------------------------------------------------------------------------------------
create table public.stock_handover_confirmations (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id),
  transfer_id        uuid not null references public.stock_transfers(id),
  stage              text not null check (stage in ('send', 'receive')),
  proof_type         text not null check (proof_type in ('in_app', 'paper')),
  signer_kind        text not null check (signer_kind in ('account', 'guest')),
  signer_name        text not null check (length(btrim(signer_name)) between 1 and 120),
  signer_user_id     uuid references public.profiles(id),
  recorded_by        uuid not null references public.profiles(id),          -- the logged-in person (the host, for a guest)
  confirmed_at       timestamptz not null default now(),
  counts             jsonb not null check (jsonb_typeof(counts) = 'array'),  -- copied by the server from the transfer lines
  goods_photo_path   text check (goods_photo_path is null or length(goods_photo_path) between 1 and 500),
  signer_photo_path  text check (signer_photo_path is null or length(signer_photo_path) between 1 and 500),
  paper_photo_path   text check (paper_photo_path is null or length(paper_photo_path) between 1 and 500),
  constraint stock_handover_shape check (
       (proof_type = 'in_app' and goods_photo_path is not null and signer_photo_path is not null and paper_photo_path is null)
    or (proof_type = 'paper'  and paper_photo_path is not null and goods_photo_path is null and signer_photo_path is null)),
  constraint stock_handover_signer_shape check ((signer_kind = 'account') = (signer_user_id is not null)),
  constraint stock_handover_guest_name check (signer_kind = 'account' or length(btrim(signer_name)) >= 2)      -- mut:guest_name
);
create index stock_handover_transfer_idx on public.stock_handover_confirmations (transfer_id, confirmed_at);

alter table public.stock_handover_confirmations enable row level security;
alter table public.stock_handover_confirmations force row level security;
create policy stock_handover_select on public.stock_handover_confirmations for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.stock_handover_confirmations from authenticated, anon;
revoke insert, update, delete, truncate, trigger, references on public.stock_handover_confirmations from service_role;
grant select on public.stock_handover_confirmations to authenticated;

create or replace function public.guard_stock_handover_immutable() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'STK_IMMUTABLE: a handover confirmation never changes' using errcode = 'P0001';        -- mut:confirm_immutable
end $$;
revoke all on function public.guard_stock_handover_immutable() from public, anon, authenticated;
create trigger stock_handover_immutable before update or delete on public.stock_handover_confirmations
  for each row execute function public.guard_stock_handover_immutable();

-- Each photo must be an uploaded object of this confirmation: {org}/{transfer}/{confirmation}/{file}.
create or replace function public.guard_stock_handover_object() returns trigger
  language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare p text;
begin
  foreach p in array array[new.goods_photo_path, new.signer_photo_path, new.paper_photo_path] loop
    if p is not null and (split_part(p, '/', 1) is distinct from new.org_id::text
        or split_part(p, '/', 2) is distinct from new.transfer_id::text
        or split_part(p, '/', 3) is distinct from new.id::text
        or array_length(string_to_array(p, '/'), 1) is distinct from 4
        or split_part(p, '/', 4) = ''
        or not exists (select 1 from storage.objects o where o.bucket_id = 'stock-handover' and o.name = p)) then
      raise exception 'STK_FILE_MISSING: upload the photo before confirming the handover' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_stock_handover_object() from public, anon, authenticated;
create trigger stock_handover_zz_object before insert on public.stock_handover_confirmations
  for each row execute function public.guard_stock_handover_object();

-- §2 ---------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('stock-handover', 'stock-handover', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

-- Who may add a photo to a transfer's handover: the sender, a keeper of either end, the named receiver, or an Admin.
create or replace function public.stock_can_handover(p_transfer text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.stock_transfers t
     where t.id::text = p_transfer and t.org_id = public.auth_org_id() and t.status <> 'Cancelled'
       and (t.sent_by = auth.uid() or t.to_user_id = auth.uid()
            or coalesce(public.role_rank(public.auth_role()) >= 50, false)
            or exists (select 1 from public.stock_warehouse_keepers k
                        where k.org_id = t.org_id and k.user_id = auth.uid() and k.warehouse_id in (t.from_warehouse_id, t.to_warehouse_id)))) $$;
create or replace function public.stock_handover_readable(p_transfer text) returns boolean
  language sql stable security definer set search_path = public as $$
  select public.is_active_member() and exists (
    select 1 from public.stock_transfers t where t.id::text = p_transfer and t.org_id = public.auth_org_id()) $$;
revoke all on function public.stock_can_handover(text), public.stock_handover_readable(text) from public, anon;
grant execute on function public.stock_can_handover(text), public.stock_handover_readable(text) to authenticated;

create policy storage_stock_handover_read on storage.objects for select to authenticated
  using (bucket_id = 'stock-handover' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.stock_handover_readable(split_part(name, '/', 2)));
create policy storage_stock_handover_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'stock-handover' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and array_length(string_to_array(name, '/'), 1) = 4
         and public.stock_can_handover(split_part(name, '/', 2)));
-- No update or delete policy: a handover photo is never changed or removed by a client.
