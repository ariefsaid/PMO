-- 1380_done_not_claimed_setting.sql — the done-not-claimed alert setting and its once-only stamp (#2675).
-- Spec docs/specs/done-not-claimed-age.spec.md (FR-DNC-010/011); proven by supabase/tests/1380_done_not_claimed_setting.test.sql.
-- The reminder switch (1375) stays off by default. The day limit is NULLABLE with NO default: a default would be a client day count in code
-- (OD-SCOPE-2); with no limit nothing is highlighted or notified. The stamp table is written only by the daily job (1381).
-- ── REVERSE: rollback/1380_done_not_claimed_setting_down.sql ───────────────────────────────────────────────────────────

alter table public.org_billing_plan_settings
  add column done_not_claimed_after_days integer
  check (done_not_claimed_after_days is null or (done_not_claimed_after_days between 1 and 3650));
comment on column public.org_billing_plan_settings.done_not_claimed_after_days is
  '#2675: a candidate line older than this many days is flagged (and Finance told once) while the reminder is on. Null = no limit set; no default.';

create table public.done_not_claimed_notices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  boq_item_id   uuid references public.boq_items(id) on delete cascade,
  notified_at   timestamptz not null default now()
);
create unique index done_not_claimed_notices_line_uq
  on public.done_not_claimed_notices (org_id, work_order_id, coalesce(boq_item_id, '00000000-0000-0000-0000-000000000000'::uuid));
comment on table public.done_not_claimed_notices is
  '#2675: one row per candidate line already notified (once-only stamp for the daily job). Never read as billing data.';

alter table public.done_not_claimed_notices enable row level security;
alter table public.done_not_claimed_notices force row level security;
revoke all on public.done_not_claimed_notices from public, anon, authenticated;
grant select on public.done_not_claimed_notices to authenticated;
grant all on public.done_not_claimed_notices to service_role;
create policy done_not_claimed_notices_select on public.done_not_claimed_notices for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
create policy done_not_claimed_notices_role_scope on public.done_not_claimed_notices as restrictive for select to authenticated
  using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));

-- ── the reminder switch and its day limit (set_billing_plan_settings is unchanged) ───────────────────────────────────
create function public.set_billing_plan_reminder(p_reminder_on boolean, p_after_days integer)
  returns public.org_billing_plan_settings
  language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_row public.org_billing_plan_settings;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if public.auth_role() is null or public.auth_role() not in ('Admin','Finance') then
    raise exception 'only Finance or an Admin can set the billing plan' using errcode = '42501';
  end if;
  if p_reminder_on is null then
    raise exception 'the reminder must be on or off' using errcode = '22023', detail = 'reminder-missing';
  end if;
  if p_after_days is not null and not (p_after_days between 1 and 3650) then
    raise exception 'the limit is between 1 and 3650 days' using errcode = '23514', detail = 'after-days-invalid';
  end if;
  insert into public.org_billing_plan_settings (org_id, done_not_claimed_reminder_on, done_not_claimed_after_days, updated_by, updated_at)
  values (v_org, p_reminder_on, p_after_days, auth.uid(), now())
  on conflict (org_id) do update set
    done_not_claimed_reminder_on = excluded.done_not_claimed_reminder_on,
    done_not_claimed_after_days = excluded.done_not_claimed_after_days,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function public.set_billing_plan_reminder(boolean, integer) from public, anon;
grant execute on function public.set_billing_plan_reminder(boolean, integer) to authenticated, service_role;
