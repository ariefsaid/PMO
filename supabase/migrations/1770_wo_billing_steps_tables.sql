-- 1770_wo_billing_steps_tables.sql — a work order's billing step list (advisory; never gates invoicing). Spec docs/specs/billing-steps.spec.md.
-- Rollback: supabase/migrations/rollback/1770_wo_billing_steps_tables_down.sql
-- Pattern copied from the close-out checklist (1400): the organisation's template, a snapshot per issued work order, definer-only writes.
-- Nothing here touches claim_billing_stages or billing_stages_open: claims keep their own steps and their own gate.

-- The template step gains the two role fields the work-order list reads (claim copies ignore them). The old owner_role (an access level)
-- stays for claims.
alter table public.billing_step_template_steps
  add column owner_role_key text references public.built_in_roles(key),
  add column hidden_from_role_keys text[] not null default '{}'
    check (cardinality(hidden_from_role_keys) <= 30);
alter table public.billing_step_template_steps
  add constraint billing_step_template_steps_owner_key_not_light check (owner_role_key is null or not public.is_light_role_key(owner_role_key));

-- The organisation's default template: none until an Admin or Finance person chooses one.
create table public.org_billing_step_settings (
  org_id              uuid primary key references public.organizations(id) on delete cascade,
  default_template_id uuid references public.billing_step_templates(id),
  updated_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now()
);

create table public.work_order_billing_steps (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id),
  work_order_id        uuid not null references public.work_orders(id) on delete cascade,
  project_id           uuid not null references public.projects(id) on delete cascade,
  position             smallint not null check (position between 1 and 20),
  name                 text not null check (btrim(name) <> '' and length(name) <= 120),
  owner_role_key       text references public.built_in_roles(key),
  assignee_id          uuid references public.profiles(id),
  target_days          smallint check (target_days between 1 and 365),
  optional             boolean not null default false,
  hidden_from_role_keys text[] not null default '{}' check (cardinality(hidden_from_role_keys) <= 30),
  started_on           date,
  done_on              date,
  done_by              uuid references public.profiles(id),
  done_at              timestamptz,
  skipped_on           date,
  skipped_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  unique (work_order_id, position),
  check (owner_role_key is null or not public.is_light_role_key(owner_role_key)),
  check (done_on is null or skipped_on is null),
  check (done_on is null or (started_on is not null and done_by is not null and done_on >= started_on))
);
create index work_order_billing_steps_org_idx on public.work_order_billing_steps (org_id, work_order_id);
create index work_order_billing_steps_waiting_idx on public.work_order_billing_steps (org_id, owner_role_key)
  where done_on is null and skipped_on is null and started_on is not null;
create index work_order_billing_steps_assignee_idx on public.work_order_billing_steps (assignee_id) where assignee_id is not null;

create table public.work_order_billing_step_documents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id),
  step_id       uuid not null references public.work_order_billing_steps(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  position      smallint not null check (position >= 1),
  name          text not null check (btrim(name) <> '' and length(name) <= 200),
  required      boolean not null default true,
  document_id   uuid references public.project_documents(id),   -- NO ACTION: a cited document cannot be deleted as evidence
  attached_by   uuid references public.profiles(id),
  attached_at   timestamptz,
  unique (step_id, position),
  check ((document_id is null) = (attached_by is null))
);
create index work_order_billing_step_documents_org_idx on public.work_order_billing_step_documents (org_id, work_order_id);
create index work_order_billing_step_documents_doc_idx on public.work_order_billing_step_documents (document_id) where document_id is not null;

do $$
declare t text;
begin
  foreach t in array array['org_billing_step_settings','work_order_billing_steps','work_order_billing_step_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    -- A field account reads none of them (the 2711 boundary): inert for every other account.
    execute format($p$create policy light_account_deny_select on public.%I as restrictive for select to authenticated
                      using ((select public.actor_is_light()) is not true)$p$, t);
  end loop;
end $$;

-- The settings are read by active members of the organisation who may read the organisation's templates (the four money levels).
create policy org_billing_step_settings_select on public.org_billing_step_settings for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));

comment on table public.work_order_billing_steps is
  'A work order''s billing step list, copied from the organisation''s default billing step template when the work order is issued (1773). Advisory: no invoice gate reads it. Written only by the 1772 functions.';
comment on column public.work_order_billing_steps.hidden_from_role_keys is
  'Built-in role keys that do not see this step (nor its documents); the named person is exempt (1771 wo_step_readable).';
