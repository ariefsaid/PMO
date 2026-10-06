-- Reverses 0246 (#768). Roll the app back first. Guarded: refuses while any category holds more than one
-- account, because restoring unique (org_id, category) must never delete an Admin's mapping.
-- A single row with is_push_target = false becomes a push account again after rollback.
begin;
lock table public.budget_category_account_map in access exclusive mode;
do $$ begin
  if exists (select 1 from public.budget_category_account_map group by org_id, category having count(*) > 1) then
    raise exception 'categories with several accounts exist — remove the extra accounts in the app first';
  end if;
end $$;
drop function if exists public.set_budget_push_account(uuid);
drop index if exists public.budget_category_account_map_one_push_per_category;
alter table public.budget_category_account_map
  add constraint budget_category_account_map_org_id_category_key unique (org_id, category);
alter table public.budget_category_account_map drop column is_push_target;
commit;
