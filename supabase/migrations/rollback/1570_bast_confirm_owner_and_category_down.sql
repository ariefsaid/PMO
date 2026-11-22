-- Reverse of 1570: restore the 1164 eight-name set; the added category stays on documents that use it (archived, not deleted).
drop function if exists public.acceptances_awaiting_my_confirmation();
update public.document_categories set archived_at = now() where lower(name) = 'delivery record' and is_system and archived_at is null;
create or replace function public.seed_document_categories(p_org uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_names text[] := array['Drawing', 'Specification', 'Report', 'Transmittal', 'Submittal', 'Certificate', 'Other', 'Reference'];
  v_i int;
  v_id uuid;
begin
  for v_i in 1 .. array_length(v_names, 1) loop
    select id into v_id from public.document_categories
      where org_id = p_org and lower(name) = lower(v_names[v_i]) and archived_at is null;
    if v_id is null then
      insert into public.document_categories (org_id, name, sort_order, is_system)
        values (p_org, v_names[v_i], v_i * 10, true) returning id into v_id;
    end if;
    insert into public.document_category_roles (category_id, org_id, role)
      select v_id, p_org, r from unnest(enum_range(null::public.user_role)) r
      on conflict do nothing;
  end loop;
end $$;
revoke all on function public.seed_document_categories(uuid) from public, anon, authenticated;
