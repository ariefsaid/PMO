-- 0028_procurement_files.sql — Procurement attachments: 3 per-phase child file tables +
-- private storage bucket procurement-files + storage RLS. Forward-only, additive.
-- Reversibility (pre-prod): supabase db reset. Forward rollback:
--   drop policy if exists storage_objects_proc_file_read  on storage.objects;
--   drop policy if exists storage_objects_proc_file_write on storage.objects;
--   delete from storage.buckets where id = 'procurement-files';
--   drop table if exists procurement_invoice_files;   -- cascades its stamp-org trigger
--   drop table if exists procurement_receipt_files;   -- cascades its stamp-org trigger
--   drop table if exists procurement_quotation_files; -- cascades its stamp-org trigger
--   drop function if exists stamp_procurement_invoice_file_org();
--   drop function if exists stamp_procurement_receipt_file_org();
--   drop function if exists stamp_procurement_quotation_file_org();
--
-- Pattern: mirrors the 0006 procurement child tables (org_id default + parent-org guard,
-- ADR-0004 force-RLS, HIGH-BV-1 parent-org guard) and the 0025 project-documents storage
-- bucket + storage RLS. Three near-identical typed child tables (ADR-0023) — one per phase —
-- with real FKs + on-delete-cascade. Legacy procurement_quotations.file_url is left untouched.

-- ── §1 quotation files ──────────────────────────────────────────────────────
create table procurement_quotation_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  quotation_id  uuid not null references procurement_quotations(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
-- Partial composite index matching the list hot-path: WHERE quotation_id = ? AND
-- archived_at IS NULL ORDER BY created_at DESC. The partial predicate keeps the index
-- to only the live (non-archived) rows.
create index procurement_quotation_files_parent_idx
  on procurement_quotation_files (quotation_id, created_at desc) where archived_at is null;
alter table procurement_quotation_files enable row level security;
alter table procurement_quotation_files force  row level security;
-- SELECT visibility = org-wide (org_id = auth_org_id()), DELIBERATELY in parity with the
-- parent: `procurements_select` (0002_rls.sql) and every existing procurement child
-- (procurement_quotations/_documents/_items _select) are all org-wide. File METADATA is no
-- more sensitive than the procurement rows the same in-org users already read, so org-wide
-- parity is correct here; storage object READ stays org-segment-1 only (no per-procurement
-- gate) to match. If the parent procurement SELECT is ever scoped (owner/role), this and the
-- storage read policy MUST be scoped in lockstep.
create policy procurement_quotation_files_select on procurement_quotation_files for select using (org_id = auth_org_id());
create policy procurement_quotation_files_write on procurement_quotation_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_quotations q where q.id = procurement_quotation_files.quotation_id and q.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_quotations q where q.id = procurement_quotation_files.quotation_id and q.org_id = auth_org_id()));

-- ── §2 receipt files (GR) ───────────────────────────────────────────────────
create table procurement_receipt_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  receipt_id    uuid not null references procurement_receipts(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
-- Partial composite index matching the list hot-path (WHERE receipt_id = ? AND
-- archived_at IS NULL ORDER BY created_at DESC).
create index procurement_receipt_files_parent_idx
  on procurement_receipt_files (receipt_id, created_at desc) where archived_at is null;
alter table procurement_receipt_files enable row level security;
alter table procurement_receipt_files force  row level security;
-- SELECT visibility = org-wide, in deliberate parity with the parent procurement (see the
-- quotation-files note above for the full rationale).
create policy procurement_receipt_files_select on procurement_receipt_files for select using (org_id = auth_org_id());
create policy procurement_receipt_files_write on procurement_receipt_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_receipts r where r.id = procurement_receipt_files.receipt_id and r.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_receipts r where r.id = procurement_receipt_files.receipt_id and r.org_id = auth_org_id()));

