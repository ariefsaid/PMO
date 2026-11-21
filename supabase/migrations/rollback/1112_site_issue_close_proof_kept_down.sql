-- Restores the 1027 body of guard_incident_file().
create or replace function public.guard_incident_file() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid; v_object_id uuid;
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'archived_at') is distinct from (to_jsonb(old) - 'archived_at') then
      raise exception 'only archiving evidence is allowed' using errcode = '42501';
    end if;
    if old.archived_at is not null and new.archived_at is null then
      perform 1 from public.incident_reports i where i.id = new.incident_id for update;
      if (select count(*) from public.incident_files f where f.incident_id = new.incident_id
            and f.kind = new.kind and f.archived_at is null) >= (case when new.kind = 'at_close' then 5 else 10 end) then
        if new.kind = 'at_close' then
          raise exception 'an issue holds at most 5 close attachments' using errcode = '23514';
        else
          raise exception 'an issue holds at most 10 raise attachments' using errcode = '23514';
        end if;
      end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'incident-files' and o.name = new.file_path) then
        raise exception 'evidence object is missing or invalid' using errcode = '23514';
      end if;
    end if;
    return new;
  end if;
  select i.org_id into v_org from public.incident_reports i where i.id = new.incident_id for update;
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then new.org_id := v_org; end if;
  if new.org_id is distinct from v_org then raise exception 'issue not in this org' using errcode = '42501'; end if;
  if auth.uid() is not null then
    if v_org is distinct from public.auth_org_id() then
      raise exception 'issue not in this org' using errcode = '42501';
    end if;
    new.uploaded_by_id := auth.uid();
    if new.file_path not like (new.org_id::text || '/' || new.incident_id::text || '/' || new.id::text || '/%') then
      raise exception 'evidence object is missing or invalid' using errcode = '23514';
    end if;
  end if;
  select o.id into v_object_id from storage.objects o
   where o.bucket_id = 'incident-files' and o.name = new.file_path
   order by o.created_at desc, o.id limit 1;
  if v_object_id is null then
    raise exception 'evidence object is missing or invalid' using errcode = '23514';
  end if;
  new.storage_object_id := v_object_id;
  if new.archived_at is null and (select count(*) from public.incident_files f
        where f.incident_id = new.incident_id and f.kind = new.kind and f.archived_at is null)
        >= (case when new.kind = 'at_close' then 5 else 10 end) then
    if new.kind = 'at_close' then
      raise exception 'an issue holds at most 5 close attachments' using errcode = '23514';
    else
      raise exception 'an issue holds at most 10 raise attachments' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
