-- 0250_progress_billing.sql — #766: bill of quantities, progress assessment, down payment, billing claims.
-- Spec docs/specs/progress-billing.spec.md (DD-PBL-1..11) · ADR-0077 · plan docs/plans/2026-10-06-progress-billing.md.
-- Depends on #765's 0245_management_pack.sql (project_progress_entries and its helpers).
-- Reversal: supabase/migrations/rollback/0250_progress_billing_down.sql (pre-production: supabase db reset).
--
-- ⚑ A progress ASSESSMENT is operational and never reaches the ERP; a BILLING CLAIM is the only path to an
--   invoice (owner ruling 2026-10-06, DD-PBL-2).
-- ⚑ A claim IS its sales invoice's PMO record (claim id = sales_invoices.id). No column is added to
--   sales_invoices, so its native-mirror guard (0193 §10) needs no paired edit.
-- ⚑ Hosted Supabase grants EXECUTE on new public functions to anon/authenticated explicitly; every function
--   below revokes what it must not expose (the 0185/0210 lesson). Definer client RPCs join 0178's allow-list.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — organizations.down_payment_item (DD-PBL-1, DD-PBL-8). The ERPNext item whose Item Default income
-- account is the customer-advance liability account. Admin-only through the existing own-org, active-member,
-- Admin-only organizations UPDATE policy (0232 precedent).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.organizations add column down_payment_item text
  constraint organizations_down_payment_item_check
  check (down_payment_item is null or (length(btrim(down_payment_item)) between 1 and 140));
grant update (down_payment_item) on public.organizations to authenticated;

create or replace function public.audit_org_down_payment_item() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.down_payment_item is distinct from old.down_payment_item then
    perform public.log_audit('org.down_payment_item.change', new.id, auth.uid(), new.id,
      jsonb_build_object('from', old.down_payment_item, 'to', new.down_payment_item));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_down_payment_item() from public, anon, authenticated;
create trigger organizations_audit_down_payment_item after update on public.organizations
  for each row execute function public.audit_org_down_payment_item();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — boq_items (DD-PBL-4). The contract's priced lines. Rates are tax-exclusive (DD-PBL-6). quantity carries
-- 3 decimals — ERPNext's default float precision — so the ERP never re-rounds what PMO sends.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.boq_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id)
                  default '00000000-0000-0000-0000-000000000001',
  project_id    uuid not null references public.projects(id),
  work_order_id uuid references public.work_orders(id),
  item_code     text not null check (length(btrim(item_code)) between 1 and 140),
  description   text not null check (length(btrim(description)) between 1 and 500),
  unit          text not null check (length(btrim(unit)) between 1 and 40),
  -- `> 0` alone is not enough: numeric NaN sorts ABOVE every value; the upper bound rejects it (0193 precedent).
  quantity      numeric(14,3) not null constraint boq_items_quantity_check
                  check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate          numeric(14,2) not null constraint boq_items_rate_check
                  check (rate >= 0 and rate < 'Infinity'::numeric),
  created_at    timestamptz not null default now()
);
create index boq_items_org_project_idx on public.boq_items (org_id, project_id);
create index boq_items_project_idx on public.boq_items (project_id);
create index boq_items_work_order_idx on public.boq_items (work_order_id);

create trigger boq_items_stamp_org_id before insert on public.boq_items
  for each row execute function public.stamp_org_id();

-- Runs after the org stamp ('s' < 'z'). Reads work_orders under the caller's RLS, so another org's work order
-- is invisible and fails closed exactly like a wrong-project one.
create or replace function public.check_boq_item_work_order_same_project() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.work_order_id is not null
     and (select wo.project_id from public.work_orders wo where wo.id = new.work_order_id)
         is distinct from new.project_id then
    raise exception 'the work order must be on the same project as the bill of quantities line'
      using errcode = '23514';
  end if;
  return new;
end; $$;
revoke all on function public.check_boq_item_work_order_same_project() from public, anon, authenticated;
create trigger boq_items_zz_check_work_order before insert or update on public.boq_items
  for each row execute function public.check_boq_item_work_order_same_project();

alter table public.boq_items enable row level security;
alter table public.boq_items force row level security;
create policy boq_items_select on public.boq_items for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy boq_items_insert on public.boq_items for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p where p.id = boq_items.project_id and p.org_id = public.auth_org_id()));
create policy boq_items_update on public.boq_items for update
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));
create policy boq_items_delete on public.boq_items for delete
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'));

