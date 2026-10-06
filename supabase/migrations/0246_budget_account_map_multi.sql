-- 0246_budget_account_map_multi.sql — #768: a budget category may map to SEVERAL ERP accounts.
-- Spec: docs/specs/budget-account-map-multi.spec.md (FR-BAM-001..004, NFR-BAM-001/002).
--
-- Supersedes the FIRST half of FR-BUD-111 (0137 §2): `unique (org_id, category)` made the map one account per
-- category. A client whose chart of accounts splits one cost class (salary / allowance / social security)
-- could then compare budget against only one of them. Now:
--   • a category may list many accounts — its ACTUALS sum across all of them (0153 get_budget_projection's
--     join already groups by category; unchanged here);
--   • at most ONE of them is the PUSH account (partial unique index) — the only account the ERP Budget gets;
--   • `unique (org_id, erp_account)` STAYS: an account still backs one category, which is what lets account-
--     grained actuals be attributed without inventing a split (ADR-0048).
-- `default true`: every existing row becomes its category's push account — single-account orgs are byte-for-
-- byte unchanged, and a writer that does not know the flag can still map a category's FIRST account but gets
-- 23505 for a second, so old app code cannot create a multi-account category during a back-to-front deploy.
-- RLS, grants, the org_id default and the stamp trigger are untouched (0137 §4).
--
-- Rollback (ADR-0006) — app first, then, in ONE transaction:
--   lock table public.budget_category_account_map in access exclusive mode;
--   do $$ begin
--     if exists (select 1 from public.budget_category_account_map group by org_id, category having count(*) > 1) then
--       raise exception 'categories with several accounts exist — remove the extra accounts in the app first';
--     end if;
--   end $$;
--   drop function if exists public.set_budget_push_account(uuid);
--   drop index if exists public.budget_category_account_map_one_push_per_category;
--   alter table public.budget_category_account_map
--     add constraint budget_category_account_map_org_id_category_key unique (org_id, category);
--   alter table public.budget_category_account_map drop column is_push_target;
-- Never delete an Admin's mapping row to make the guard pass. A single row with is_push_target = false
-- becomes a push account again after rollback — say so to the Admin before rolling back.

alter table public.budget_category_account_map
  add column is_push_target boolean not null default true;

comment on column public.budget_category_account_map.is_push_target is
  'True for the ONE account per category that receives the pushed ERP Budget amount (#768). Other accounts of the category count toward its actuals only.';

alter table public.budget_category_account_map
  drop constraint budget_category_account_map_org_id_category_key;

create unique index budget_category_account_map_one_push_per_category
  on public.budget_category_account_map (org_id, category)
  where is_push_target;

-- Move a category's push flag to one of its accounts, atomically. SECURITY INVOKER: the table's own RLS
-- (select = active member; write = active Admin of the org, 0137 §4) is the authorization — no definer surface.
create or replace function public.set_budget_push_account(p_map_id uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  v_org      uuid;
  v_category public.budget_category;
begin
  select m.org_id, m.category into v_org, v_category
    from public.budget_category_account_map m
   where m.id = p_map_id;
  if v_org is null then
    raise exception 'budget account mapping not found' using errcode = 'P0002';
  end if;

  -- Serialize concurrent designations for this category. FOR UPDATE applies the write policy, so a
  -- non-Admin locks (and later updates) nothing.
  perform 1 from public.budget_category_account_map m
    where m.org_id = v_org and m.category = v_category
    for update;

  update public.budget_category_account_map
     set is_push_target = false, updated_by = auth.uid(), updated_at = now()
   where org_id = v_org and category = v_category and is_push_target and id <> p_map_id;

  update public.budget_category_account_map
     set is_push_target = true, updated_by = auth.uid(), updated_at = now()
   where id = p_map_id;

  -- #541 class: an RLS-denied UPDATE is a silent 0-row no-op. Say so.
  if not found then
    raise exception 'not authorized to set the budget push account' using errcode = '42501';
  end if;
end;
$$;

revoke all     on function public.set_budget_push_account(uuid) from public;
revoke execute on function public.set_budget_push_account(uuid) from anon;
grant  execute on function public.set_budget_push_account(uuid) to authenticated;
