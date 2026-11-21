-- 1321_dsr_stock_postings.sql — #2676 (FR-DRS-016, 040). What a validated report did to stock: one row per report, one per material line.
-- Written only by dsr_post_stock / dsr_reverse_stock (1323). Clients read under org RLS; there is no write grant.
-- Idempotence is structural: unique report_id, unique consumable_id, unique issue_line_id.
-- ── REVERSE: rollback/1321_dsr_stock_postings_down.sql.
create table public.dsr_stock_postings (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  report_id            uuid not null references public.daily_site_reports(id) on delete cascade,
  state                text not null check (state in ('posted', 'partial', 'flagged', 'out_of_scope')),
  reason               text check (reason is null or char_length(reason) <= 300),
  warehouse_id         uuid references public.stock_warehouses(id),
  issue_document_id    uuid references public.stock_documents(id),
  occurred_on          date,
  reversal_document_id uuid references public.stock_documents(id),
  reversed_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint dsr_stock_postings_report_uniq unique (report_id)                                       -- mut:drs_idem_posting
);
create table public.dsr_stock_posting_lines (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  posting_id        uuid not null references public.dsr_stock_postings(id) on delete cascade,
  consumable_id     uuid not null references public.dsr_consumables(id) on delete cascade,
  item_id           uuid not null references public.stock_items(id),
  quantity          numeric(14,3) not null,
  state             text not null check (state in ('pending', 'posted', 'short', 'no_location', 'no_work_item', 'not_stocked', 'failed')),
  short_by          numeric(14,3),
  reason            text check (reason is null or char_length(reason) <= 300),
  issue_line_id     uuid references public.stock_document_lines(id),
  constraint dsr_stock_posting_lines_consumable_uniq unique (consumable_id),                          -- mut:drs_idem_line
  constraint dsr_stock_posting_lines_issue_line_uniq unique (issue_line_id)
);
create index dsr_stock_posting_lines_posting on public.dsr_stock_posting_lines (posting_id);
create index dsr_stock_postings_issue_doc on public.dsr_stock_postings (issue_document_id);
create index dsr_stock_postings_reversal_doc on public.dsr_stock_postings (reversal_document_id);

do $$ declare t text; begin
  foreach t in array array['dsr_stock_postings', 'dsr_stock_posting_lines'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function public.stamp_org_id()', t || '_stamp_org_id', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('create policy %I on public.%I for select using (org_id = (select public.auth_org_id()) and (select public.is_active_member()))',
                   t || '_select', t);
  end loop;
end $$;
