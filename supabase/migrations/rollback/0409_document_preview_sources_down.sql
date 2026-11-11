-- Rolls back 0409. Rows whose only source is a Microsoft item lose that link when the columns are dropped;
-- existing uploaded bytes and Microsoft files are never touched. Rehearse before first use.

-- §3 guard -> migration 0292's body
create or replace function public.guard_project_m365_source() returns trigger
language plpgsql set search_path=public as $$
declare v_parent_org uuid;
begin
  if tg_op='INSERT' and new.file_path is not null and new.source is null then new.source:='upload'; end if;
  if public.actor_bypasses_rls() then return new; end if;
  if not public.is_active_member() or public.auth_role() not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  select p.org_id into v_parent_org from public.projects p where p.id=new.project_id;
  if v_parent_org is distinct from public.auth_org_id() or new.org_id is distinct from public.auth_org_id() then
    raise exception 'Cannot change this document reference.' using errcode='42501';
  end if;
  if tg_op='INSERT' then
    if new.source='onedrive' and (new.status<>'Draft' or (new.author_id is distinct from auth.uid()
       and public.auth_role()<>'Admin')) then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
    return new;
  end if;
  if old.source='onedrive' and new.file_path is not null then
    raise exception 'Clear the Microsoft reference before uploading.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' and (old.file_path is not null
     or (old.source is not null and old.source is distinct from 'upload')) then
    raise exception 'This entry already has a file or link.' using errcode='23514',detail='m365-source-collision';
  end if;
  if new.source='onedrive' or old.source='onedrive' then
    if old.status<>'Draft' or (old.author_id is distinct from auth.uid() and public.auth_role()<>'Admin') then
      raise exception 'Cannot change this document reference.' using errcode='42501';
    end if;
  end if;
  if old.source is distinct from 'onedrive' then
    if new.file_path is not null and new.source is null then new.source:='upload';
    elsif old.file_path is not null and new.file_path is null and new.source='upload' then new.source:=null;
    end if;
  end if;
  return new;
end; $$;

-- §2/§1 stamp triggers, function, constraints, columns
do $$
declare t text;
begin
  foreach t in array array['procurement_quotation_files','procurement_receipt_files','procurement_invoice_files',
    'purchase_request_files','rfq_files','purchase_order_files','payment_files'] loop
    execute format('drop trigger if exists zz_%1$s_ms_stamp on public.%1$I', t);
    execute format('alter table public.%1$I drop constraint if exists %1$I_source_one', t);
    execute format($f$
      alter table public.%1$I
        drop column if exists ms_linked_at,
        drop column if exists ms_linked_by,
        drop column if exists ms_item_name,
        drop column if exists ms_web_url,
        drop column if exists ms_item_id,
        drop column if exists ms_drive_id,
        drop column if exists source $f$, t);
  end loop;
end $$;
drop function if exists public.stamp_procurement_file_ms_source();
