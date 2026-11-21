-- 1400_work_order_closeout_tables.sql — the work-order close-out checklist: the organisation's ordered list (client data, replaced
-- whole by an Admin) and each issued work order's snapshot of it, plus work_orders.closed_by. #2593; FR-WCO-001..002, 021..032.
-- Pattern copied from 1021 billing stages; no billing-stage object is touched. No item name is coded anywhere: items are rows.
-- Nobody writes these tables directly: every write is a SECURITY DEFINER function (1401) or the issue-time trigger (1402).

create table public.closeout_checklist_templates (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  position   smallint not null check (position between 1 and 20),
  name       text not null check (btrim(name) <> '' and length(name) <= 120),
  required   boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, position)
);

create table public.work_order_closeout_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  position      smallint not null check (position between 1 and 20),
  name          text not null check (btrim(name) <> '' and length(name) <= 120),
  required      boolean not null,
  started_on    date,
  done_on       date,
  document_id   uuid references public.project_documents(id),   -- NO ACTION: a cited document cannot be deleted (as evidence)
  attached_by   uuid references public.profiles(id),
  attached_at   timestamptz,
  done_by       uuid references public.profiles(id),
  done_at       timestamptz,
  unique (work_order_id, position),
  check ((document_id is null) = (attached_by is null)),
  check (done_on is null or (document_id is not null and done_by is not null and started_on is not null and done_on >= started_on))
);
create index work_order_closeout_items_org_idx on public.work_order_closeout_items (org_id, work_order_id);
create index work_order_closeout_items_doc_idx on public.work_order_closeout_items (document_id) where document_id is not null;

do $$
declare t text;
begin
  foreach t in array array['closeout_checklist_templates','work_order_closeout_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
  end loop;
end $$;

-- Who closed a work order: stamped by the close guard (1402) from the caller, never written by a client.
alter table public.work_orders add column closed_by uuid references public.profiles(id);
-- Change-history registry (record_changes_catalog_gate): the closer is captured row history.
update public.record_history_config set captured = captured || '{"closed_by":"ref"}'::jsonb
 where table_name = 'work_orders' and not (captured ? 'closed_by');

comment on table public.work_order_closeout_items is
  'An issued work order''s close-out checklist, copied from closeout_checklist_templates when it was issued (1400). Written only by the close-out functions.';
