-- 0330 — keep organization cascades from recreating dirty-date children.
-- The semantic dirty-date trigger otherwise preserves its 0321 behavior unchanged.
create or replace function public.track_erp_statement_dirty_date()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_key bigint;
  v_new_key bigint;
  v_first_key bigint;
  v_second_key bigint;
  v_old_valid boolean := false;
  v_new_valid boolean := false;
  v_changed boolean := false;
begin
  if TG_OP='DELETE' and not exists (
    select 1 from public.organizations where id=OLD.org_id
  ) then
    return OLD;
  end if;

  if tg_op <> 'INSERT' then
    v_old_valid := old.org_id is not null and old.company is not null and btrim(old.company) <> ''
      and old.posting_date is not null;
  end if;
  if tg_op <> 'DELETE' then
    v_new_valid := new.org_id is not null and new.company is not null and btrim(new.company) <> ''
      and new.posting_date is not null;
  end if;

  if tg_op = 'INSERT' or tg_op = 'DELETE' then
    v_changed := true;
  else
    v_changed := row(old.org_id,old.erp_name,old.account,old.cost_center,old.fiscal_year,old.project,
        old.party_type,old.party,old.voucher_type,old.voucher_no,old.company,old.posting_date,
        old.debit,old.credit,old.is_cancelled,old.erp_docstatus,old.is_opening,old.finance_book)
      is distinct from
      row(new.org_id,new.erp_name,new.account,new.cost_center,new.fiscal_year,new.project,
        new.party_type,new.party,new.voucher_type,new.voucher_no,new.company,new.posting_date,
        new.debit,new.credit,new.is_cancelled,new.erp_docstatus,new.is_opening,new.finance_book);
  end if;
  if not v_changed then return new; end if;

  if v_old_valid and v_new_valid and old.org_id=new.org_id and old.company=new.company
     and old.posting_date=new.posting_date then
    v_old_key := hashtextextended(old.org_id::text || ':' || old.company,0);
    perform pg_advisory_xact_lock(v_old_key);
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (old.org_id,old.company,old.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if v_old_valid then v_old_key := hashtextextended(old.org_id::text || ':' || old.company,0); end if;
  if v_new_valid then v_new_key := hashtextextended(new.org_id::text || ':' || new.company,0); end if;
  if v_old_valid and v_new_valid then
    v_first_key := least(v_old_key,v_new_key);
    v_second_key := greatest(v_old_key,v_new_key);
    perform pg_advisory_xact_lock(v_first_key);
    if v_second_key <> v_first_key then perform pg_advisory_xact_lock(v_second_key); end if;
  elsif v_old_valid then
    perform pg_advisory_xact_lock(v_old_key);
  elsif v_new_valid then
    perform pg_advisory_xact_lock(v_new_key);
  end if;

  if v_old_valid then
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (old.org_id,old.company,old.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
  end if;
  if v_new_valid and (not v_old_valid or old.org_id is distinct from new.org_id
      or old.company is distinct from new.company or old.posting_date is distinct from new.posting_date) then
    insert into public.erp_financial_statement_dirty_date(org_id,company,posting_date,revision)
      values (new.org_id,new.company,new.posting_date,nextval('public.erp_financial_statement_dirty_revision_seq'))
    on conflict (org_id,company,posting_date) do update set revision=excluded.revision;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