-- Column-level grants only (the 0014 A2 mechanic). project_id is not updatable: a line never moves contracts.
revoke all on public.boq_items from authenticated, anon;
grant select on public.boq_items to authenticated;
grant insert (id, org_id, project_id, work_order_id, item_code, description, unit, quantity, rate)
  on public.boq_items to authenticated;
grant update (work_order_id, item_code, description, unit, quantity, rate) on public.boq_items to authenticated;
grant delete on public.boq_items to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — progress assessment (DD-PBL-2, DD-PBL-3). ONE source of operational progress: #765's
-- project_progress_entries row for the month (0245), optionally with per-BoQ-line quantities done to date. When
-- quantities are recorded the month's pct_complete is DERIVED from them, so the management pack sees
-- quantity-measured progress with no change. Never reaches billing or the ERP. Who: #765's
-- may_record_project_progress (the project's PM, or Finance rank and above). INVOKER throughout.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_assessment_quantities (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id)
                     default '00000000-0000-0000-0000-000000000001',
  entry_id         uuid not null references public.project_progress_entries(id),
  boq_item_id      uuid not null references public.boq_items(id),
  quantity_to_date numeric(14,3) not null constraint progress_assessment_quantities_quantity_check
                     check (quantity_to_date >= 0 and quantity_to_date < 'Infinity'::numeric),
  unique (entry_id, boq_item_id)
);
create index progress_assessment_quantities_org_idx on public.progress_assessment_quantities (org_id);
create index progress_assessment_quantities_boq_item_idx on public.progress_assessment_quantities (boq_item_id);

create trigger progress_assessment_quantities_stamp_org_id before insert on public.progress_assessment_quantities
  for each row execute function public.stamp_org_id();

-- A quantity row is writable only by someone who may record the entry's project's progress, and only for a
-- BoQ line of that project.
create or replace function public.progress_assessment_line_ok(p_entry_id uuid, p_boq_item_id uuid) returns boolean
  language sql stable set search_path = public as $$
  select exists (select 1 from public.project_progress_entries e
                   join public.boq_items b on b.project_id = e.project_id
                  where e.id = p_entry_id and b.id = p_boq_item_id
                    and public.may_record_project_progress(e.project_id))
$$;
revoke all on function public.progress_assessment_line_ok(uuid, uuid) from public, anon;
grant execute on function public.progress_assessment_line_ok(uuid, uuid) to authenticated;

alter table public.progress_assessment_quantities enable row level security;
alter table public.progress_assessment_quantities force row level security;
create policy progress_assessment_quantities_select on public.progress_assessment_quantities for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy progress_assessment_quantities_insert on public.progress_assessment_quantities for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
create policy progress_assessment_quantities_update on public.progress_assessment_quantities for update
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id))
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
create policy progress_assessment_quantities_delete on public.progress_assessment_quantities for delete
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.progress_assessment_line_ok(entry_id, boq_item_id));
revoke all on public.progress_assessment_quantities from authenticated, anon;
grant select on public.progress_assessment_quantities to authenticated;
grant insert (entry_id, boq_item_id, quantity_to_date) on public.progress_assessment_quantities to authenticated;
grant update (quantity_to_date) on public.progress_assessment_quantities to authenticated;
grant delete on public.progress_assessment_quantities to authenticated;

-- The writer. Every BoQ line the PM sends is "done to date" for that month; lines not sent count as nothing
-- done and are removed from the month (the UI always sends every line, pre-filled from the last assessment).
-- pct = Σ min(done, BoQ qty) × rate / Σ BoQ qty × rate × 100, rounded to 2 — so it can never pass 100.
create or replace function public.record_progress_assessment(
  p_project_id uuid, p_month date, p_quantities jsonb, p_note text default null)
  returns numeric language plpgsql volatile set search_path = public as $$
declare
  v_total numeric;
  v_done  numeric;
  v_pct   numeric;
  v_entry uuid;
