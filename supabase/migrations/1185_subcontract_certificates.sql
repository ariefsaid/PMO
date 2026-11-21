-- 1185_subcontract_certificates.sql — #2584 Slice 2: the subcontractor progress certificate, its derive, backcharges, claims.
-- Spec docs/specs/subcontractor-progress-certificate.spec.md (FR-SPC-004..009, 011, 013, 018..021; NFR-SPC-001/002/005).
-- Plan docs/plans/2026-11-20-subcontractor-progress-certificate.md. Proven by supabase/tests/subcontract_certificate_derive.test.sql
-- and supabase/tests/subcontract_certificate_immutability.test.sql.
-- Rollback: rollback/1185_subcontract_certificates_down.sql (refused while a certificate or backcharge exists).
--
-- A certificate is a calculation and approval record. It is one subcontract PO, one calendar month, the PO's work order.
-- draft / returned: lines are DERIVED on every read (spc_derive); nothing is reserved. submit (1137) FREEZES them: lines,
-- claims on the measured work (one live claim per work order, date, contract line and crew — by the unique index, whatever
-- the PO), the backcharges' claim and the totals. approved / billed are immutable by trigger, including for the table owner.
-- The state-change RPCs (1137) are the only writers; every child write is gated by a session setting only they set.

-- ── §1 tables ───────────────────────────────────────────────────────────────────────────────────────
create table public.subcontract_certificates (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  procurement_id    uuid not null references public.procurements(id),
  po_id             uuid not null references public.purchase_orders(id),
  project_id        uuid not null references public.projects(id),
  work_order_id     uuid not null references public.work_orders(id),
  vendor_company_id uuid not null references public.companies(id),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  period_start      date not null,
  period_end        date not null,
  status            text not null default 'draft' check (status in ('draft', 'submitted', 'returned', 'approved', 'billed', 'cancelled')),
  prepared_by       uuid not null references public.profiles(id),
  submitted_by      uuid references public.profiles(id),
  submitted_at      timestamptz,
  approved_by       uuid references public.profiles(id),
  approved_at       timestamptz,
  returned_reason   text check (returned_reason is null or char_length(btrim(returned_reason)) between 1 and 500),
  cancel_reason     text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 500),
  cancelled_by      uuid references public.profiles(id),
  gross             numeric(16,2) check (gross is null or gross >= 0),
  backcharge_total  numeric(16,2) check (backcharge_total is null or backcharge_total >= 0),
  net               numeric(16,2),
  unrated           jsonb,                       -- frozen at submit: items measured but not rated, with the reason
  excluded          jsonb,                       -- frozen at submit: every excluded source with its reason
  invoice_id        uuid references public.procurement_invoices(id),
  billed_at         timestamptz,
  bill_refusal      text,                        -- the last refusal of the capture, shown on the screen (FR-SPC-016)
  bill_refusal_at   timestamptz,
  acceptance_id     uuid references public.subcontract_acceptances(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint subcontract_certificates_period check
    (period_start = date_trunc('month', period_start)::date and period_end = (date_trunc('month', period_start) + interval '1 month - 1 day')::date),
  constraint subcontract_certificates_sod check
    (approved_by is null or (approved_by is distinct from prepared_by and approved_by is distinct from submitted_by)),
  constraint subcontract_certificates_frozen check
    (status in ('draft', 'returned', 'cancelled') or (gross is not null and backcharge_total is not null and net is not null)),
  constraint subcontract_certificates_net check (net is null or net = gross - backcharge_total),
  constraint subcontract_certificates_billed check ((status = 'billed') = (invoice_id is not null))
);
-- At most one non-cancelled certificate per PO and period.
create unique index subcontract_certificates_one_per_period on public.subcontract_certificates (po_id, period_start) where status <> 'cancelled';
create index subcontract_certificates_project on public.subcontract_certificates (org_id, project_id, period_start desc, id desc);
create index subcontract_certificates_wo on public.subcontract_certificates (work_order_id, period_start);
create index subcontract_certificates_vendor on public.subcontract_certificates (org_id, vendor_company_id, period_start desc);
create index subcontract_certificates_invoice on public.subcontract_certificates (invoice_id) where invoice_id is not null;

-- Frozen item lines (written at submit).
create table public.subcontract_certificate_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  certificate_id    uuid not null references public.subcontract_certificates(id),
  boq_item_id       uuid not null references public.boq_items(id),
  item_code         text not null,
  unit              text not null,
  measured_quantity numeric(14,3) not null check (measured_quantity > 0 and measured_quantity < 'Infinity'::numeric),
  rate              numeric(14,2) not null check (rate >= 0 and rate < 'Infinity'::numeric),
  po_rate           numeric(14,2) not null,
  amount            numeric(14,2) generated always as (round(measured_quantity * rate, 2)) stored,
  unique (certificate_id, boq_item_id)
);
-- The claim on measured work: one live claim per (work order, date, contract line, crew). Rows exist only while a certificate
-- is live; return and cancel delete them. The unique index is the arbiter of two certificates racing for the same work.
create table public.subcontract_certificate_claims (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  certificate_id     uuid not null references public.subcontract_certificates(id),
  work_order_id      uuid not null references public.work_orders(id),
  work_date          date not null,
  work_order_line_id uuid not null references public.work_order_lines(id),
  crew_id            uuid not null references public.crews(id),
  boq_item_id        uuid not null references public.boq_items(id),
  quantity           numeric(14,3) not null check (quantity > 0)
);
create unique index subcontract_certificate_claims_one_live on public.subcontract_certificate_claims
  (work_order_id, work_date, work_order_line_id, crew_id);
