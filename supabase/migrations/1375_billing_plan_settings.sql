-- 1375_billing_plan_settings.sql — monthly billing plan settings (#2682).
-- Spec docs/specs/monthly-billing-plan.spec.md (FR-MBP-010..012); proven by supabase/tests/1375_billing_plan_settings.test.sql.
-- Two small tables: the organisation's default monthly target (+ currency) with the done-not-claimed reminder switch (default OFF), and
-- optional per-month target overrides. Nothing about picked candidates is stored anywhere (OD-MBP-4). Writes only through the two
-- Admin/Finance definer functions; clients hold select only, limited to the four money roles by a restrictive policy.
-- ── REVERSE: rollback/1375_billing_plan_settings_down.sql ──────────────────────────────────────────────────────────

create table public.org_billing_plan_settings (
  org_id                       uuid primary key references public.organizations(id) on delete cascade,
  monthly_target               numeric(14,2) check (monthly_target is null or (monthly_target >= 0 and monthly_target < 1000000000000)),
  target_currency              text check (target_currency is null or target_currency ~ '^[A-Z]{3}$'),
  done_not_claimed_reminder_on boolean not null default false,
  updated_by                   uuid not null references public.profiles(id),
  updated_at                   timestamptz not null default now(),
  constraint org_billing_plan_settings_target_currency check (monthly_target is null or target_currency is not null)
);
comment on table public.org_billing_plan_settings is
  '#2682: default monthly billing target and its currency, and whether the done-not-claimed reminder is on (default off; #2675 reads it).';

create table public.billing_plan_month_targets (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  target     numeric(14,2) not null check (target >= 0 and target < 1000000000000),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (org_id, month)
);
comment on table public.billing_plan_month_targets is '#2682: a month-specific target that overrides the organisation default (same currency).';

do $$
declare t text;
begin
  foreach t in array array['org_billing_plan_settings','billing_plan_month_targets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
                      using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'))$p$, t || '_role_scope', t);
  end loop;
end $$;

-- ── default target, currency and reminder switch ─────────────────────────────────────────────────────────────────────
create function public.set_billing_plan_settings(p_target numeric, p_currency text, p_reminder_on boolean)
  returns public.org_billing_plan_settings
  language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid      := public.auth_org_id();
  v_cur  text      := nullif(upper(btrim(coalesce(p_currency, ''))), '');
  v_row  public.org_billing_plan_settings;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set the billing plan' using errcode = '42501';
  end if;
  if p_reminder_on is null then
    raise exception 'the reminder must be on or off' using errcode = '22023', detail = 'reminder-missing';
  end if;
  if p_target is not null then
    if not (p_target >= 0 and p_target < 1000000000000) then
      raise exception 'a monthly target is zero or more' using errcode = '23514', detail = 'target-invalid';
    end if;
    if v_cur is null or v_cur !~ '^[A-Z]{3}$' then
      raise exception 'a monthly target needs a currency' using errcode = '23514', detail = 'target-currency-missing';
    end if;
  end if;
  insert into public.org_billing_plan_settings (org_id, monthly_target, target_currency, done_not_claimed_reminder_on, updated_by, updated_at)
  values (v_org, round(p_target, 2), case when p_target is null then null else v_cur end, p_reminder_on, auth.uid(), now())
  on conflict (org_id) do update set
    monthly_target = excluded.monthly_target, target_currency = excluded.target_currency,
    done_not_claimed_reminder_on = excluded.done_not_claimed_reminder_on,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.set_billing_plan_settings(numeric, text, boolean) from public, anon;
grant execute on function public.set_billing_plan_settings(numeric, text, boolean) to authenticated, service_role;

-- ── one month's target (null clears the override) ────────────────────────────────────────────────────────────────────
create function public.set_billing_plan_month_target(p_month date, p_target numeric) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_m   date;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set the billing plan' using errcode = '42501';
  end if;
  if p_month is null then
    raise exception 'a month is required' using errcode = '22023', detail = 'month-missing';
  end if;
  v_m := date_trunc('month', p_month)::date;
  if p_target is null then
    delete from public.billing_plan_month_targets where org_id = v_org and month = v_m;
    return;
  end if;
  if not (p_target >= 0 and p_target < 1000000000000) then
    raise exception 'a monthly target is zero or more' using errcode = '23514', detail = 'target-invalid';
  end if;
  if not exists (select 1 from public.org_billing_plan_settings s where s.org_id = v_org and s.target_currency is not null) then
    raise exception 'set the target currency first' using errcode = '23514', detail = 'target-currency-missing';
  end if;
  insert into public.billing_plan_month_targets (org_id, month, target, updated_by, updated_at)
  values (v_org, v_m, round(p_target, 2), auth.uid(), now())
  on conflict (org_id, month) do update set target = excluded.target, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end; $$;
revoke all on function public.set_billing_plan_month_target(date, numeric) from public, anon;
grant execute on function public.set_billing_plan_month_target(date, numeric) to authenticated, service_role;
