-- S29 — create a claimant-owned Draft and optional first line as one idempotent intent.
-- Existing table triggers remain responsible for org/currency stamps and the line-summed claim amount.
create or replace function public.create_expense_capture(
  p_claim_id uuid,
  p_line_id uuid,
  p_header jsonb,
  p_first_line jsonb default null
) returns uuid
  language plpgsql
  security invoker
  set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_title text;
  v_purpose text;
  v_project_id uuid;
  v_budget_category public.budget_category;
  v_advance_id uuid;
  v_line_date date;
  v_line_type public.expense_type;
  v_line_description text;
  v_line_amount numeric;
  v_claim public.expense_claims%rowtype;
  v_line public.expense_claim_lines%rowtype;
  v_inserted integer;
begin
  if auth.uid() is null or public.auth_org_id() is null or not public.is_active_member() then
    raise exception 'active organization membership is required' using errcode = '42501';
  end if;
  if p_claim_id is null then
    raise exception 'stable claim ID is required' using errcode = '22023';
  end if;
  if p_header is null or jsonb_typeof(p_header) <> 'object'
     or (p_header - array['title','purpose','projectId','budgetCategory','advanceId']) <> '{}'::jsonb
     or not (p_header ? 'title')
     or jsonb_typeof(p_header->'title') <> 'string' then
    raise exception 'claim header keys are invalid' using errcode = '22023';
  end if;

  v_title := btrim(p_header->>'title');
  if v_title = '' then
    raise exception 'claim title is required' using errcode = '22023';
  end if;
  if p_header ? 'purpose' and jsonb_typeof(p_header->'purpose') not in ('string','null') then
    raise exception 'claim purpose must be text or null' using errcode = '22023';
  end if;
  v_purpose := nullif(btrim(p_header->>'purpose'), '');

  if p_header ? 'projectId' and jsonb_typeof(p_header->'projectId') not in ('string','null') then
    raise exception 'claim project ID must be text or null' using errcode = '22023';
  end if;
  v_project_id := nullif(p_header->>'projectId', '')::uuid;
  if p_header ? 'budgetCategory' and jsonb_typeof(p_header->'budgetCategory') not in ('string','null') then
    raise exception 'claim budget category must be text or null' using errcode = '22023';
  end if;
  v_budget_category := nullif(p_header->>'budgetCategory', '')::public.budget_category;
  if p_header ? 'advanceId' and jsonb_typeof(p_header->'advanceId') not in ('string','null') then
    raise exception 'claim advance ID must be text or null' using errcode = '22023';
  end if;
  v_advance_id := nullif(p_header->>'advanceId', '')::uuid;

  if p_first_line is null or jsonb_typeof(p_first_line) = 'null' then
    if p_line_id is not null then
      raise exception 'line ID must be null when no first line is supplied' using errcode = '22023';
    end if;
  else
    if p_line_id is null or jsonb_typeof(p_first_line) <> 'object'
       or (p_first_line - array['expenseDate','expenseType','description','amount']) <> '{}'::jsonb
       or not (p_first_line ?& array['expenseDate','expenseType','description','amount'])
       or jsonb_typeof(p_first_line->'expenseDate') <> 'string'
       or jsonb_typeof(p_first_line->'expenseType') <> 'string'
       or jsonb_typeof(p_first_line->'description') <> 'string'
       or jsonb_typeof(p_first_line->'amount') <> 'number' then
      raise exception 'first expense line keys are invalid' using errcode = '22023';
    end if;
    v_line_date := (p_first_line->>'expenseDate')::date;
    v_line_type := (p_first_line->>'expenseType')::public.expense_type;
    v_line_description := p_first_line->>'description';
    v_line_amount := (p_first_line->>'amount')::numeric;
    if v_line_amount <> round(v_line_amount, 2) then
      raise exception 'expense amount must have at most two decimal places' using errcode = '22023';
    end if;
  end if;

  -- Serializes replay of one stable claim ID. A foreign collision remains hidden by RLS and is refused below.
  perform pg_advisory_xact_lock(hashtextextended('expense-capture:' || p_claim_id::text, 0));
  select * into v_claim from public.expense_claims where id = p_claim_id for update;
  if found then
    if v_claim.org_id is distinct from public.auth_org_id()
       or v_claim.claimant_id is distinct from auth.uid()
       or v_claim.kind is distinct from 'claim'::public.expense_kind
       or v_claim.status is distinct from 'Draft'::public.expense_claim_status then
      raise exception 'saved claim intent cannot be reused' using errcode = '42501';
    end if;
    if v_claim.title is distinct from v_title
       or v_claim.purpose is distinct from v_purpose
       or v_claim.project_id is distinct from v_project_id
       or v_claim.budget_category is distinct from v_budget_category
       or v_claim.advance_id is distinct from v_advance_id then
      raise exception 'saved claim intent conflicts with this retry' using errcode = '55000';
    end if;

    if p_first_line is null or jsonb_typeof(p_first_line) = 'null' then
      if exists (select 1 from public.expense_claim_lines where claim_id = p_claim_id) then
        raise exception 'saved claim intent conflicts with this retry' using errcode = '55000';
      end if;
    else
      select * into v_line from public.expense_claim_lines where id = p_line_id for update;
      if found then
        if v_line.claim_id is distinct from p_claim_id
           or v_line.expense_date is distinct from v_line_date
           or v_line.expense_type is distinct from v_line_type
           or v_line.description is distinct from v_line_description
           or v_line.amount is distinct from v_line_amount then
          raise exception 'saved line intent conflicts with this retry' using errcode = '55000';
        end if;
      else
        if exists (select 1 from public.expense_claim_lines where claim_id = p_claim_id) then
          raise exception 'saved line intent conflicts with this retry' using errcode = '55000';
        end if;
        raise exception 'saved claim intent conflicts with this retry' using errcode = '55000';
      end if;
    end if;
    return p_claim_id;
  end if;

  insert into public.expense_claims (id, kind, title, purpose, project_id, budget_category, advance_id)
  values (p_claim_id, 'claim', v_title, v_purpose, v_project_id, v_budget_category, v_advance_id)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted <> 1 then
    raise exception 'saved claim intent cannot be reused' using errcode = '42501';
  end if;

  if p_first_line is not null then
    insert into public.expense_claim_lines (id, claim_id, expense_date, expense_type, description, amount)
    values (p_line_id, p_claim_id, v_line_date, v_line_type, v_line_description, v_line_amount);
  end if;
  return p_claim_id;
end;
$$;

revoke all on function public.create_expense_capture(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_expense_capture(uuid, uuid, jsonb, jsonb) to authenticated;

comment on function public.create_expense_capture(uuid, uuid, jsonb, jsonb) is
  'S29: idempotently creates a claimant-owned Draft expense claim and optional first line in one transaction; server stamps authority and sums amount.';
