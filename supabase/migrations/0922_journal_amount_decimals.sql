-- 0922_journal_amount_decimals.sql — a journal line amount with more decimals than the organisation's currency holds
-- is refused by save_journal_draft instead of rounded to the column's two places. A zero-decimal currency refuses any
-- decimals. The currency is the organisation's own (organizations.default_currency); a three-decimal currency is capped at
-- the two places journal_entry_lines stores. Refusal is SQLSTATE PJ422 (the client maps it to its own catalogue key).
-- Body below = the 0887 definition, with the added check marked.

create or replace function public.journal_currency_decimals(p_currency text) returns int
  language sql immutable set search_path = pg_catalog as $f$
  select case when upper(coalesce(p_currency, '')) in
    ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0 else 2 end
$f$;
revoke all on function public.journal_currency_decimals(text) from public, anon, authenticated;

create or replace function public.save_journal_draft(p_id uuid, p_kind public.journal_kind, p_date date, p_memo text, p_lines jsonb)
  returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_org uuid := public.assert_journal_desk_member();
  v_me  uuid := auth.uid();
  v_row public.journal_entries%rowtype;
  v_id  uuid;
  v_line record;
  v_no  int := 0;
  v_debit numeric(18,2);
  v_credit numeric(18,2);
  v_raw_d numeric;      -- added in 0922
  v_raw_c numeric;      -- added in 0922
  v_dec int;            -- added in 0922
begin
  select public.journal_currency_decimals(default_currency) into v_dec from public.organizations where id = v_org;  -- added in 0922
  perform public.assert_is_active_member();  -- explicit, ahead of every write (AC-AMG-001 reads the body)
  if p_kind is null or p_date is null then raise exception 'a journal needs a kind and a date' using errcode = '22023'; end if;
  if p_memo is null or length(btrim(p_memo)) not between 1 and 500 then
    raise exception 'a journal needs a memo of up to 500 characters' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception 'journal lines must be a list of up to 200 lines' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.journal_entries (org_id, kind, entry_date, memo, maker_id)
      values (v_org, p_kind, p_date, btrim(p_memo), v_me) returning id into v_id;
  else
    select * into v_row from public.journal_entries where id = p_id and org_id = v_org for update;
    if not found then raise exception 'journal not found' using errcode = '42501'; end if;
    if v_row.status <> 'draft' then raise exception 'only a draft can be edited' using errcode = 'P0001'; end if;
    if v_row.reverses_journal_id is not null then
      raise exception 'a reversal cannot be edited; it carries the original''s lines with their sides swapped' using errcode = 'P0001';
    end if;
    update public.journal_entries set kind = p_kind, entry_date = p_date, memo = btrim(p_memo), updated_at = now() where id = p_id;
    delete from public.journal_entry_lines where journal_id = p_id;
    v_id := p_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) as e(l) loop
    v_no := v_no + 1;
    begin
      v_raw_d := coalesce(nullif(v_line.l->>'debit', ''), '0')::numeric;    -- added in 0922
      v_raw_c := coalesce(nullif(v_line.l->>'credit', ''), '0')::numeric;   -- added in 0922
    exception when others then
      raise exception 'line %: the amount is not a number', v_no using errcode = '22023';
    end;
    if scale(trim_scale(v_raw_d)) > v_dec or scale(trim_scale(v_raw_c)) > v_dec then   -- added in 0922
      raise exception 'line %: the amount has more decimals than the currency holds (%)', v_no, v_dec using errcode = 'PJ422';
    end if;
    begin
      v_debit  := coalesce(nullif(v_line.l->>'debit', ''), '0')::numeric(18,2);
      v_credit := coalesce(nullif(v_line.l->>'credit', ''), '0')::numeric(18,2);
    exception when others then
      raise exception 'line %: the amount is not a number', v_no using errcode = '22023';
    end;
    if v_debit < 0 or v_credit < 0 or (v_debit = 0) = (v_credit = 0) then
      raise exception 'line %: each line takes either a debit or a credit', v_no using errcode = '22023';
    end if;
    if coalesce(btrim(v_line.l->>'account'), '') = '' then
      raise exception 'line %: choose an account', v_no using errcode = '22023';
    end if;
    if nullif(v_line.l->>'project_id', '') is not null and not exists (
         select 1 from public.projects where id = (v_line.l->>'project_id')::uuid and org_id = v_org) then
      raise exception 'line %: the project is not in this organisation', v_no using errcode = '22023';
    end if;
    if nullif(v_line.l->>'partner_company_id', '') is not null and not exists (
         select 1 from public.companies where id = (v_line.l->>'partner_company_id')::uuid and org_id = v_org) then
      raise exception 'line %: the company is not in this organisation', v_no using errcode = '22023';
    end if;
    insert into public.journal_entry_lines (org_id, journal_id, line_no, account, debit, credit, partner_company_id, project_id, label)
      values (v_org, v_id, v_no, btrim(v_line.l->>'account'), v_debit, v_credit,
              nullif(v_line.l->>'partner_company_id', '')::uuid, nullif(v_line.l->>'project_id', '')::uuid,
              left(coalesce(v_line.l->>'label', ''), 500));
  end loop;

  insert into public.journal_entry_authors (journal_id, profile_id, org_id) values (v_id, v_me, v_org) on conflict do nothing;
  return v_id;
end $$;