begin
  if p_project_id is null or p_month is null or p_quantities is null
     or jsonb_typeof(p_quantities) <> 'array' or jsonb_array_length(p_quantities) = 0 then
    raise exception 'project, month and at least one quantity are required' using errcode = '23502';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
              where not coalesce(x.quantity_to_date >= 0 and x.quantity_to_date < 'Infinity'::numeric
                                 and x.quantity_to_date = round(x.quantity_to_date, 3), false)) then
    raise exception 'each quantity done to date must be 0 or more with at most 3 decimals' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
               left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
              where b.id is null) then
    raise exception 'every line must be a bill of quantities line of this project' using errcode = '23514';
  end if;
  if (select count(*) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric))
     <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)) then
    raise exception 'each bill of quantities line may appear once per assessment' using errcode = '23514';
  end if;
  select coalesce(sum(b.quantity * b.rate), 0) into v_total from public.boq_items b where b.project_id = p_project_id;
  if v_total <= 0 then
    raise exception 'this project''s bill of quantities has no value, so percent complete cannot be measured from quantities — record a percent instead'
      using errcode = '23514';
  end if;
  select coalesce(sum(least(x.quantity_to_date, b.quantity) * b.rate), 0) into v_done
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
    join public.boq_items b on b.id = x.boq_item_id;
  v_pct := round(v_done / v_total * 100, 2);

  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, v_pct, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note
  returning id into v_entry;

  delete from public.progress_assessment_quantities q
   where q.entry_id = v_entry
     and not exists (select 1 from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
                      where x.boq_item_id = q.boq_item_id);
  insert into public.progress_assessment_quantities (entry_id, boq_item_id, quantity_to_date)
  select v_entry, x.boq_item_id, x.quantity_to_date
    from jsonb_to_recordset(p_quantities) as x(boq_item_id uuid, quantity_to_date numeric)
  on conflict (entry_id, boq_item_id) do update set quantity_to_date = excluded.quantity_to_date;
  return v_pct;
end; $$;
revoke all on function public.record_progress_assessment(uuid, date, jsonb, text) from public, anon;
grant execute on function public.record_progress_assessment(uuid, date, jsonb, text) to authenticated;

-- Paired edit to #765: 0245's record_project_progress, verbatim, with ONE added refusal (marked). A month
-- measured by quantities must not have its derived percent overwritten by a typed one.
create or replace function public.record_project_progress(
  p_project_id uuid, p_month date, p_pct_complete numeric, p_note text default null)
  returns void language plpgsql volatile set search_path = public as $$
begin
  if p_project_id is null or p_month is null or p_pct_complete is null then
    raise exception 'project, month and percent complete are required' using errcode = '23502';
  end if;
  if not (p_pct_complete >= 0 and p_pct_complete <= 100) then
    raise exception 'percent complete must be between 0 and 100' using errcode = '23514';
  end if;
  if not public.may_record_project_progress(p_project_id) then
    raise exception 'you may record progress only on projects you manage, unless you are Finance, an Executive or an Admin'
      using errcode = '42501';
  end if;
  -- ⚑ 0250 (#766, DD-PBL-3): the one added refusal.
  if exists (select 1 from public.project_progress_entries e
               join public.progress_assessment_quantities q on q.entry_id = e.id
              where e.project_id = p_project_id and e.month = date_trunc('month', p_month)::date) then
    raise exception 'this month''s progress is measured by quantities — record the quantities done to date instead'
      using errcode = 'P0001';
  end if;
  insert into public.project_progress_entries (project_id, month, pct_complete, note)
  values (p_project_id, date_trunc('month', p_month)::date, p_pct_complete, nullif(btrim(p_note), ''))
  on conflict (project_id, month) do update
    set pct_complete = excluded.pct_complete,
        note         = excluded.note;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — progress_claims + progress_claim_lines: BILLING claims (DD-PBL-5, DD-PBL-7). Written ONLY by
-- create_progress_claim and withdraw_progress_claim. org_id has no default: the RPC states it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_claims (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id),
  project_id          uuid not null references public.projects(id),
  work_order_id       uuid references public.work_orders(id),
  kind                text not null check (kind in ('down_payment','progress')),
  currency            text not null check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX'),
  gross_amount        numeric(14,2) not null check (gross_amount >= 0 and gross_amount < 'Infinity'::numeric),
  down_payment_amount numeric(14,2),
  recovery_pct        numeric(6,3),
  dp_recovery_amount  numeric(14,2) not null default 0
                        check (dp_recovery_amount >= 0 and dp_recovery_amount < 'Infinity'::numeric),
  dp_item_code        text,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  withdrawn_by        uuid references public.profiles(id),
  withdrawn_at        timestamptz,
  constraint progress_claims_kind_shape check (
    (kind = 'down_payment'
      and down_payment_amount > 0 and down_payment_amount < 'Infinity'::numeric
      and recovery_pct > 0 and recovery_pct <= 100
      and gross_amount = down_payment_amount and dp_recovery_amount = 0 and dp_item_code is not null)
    or (kind = 'progress'
      and down_payment_amount is null and recovery_pct is null
      and dp_recovery_amount <= gross_amount
      and (dp_recovery_amount = 0 or dp_item_code is not null))),
  constraint progress_claims_withdrawn_pair check ((withdrawn_by is null) = (withdrawn_at is null))
);
create index progress_claims_org_project_kind_idx on public.progress_claims (org_id, project_id, kind);
create index progress_claims_project_idx on public.progress_claims (project_id);
create index progress_claims_work_order_idx on public.progress_claims (work_order_id);
create index progress_claims_created_by_idx on public.progress_claims (created_by);
create index progress_claims_withdrawn_by_idx on public.progress_claims (withdrawn_by);

