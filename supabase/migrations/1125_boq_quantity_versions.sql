-- 1125_boq_quantity_versions.sql — #2578: every contract quantity is a version; the current figure is a server-written cache.
-- Spec: docs/specs/quantity-change-requests.spec.md (FR-QCR-017..020); plan: docs/plans/2026-11-20-quantity-change-requests.md.
-- Reversal: rollback/1125_boq_quantity_versions_down.sql.
--   §1 boq_quantity_versions: append-only (immutability trigger, 42501), org-scoped, read-only to clients.
--   §2 baseline version for every existing contract line (backfill) and every new one (insert trigger).
--   §3 direct-edit guard: once a line has progress, a claim or a confirmed acceptance, boq_items.quantity changes only
--      through an accepted change request (the amend flag is honoured only inside the accepting function, running as
--      the table owner); before that a direct edit appends a `setup_edit` version.

-- ── §1 versions ─────────────────────────────────────────────────────────────────────────────────────
create table public.boq_quantity_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) default '00000000-0000-0000-0000-000000000001',
  boq_item_id uuid not null references public.boq_items(id) on delete cascade,
  version_no  integer not null check (version_no >= 1),
  quantity    numeric(14,3) not null check (quantity > 0 and quantity < 'Infinity'::numeric),
  source      text not null check (source in ('baseline','setup_edit','change_request')),
  request_id  uuid,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (boq_item_id, version_no),
  constraint boq_quantity_versions_request_pair check ((source = 'change_request') = (request_id is not null))
);
create index boq_quantity_versions_org_idx on public.boq_quantity_versions (org_id);
create index boq_quantity_versions_request_idx on public.boq_quantity_versions (request_id) where request_id is not null;
create index boq_quantity_versions_created_by_idx on public.boq_quantity_versions (created_by);

alter table public.boq_quantity_versions enable row level security;
alter table public.boq_quantity_versions force row level security;
create policy boq_quantity_versions_select on public.boq_quantity_versions for select
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member()));
revoke all on public.boq_quantity_versions from public, anon, authenticated;
grant select on public.boq_quantity_versions to authenticated;

-- Append-only for EVERY role (Admin and the service role included). The one exception is the cascade that removes a
-- contract line itself (the parent row is already gone when the foreign-key action runs); a direct delete of a version
-- while its line exists is refused.
create function public.refuse_boq_quantity_version_change() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.boq_items b where b.id = old.boq_item_id) then
    return old;
  end if;
  raise exception 'quantity versions are append-only' using errcode = '42501';
end; $$;
revoke all on function public.refuse_boq_quantity_version_change() from public, anon, authenticated;
create trigger boq_quantity_versions_immutable before update or delete on public.boq_quantity_versions
  for each row execute function public.refuse_boq_quantity_version_change();
create trigger boq_quantity_versions_no_truncate before truncate on public.boq_quantity_versions
  for each statement execute function public.refuse_boq_quantity_version_change();

-- ── §2 baseline: backfill + new lines ───────────────────────────────────────────────────────────────
insert into public.boq_quantity_versions (org_id, boq_item_id, version_no, quantity, source, created_at)
select b.org_id, b.id, 1, b.quantity, 'baseline', b.created_at from public.boq_items b;

create function public.boq_quantity_baseline() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.boq_quantity_versions (org_id, boq_item_id, version_no, quantity, source, created_by)
  values (new.org_id, new.id, 1, new.quantity, 'baseline', auth.uid());
  return new;
end; $$;
revoke all on function public.boq_quantity_baseline() from public, anon, authenticated;
create trigger boq_items_zz_quantity_baseline after insert on public.boq_items
  for each row execute function public.boq_quantity_baseline();

-- ── §3 the direct-edit guard ────────────────────────────────────────────────────────────────────────
-- "Has this line moved at all?" — progress (an assessed quantity above zero, a validated daily-report quantity),
-- a claim line, or a confirmed acceptance. A pure read, executable by the caller so the invoker-rights guard below can
-- use it; it answers only for a line of the caller's own organisation.
create function public.boq_item_quantity_locked(p_item uuid) returns boolean
  language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.boq_items b
                  where b.id = p_item
                    and (auth.uid() is null or (b.org_id = public.auth_org_id() and public.is_active_member())))
     and (   exists (select 1 from public.progress_assessment_quantities q where q.boq_item_id = p_item and q.quantity_to_date > 0)
          or exists (select 1 from public.progress_claim_lines l where l.boq_item_id = p_item)
          or exists (select 1 from public.work_order_acceptance_lines al join public.work_order_acceptances a on a.id = al.acceptance_id
                      where al.boq_item_id = p_item and a.status = 'Confirmed')
          or exists (select 1 from public.dsr_progress_lines d
                       join public.work_order_lines wl on wl.id = d.work_order_line_id
                       join public.daily_site_reports r on r.id = d.report_id
                      where wl.boq_item_id = p_item and r.status = 'validated' and r.superseded_at is null and r.archived_at is null))
$$;
revoke all on function public.boq_item_quantity_locked(uuid) from public, anon;
grant execute on function public.boq_item_quantity_locked(uuid) to authenticated;

-- Invoker rights ON PURPOSE: `current_user` is the caller's role. The accepting function runs as the table owner and
-- sets the transaction flag; nobody else can satisfy both (a client's current_user is `authenticated`).
create function public.guard_boq_quantity_change() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if new.quantity is not distinct from old.quantity then return new; end if;
  if current_user = 'postgres' and coalesce(current_setting('pmo.qcr_amend_quantity', true), '') = 'on' then
    return new;
  end if;
  if public.boq_item_quantity_locked(old.id) then
    raise exception 'use a quantity change request: this contract line already has progress, a claim or a confirmed acceptance'
      using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.guard_boq_quantity_change() from public, anon, authenticated;
create trigger boq_items_zz_quantity_guard before update of quantity on public.boq_items
  for each row execute function public.guard_boq_quantity_change();

-- A direct edit that passed the guard is a `setup_edit` version; the accepting function writes its own version row.
create function public.boq_quantity_setup_edit() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.quantity is distinct from old.quantity
     and coalesce(current_setting('pmo.qcr_amend_quantity', true), '') <> 'on' then
    insert into public.boq_quantity_versions (org_id, boq_item_id, version_no, quantity, source, created_by)
    select new.org_id, new.id, coalesce(max(v.version_no), 0) + 1, new.quantity, 'setup_edit', auth.uid()
      from public.boq_quantity_versions v where v.boq_item_id = new.id;
  end if;
  return new;
end; $$;
revoke all on function public.boq_quantity_setup_edit() from public, anon, authenticated;
create trigger boq_items_zz_quantity_setup_edit after update of quantity on public.boq_items
  for each row execute function public.boq_quantity_setup_edit();