create index subcontract_certificate_claims_cert on public.subcontract_certificate_claims (certificate_id);
-- A measured line the preparer set aside (FR-SPC-007). Draft state; it holds nothing.
create table public.subcontract_certificate_deselections (
  org_id             uuid not null references public.organizations(id) on delete cascade,
  certificate_id     uuid not null references public.subcontract_certificates(id),
  work_date          date not null,
  work_order_line_id uuid not null references public.work_order_lines(id),
  crew_id            uuid not null references public.crews(id),
  reason             text not null check (char_length(btrim(reason)) between 1 and 300),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  primary key (certificate_id, work_date, work_order_line_id, crew_id)
);
-- A recovery from the subcontractor (FR-SPC-009). Included in at most one live certificate (claimed_by_certificate_id).
create table public.subcontract_backcharges (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  vendor_company_id       uuid not null references public.companies(id),
  project_id              uuid not null references public.projects(id),
  work_order_id           uuid references public.work_orders(id),
  currency                text not null check (currency ~ '^[A-Z]{3}$'),
  amount                  numeric(14,2) not null check (amount > 0 and amount < 'Infinity'::numeric),
  reason_code             text not null check (reason_code in ('rework', 'damaged', 'safety', 'materials_supplied', 'other')),
  reason_text             text check (reason_text is null or char_length(btrim(reason_text)) between 1 and 500),
  proof_document_id       uuid references public.project_documents(id),
  claimed_by_certificate_id uuid references public.subcontract_certificates(id),
  created_by              uuid not null references public.profiles(id),
  created_at              timestamptz not null default now(),
  archived_at             timestamptz
);
create index subcontract_backcharges_vendor on public.subcontract_backcharges (org_id, vendor_company_id, project_id) where archived_at is null;
create index subcontract_backcharges_claim on public.subcontract_backcharges (claimed_by_certificate_id) where claimed_by_certificate_id is not null;
-- A backcharge chosen for a certificate; the amount is stamped at submit.
create table public.subcontract_certificate_backcharges (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  certificate_id uuid not null references public.subcontract_certificates(id),
  backcharge_id  uuid not null references public.subcontract_backcharges(id),
  amount         numeric(14,2),
  primary key (certificate_id, backcharge_id)
);
create index subcontract_certificate_backcharges_bc on public.subcontract_certificate_backcharges (backcharge_id);

-- ── §2 guards: tenancy from the parent, and the immutability that makes approved final ────────────────
-- Child rows take their org from the parent certificate, never from the caller.
create function public.guard_spc_child() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text; v_org uuid; v_cert uuid;
begin
  v_cert := case when tg_op = 'DELETE' then old.certificate_id else new.certificate_id end;
  select c.status, c.org_id into v_status, v_org from public.subcontract_certificates c where c.id = v_cert;
  if v_status is null then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if tg_op = 'INSERT' then
    new.org_id := v_org;
  elsif new.org_id is distinct from old.org_id and tg_op = 'UPDATE' then
    raise exception 'a certificate row never changes organisation' using errcode = '42501';
  end if;
  if tg_table_name in ('subcontract_certificate_lines', 'subcontract_certificate_claims') then
    -- frozen rows: written at submit (status submitted), removed when the certificate returns to the preparer (lines, claims)
    -- or is cancelled (claims only; the lines stay as the record). Approved and billed are never touched.
    if tg_op = 'INSERT' then
      if v_status <> 'submitted' or coalesce(current_setting('pmo.spc_freeze', true), '') <> 'on' then
        raise exception 'certificate lines are written only when a certificate is submitted' using errcode = '42501'; end if;
    elsif tg_op = 'UPDATE' then
      raise exception 'certificate lines and claims are immutable' using errcode = '42501';
    else
      if coalesce(current_setting('pmo.spc_release', true), '') <> 'on'
         or not (v_status in ('returned', 'draft') or (v_status = 'cancelled' and tg_table_name = 'subcontract_certificate_claims')) then
        raise exception 'certificate lines and claims are immutable once submitted' using errcode = '42501'; end if;
    end if;
  elsif tg_table_name = 'subcontract_certificate_backcharges' then
    if coalesce(current_setting('pmo.spc_draft_write', true), '') <> 'on' and coalesce(current_setting('pmo.spc_freeze', true), '') <> 'on'
       and coalesce(current_setting('pmo.spc_release', true), '') <> 'on' then
      raise exception 'backcharge selection is written through the certificate functions only' using errcode = '42501'; end if;
    if tg_op = 'INSERT' and v_status not in ('draft', 'returned') then
      raise exception 'a submitted certificate''s backcharges are fixed' using errcode = '42501'; end if;
    if tg_op = 'DELETE' and v_status in ('approved', 'billed') then
      raise exception 'an approved certificate''s backcharges are fixed' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and (v_status in ('approved', 'billed')
         or (new.amount is distinct from old.amount and coalesce(current_setting('pmo.spc_freeze', true), '') <> 'on'
             and coalesce(current_setting('pmo.spc_release', true), '') <> 'on')) then
      raise exception 'an approved certificate''s backcharges are fixed' using errcode = '42501'; end if;
  else  -- deselections: draft state only
    if coalesce(current_setting('pmo.spc_draft_write', true), '') <> 'on' or v_status not in ('draft', 'returned') then
      raise exception 'deselections are written on a draft certificate through its function' using errcode = '42501'; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_spc_child() from public, anon, authenticated;