create table public.progress_claim_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  claim_id    uuid not null references public.progress_claims(id),
  boq_item_id uuid not null references public.boq_items(id),
  item_code   text not null,
  description text not null,
  unit        text not null,
  quantity    numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  rate        numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  amount      numeric(14,2) not null check (amount >= 0 and amount < 'Infinity'::numeric),
  unique (claim_id, boq_item_id)
);
create index progress_claim_lines_org_idx on public.progress_claim_lines (org_id);
create index progress_claim_lines_boq_item_idx on public.progress_claim_lines (boq_item_id);

-- Immutability as a schema fact (DD-WO-8 lesson): only the withdraw stamp may ever change, once.
create or replace function public.assert_progress_claim_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  if old.withdrawn_at is not null then
    raise exception 'this progress claim was withdrawn and can no longer change' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'withdrawn_by' - 'withdrawn_at') is distinct from (to_jsonb(old) - 'withdrawn_by' - 'withdrawn_at') then
    raise exception 'a progress claim cannot be edited: its invoice is built from it — withdraw it (if not yet raised) or cancel its invoice, then create a new claim'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.assert_progress_claim_update() from public, anon, authenticated;
create trigger progress_claims_assert_update before update on public.progress_claims
  for each row execute function public.assert_progress_claim_update();

create or replace function public.refuse_progress_claim_line_change() returns trigger
  language plpgsql set search_path = public as $$
begin
  raise exception 'progress claim lines cannot be changed' using errcode = '42501';
end; $$;
revoke all on function public.refuse_progress_claim_line_change() from public, anon, authenticated;
create trigger progress_claim_lines_immutable before update on public.progress_claim_lines
  for each row execute function public.refuse_progress_claim_line_change();

alter table public.progress_claims enable row level security;
alter table public.progress_claims force row level security;
alter table public.progress_claim_lines enable row level security;
alter table public.progress_claim_lines force row level security;
create policy progress_claims_select on public.progress_claims for select
  using (org_id = public.auth_org_id() and public.is_active_member());
