-- 1784_survey_records_tables.sql — survey-cap-record (part C): a survey record per work order and contract line, who took part as data,
-- and its attached documents. Nobody writes these tables directly: every write is a SECURITY DEFINER function (1786).
-- Reversal: rollback/1784_survey_records_tables_down.sql.
create table public.survey_records (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id),
  project_id            uuid not null references public.projects(id),
  work_order_id         uuid not null references public.work_orders(id),
  boq_item_id           uuid not null references public.boq_items(id),
  survey_date           date not null,
  surveyed_quantity     numeric(14,3) not null check (surveyed_quantity >= 0 and surveyed_quantity < 'Infinity'::numeric),
  quality_ready_quantity numeric(14,3) not null default 0 check (quality_ready_quantity >= 0 and quality_ready_quantity < 'Infinity'::numeric),
  note                  text check (note is null or length(note) <= 500),
  status                text not null default 'draft' check (status in ('draft','confirmed')),
  recorded_by           uuid not null references public.profiles(id),
  recorded_at           timestamptz not null default now(),
  confirmed_by          uuid references public.profiles(id),
  confirmed_at          timestamptz,
  confirm_basis         text check (confirm_basis in ('standard','sole_operator')),
  supersedes_id         uuid references public.survey_records(id),
  superseded_at         timestamptz,
  archived_at           timestamptz,
  constraint survey_records_quality_within_surveyed check (quality_ready_quantity <= surveyed_quantity),
  constraint survey_records_confirmation_pair check
    ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null and confirm_basis is not null)),
  constraint survey_records_archive_draft_only check (archived_at is null or status = 'draft'),
  constraint survey_records_supersede_confirmed_only check (superseded_at is null or status = 'confirmed')
);
create index survey_records_line_idx on public.survey_records (org_id, work_order_id, boq_item_id);
-- One open correction per superseded record (a discarded draft frees it).
create unique index survey_records_one_correction_idx on public.survey_records (supersedes_id)
  where supersedes_id is not null and archived_at is null;

create table public.survey_participants (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id),
  record_id  uuid not null references public.survey_records(id),
  name       text not null check (btrim(name) <> '' and length(name) <= 120),
  company    text check (company is null or length(company) <= 120),
  role_label text check (role_label is null or length(role_label) <= 120),
  profile_id uuid references public.profiles(id)      -- null for a person without an account: the typed name is the fact
);
create index survey_participants_record_idx on public.survey_participants (record_id);

create table public.survey_record_documents (
  record_id   uuid not null references public.survey_records(id),
  document_id uuid not null references public.project_documents(id),   -- NO ACTION: a cited document cannot be deleted
  org_id      uuid not null references public.organizations(id),
  attached_by uuid not null references public.profiles(id),
  attached_at timestamptz not null default now(),
  primary key (record_id, document_id)
);
create index survey_record_documents_doc_idx on public.survey_record_documents (document_id);

do $$
declare t text;
begin
  foreach t in array array['survey_records','survey_participants','survey_record_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format($p$create policy %I on public.%I for select to authenticated
                      using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))$p$, t || '_select', t);
    execute format($p$create policy light_account_deny_select on public.%I as restrictive for select to authenticated
                      using ((select public.actor_is_light()) is not true)$p$, t);
  end loop;
end $$;

comment on table public.survey_records is
  'A measured quantity for one work-order line (1784). Confirmed records sum to the certified quantity; a correction is a new record that supersedes the old one. Written only by the survey functions.';