create trigger subcontract_certificate_lines_guard before insert or update or delete on public.subcontract_certificate_lines
  for each row execute function public.guard_spc_child();
create trigger subcontract_certificate_claims_guard before insert or update or delete on public.subcontract_certificate_claims
  for each row execute function public.guard_spc_child();
create trigger subcontract_certificate_deselections_guard before insert or update or delete on public.subcontract_certificate_deselections
  for each row execute function public.guard_spc_child();
create trigger subcontract_certificate_backcharges_guard before insert or update or delete on public.subcontract_certificate_backcharges
  for each row execute function public.guard_spc_child();

-- The certificate row. After submit its identity, period, vendor and totals never change (except the return that clears them);
-- the status moves only along the state machine and only inside the RPCs (pmo.spc_transition).
create function public.guard_spc_certificate() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t boolean := coalesce(current_setting('pmo.spc_transition', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'a certificate is cancelled, never deleted' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or not v_t then
      raise exception 'a certificate is created as a draft by prepare_subcontract_certificate' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.org_id, new.procurement_id, new.po_id, new.project_id, new.work_order_id, new.vendor_company_id, new.currency,
      new.period_start, new.period_end, new.prepared_by)
     is distinct from (old.org_id, old.procurement_id, old.po_id, old.project_id, old.work_order_id, old.vendor_company_id, old.currency,
      old.period_start, old.period_end, old.prepared_by) then
    raise exception 'a certificate''s purchase order, period, vendor and preparer never change' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not v_t or not (
         (old.status in ('draft', 'returned') and new.status in ('submitted', 'cancelled'))
      or (old.status = 'submitted' and new.status in ('returned', 'approved', 'cancelled'))
      or (old.status = 'approved' and new.status in ('billed', 'cancelled'))
      or (old.status = 'billed' and new.status = 'approved')) then
      raise exception 'certificate status % -> % is not allowed here', old.status, new.status using errcode = '42501';
    end if;
  elsif old.status in ('submitted', 'approved', 'billed', 'cancelled') and not v_t then
    -- no status change: nothing but the refusal note and the acceptance link may move on a frozen certificate
    if (new.gross, new.backcharge_total, new.net, new.unrated, new.excluded, new.submitted_by, new.submitted_at, new.approved_by, new.approved_at,
        new.invoice_id, new.billed_at, new.returned_reason, new.cancel_reason)
       is distinct from (old.gross, old.backcharge_total, old.net, old.unrated, old.excluded, old.submitted_by, old.submitted_at, old.approved_by, old.approved_at,
        old.invoice_id, old.billed_at, old.returned_reason, old.cancel_reason) then
      raise exception 'a submitted certificate''s totals and lines are fixed' using errcode = '42501'; end if;
  end if;
  -- totals, once frozen, move only at the transition that unfreezes them (return) — never on an approved or billed certificate
  if old.status in ('approved', 'billed') and (new.gross, new.backcharge_total, new.net, new.unrated, new.excluded, new.submitted_by, new.submitted_at)
       is distinct from (old.gross, old.backcharge_total, old.net, old.unrated, old.excluded, old.submitted_by, old.submitted_at) then
    raise exception 'an approved certificate''s totals and lines are fixed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.guard_spc_certificate() from public, anon, authenticated;
create trigger subcontract_certificates_guard before insert or update or delete on public.subcontract_certificates
  for each row execute function public.guard_spc_certificate();

-- A backcharge: written by its functions; once claimed by a certificate, never changed or archived while that claim stands.
create function public.guard_spc_backcharge() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_w boolean := coalesce(current_setting('pmo.spc_backcharge', true), '') = 'on';
begin
  if tg_op = 'DELETE' then raise exception 'a backcharge is archived, never deleted' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if not v_w then raise exception 'backcharges are written through record_subcontract_backcharge' using errcode = '42501'; end if;
    if new.claimed_by_certificate_id is not null then raise exception 'a new backcharge is unclaimed' using errcode = '42501'; end if;
    return new;
  end if;
  if (new.org_id, new.vendor_company_id, new.project_id, new.work_order_id, new.currency, new.amount, new.reason_code, new.reason_text,
      new.proof_document_id, new.created_by)
     is distinct from (old.org_id, old.vendor_company_id, old.project_id, old.work_order_id, old.currency, old.amount, old.reason_code, old.reason_text,
      old.proof_document_id, old.created_by) then
    raise exception 'a backcharge is not edited; archive it and record another' using errcode = '42501'; end if;
  if new.claimed_by_certificate_id is distinct from old.claimed_by_certificate_id then
    -- claimed only by a submitted certificate (null -> cert), released only once its certificate is back with the preparer or
    -- cancelled (cert -> null): the claim of an approved or billed certificate is never moved, by any path.
    if (old.claimed_by_certificate_id is null and (coalesce(current_setting('pmo.spc_freeze', true), '') <> 'on'
          or (select c.status from public.subcontract_certificates c where c.id = new.claimed_by_certificate_id) is distinct from 'submitted'))
       or (old.claimed_by_certificate_id is not null and (new.claimed_by_certificate_id is not null
          or coalesce(current_setting('pmo.spc_release', true), '') <> 'on'
          or (select c.status from public.subcontract_certificates c where c.id = old.claimed_by_certificate_id) not in ('returned', 'draft', 'cancelled'))) then
      raise exception 'a backcharge is claimed or released with its certificate' using errcode = '42501'; end if;
  end if;
  if new.archived_at is distinct from old.archived_at and (not v_w or old.claimed_by_certificate_id is not null) then
    raise exception 'a backcharge in a live certificate cannot be archived' using errcode = '42501'; end if;
  return new;
end $$;
revoke all on function public.guard_spc_backcharge() from public, anon, authenticated;
create trigger subcontract_backcharges_guard before insert or update or delete on public.subcontract_backcharges
  for each row execute function public.guard_spc_backcharge();

-- ── §3 access ────────────────────────────────────────────────────────────────────────────────────────
-- Prepare / record backcharges: Project Manager (own projects), Finance, Admin. Executive reads, never prepares.
create function public.spc_may_prepare(p_project uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select (select public.is_active_member()) and (
    (select public.auth_role()) in ('Admin', 'Finance')
    or ((select public.auth_role()) = 'Project Manager' and exists (
          select 1 from public.projects pj where pj.id = p_project and pj.org_id = (select public.auth_org_id())
             and pj.project_manager_id = (select auth.uid()))))
$$;
revoke all on function public.spc_may_prepare(uuid) from public, anon;
grant execute on function public.spc_may_prepare(uuid) to authenticated;
create function public.spc_may_read(p_project uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select (select public.is_active_member()) and (
    (select public.auth_role()) in ('Admin', 'Executive', 'Finance')
    or ((select public.auth_role()) = 'Project Manager' and exists (
          select 1 from public.projects pj where pj.id = p_project and pj.org_id = (select public.auth_org_id())
             and pj.project_manager_id = (select auth.uid()))))
$$;
revoke all on function public.spc_may_read(uuid) from public, anon;
grant execute on function public.spc_may_read(uuid) to authenticated;

do $rls$
declare t text;
begin
  foreach t in array array['subcontract_certificates', 'subcontract_certificate_lines', 'subcontract_certificate_claims',
                           'subcontract_certificate_deselections', 'subcontract_backcharges', 'subcontract_certificate_backcharges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $rls$;
create policy subcontract_certificates_select on public.subcontract_certificates for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.spc_may_read(project_id));
create policy subcontract_backcharges_select on public.subcontract_backcharges for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()) and public.spc_may_read(project_id));
-- Children inherit the parent's visibility: the parent must be visible under the caller's own RLS.
create policy subcontract_certificate_lines_select on public.subcontract_certificate_lines for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.subcontract_certificates c where c.id = certificate_id));
create policy subcontract_certificate_claims_select on public.subcontract_certificate_claims for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.subcontract_certificates c where c.id = certificate_id));
create policy subcontract_certificate_deselections_select on public.subcontract_certificate_deselections for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.subcontract_certificates c where c.id = certificate_id));
create policy subcontract_certificate_backcharges_select on public.subcontract_certificate_backcharges for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and exists (select 1 from public.subcontract_certificates c where c.id = certificate_id));