create policy progress_claim_lines_select on public.progress_claim_lines for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.progress_claims from authenticated, anon;
revoke all on public.progress_claim_lines from authenticated, anon;
grant select on public.progress_claims to authenticated;
grant select on public.progress_claim_lines to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — create_progress_claim (DD-PBL-5). Quantities in, money out: rates are copied from the BoQ and the
-- recovery is computed HERE, under the project row lock, so two concurrent claims never read one balance.
-- "Live" = not withdrawn and invoice (if any) not Cancelled. Check order: membership → role → project →
-- work order → kind-specific input → scope → money. The assessment is not an input: Finance states the
-- quantities (the UI may pre-fill them from it, DD-PBL-7).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.create_progress_claim(
  p_project_id          uuid,
  p_kind                text,
  p_work_order_id       uuid    default null,
  p_lines               jsonb   default null,
  p_down_payment_amount numeric default null,
  p_recovery_pct        numeric default null,
  p_recover_remaining   boolean default false)
  returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org         uuid := public.auth_org_id();
  v_role        user_role := public.auth_role();
  v_project_org uuid;
  v_currency    text;
  v_wo_project  uuid;
  v_wo_status   public.work_order_status;
  v_id          uuid := gen_random_uuid();
  v_item        text;
  v_gross       numeric := 0;
  v_recovery    numeric := 0;
  v_dp_amount   numeric;
  v_dp_pct      numeric;
  v_dp_item     text;
  v_dp_status   text;
  v_dp_found    boolean;
  v_balance     numeric;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay — a SECURITY DEFINER body bypasses RLS.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may create a progress claim' using errcode = '42501';
  end if;
  select p.org_id, p.currency into v_project_org, v_currency
    from public.projects p where p.id = p_project_id for update;
  if not found or v_project_org is distinct from v_org then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  if p_work_order_id is not null then
    select wo.project_id, wo.status into v_wo_project, v_wo_status
      from public.work_orders wo where wo.id = p_work_order_id;
    if v_wo_project is distinct from p_project_id then
      raise exception 'the work order must be on the same project as the claim' using errcode = '23514';
    end if;
    if v_wo_status not in ('Issued','Closed') then
      raise exception 'only an issued or closed work order can be billed — this one is %', v_wo_status
        using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'down_payment' then
    if p_lines is not null or coalesce(p_recover_remaining, false) then
      raise exception 'a down payment claim has no quantity lines and recovers nothing' using errcode = 'P0001';
    end if;
    if not coalesce(p_down_payment_amount > 0 and p_down_payment_amount < 'Infinity'::numeric
                    and p_down_payment_amount = round(p_down_payment_amount, 2), false) then
      raise exception 'the down payment amount must be a positive number with at most 2 decimals' using errcode = '23514';
    end if;
    if not coalesce(p_recovery_pct > 0 and p_recovery_pct <= 100 and p_recovery_pct = round(p_recovery_pct, 3), false) then
      raise exception 'the recovery percentage must be above 0 and at most 100, with at most 3 decimals' using errcode = '23514';
    end if;
    select o.down_payment_item into v_item from public.organizations o where o.id = v_org;
    if v_item is null then
      raise exception 'set the down payment item in Administration → Accounting before billing a down payment'
        using errcode = 'P0001';
    end if;
    if exists (select 1 from public.progress_claims pc
                 left join public.sales_invoices si on si.id = pc.id
                where pc.project_id = p_project_id and pc.kind = 'down_payment'
                  and pc.withdrawn_at is null and si.status is distinct from 'Cancelled') then
      raise exception 'this project already has a down payment — withdraw it or cancel its invoice before billing another'
        using errcode = 'P0001';
    end if;
    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        down_payment_amount, recovery_pct, dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'down_payment', v_currency, p_down_payment_amount,
            p_down_payment_amount, p_recovery_pct, 0, v_item, auth.uid());
    v_gross := p_down_payment_amount;

  elsif p_kind = 'progress' then
    if p_down_payment_amount is not null or p_recovery_pct is not null then
      raise exception 'a progress claim states quantities, not a down payment' using errcode = 'P0001';
    end if;
    if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
      raise exception 'a progress claim needs at least one quantity line' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_lines) > 500 then
      raise exception 'a progress claim may have at most 500 lines' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                where not coalesce(x.quantity > 0 and x.quantity < 'Infinity'::numeric
                                   and x.quantity = round(x.quantity, 3), false)) then
      raise exception 'each quantity must be a positive number with at most 3 decimals' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
                 left join public.boq_items b on b.id = x.boq_item_id and b.project_id = p_project_id
                where b.id is null or b.work_order_id is distinct from p_work_order_id) then
      raise exception 'every line must be a bill of quantities line of this project and of the claim''s work order (or of no work order when the claim names none)'
        using errcode = '23514';
    end if;
    if (select count(*) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric))
       <> (select count(distinct x.boq_item_id) from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)) then
      raise exception 'each bill of quantities line may appear once per claim' using errcode = '23514';
    end if;

    select coalesce(sum(round(x.quantity * b.rate, 2)), 0) into v_gross
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;

    select pc.down_payment_amount, pc.recovery_pct, pc.dp_item_code, si.status
      into v_dp_amount, v_dp_pct, v_dp_item, v_dp_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id
     where pc.project_id = p_project_id and pc.kind = 'down_payment'
       and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
    v_dp_found := found;

    if v_dp_found then
      if v_dp_status is null or v_dp_status not in ('Submitted','Unpaid','Paid') then
        raise exception 'the down payment invoice has not been submitted yet: submit it (or withdraw the down payment) before claiming progress'
          using errcode = 'P0001';
      end if;
      select v_dp_amount - coalesce(sum(pc.dp_recovery_amount), 0) into v_balance
        from public.progress_claims pc
        left join public.sales_invoices si on si.id = pc.id
       where pc.project_id = p_project_id and pc.kind = 'progress'
         and pc.withdrawn_at is null and si.status is distinct from 'Cancelled';
      v_balance := greatest(v_balance, 0);
      if coalesce(p_recover_remaining, false) then
        v_recovery := least(v_balance, v_gross);
      else
        v_recovery := least(round(v_gross * v_dp_pct / 100, 2), v_balance);
      end if;
    elsif coalesce(p_recover_remaining, false) then
      raise exception 'there is no down payment to recover on this project' using errcode = 'P0001';
    end if;

    insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount,
                                        dp_recovery_amount, dp_item_code, created_by)
    values (v_id, v_org, p_project_id, p_work_order_id, 'progress', v_currency, v_gross,
            v_recovery, case when v_recovery > 0 then v_dp_item end, auth.uid());
    insert into public.progress_claim_lines (org_id, claim_id, boq_item_id, item_code, description, unit,
                                             quantity, rate, amount)
    select v_org, v_id, b.id, b.item_code, b.description, b.unit, x.quantity, b.rate, round(x.quantity * b.rate, 2)
      from jsonb_to_recordset(p_lines) as x(boq_item_id uuid, quantity numeric)
      join public.boq_items b on b.id = x.boq_item_id;
  else
    raise exception 'a claim is either a down_payment or a progress claim, not %', coalesce(p_kind, 'null')
      using errcode = '22023';
  end if;

  perform public.log_audit('progress_claim.create', v_org, auth.uid(), v_id,
    jsonb_build_object('project_id', p_project_id, 'kind', p_kind, 'work_order_id', p_work_order_id,
                       'gross_amount', v_gross, 'dp_recovery_amount', v_recovery));
  return v_id;
