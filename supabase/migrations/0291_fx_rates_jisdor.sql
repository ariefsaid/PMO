-- #1012: organization-scoped JISDOR reference rates for display-only equivalents.
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references public.organizations(id),
  rate_date date not null,
  base_currency text not null default 'USD' check (base_currency = 'USD'),
  quote_currency text not null default 'IDR' check (quote_currency = 'IDR'),
  rate numeric(18,6) not null check (rate > 0 and rate between 1000 and 100000),
  source text not null default 'JISDOR' check (source = 'JISDOR'),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, source, base_currency, quote_currency, rate_date)
);

create index fx_rates_org_date_idx on public.fx_rates(org_id, rate_date desc);
create trigger fx_rates_stamp_org_id before insert on public.fx_rates
  for each row execute function public.stamp_org_id();

alter table public.fx_rates enable row level security;
alter table public.fx_rates force row level security;
create policy fx_rates_select on public.fx_rates for select to authenticated
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy fx_rates_insert on public.fx_rates for insert to authenticated
  with check (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Finance','Admin'));
create policy fx_rates_update on public.fx_rates for update to authenticated
  using (org_id = public.auth_org_id() and public.is_active_member()
         and public.auth_role() in ('Finance','Admin'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
              and public.auth_role() in ('Finance','Admin'));
revoke all on public.fx_rates from public, anon, authenticated;
grant select on public.fx_rates to authenticated;
grant insert (rate_date, rate) on public.fx_rates to authenticated;
grant update (rate) on public.fx_rates to authenticated;

create function public.stamp_fx_rate() returns trigger language plpgsql
  set search_path = public as $$
declare v_today date;
begin
  select (now() at time zone coalesce(default_timezone, 'UTC'))::date into v_today
  from public.organizations where id = new.org_id;
  if new.rate_date > v_today then
    raise exception 'publication date cannot be in the future' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_by := auth.uid();
    new.updated_at := now();
  elsif new.rate is distinct from old.rate then
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.stamp_fx_rate() from public, anon, authenticated;
create trigger fx_rates_zz_stamp before insert or update on public.fx_rates
  for each row execute function public.stamp_fx_rate();

create function public.audit_fx_rate() returns trigger language plpgsql security definer
  set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.rate is not distinct from old.rate then return null; end if;
  perform public.log_audit('fx_rate.change', new.org_id, auth.uid(), new.id,
    jsonb_build_object('rate_date', new.rate_date, 'source', new.source,
      'old_rate', case when tg_op = 'UPDATE' then old.rate else null end,
      'new_rate', new.rate));
  return null;
end $$;
revoke all on function public.audit_fx_rate() from public, anon, authenticated;
create trigger fx_rates_audit after insert or update on public.fx_rates
  for each row execute function public.audit_fx_rate();

create function public.fx_rate_on(base text, quote text, on_date date)
returns table(rate numeric, rate_date date)
language sql stable security invoker set search_path = public as $$
  select f.rate, f.rate_date from public.fx_rates f
  where f.org_id = public.auth_org_id() and f.source = 'JISDOR'
    and f.base_currency = base and f.quote_currency = quote and f.rate_date <= on_date
  order by f.rate_date desc limit 1
$$;
revoke all on function public.fx_rate_on(text, text, date) from public, anon;
grant execute on function public.fx_rate_on(text, text, date) to authenticated;

create function public.upsert_fx_rates(p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  x jsonb;
  d date;
  r numeric;
  affected integer;
  n integer := 0;
  c integer := 0;
  u integer := 0;
begin
  if not public.is_active_member() or public.auth_role() not in ('Finance', 'Admin') then
    raise exception 'Finance or Admin required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rate rows must be an array' using errcode = '23514';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'import requires 1 to 500 rows' using errcode = '23514';
  end if;
  for x in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(x) <> 'object' or not (x ? 'rate_date' and x ? 'rate')
       or (x - 'rate_date' - 'rate') <> '{}'::jsonb
       or jsonb_typeof(x->'rate_date') is distinct from 'string'
       or jsonb_typeof(x->'rate') is distinct from 'number' then
      raise exception 'invalid rate row' using errcode = '23514';
    end if;
    d := (x->>'rate_date')::date;
    r := (x->>'rate')::numeric;
    if to_char(d, 'YYYY-MM-DD') <> (x->>'rate_date')
       or not (r between 1000 and 100000) or scale(r) > 6 then
      raise exception 'invalid publication date or rate' using errcode = '23514';
    end if;
  end loop;
  if (select count(*) <> count(distinct value->>'rate_date')
      from jsonb_array_elements(p_rows)) then
    raise exception 'duplicate publication date' using errcode = '23514';
  end if;
  for x in select value from jsonb_array_elements(p_rows) order by value->>'rate_date' loop
    d := (x->>'rate_date')::date;
    r := (x->>'rate')::numeric;
    insert into public.fx_rates(rate_date, rate) values (d, r)
      on conflict (org_id, source, base_currency, quote_currency, rate_date) do nothing;
    get diagnostics affected = row_count;
    if affected = 1 then
      n := n + 1;
    else
      update public.fx_rates set rate = r where org_id = public.auth_org_id()
        and source = 'JISDOR' and base_currency = 'USD' and quote_currency = 'IDR'
        and rate_date = d and rate is distinct from r;
      get diagnostics affected = row_count;
      if affected = 1 then c := c + 1; else u := u + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('new', n, 'changed', c, 'unchanged', u);
end $$;
revoke all on function public.upsert_fx_rates(jsonb) from public, anon;
grant execute on function public.upsert_fx_rates(jsonb) to authenticated;