-- ── §4 the derive (FR-SPC-005/006/008/009; AC-SPC-001..005) ─────────────────────────────────────────────
-- Internal, server-side, from validated daily reports and the rate card. A client never supplies a quantity or an amount.
-- Returns jsonb: lines (per item, with the cap picture), tuples (the measured work to claim), excluded (every source left
-- out, with its reason), unrated, backcharges, gross, backcharge_total, net. NFR-SPC-003: an unreadable input yields no line.
create function public.spc_derive(p_cert uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.subcontract_certificates; v_rev integer; v_out jsonb;
begin
  select * into c from public.subcontract_certificates where id = p_cert;
  if c.id is null then return null; end if;
  v_rev := public.po_effective_revision(c.po_id);
  with po as (
    select pl.boq_item_id, pl.quantity as po_qty, pl.rate as po_rate, pl.unit
      from public.purchase_order_lines pl where pl.po_id = c.po_id and pl.revision = v_rev
  ), cand as (
    select r.id as report_id, r.work_date, l.work_order_line_id, l.crew_id, wl.boq_item_id, b.item_code, l.quantity,
           case when r.superseded_at is not null then 'report_superseded'
                when r.status <> 'validated' then 'report_not_validated'
                when l.crew_id is null or cr.kind is distinct from 'vendor' or cr.vendor_company_id is distinct from c.vendor_company_id then 'not_vendor_crew'
                when po.boq_item_id is null then 'item_not_on_po'
                when exists (select 1 from public.subcontract_certificate_claims k
                              where k.certificate_id <> c.id and k.work_order_id = r.work_order_id and k.work_date = r.work_date
                                and k.work_order_line_id = l.work_order_line_id and k.crew_id = l.crew_id) then 'already_certified'
                when exists (select 1 from public.subcontract_certificate_deselections d
                              where d.certificate_id = c.id and d.work_date = r.work_date
                                and d.work_order_line_id = l.work_order_line_id and d.crew_id = l.crew_id) then 'deselected'
                else 'eligible' end as state
      from public.daily_site_reports r
      join public.dsr_progress_lines l on l.report_id = r.id
      join public.work_order_lines wl on wl.id = l.work_order_line_id
      join public.boq_items b on b.id = wl.boq_item_id
      left join public.crews cr on cr.id = l.crew_id
      left join po on po.boq_item_id = wl.boq_item_id
     where r.org_id = c.org_id and r.work_order_id = c.work_order_id and r.archived_at is null
       and r.work_date between c.period_start and c.period_end
  ), tup as (   -- eligible work grouped to the claim key
    select work_date, work_order_line_id, crew_id, boq_item_id, item_code, sum(quantity) as quantity
      from cand where state = 'eligible' group by work_date, work_order_line_id, crew_id, boq_item_id, item_code
  ), item as (
    select t.boq_item_id, t.item_code, sum(t.quantity) as mq from tup t group by t.boq_item_id, t.item_code
  ), rated as (
    select i.boq_item_id, i.item_code, i.mq, po.unit, po.po_qty, po.po_rate, rc.rate as card_rate,
           case when rc.id is null then 'unrated_no_rate'
                when rc.currency <> (select o.currency from public.purchase_orders o where o.id = c.po_id) then 'unrated_currency'
                when rc.unit <> po.unit then 'unrated_unit'
                when rc.rate > po.po_rate then 'unrated_above_po_rate'
                end as unrated_reason
      from item i join po on po.boq_item_id = i.boq_item_id
      left join lateral (
        select r.* from public.subcontractor_rate_lines r
         where r.org_id = c.org_id and r.vendor_company_id = c.vendor_company_id and r.boq_item_id = i.boq_item_id
           and r.effective_from <= c.period_start and coalesce(r.effective_to, 'infinity'::date) >= c.period_start
         order by r.version desc limit 1) rc on true
  ), lines as (
    select r.boq_item_id, r.item_code, r.unit, r.mq as measured_quantity, r.card_rate as rate, r.po_rate, r.po_qty,
           round(r.mq * r.card_rate, 2) as amount,
           coalesce(v.quantity, 0) as verified, coalesce(bl.quantity, 0) as billed
      from rated r
      left join public.subcontract_verified(c.po_id) v on v.boq_item_id = r.boq_item_id
      left join public.subcontract_billed(c.po_id, null) bl on bl.boq_item_id = r.boq_item_id
     where r.unrated_reason is null
  ), bc as (
    select b.id, b.amount, b.reason_code, b.reason_text, b.claimed_by_certificate_id,
           (b.claimed_by_certificate_id is not null and b.claimed_by_certificate_id <> c.id) as held
      from public.subcontract_certificate_backcharges s join public.subcontract_backcharges b on b.id = s.backcharge_id
     where s.certificate_id = c.id
  )
  select jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'boq_item_id', l.boq_item_id, 'item_code', l.item_code, 'unit', l.unit, 'measured_quantity', l.measured_quantity,
        'rate', l.rate, 'po_rate', l.po_rate, 'amount', l.amount, 'po_qty', l.po_qty, 'verified', l.verified, 'billed', l.billed,
        'certified_to_date', l.billed + l.measured_quantity,
        'cap_ok', l.billed + l.measured_quantity <= least(l.verified, l.po_qty),
        'verified_short', l.verified < l.billed + l.measured_quantity) order by l.item_code) from lines l), '[]'::jsonb),
    'tuples', coalesce((select jsonb_agg(jsonb_build_object(
        'work_date', t.work_date, 'work_order_line_id', t.work_order_line_id, 'crew_id', t.crew_id,
        'boq_item_id', t.boq_item_id, 'quantity', t.quantity) order by t.work_date, t.item_code)
        from tup t join lines l on l.boq_item_id = t.boq_item_id), '[]'::jsonb),
    'excluded', coalesce((
        select jsonb_agg(x order by x->>'item_code', x->>'work_date') from (
          select jsonb_build_object('work_date', k.work_date, 'work_order_line_id', k.work_order_line_id, 'crew_id', k.crew_id,
                   'boq_item_id', k.boq_item_id, 'item_code', k.item_code, 'quantity', k.quantity, 'reason', k.state,
                   'certificate_id', (select cc.id from public.subcontract_certificate_claims kk join public.subcontract_certificates cc on cc.id = kk.certificate_id
                                       where k.state = 'already_certified' and kk.certificate_id <> c.id and kk.work_order_id = c.work_order_id
                                         and kk.work_date = k.work_date and kk.work_order_line_id = k.work_order_line_id and kk.crew_id = k.crew_id),
                   'period_start', (select cc.period_start from public.subcontract_certificate_claims kk join public.subcontract_certificates cc on cc.id = kk.certificate_id
                                     where k.state = 'already_certified' and kk.certificate_id <> c.id and kk.work_order_id = c.work_order_id
                                       and kk.work_date = k.work_date and kk.work_order_line_id = k.work_order_line_id and kk.crew_id = k.crew_id)) as x
            from cand k where k.state <> 'eligible'
          union all
          select jsonb_build_object('work_date', t.work_date, 'work_order_line_id', t.work_order_line_id, 'crew_id', t.crew_id,
                   'boq_item_id', t.boq_item_id, 'item_code', t.item_code, 'quantity', t.quantity, 'reason', r.unrated_reason)
            from tup t join rated r on r.boq_item_id = t.boq_item_id where r.unrated_reason is not null
        ) e), '[]'::jsonb),
    'unrated', coalesce((select jsonb_agg(jsonb_build_object('boq_item_id', r.boq_item_id, 'item_code', r.item_code,
                  'measured_quantity', r.mq, 'reason', r.unrated_reason) order by r.item_code) from rated r where r.unrated_reason is not null), '[]'::jsonb),
    'backcharges', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'amount', b.amount, 'reason_code', b.reason_code,
                  'reason_text', b.reason_text, 'held', b.held) order by b.id) from bc b), '[]'::jsonb),
    'gross', coalesce((select sum(l.amount) from lines l), 0),
    'backcharge_total', coalesce((select sum(b.amount) from bc b), 0),
    'net', coalesce((select sum(l.amount) from lines l), 0) - coalesce((select sum(b.amount) from bc b), 0))
  into v_out;
  return v_out;