end; $$;
revoke all on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) from public, anon;
grant execute on function public.create_progress_claim(uuid, text, uuid, jsonb, numeric, numeric, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — billing evidence (DD-PBL-7). Evidence is a document from the project's own register, Issued or
-- Approved (content frozen by the 2026-06-12 register rule) and carrying a file. Attach-only; a cited
-- document cannot be deleted (FK, no action). The outbox fence (§7) refuses to raise a claim without evidence.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create table public.progress_claim_evidence (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id),
  claim_id          uuid not null references public.progress_claims(id),
  document_id       uuid not null references public.project_documents(id),
  document_status   public.doc_status not null,
  document_revision text,
  attached_by       uuid not null references public.profiles(id),
  attached_at       timestamptz not null default now(),
  unique (claim_id, document_id)
);
create index progress_claim_evidence_org_idx on public.progress_claim_evidence (org_id);
create index progress_claim_evidence_document_idx on public.progress_claim_evidence (document_id);
create index progress_claim_evidence_attached_by_idx on public.progress_claim_evidence (attached_by);

alter table public.progress_claim_evidence enable row level security;
alter table public.progress_claim_evidence force row level security;
create policy progress_claim_evidence_select on public.progress_claim_evidence for select
  using (org_id = public.auth_org_id() and public.is_active_member());
revoke all on public.progress_claim_evidence from authenticated, anon;
grant select on public.progress_claim_evidence to authenticated;

