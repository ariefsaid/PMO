-- 1386_site_checkpoint_record.sql — #2594: recording a checkpoint, its photo bucket, and immutability.
-- Spec: FR-STC-020..023. Proven by supabase/tests/1385_site_timed_checkpoints.test.sql.
--   §1 record_site_checkpoint(checkpoint, photo path, note): the ONLY writer of a recorded time. It takes no time argument: the
--      time and the person are stamped here from now() and auth.uid().
--   §2 a trigger refuses any later change of the recorded columns (OD-STC-5: a mistake is a note on the day, not an edit).
--   §3 private bucket `site-checkpoint-photos`, path <org>/<work order>/<crew>/<date>/<checkpoint>.<ext>.
-- ── REVERSE (also rollback/1386_site_checkpoint_record_down.sql) ───────────────────────────────────────

-- The object must exist in the checkpoint bucket and sit at this checkpoint's own path.
create function public.site_checkpoint_photo_stored(p_path text) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from storage.objects o where o.bucket_id = 'site-checkpoint-photos' and o.name = p_path)
$$;
revoke all on function public.site_checkpoint_photo_stored(text) from public, anon;
grant execute on function public.site_checkpoint_photo_stored(text) to authenticated;

-- A storage path names exactly one existing checkpoint row; the caller's right on it decides.
create function public.site_checkpoint_photo_path_ok(p_name text, p_write boolean) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.is_active_member() and exists (
    select 1 from public.site_checkpoints c
     where c.org_id = public.auth_org_id()
       and p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}\.[A-Za-z0-9]{1,5}$'
       and split_part(p_name, '/', 1) = c.org_id::text
       and split_part(p_name, '/', 2) = c.work_order_id::text
       and split_part(p_name, '/', 3) = c.crew_id::text
       and split_part(p_name, '/', 4) = c.work_date::text
       and split_part(split_part(p_name, '/', 5), '.', 1) = c.id::text
       and case when p_write then c.recorded_at is null and public.site_checkpoint_may_record(c.work_order_id, c.crew_id)
                else public.site_checkpoint_may_read(c.work_order_id, c.crew_id) end), false)
$$;
revoke all on function public.site_checkpoint_photo_path_ok(text, boolean) from public, anon;
grant execute on function public.site_checkpoint_photo_path_ok(text, boolean) to authenticated;

create function public.record_site_checkpoint(p_checkpoint uuid, p_photo_path text default null, p_note text default null)
  returns void
  language plpgsql security definer set search_path = public as $$
declare
  c   public.site_checkpoints;
  v_status text;
  v_today date;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  select * into c from public.site_checkpoints x where x.id = p_checkpoint and x.org_id = public.auth_org_id() for update;
  if not found then raise exception 'checkpoint not found' using errcode = 'P0002'; end if;
  if not public.site_checkpoint_may_record(c.work_order_id, c.crew_id) then
    raise exception 'only the crew''s field controller, an Admin, an Engineer or the project manager can record a checkpoint'
      using errcode = '42501';
  end if;
  if c.recorded_at is not null then
    raise exception 'this checkpoint is already recorded' using errcode = '55000', detail = 'checkpoint-not-recordable';
  end if;
  select w.status::text into v_status from public.work_orders w where w.id = c.work_order_id;
  if v_status is distinct from 'Issued' then
    raise exception 'the work order is not issued' using errcode = '55000', detail = 'work-order-not-issued';
  end if;
  v_today := public.site_checkpoint_today();
  if c.work_date > v_today or c.work_date < v_today - 1 then
    raise exception 'a checkpoint is recorded for today or yesterday only' using errcode = '55000', detail = 'checkpoint-not-recordable';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'the note is at most 500 characters' using errcode = '23514', detail = 'checkpoint-note-long';
  end if;
  if p_photo_path is not null and not (
       public.site_checkpoint_photo_stored(p_photo_path)
       and split_part(p_photo_path, '/', 1) = c.org_id::text and split_part(p_photo_path, '/', 2) = c.work_order_id::text
       and split_part(p_photo_path, '/', 3) = c.crew_id::text and split_part(p_photo_path, '/', 4) = c.work_date::text
       and split_part(split_part(p_photo_path, '/', 5), '.', 1) = c.id::text) then
    raise exception 'the photo is not stored at this checkpoint''s path' using errcode = '23514', detail = 'checkpoint-photo-missing';
  end if;
  if c.photo_required and p_photo_path is null then
    raise exception 'this checkpoint needs a photo' using errcode = '23514', detail = 'checkpoint-photo-missing';
  end if;

  update public.site_checkpoints set recorded_at = now(), recorded_by = auth.uid(), photo_path = p_photo_path, note = v_note
   where id = c.id;
  perform public.log_audit('site_checkpoint.recorded', c.org_id, auth.uid(), c.id,
    jsonb_build_object('work_order_id', c.work_order_id, 'crew_id', c.crew_id, 'work_date', c.work_date, 'position', c.position));
end; $$;
revoke all on function public.record_site_checkpoint(uuid, text, text) from public, anon;
grant execute on function public.record_site_checkpoint(uuid, text, text) to authenticated;

-- §2 OD-STC-5: a recorded checkpoint never changes (defence in depth under the missing client write grant).
create function public.site_checkpoints_keep_record() returns trigger
  language plpgsql set search_path = public as $$
begin
  if old.recorded_at is not null
     and (new.recorded_at is distinct from old.recorded_at or new.recorded_by is distinct from old.recorded_by
          or new.photo_path is distinct from old.photo_path or new.note is distinct from old.note) then
    raise exception 'a recorded checkpoint does not change' using errcode = '55000', detail = 'checkpoint-not-recordable';
  end if;
  return new;
end; $$;
create trigger site_checkpoints_keep_record before update on public.site_checkpoints
  for each row execute function public.site_checkpoints_keep_record();

-- §3 the private photo bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('site-checkpoint-photos', 'site-checkpoint-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'image/heic'])
  on conflict (id) do nothing;

create policy storage_objects_site_checkpoint_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'site-checkpoint-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and public.site_checkpoint_photo_path_ok(name, false));
create policy storage_objects_site_checkpoint_photo_write on storage.objects for insert to authenticated
  with check (bucket_id = 'site-checkpoint-photos' and (select auth.uid()) is not null
         and split_part(name, '/', 1) = (select public.auth_org_id())::text
         and public.site_checkpoint_photo_path_ok(name, true));