end $$;
revoke all on function public.spc_derive(uuid) from public, anon, authenticated;
grant execute on function public.spc_derive(uuid) to service_role;

-- What the screen reads. A draft or returned certificate is derived live; a submitted or later one reads its frozen snapshot.
create function public.subcontract_certificate_view(p_certificate uuid) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c public.subcontract_certificates; v jsonb;
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = public.auth_org_id();
  if c.id is null or not public.spc_may_read(c.project_id) then
    raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status in ('draft', 'returned') then
    v := public.spc_derive(c.id);                       -- the tuples are the measured days the preparer may set aside
  else
    v := jsonb_build_object(
      'lines', coalesce((select jsonb_agg(jsonb_build_object('boq_item_id', l.boq_item_id, 'item_code', l.item_code, 'unit', l.unit,
                 'measured_quantity', l.measured_quantity, 'rate', l.rate, 'po_rate', l.po_rate, 'amount', l.amount) order by l.item_code)
                 from public.subcontract_certificate_lines l where l.certificate_id = c.id), '[]'::jsonb),
      'excluded', coalesce(c.excluded, '[]'::jsonb), 'unrated', coalesce(c.unrated, '[]'::jsonb),
      'backcharges', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'amount', coalesce(s.amount, b.amount), 'reason_code', b.reason_code,
                 'reason_text', b.reason_text, 'held', false) order by b.id)
                 from public.subcontract_certificate_backcharges s join public.subcontract_backcharges b on b.id = s.backcharge_id
                where s.certificate_id = c.id), '[]'::jsonb),
      'gross', c.gross, 'backcharge_total', c.backcharge_total, 'net', c.net);
  end if;
  return jsonb_build_object('certificate', to_jsonb(c) - 'excluded' - 'unrated', 'derived', v);