create or replace function public.attach_claim_evidence(p_claim_id uuid, p_document_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role := public.auth_role();
  v_org         uuid;
  v_project     uuid;
  v_withdrawn   timestamptz;
  v_doc_org     uuid;
  v_doc_project uuid;
  v_status      public.doc_status;
  v_file        text;
  v_revision    text;
  v_rows        int;
begin
  -- SECURITY: membership, role and org re-assertions MUST stay.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may attach billing evidence' using errcode = '42501';
  end if;
  -- Same row lock as withdraw_progress_claim and the outbox fence.
  select pc.org_id, pc.project_id, pc.withdrawn_at into v_org, v_project, v_withdrawn
    from public.progress_claims pc where pc.id = p_claim_id for update;
  if not found or v_org is distinct from public.auth_org_id() then
    raise exception 'progress claim not found' using errcode = 'P0002';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn' using errcode = 'P0001';
  end if;
  select d.org_id, d.project_id, d.status, d.file_path, d.revision
    into v_doc_org, v_doc_project, v_status, v_file, v_revision
    from public.project_documents d where d.id = p_document_id;
  if not found or v_doc_org is distinct from v_org or v_doc_project is distinct from v_project then
    raise exception 'the evidence must be a document of the claim''s project' using errcode = '23514';
  end if;
  if v_status not in ('Issued','Approved') then
    raise exception 'only an issued or approved document can be billing evidence — its content is frozen from issue'
      using errcode = 'P0001';
  end if;
  if v_file is null or btrim(v_file) = '' then
    raise exception 'the evidence document has no file attached' using errcode = 'P0001';
  end if;
  insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
  values (v_org, p_claim_id, p_document_id, v_status, v_revision, auth.uid())
  on conflict (claim_id, document_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform public.log_audit('progress_claim.evidence.attach', v_org, auth.uid(), p_claim_id,
      jsonb_build_object('document_id', p_document_id, 'document_status', v_status, 'document_revision', v_revision));
  end if;
end; $$;
revoke all on function public.attach_claim_evidence(uuid, uuid) from public, anon;
grant execute on function public.attach_claim_evidence(uuid, uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — withdraw + the outbox fence + the author set (DD-PBL-7, DD-PBL-8).
-- Withdraw, attach_claim_evidence and the outbox insert serialize on the CLAIM ROW. The outbox insert precedes
-- every ERP POST (0134) and PostgREST runs it as one statement, so the fence needs no edge-function lock
-- (0154 §fence precedent). The fence refuses (a) a withdrawn claim and (b) a claim with no evidence.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.withdraw_progress_claim(p_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org       uuid;
  v_withdrawn timestamptz;
  v_role      user_role := public.auth_role();
begin
  -- SECURITY: these re-assertions MUST stay.
  perform public.assert_is_active_member();
  if v_role is null or v_role not in ('Admin','Finance') then
    raise exception 'only Admin or Finance may withdraw a progress claim' using errcode = '42501';
  end if;
  select pc.org_id, pc.withdrawn_at into v_org, v_withdrawn
    from public.progress_claims pc where pc.id = p_id for update;
  if not found or v_org is distinct from public.auth_org_id() then
    raise exception 'progress claim not found' using errcode = 'P0002';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim is already withdrawn' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.sales_invoices si where si.id = p_id) then
    raise exception 'this claim already has an invoice — cancel the invoice instead' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.external_command_outbox o
              where o.org_id = v_org and o.domain = 'revenue' and o.pmo_record_id = p_id::text
                and o.state <> 'failed') then
    raise exception 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong'
      using errcode = 'P0001';
  end if;
  update public.progress_claims set withdrawn_by = auth.uid(), withdrawn_at = now() where id = p_id;
  perform public.log_audit('progress_claim.withdraw', v_org, auth.uid(), p_id, '{}'::jsonb);
end; $$;
revoke all on function public.withdraw_progress_claim(uuid) from public, anon;
grant execute on function public.withdraw_progress_claim(uuid) to authenticated;

create or replace function public.assert_progress_claim_raisable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_withdrawn timestamptz;
begin
  if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  select pc.withdrawn_at into v_withdrawn
    from public.progress_claims pc
   where pc.id = new.pmo_record_id::uuid and pc.org_id = new.org_id
     for share;
  if not found then
    return new;   -- not a claim: an ordinary invoice or receipt
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = new.pmo_record_id::uuid) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;
  return new;
end; $$;
revoke all on function public.assert_progress_claim_raisable() from public, anon, authenticated;
-- zz_: it reads NEW.org_id, so it must fire after external_command_outbox_stamp_org_id (triggers fire by name; 0215).
create trigger external_command_outbox_zz_progress_claim_fence
  before insert on public.external_command_outbox
  for each row when (new.domain = 'revenue')
  execute function public.assert_progress_claim_raisable();

-- Whoever set a claim's quantities is an author of its invoice, alongside whoever raised it (0132's set).
create or replace function public.append_progress_claim_author() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  select new.org_id, new.id, pc.created_by
    from public.progress_claims pc
   where pc.id = new.id and pc.org_id = new.org_id
  on conflict do nothing;
  return new;
end; $$;
revoke all on function public.append_progress_claim_author() from public, anon, authenticated;
create trigger sales_invoices_append_progress_claim_author
  after insert on public.sales_invoices
  for each row execute function public.append_progress_claim_author();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — ONE definition of billed work (DD-PBL-9), read by get_project_billing and (0251) get_management_pack.
-- Per invoice: its net of tax (0197's CASE), whether it is a down-payment invoice, and the recovery its claim
-- removed. Billed work = net + recovery for every non-DP invoice. security_invoker: RLS stays the boundary.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create view public.sales_invoice_work_billed with (security_invoker = true) as
  select si.id, si.org_id, si.project_id, si.currency, si.invoice_date, si.status,
         coalesce(pc.kind = 'down_payment', false) as is_down_payment,
         case when si.tax_treatment = 'inclusive' then si.amount - si.tax_amount else si.amount end as net,
         coalesce(pc.dp_recovery_amount, 0) as recovery
    from public.sales_invoices si
    left join public.progress_claims pc on pc.id = si.id and pc.org_id = si.org_id;
comment on view public.sales_invoice_work_billed is
  '#766 DD-PBL-9: the single definition of billed work. A DP invoice is an advance, not work; a claim invoice '
  'counts at net plus the recovery its negative line removed.';
revoke all on public.sales_invoice_work_billed from public, anon, authenticated;
grant select on public.sales_invoice_work_billed to authenticated;

-- SECURITY INVOKER — do NOT add security definer. All figures net of tax in the project's currency.
-- The assessment is the latest #765 entry up to the org's current month; assessed value and the gap are
-- computed in the UI with the management pack's pctOf (one formula, DD-PBL-9). Invisible project → NULL.
create or replace function public.get_project_billing(p_project_id uuid)
  returns jsonb language sql stable security invoker set search_path = public as $$
  with p as (
    select pr.id, pr.currency,
           case when pr.tax_treatment = 'inclusive' then pr.contract_value - coalesce(pr.tax_amount, 0)
                else pr.contract_value end as contract_net
      from public.projects pr where pr.id = p_project_id
  ),
  counted as (
    select w.is_down_payment, w.net, w.recovery
      from public.sales_invoice_work_billed w join p on p.id = w.project_id
     where w.status in ('Submitted','Unpaid','Paid') and w.net is not null and w.currency = p.currency
  ),
  c as (
    select pc.id, pc.kind, pc.gross_amount, pc.dp_recovery_amount, si.status as si_status
      from public.progress_claims pc
      left join public.sales_invoices si on si.id = pc.id and si.org_id = pc.org_id
     where pc.project_id = p_project_id and pc.withdrawn_at is null
       and si.status is distinct from 'Cancelled'
  ),
  claimed as (
    select l.boq_item_id, sum(l.quantity) as claimed_quantity
      from public.progress_claim_lines l join c on c.id = l.claim_id
     group by l.boq_item_id
  ),
  latest as (
    select e.id, e.month, e.pct_complete
      from public.project_progress_entries e
     where e.project_id = p_project_id
       and e.month <= public.org_current_month(
             (select o.default_timezone from public.organizations o where o.id = public.auth_org_id()), now())
     order by e.month desc
     limit 1
  ),
  assessed as (
    select q.boq_item_id, q.quantity_to_date
      from public.progress_assessment_quantities q join latest l on l.id = q.entry_id
  )
  select jsonb_build_object(
    'currency',      p.currency,
    'contract_net',  p.contract_net,
    'work_billed',   coalesce((select sum(net + recovery) from counted where not is_down_payment), 0),
    'dp_billed',     coalesce((select sum(net) from counted where is_down_payment), 0),
    'dp_recovered',  coalesce((select sum(recovery) from counted where not is_down_payment), 0),
    'not_submitted', coalesce((select sum(gross_amount - dp_recovery_amount) from c
                                where si_status is null or si_status = 'Draft'), 0),
    'assessment',    (select jsonb_build_object('month', l.month, 'pct_complete', l.pct_complete) from latest l),
    'boq',           coalesce((select jsonb_agg(jsonb_build_object(
                                        'boq_item_id', b.id,
                                        'claimed_quantity', coalesce(cl.claimed_quantity, 0),
                                        'assessed_quantity', a.quantity_to_date) order by b.id)
                                 from public.boq_items b
                                 left join claimed cl on cl.boq_item_id = b.id
                                 left join assessed a on a.boq_item_id = b.id
                                where b.project_id = p_project_id), '[]'::jsonb))
  from p
$$;
revoke all on function public.get_project_billing(uuid) from public, anon;
grant execute on function public.get_project_billing(uuid) to authenticated;