-- ── §3 invoice files (VI) ───────────────────────────────────────────────────
create table procurement_invoice_files (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  invoice_id    uuid not null references procurement_invoices(id) on delete cascade,
  title         text,
  file_path     text,
  uploaded_by_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
-- Partial composite index matching the list hot-path (WHERE invoice_id = ? AND
-- archived_at IS NULL ORDER BY created_at DESC).
create index procurement_invoice_files_parent_idx
  on procurement_invoice_files (invoice_id, created_at desc) where archived_at is null;
alter table procurement_invoice_files enable row level security;
alter table procurement_invoice_files force  row level security;
-- SELECT visibility = org-wide, in deliberate parity with the parent procurement (see the
-- quotation-files note above for the full rationale).
create policy procurement_invoice_files_select on procurement_invoice_files for select using (org_id = auth_org_id());
create policy procurement_invoice_files_write on procurement_invoice_files for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_invoices v where v.id = procurement_invoice_files.invoice_id and v.org_id = auth_org_id()))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurement_invoices v where v.id = procurement_invoice_files.invoice_id and v.org_id = auth_org_id()));

-- ── §4 storage bucket procurement-files (private, 5 MB, same MIME allowlist as 0025) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'procurement-files', 'procurement-files', false, 5242880,
    array[
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/vnd.dxf', 'application/dxf', 'application/acad',
      'text/csv', 'text/plain'
    ]
  ) on conflict (id) do nothing;

-- ── §5 storage RLS: 5-segment path {org}/{proc}/{phase}/{file_id}/{filename} ──
-- Path is {org}/{proc}/{phase}/{file_id}/{filename} = 5 slash-separated segments.
-- There is NO Draft-status gate (procurement files attach at any phase the parent row exists).
-- Read: in-org + 5-segment shape.
create policy storage_objects_proc_file_read on storage.objects
  for select
  using (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
  );
-- Write: in-org + writer role + 5-segment shape + segment-2 references an in-org procurement.
create policy storage_objects_proc_file_write on storage.objects
  for all
  using (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
      where p.id::text = split_part(name, '/', 2) and p.org_id = auth_org_id())
  )
  with check (
    bucket_id = 'procurement-files'
    and auth.uid() is not null
    and split_part(name, '/', 1) = auth_org_id()::text
    and array_length(string_to_array(name, '/'), 1) = 5
    and auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.procurements p
      where p.id::text = split_part(name, '/', 2) and p.org_id = auth_org_id())
  );

-- ── §6 org_id stamp triggers (mirror 0015 stamp_procurement_item_org) ────────
-- The client NEVER sends org_id; the column default is the seed org. A BEFORE INSERT trigger
-- inherits org_id from the parent PHASE row whenever the client left it null / at the seed
-- default, so the *_write WITH CHECK (org_id = auth_org_id()) passes for any org. An
-- EXPLICITLY-sent org_id is preserved untouched, so a cross-org spoof still hits WITH CHECK
-- rather than being silently rewritten. search_path pinned + schema-qualified (LOW-BV-1).
create or replace function stamp_procurement_quotation_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select q.org_id into new.org_id
      from public.procurement_quotations q where q.id = new.quotation_id;
  end if;
  return new;
end; $$;
create trigger procurement_quotation_files_stamp_org
  before insert on procurement_quotation_files
  for each row execute function stamp_procurement_quotation_file_org();

create or replace function stamp_procurement_receipt_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select r.org_id into new.org_id
      from public.procurement_receipts r where r.id = new.receipt_id;
  end if;
  return new;
end; $$;
create trigger procurement_receipt_files_stamp_org
  before insert on procurement_receipt_files
  for each row execute function stamp_procurement_receipt_file_org();

create or replace function stamp_procurement_invoice_file_org()
  returns trigger language plpgsql set search_path = public as $$
begin
  if new.org_id is null or new.org_id = '00000000-0000-0000-0000-000000000001'::uuid then
    select v.org_id into new.org_id
      from public.procurement_invoices v where v.id = new.invoice_id;
  end if;
  return new;
end; $$;
create trigger procurement_invoice_files_stamp_org
  before insert on procurement_invoice_files
  for each row execute function stamp_procurement_invoice_file_org();
