-- 1365_claim_billing_steps_columns.sql — owner role and own target date on a claim's billing step; organisation step templates (#2680).
-- Spec docs/specs/claim-billing-steps.spec.md (FR-CBS-001/010/020, NFR-CBS-001..003); proven by supabase/tests/1365_claim_billing_steps.test.sql.
-- Additive: every new column is nullable, so an organisation that sets no owner role or template sees no change. The steps ARE the
-- existing claim_billing_stages rows (OD-SCOPE-6: one billing record, no task copies). No client write grant exists on any new table;
-- they are written only by the RPCs of 1366/1367.
-- ── REVERSE: rollback/1365_claim_billing_steps_columns_down.sql ──────────────────────────────────────────────────────

alter table public.billing_stage_templates add column owner_role public.user_role;
alter table public.claim_billing_stages
  add column owner_role public.user_role,
  add column target_on  date;

-- The step editor renumbers positions inside one statement; make the uniqueness check deferrable so an UPDATE need not order its rows.
alter table public.claim_billing_stages drop constraint claim_billing_stages_claim_id_position_key;
alter table public.claim_billing_stages add constraint claim_billing_stages_claim_id_position_key
  unique (claim_id, position) deferrable initially immediate;

-- The needs-you read: current steps by owner role.
create index claim_billing_stages_waiting_idx on public.claim_billing_stages (org_id, owner_role)
  where completed_on is null and skipped_on is null and started_on is not null and owner_role is not null;

-- The overdue job now also reads a step's own target date (1368): widen its scan.
drop index public.claim_billing_stages_overdue_idx;
create index claim_billing_stages_overdue_idx on public.claim_billing_stages (project_id)
  where completed_on is null and skipped_on is null and (target_days is not null or target_on is not null) and overdue_notified_at is null;

-- ── organisation step templates (client data; nothing is seeded) ───────────────────────────────────────────────────────
create table public.billing_step_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  archived_at timestamptz,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create unique index billing_step_templates_name_idx on public.billing_step_templates (org_id, lower(btrim(name))) where archived_at is null;

create table public.billing_step_template_steps (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id),
  template_id uuid not null references public.billing_step_templates(id) on delete cascade,
  position    smallint not null check (position between 1 and 20),
  name        text not null check (btrim(name) <> '' and length(name) <= 120),
  owner_role  public.user_role,
  target_days smallint check (target_days between 1 and 365),
  client_side boolean not null default false,
  optional    boolean not null default false,
  unique (template_id, position)
);
create index billing_step_template_steps_org_idx on public.billing_step_template_steps (org_id, template_id);

create table public.billing_step_template_documents (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references public.organizations(id),
  step_id  uuid not null references public.billing_step_template_steps(id) on delete cascade,
  position smallint not null,
  name     text not null check (btrim(name) <> '' and length(name) <= 200),
  required boolean not null default true,
  unique (step_id, position)
);
create index billing_step_template_documents_org_idx on public.billing_step_template_documents (org_id, step_id);

-- RLS as the stage tables (1021): active members of the organisation read (Engineers excluded); nobody writes directly.
do $$
declare t text;
begin
  foreach t in array array['billing_step_templates','billing_step_template_steps','billing_step_template_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
    execute format($p$create policy %I on public.%I as restrictive for select to authenticated
                      using ((select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'))$p$, t || '_engineer_read_scope', t);
  end loop;
end $$;

-- ── the claim copy now carries the owner role ──────────────────────────────────────────────────────────────────────────
create or replace function public.instantiate_claim_billing_stages() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'progress' then return new; end if;
  insert into public.claim_billing_stages (org_id, claim_id, project_id, position, name, client_side, target_days, optional, owner_role, started_on)
  select new.org_id, new.id, new.project_id, t.position, t.name, t.client_side, t.target_days, t.optional, t.owner_role,
         case when t.position = (select min(t2.position) from public.billing_stage_templates t2 where t2.project_id = new.project_id)
              then public.native_org_today(new.org_id) end
    from public.billing_stage_templates t
   where t.project_id = new.project_id and t.org_id = new.org_id;
  insert into public.claim_billing_stage_documents (org_id, stage_id, claim_id, position, name, required)
  select new.org_id, s.id, new.id, d.position, d.name, d.required
    from public.claim_billing_stages s
    join public.billing_stage_templates t on t.project_id = new.project_id and t.position = s.position
    join public.billing_stage_template_documents d on d.template_id = t.id
   where s.claim_id = new.id;
  return new;
end; $$;
revoke all on function public.instantiate_claim_billing_stages() from public, anon, authenticated;