end $$;
revoke all on function public.subcontract_certificate_view(uuid) from public, anon;
grant execute on function public.subcontract_certificate_view(uuid) to authenticated;

-- ── §5 preparing (FR-SPC-004/007/009) ───────────────────────────────────────────────────────────────
create function public.prepare_subcontract_certificate(p_po_id uuid, p_period_start date) returns uuid
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_po public.purchase_orders; v_proc public.procurements; v_id uuid;
begin
  perform public.assert_is_active_member();
  select * into v_po from public.purchase_orders where id = p_po_id and org_id = v_org;
  if not found then raise exception 'purchase order not found' using errcode = 'P0002'; end if;
  select * into v_proc from public.procurements where id = v_po.procurement_id and org_id = v_org;
  if not public.spc_may_prepare(v_proc.project_id) then
    raise exception 'you may prepare a certificate on a project you manage, as Finance or as an Admin' using errcode = '42501'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  if p_period_start is null or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'a certificate period is one calendar month, starting on its first day' using errcode = '23514'; end if;
  if not v_proc.is_subcontract or v_proc.vendor_id is null or v_proc.project_id is null then
    raise exception 'a certificate is prepared for a subcontract purchase with a vendor' using errcode = 'SC002'; end if;
  select * into v_proc from public.procurements where id = v_proc.id for update;                           -- D5: row, then PO lock
  perform public.subcontract_po_lock(p_po_id);
  if v_proc.status::text in ('Cancelled', 'Rejected') then raise exception 'this purchase is closed' using errcode = '42501'; end if;
  if public.po_effective_revision(p_po_id) is null then raise exception 'the PO has no issued BoQ lines' using errcode = '42501'; end if;
  if v_po.work_order_id is null then raise exception 'the purchase order names no work order' using errcode = '23514'; end if;
  if not exists (select 1 from public.work_orders w where w.id = v_po.work_order_id and w.org_id = v_org and w.project_id = v_proc.project_id) then
    raise exception 'the purchase order''s work order is not on this project' using errcode = '23514'; end if;
  perform set_config('pmo.spc_transition', 'on', true);
  begin
    insert into public.subcontract_certificates (org_id, procurement_id, po_id, project_id, work_order_id, vendor_company_id, currency,
                                                 period_start, period_end, prepared_by)
    values (v_org, v_proc.id, p_po_id, v_proc.project_id, v_po.work_order_id, v_proc.vendor_id, v_po.currency, p_period_start,
            (p_period_start + interval '1 month - 1 day')::date, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'a certificate already exists for this purchase order and period' using errcode = '23505', detail = 'cert-period-exists';
  end;
  perform set_config('pmo.spc_transition', '', true);
  perform public.log_audit('subcontract_certificate.prepare', v_org, auth.uid(), v_id,
    jsonb_build_object('po_id', p_po_id, 'period_start', p_period_start, 'work_order_id', v_po.work_order_id));
  return v_id;
end $$;
revoke all on function public.prepare_subcontract_certificate(uuid, date) from public, anon;
grant execute on function public.prepare_subcontract_certificate(uuid, date) to authenticated;

-- Set a measured line aside (or put it back). Draft or returned only.
create function public.set_certificate_deselection(p_certificate uuid, p_work_date date, p_work_order_line uuid, p_crew uuid,
                                                   p_deselect boolean, p_reason text default null) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.subcontract_certificates; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = public.auth_org_id() for update;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status not in ('draft', 'returned') then raise exception 'only a draft or returned certificate can be changed' using errcode = '42501'; end if;
  perform set_config('pmo.spc_draft_write', 'on', true);
  if p_deselect then
    if v_reason is null or char_length(v_reason) > 300 then raise exception 'setting a line aside needs a reason' using errcode = '22023'; end if;
    insert into public.subcontract_certificate_deselections (org_id, certificate_id, work_date, work_order_line_id, crew_id, reason, created_by)
    values (c.org_id, c.id, p_work_date, p_work_order_line, p_crew, v_reason, auth.uid())
    on conflict (certificate_id, work_date, work_order_line_id, crew_id) do update set reason = excluded.reason;
  else
    delete from public.subcontract_certificate_deselections
     where certificate_id = c.id and work_date = p_work_date and work_order_line_id = p_work_order_line and crew_id = p_crew;
  end if;
  perform set_config('pmo.spc_draft_write', '', true);
end $$;
revoke all on function public.set_certificate_deselection(uuid, date, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_certificate_deselection(uuid, date, uuid, uuid, boolean, text) to authenticated;

-- Record a backcharge against a vendor on a project (FR-SPC-009).
create function public.record_subcontract_backcharge(p_vendor uuid, p_project uuid, p_work_order uuid, p_amount numeric, p_currency text,
                                                     p_reason_code text, p_reason_text text default null, p_proof_document uuid default null)
  returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.auth_org_id(); v_id uuid; v_cur text := upper(btrim(coalesce(p_currency, '')));
begin
  perform public.assert_is_active_member();
  if not public.spc_may_prepare(p_project) then
    raise exception 'you may record a backcharge on a project you manage, as Finance or as an Admin' using errcode = '42501'; end if;
  perform public.assert_feature_on(v_org, 'procurement');
  if p_amount is null or p_amount <= 0 or p_amount >= 'Infinity'::numeric or round(p_amount, 2) <> p_amount or v_cur !~ '^[A-Z]{3}$'
     or p_reason_code not in ('rework', 'damaged', 'safety', 'materials_supplied', 'other') then
    raise exception 'a backcharge needs a positive amount with at most 2 decimals, a currency and a reason' using errcode = '22023'; end if;
  if not exists (select 1 from public.companies c where c.id = p_vendor and c.org_id = v_org)
     or not exists (select 1 from public.projects p where p.id = p_project and p.org_id = v_org)
     or (p_work_order is not null and not exists (select 1 from public.work_orders w where w.id = p_work_order and w.org_id = v_org and w.project_id = p_project))
     or (p_proof_document is not null and not exists (select 1 from public.project_documents d where d.id = p_proof_document and d.org_id = v_org and d.project_id = p_project)) then
    raise exception 'vendor, project, work order or proof not found' using errcode = 'P0002'; end if;
  perform set_config('pmo.spc_backcharge', 'on', true);
  insert into public.subcontract_backcharges (org_id, vendor_company_id, project_id, work_order_id, currency, amount, reason_code, reason_text,
                                              proof_document_id, created_by)
  values (v_org, p_vendor, p_project, p_work_order, v_cur, p_amount, p_reason_code, nullif(btrim(coalesce(p_reason_text, '')), ''),
          p_proof_document, auth.uid()) returning id into v_id;
  perform set_config('pmo.spc_backcharge', '', true);
  perform public.log_audit('subcontract_backcharge.record', v_org, auth.uid(), v_id,
    jsonb_build_object('vendor_company_id', p_vendor, 'project_id', p_project, 'amount', p_amount, 'reason_code', p_reason_code));
  return v_id;
end $$;
revoke all on function public.record_subcontract_backcharge(uuid, uuid, uuid, numeric, text, text, text, uuid) from public, anon;
grant execute on function public.record_subcontract_backcharge(uuid, uuid, uuid, numeric, text, text, text, uuid) to authenticated;

create function public.archive_subcontract_backcharge(p_backcharge uuid) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.subcontract_backcharges;
begin
  perform public.assert_is_active_member();
  select * into b from public.subcontract_backcharges where id = p_backcharge and org_id = public.auth_org_id() for update;
  if b.id is null or not public.spc_may_prepare(b.project_id) then raise exception 'backcharge not found' using errcode = 'P0002'; end if;
  if b.claimed_by_certificate_id is not null or exists (select 1 from public.subcontract_certificate_backcharges s
       join public.subcontract_certificates c on c.id = s.certificate_id where s.backcharge_id = b.id and c.status in ('draft', 'returned')) then
    raise exception 'a backcharge in a certificate cannot be archived' using errcode = '23514'; end if;
  perform set_config('pmo.spc_backcharge', 'on', true);
  update public.subcontract_backcharges set archived_at = now() where id = b.id;
  perform set_config('pmo.spc_backcharge', '', true);
  perform public.log_audit('subcontract_backcharge.archive', b.org_id, auth.uid(), b.id, '{}'::jsonb);
end $$;
revoke all on function public.archive_subcontract_backcharge(uuid) from public, anon;
grant execute on function public.archive_subcontract_backcharge(uuid) to authenticated;

-- Include or leave out a backcharge on a draft. A backcharge another live certificate holds is refused with that period.
create function public.set_certificate_backcharge(p_certificate uuid, p_backcharge uuid, p_include boolean) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.subcontract_certificates; b public.subcontract_backcharges; v_other public.subcontract_certificates;
begin
  perform public.assert_is_active_member();
  select * into c from public.subcontract_certificates where id = p_certificate and org_id = public.auth_org_id() for update;
  if c.id is null or not public.spc_may_prepare(c.project_id) then raise exception 'certificate not found' using errcode = 'P0002'; end if;
  if c.status not in ('draft', 'returned') then raise exception 'only a draft or returned certificate can be changed' using errcode = '42501'; end if;
  perform set_config('pmo.spc_draft_write', 'on', true);
  if p_include then
    select * into b from public.subcontract_backcharges where id = p_backcharge and org_id = c.org_id and archived_at is null;
    if b.id is null then raise exception 'backcharge not found' using errcode = 'P0002'; end if;
    if b.vendor_company_id <> c.vendor_company_id or b.project_id <> c.project_id or b.currency <> c.currency
       or (b.work_order_id is not null and b.work_order_id <> c.work_order_id) then
      raise exception 'this backcharge is not against this subcontractor, project, work order and currency' using errcode = '23514'; end if;
    if b.claimed_by_certificate_id is not null and b.claimed_by_certificate_id <> c.id then
      select * into v_other from public.subcontract_certificates where id = b.claimed_by_certificate_id;
      raise exception 'already certified in %', to_char(v_other.period_start, 'YYYY-MM') using errcode = '23505', detail = 'already-certified';
    end if;
    insert into public.subcontract_certificate_backcharges (org_id, certificate_id, backcharge_id) values (c.org_id, c.id, b.id)
      on conflict do nothing;
  else
    delete from public.subcontract_certificate_backcharges where certificate_id = c.id and backcharge_id = p_backcharge;
  end if;
  perform set_config('pmo.spc_draft_write', '', true);
end $$;
revoke all on function public.set_certificate_backcharge(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_certificate_backcharge(uuid, uuid, boolean) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['subcontract_certificates', 'subcontract_certificate_lines', 'subcontract_certificate_claims',
                           'subcontract_certificate_deselections', 'subcontract_backcharges', 'subcontract_certificate_backcharges'] loop
    if not (select c.relforcerowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then
      raise exception '1136: % lacks FORCE RLS', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception '1136: % holds a client DML grant', t; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.spc_derive(uuid)', 'EXECUTE') then
    raise exception '1136: spc_derive is client-executable'; end if;
end $$;
