# Plan — Procurement flexible entry and ERP document linking (#1319)

Spec: `docs/specs/procurement-flexible-entry.spec.md` (FR-/NFR-/AC-PFE-*). ADR: `docs/adr/0093-purchase-documents-linked-and-status-derived.md`.
Lane: money path, Director-dispatched (not the SSSF ADW). Ceiling: `dev`. Migrations **0360–0363** (0356–0358 are taken by
parallel work; 0359 is left free on purpose so a late sibling can land without a renumber).

## 0. Design in one page

```
ERPNext ──sweep──▶ erp_purchase_documents (PO, PR, PI, PE; +net_total)        [slice F feeds PR/PE]
                         │  1                                                   
                         ▼  0..1 (unique)                                       
                 procurement_erp_links ──▶ procurements (case)  ◀── PMO records (PR/PO/GR/VI/PAY)
                         │                     │  status = max(declared, furthest evidence)  [advance_procurement_status]
          views:  erp_purchase_documents_linked / erp_purchase_orphans          
                                               │
       open commitment = ledger org ? max(0, total_value − ledger-held PI net) : total_value
                                               ▼
                         project_committed_spend()  ◀── FE getProjectCommittedSpend / list summary
gates: organizations.procurement_gates → procurement_gate_violation() checked by
       transition_procurement · record-insert triggers (users) · link RPC · adapter-dispatch (before ERP write)
SoD:   approver ≠ payer moved into the procurement update guard (every path to Paid)
```

Decisions taken here (each traced in the spec; questions for the owner are in §9):
1. **Link table, not adoption** — ERP docs never enter PMO record tables, so the push path can never see them (FR-PFE-022/055).
2. **Status derivation runs only for user writes and the ERP mirror (service role), never for direct SQL** (seed, migrations,
   test fixtures). That is what keeps existing data and ~45 existing pgTAP files' fixtures stable (NFR-PFE-010).
3. **Gates live on `organizations`**, not on the ERPNext binding: an org without ERPNext has no binding row (FR-PFE-013).
4. **The FE stays stricter than the DB**: the shipped next-action buttons are unchanged; start-at-a-step is a "First
   document" choice on the create page that opens that document's capture form. The only new button is "Mark as Paid"
   when a payment record exists before Vendor Invoiced (payment-first).
5. **Committed spend is computed once, in SQL** (`procurement_open_commitment`), and the two client sums that duplicated it
   (`getProjectCommittedSpend`, `procurement-summary`) read it — removes duplicate money logic.
6. **The CLI loads history only by linking** (FR-PFE-063); PMO-authored documents that push stay in the app.

Scaling notes: link batches ≤500 rows per RPC call (CLI batches); orphan read is keyset-paged over the existing partial
index `(org_id, id) where erp_docstatus = 1 and not pmo_owned` plus the unique index on `procurement_erp_links(erp_purchase_document_id)`;
open commitment is two indexed sub-selects per purchase (`procurement_erp_links_procurement_idx`, `procurement_invoices_procurement_idx`).

## 1. Slice map, dependencies, file ownership

| Slice | What | Depends on | Can run with | Owns (no other slice edits these) |
|---|---|---|---|---|
| **S0** | DB foundation: link table, views, gates column + RPCs, step model, `net_total` (0360) | — | — (first, ~45 min) | `supabase/migrations/0360_procurement_flexible_foundation.sql`, `supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql`, `supabase/tests/procurement_flexible_foundation.test.sql`, `supabase/tests/erp_purchase_documents.test.sql` |
| **A** | DB linking, no double count, orphans, files-per-record (0361) | S0 | B, F, G | `supabase/migrations/0361_procurement_erp_linking.sql`, `.../rollback/0361_procurement_erp_linking_down.sql`, `supabase/tests/procurement_erp_links.test.sql`, `supabase/tests/procurement_no_double_count.test.sql`, `supabase/tests/erp_purchase_orphans.test.sql` |
| **B** | DB start-anywhere: derivation triggers, gates on records, transition skips, guard SoD (0362) | S0 | A, F, G | `supabase/migrations/0362_procurement_start_anywhere.sql`, `.../rollback/0362_procurement_start_anywhere_down.sql`, `supabase/tests/procurement_flexible_status.test.sql`, plus the existing pgTAP files it must re-baseline (task B9) |
| **F** | Sweep feed: Purchase Receipts + supplier Payment Entries + net_total | S0 (runtime only) | A, B, G | `pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.ts`, `purchaseMirrorFeed.test.ts` |
| **G** | Dispatch gate before any ERP write | S0 (runtime only) | A, B, F | `supabase/functions/adapter-dispatch/procurementGateGuard.ts`, `procurementGateGuard.test.ts`, `procurementGateWiring.test.ts`, `supabase/functions/adapter-dispatch/index.ts` |
| **C** | API guard tier + `pmo purchases` CLI (0363) | A | D1 | `supabase/migrations/0363_api_client_purchase_surface.sql`, `.../rollback/0363_api_client_purchase_surface_down.sql`, `supabase/tests/api_client_purchase_surface.test.sql`, `scripts/pmo.mjs`, `scripts/lib/pmo-purchases.mjs`, `scripts/pmo-purchases.test.mjs`, `scripts/pmo.test.mjs`, `docs/runbooks/pmo-cli.md` |
| **D1** | FE history path: types, repositories, orphan list, link dialog, linked-docs display | A (types) | C | `pmo-portal/src/lib/supabase/database.types.ts`, `src/lib/repositories/{erpPurchases.ts,erpPurchases.test.ts,index.ts,types.ts}`, `src/lib/db/orgs.ts`, `src/hooks/useErpPurchases.ts`, `src/hooks/useErpPurchaseLinks.ts`, `pages/procurement/{ErpOrphansSection,LinkErpDocumentsDialog,LinkedErpDocuments}.tsx` (+tests), `pages/procurement/erpLinkReasons.ts` (+test), `pages/procurement/ErpPurchasesTable.tsx`, `pages/project-detail/ErpPurchasesSection.tsx` (+test), `pages/ErpPurchases.tsx` (+test), `pages/Procurement.tsx`, `public/locales/{en,id}/finance.json` |
| **D2** | FE start-at-step, gates admin, committed figures, files per document | B, D1 | — | `pages/ProcurementCreate.tsx` (+test), `pages/ProcurementDetails.tsx`, `pages/procurement/{ledgerCapture.ts,LedgerCaptureRow.tsx,ProcurementLedger.tsx,ProcurementMicrosoftReferences.tsx}`, `pages/procurement/ledgerCapture.startAt.test.ts`, `pages/procurement/ProcurementMicrosoftReferences.test.tsx`, `pages/admin/OrgProcurementGates.tsx` (+test), `pages/Administration.tsx`, `src/lib/db/procurements.ts` (+test), `src/lib/procurement-summary.ts` (+test), `src/lib/db/procurementCrud.ts`, `public/locales/{en,id}/procurement.json`, `public/locales/{en,id}/common.json` |
| **E** | e2e journeys + re-baselined procurement journeys | D1, D2 | — | `pmo-portal/e2e/AC-PFE-001-start-at-order.spec.ts`, `AC-PFE-021-new-purchase-from-erp-invoice.spec.ts`, `AC-PFE-022-bulk-link-orphans.spec.ts`, `AC-EPR-008-erp-purchases.spec.ts`, and any procurement journey task E4 finds red |

History-loading path order: **S0 → A → C** (operator can dry-run + load the 55 invoices from the CLI) **→ F** (receipts/payments
appear as orphans) **→ D1** (the same in the UI). B/G/D2 complete the flexible-entry half. Each slice = one worktree off
`origin/dev`, one PR to `dev`. S0 merges first; A and B rebase on it. Migrations must not contain `begin;`/`commit;`
(the rollback test wraps them in a pgTAP transaction).

Common commands (run from the slice's worktree root, e.g. `/Users/ariefsaid/Coding/PMO-wt-pfe-a`):
- DB test: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/<file>.test.sql'`
- Unit: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run <path>`
- Deno: `deno test -A supabase/functions/adapter-dispatch/<file>.test.ts`
- Node: `node --test scripts/<file>.test.mjs`
- Final local gate per CLAUDE.md: `cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 <touched> && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev`

---

## 2. Slice S0 — foundation (0360)

### S0-1 Write the failing foundation test (AC-PFE-016 part, AC-PFE-003 defaults, AC-PFE-012)
File `supabase/tests/procurement_flexible_foundation.test.sql`:
```sql
-- procurement_flexible_foundation.test.sql — 0360 (spec procurement-flexible-entry). AC-PFE-003 (defaults), AC-PFE-012, AC-PFE-016 (link table RLS).
begin;
select plan(14);

-- AC-PFE-012: nothing is derived by the migration or the seed.
select is((select count(*) from procurement_status_events where notes like 'Derived:%'), 0::bigint,
  'AC-PFE-012 no status was derived by migrating or seeding');

insert into organizations (id, name, default_currency) values
  ('03600000-0000-0000-0000-00000000000a','PFE0 A','IDR'), ('03600000-0000-0000-0000-00000000000b','PFE0 B','IDR');
insert into auth.users (id, email) values
  ('03600000-0000-0000-0000-0000000000a1','pfe0-admin@example.com'),
  ('03600000-0000-0000-0000-0000000000a2','pfe0-fin@example.com'),
  ('03600000-0000-0000-0000-0000000000b1','pfe0-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03600000-0000-0000-0000-0000000000a1','03600000-0000-0000-0000-00000000000a','PFE0 Admin','pfe0-admin@example.com','Admin','active'),
  ('03600000-0000-0000-0000-0000000000a2','03600000-0000-0000-0000-00000000000a','PFE0 Fin','pfe0-fin@example.com','Finance','active'),
  ('03600000-0000-0000-0000-0000000000b1','03600000-0000-0000-0000-00000000000b','PFE0 B','pfe0-b@example.com','Finance','active');

select has_table('public','procurement_erp_links','link table exists');
select col_is_unique('public','procurement_erp_links', array['erp_purchase_document_id'], 'FR-PFE-021 one purchase per ERP document');
select has_column('public','erp_purchase_documents','net_total','mirror carries net_total');
select lives_ok($$ insert into erp_purchase_documents (org_id, erp_doctype, erp_name, erp_docstatus, erp_modified)
                   values ('03600000-0000-0000-0000-00000000000a','Payment Entry','PE-0',1,'2026-01-01'),
                          ('03600000-0000-0000-0000-00000000000a','Purchase Receipt','PR-0',1,'2026-01-01') $$,
  'FR-PFE-040 the mirror accepts Purchase Receipts and Payment Entries');
select is(procurement_step_rank('Paid'), 8, 'step rank: Paid is furthest');
select is(procurement_step_rank('Cancelled'), -1, 'step rank: Cancelled is unranked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03600000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(get_procurement_gates(),
  '{"request_before_order":false,"approval_before_order":false,"approval_before_payment":false,"receipt_before_invoice":false}'::jsonb,
  'AC-PFE-003 every gate is OFF by default');
select throws_ok($$ select set_procurement_gates('{"approval_before_payment":true}') $$, '42501', null,
  'FR-PFE-011 only an Admin changes purchase rules');
select throws_ok($$ insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
                    values ('03600000-0000-0000-0000-00000000000a', gen_random_uuid(), gen_random_uuid()) $$, '42501', null,
  'NFR-PFE-012 no client writes links directly');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03600000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(set_procurement_gates('{"approval_before_payment":true}') ->> 'approval_before_payment', 'true',
  'FR-PFE-011 an Admin turns a gate on');
select throws_ok($$ select set_procurement_gates('{"approval_before_lunch":true}') $$, '22023', null,
  'FR-PFE-011 unknown gate keys are refused');
select throws_ok($$ select set_procurement_gates('{"approval_before_order":"yes"}') $$, '22023', null,
  'FR-PFE-011 non-boolean gate values are refused');
reset role;
select ok(exists (select 1 from audit_events where action = 'organization.procurement_gates'
                   and org_id = '03600000-0000-0000-0000-00000000000a'), 'FR-PFE-011 a gate change is audited');

select * from finish();
rollback;
```
Run: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/procurement_flexible_foundation.test.sql'` → **RED** (objects missing).

### S0-2 Write migration 0360
File `supabase/migrations/0360_procurement_flexible_foundation.sql`:
```sql
-- 0360 procurement flexible entry — foundation (spec docs/specs/procurement-flexible-entry.spec.md; ADR-0093).
-- Rollback: supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql
-- No begin/commit: the rollback pgTAP wraps this file in its own transaction.

-- §1 The purchase mirror also carries receipts and supplier payments, and the pre-tax total (FR-PFE-040).
alter table public.erp_purchase_documents drop constraint erp_purchase_documents_erp_doctype_check;
alter table public.erp_purchase_documents add constraint erp_purchase_documents_erp_doctype_check
  check (erp_doctype in ('Purchase Order','Purchase Receipt','Purchase Invoice','Payment Entry'));
alter table public.erp_purchase_documents add column net_total numeric(18,2);

-- 0335's upsert, plus net_total (the only change).
create or replace function public.upsert_erp_purchase_documents(p_org_id uuid, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_written integer;
begin
  insert into public.erp_purchase_documents as d (
    org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
    grand_total, net_total, outstanding_amount, erp_status, erp_docstatus, is_return, erp_project, erp_modified)
  select p_org_id, r.erp_doctype, r.erp_name, r.supplier, r.supplier_name, r.doc_date, r.due_date, r.bill_no,
         r.currency, r.grand_total, r.net_total, r.outstanding_amount, r.erp_status, r.erp_docstatus,
         coalesce(r.is_return, false), r.erp_project, r.erp_modified
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(
      erp_doctype text, erp_name text, supplier text, supplier_name text, doc_date date, due_date date,
      bill_no text, currency text, grand_total numeric, net_total numeric, outstanding_amount numeric, erp_status text,
      erp_docstatus smallint, is_return boolean, erp_project text, erp_modified text)
  on conflict (org_id, erp_doctype, erp_name) do update set
    supplier = excluded.supplier, supplier_name = excluded.supplier_name, doc_date = excluded.doc_date,
    due_date = excluded.due_date, bill_no = excluded.bill_no, currency = excluded.currency,
    grand_total = excluded.grand_total, net_total = excluded.net_total, outstanding_amount = excluded.outstanding_amount,
    erp_status = excluded.erp_status, erp_docstatus = excluded.erp_docstatus, is_return = excluded.is_return,
    erp_project = excluded.erp_project, erp_modified = excluded.erp_modified, updated_at = now()
  where excluded.erp_modified > d.erp_modified;
  get diagnostics v_written = row_count;

  with map as (
    select m.value as erp_name, min(m.key)::uuid as project_id
      from public.external_org_bindings b, jsonb_each_text(coalesce(b.config->'project_map','{}'::jsonb)) m
     where b.org_id = p_org_id and b.external_tier = 'erpnext' and b.activated_at is not null
       and m.key ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' and m.value <> ''
     group by m.value having count(*) = 1
  ), names as (
    select d.id, d.erp_project as erp_name from public.erp_purchase_documents d
     where d.org_id = p_org_id and d.erp_project is not null
    union
    select d.id, g.project from public.erp_purchase_documents d
      join public.erp_gl_entry_mirror g
        on g.org_id = d.org_id and g.voucher_type = d.erp_doctype and g.voucher_no = d.erp_name
     where d.org_id = p_org_id and d.erp_doctype = 'Purchase Invoice'
       and g.project is not null and not g.is_cancelled
  ), stamped as (
    select d.id,
           coalesce(array_agg(distinct p.id order by p.id) filter (where p.id is not null), '{}') as project_ids,
           exists (select 1 from public.external_refs x
                    where x.org_id = p_org_id and x.domain = 'procurement' and x.external_tier = 'erpnext'
                      and x.external_record_id = d.erp_name) as pmo_owned
      from public.erp_purchase_documents d
      left join names n on n.id = d.id
      left join map on map.erp_name = n.erp_name
      left join public.projects p on p.id = map.project_id and p.org_id = p_org_id
     where d.org_id = p_org_id
     group by d.id, d.erp_name
  )
  update public.erp_purchase_documents d
     set project_ids = s.project_ids, pmo_owned = s.pmo_owned
    from stamped s
   where d.id = s.id and (d.project_ids is distinct from s.project_ids or d.pmo_owned is distinct from s.pmo_owned);

  return v_written;
end $$;
revoke all on function public.upsert_erp_purchase_documents(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_erp_purchase_documents(uuid, jsonb) to service_role;

-- §2 The link: an ERP document belongs to at most one purchase (FR-PFE-021). Written only by 0361's RPCs.
create table public.procurement_erp_links (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  procurement_id           uuid not null references public.procurements(id) on delete cascade,
  erp_purchase_document_id uuid not null references public.erp_purchase_documents(id) on delete restrict,
  linked_by                uuid references public.profiles(id),
  linked_at                timestamptz not null default now(),
  constraint procurement_erp_links_one_purchase unique (erp_purchase_document_id)
);
create index procurement_erp_links_procurement_idx on public.procurement_erp_links (procurement_id);

-- Defence in depth (the RPC already checks): purchase, document and link are one org.
create function public.guard_procurement_erp_link_org() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not exists (select 1 from public.procurements p where p.id = new.procurement_id and p.org_id = new.org_id)
     or not exists (select 1 from public.erp_purchase_documents d where d.id = new.erp_purchase_document_id and d.org_id = new.org_id) then
    raise exception 'An ERP document can be linked only to a purchase of its own organization.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_erp_link_org() from public, anon, authenticated;
create trigger procurement_erp_links_org_guard before insert or update on public.procurement_erp_links
  for each row execute function public.guard_procurement_erp_link_org();

alter table public.procurement_erp_links enable row level security;
alter table public.procurement_erp_links force row level security;
create policy procurement_erp_links_select on public.procurement_erp_links for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_active_member())
         and (select public.auth_role()) in ('Admin','Executive','Project Manager','Finance'));
revoke all on public.procurement_erp_links from anon, authenticated;
grant select on public.procurement_erp_links to authenticated;

-- §3 Read models (FR-PFE-041/043). security_invoker: the caller's RLS on both tables applies.
create view public.erp_purchase_documents_linked with (security_invoker = true) as
  select d.id, d.org_id, d.erp_doctype, d.erp_name, d.supplier, d.supplier_name, d.doc_date, d.due_date, d.bill_no,
         d.currency, d.grand_total, d.net_total, d.outstanding_amount, d.erp_status, d.erp_docstatus, d.is_return,
         d.erp_project, d.project_ids, d.pmo_owned, l.id as link_id, l.procurement_id, l.linked_at
    from public.erp_purchase_documents d
    left join public.procurement_erp_links l on l.erp_purchase_document_id = d.id;
create view public.erp_purchase_orphans with (security_invoker = true) as
  select id, org_id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency,
         grand_total, net_total, outstanding_amount, erp_status, is_return, erp_project, project_ids
    from public.erp_purchase_documents_linked
   where erp_docstatus = 1 and not pmo_owned and procurement_id is null;
revoke all on public.erp_purchase_documents_linked, public.erp_purchase_orphans from anon;
grant select on public.erp_purchase_documents_linked, public.erp_purchase_orphans to authenticated;

-- §4 Gates: org settings, default OFF (FR-PFE-010..013).
alter table public.organizations add column procurement_gates jsonb not null default '{}'::jsonb
  constraint organizations_procurement_gates_object check (jsonb_typeof(procurement_gates) = 'object');
comment on column public.organizations.procurement_gates is
  'FR-PFE-011 purchase rules (request_before_order, approval_before_order, approval_before_payment, receipt_before_invoice); absent or non-boolean = OFF. Written only by set_procurement_gates().';

create function public.procurement_gate(p_org uuid, p_key text) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((
    select case when jsonb_typeof(o.procurement_gates -> p_key) = 'boolean'
                then (o.procurement_gates ->> p_key)::boolean else false end
      from public.organizations o
     where o.id = p_org and (auth.uid() is null or p_org = public.auth_org_id())), false)
$$;
revoke all on function public.procurement_gate(uuid, text) from public, anon;
grant execute on function public.procurement_gate(uuid, text) to authenticated, service_role;

create function public.procurement_gate_message(p_code text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select case p_code
    when 'gate_request_before_order'    then 'Your organization requires a purchase request before an order.'
    when 'gate_approval_before_order'   then 'Your organization requires an approval before an order.'
    when 'gate_receipt_before_invoice'  then 'Your organization requires a goods receipt before a vendor invoice.'
    when 'gate_approval_before_payment' then 'Your organization requires an approval before payment.'
    else p_code end
$$;
grant execute on function public.procurement_gate_message(text) to authenticated, service_role;

create function public.get_procurement_gates() returns jsonb
language sql stable security definer set search_path = public, pg_catalog as $$
  select jsonb_build_object(
    'request_before_order',    public.procurement_gate(public.auth_org_id(), 'request_before_order'),
    'approval_before_order',   public.procurement_gate(public.auth_org_id(), 'approval_before_order'),
    'approval_before_payment', public.procurement_gate(public.auth_org_id(), 'approval_before_payment'),
    'receipt_before_invoice',  public.procurement_gate(public.auth_org_id(), 'receipt_before_invoice'))
  where public.is_active_member()
$$;
revoke all on function public.get_procurement_gates() from public, anon;
grant execute on function public.get_procurement_gates() to authenticated;

create function public.set_procurement_gates(p_gates jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_org uuid := public.auth_org_id(); v_old jsonb; v_new jsonb;
begin
  perform public.assert_is_active_member();
  if public.auth_role() is distinct from 'Admin' then
    raise exception 'Only an Admin can change purchase rules.' using errcode = '42501';
  end if;
  if p_gates is null or jsonb_typeof(p_gates) <> 'object' or exists (
       select 1 from jsonb_each(p_gates) e
        where e.key not in ('request_before_order','approval_before_order','approval_before_payment','receipt_before_invoice')
           or jsonb_typeof(e.value) <> 'boolean') then
    raise exception 'Purchase rules are the four known switches, each true or false.' using errcode = '22023';
  end if;
  select procurement_gates into v_old from public.organizations where id = v_org for update;
  v_new := coalesce(v_old, '{}'::jsonb) || p_gates;
  update public.organizations set procurement_gates = v_new where id = v_org;
  perform public.log_audit('organization.procurement_gates', v_org, auth.uid(), v_org,
    jsonb_build_object('from', v_old, 'to', v_new));
  return public.get_procurement_gates();
end $$;
revoke all on function public.set_procurement_gates(jsonb) from public, anon;
grant execute on function public.set_procurement_gates(jsonb) to authenticated;

-- §5 Step model (FR-PFE-002/003/007).
create function public.procurement_step_rank(p_status public.procurement_status) returns integer
language sql immutable set search_path = public, pg_catalog as $$
  select case p_status::text
    when 'Draft' then 0 when 'Rejected' then 0 when 'Requested' then 1 when 'Approved' then 2
    when 'Vendor Quoted' then 3 when 'Quote Selected' then 4 when 'Ordered' then 5
    when 'Received' then 6 when 'Vendor Invoiced' then 7 when 'Paid' then 8 else -1 end
$$;
grant execute on function public.procurement_step_rank(public.procurement_status) to authenticated, service_role;

-- Furthest document-evidenced step: a PMO record or a linked, submitted ERP document.
create function public.procurement_evidenced_step(p_procurement_id uuid) returns public.procurement_status
language sql stable security definer set search_path = public, pg_catalog as $$
  with linked as (
    select d.erp_doctype from public.procurement_erp_links l
      join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1)
  select case
    when exists (select 1 from public.payments pay where pay.procurement_id = p_procurement_id and pay.status = 'Paid'
                   and coalesce(pay.erp_docstatus, 1) <> 2 and pay.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Payment Entry') then 'Paid'::public.procurement_status
    when exists (select 1 from public.procurement_invoices i where i.procurement_id = p_procurement_id
                   and coalesce(i.erp_docstatus, 1) <> 2 and i.erp_cancelled_at is null)
      or exists (select 1 from linked where erp_doctype = 'Purchase Invoice') then 'Vendor Invoiced'::public.procurement_status
    when exists (select 1 from public.procurement_receipts r where r.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Receipt') then 'Received'::public.procurement_status
    when exists (select 1 from public.purchase_orders po where po.procurement_id = p_procurement_id)
      or exists (select 1 from linked where erp_doctype = 'Purchase Order') then 'Ordered'::public.procurement_status
    else null end
$$;
revoke all on function public.procurement_evidenced_step(uuid) from public, anon, authenticated;
grant execute on function public.procurement_evidenced_step(uuid) to service_role;

-- Which gate (if any) refuses moving this purchase to p_step (FR-PFE-010). Null = allowed.
create function public.procurement_gate_violation(p_procurement_id uuid, p_step public.procurement_status)
returns text language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_row public.procurements%rowtype;
begin
  select * into v_row from public.procurements where id = p_procurement_id;
  if not found or (auth.uid() is not null and v_row.org_id is distinct from public.auth_org_id()) then
    return 'purchase_not_found';
  end if;
  if public.procurement_step_rank(p_step) >= 5 then
    if public.procurement_gate(v_row.org_id, 'request_before_order')
       and v_row.pr_number is null and public.procurement_step_rank(v_row.status) < 1
       and not exists (select 1 from public.purchase_requests r where r.procurement_id = v_row.id) then
      return 'gate_request_before_order';
    end if;
    if public.procurement_gate(v_row.org_id, 'approval_before_order') and v_row.approved_by_id is null then
      return 'gate_approval_before_order';
    end if;
  end if;
  if public.procurement_step_rank(p_step) >= 7
     and public.procurement_gate(v_row.org_id, 'receipt_before_invoice')
     and public.procurement_step_rank(v_row.status) < 6
     and not exists (select 1 from public.procurement_receipts r where r.procurement_id = v_row.id)
     and not exists (select 1 from public.procurement_erp_links l
                       join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                      where l.procurement_id = v_row.id and d.erp_doctype = 'Purchase Receipt' and d.erp_docstatus = 1) then
    return 'gate_receipt_before_invoice';
  end if;
  if p_step = 'Paid' and public.procurement_gate(v_row.org_id, 'approval_before_payment') and v_row.approved_by_id is null then
    return 'gate_approval_before_payment';
  end if;
  return null;
end $$;
revoke all on function public.procurement_gate_violation(uuid, public.procurement_status) from public, anon;
grant execute on function public.procurement_gate_violation(uuid, public.procurement_status) to authenticated, service_role;

-- Move a purchase forward to its furthest evidence; never backwards; never out of Cancelled/Rejected.
-- The status update runs the 0349/0362 guard (SoD, ceiling, approval gate). Returns the resulting status.
create function public.advance_procurement_status(p_procurement_id uuid, p_note text)
returns public.procurement_status language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_from public.procurement_status; v_org uuid; v_to public.procurement_status;
begin
  select status, org_id into v_from, v_org from public.procurements where id = p_procurement_id for update;
  if not found or v_from::text in ('Cancelled','Rejected') then return v_from; end if;
  v_to := public.procurement_evidenced_step(p_procurement_id);
  if v_to is null or public.procurement_step_rank(v_to) <= public.procurement_step_rank(v_from) then
    return v_from;
  end if;
  update public.procurements
     set status = v_to,
         vendor_invoiced_at = case when v_to::text in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,
         updated_at = now()
   where id = p_procurement_id;
  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_procurement_id, v_org, v_from, v_to, auth.uid(), p_note);
  return v_to;
end $$;
revoke all on function public.advance_procurement_status(uuid, text) from public, anon, authenticated;
grant execute on function public.advance_procurement_status(uuid, text) to service_role;
```

### S0-3 Rollback file
File `supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql`:
```sql
-- Reverses 0360. Run 0362_down and 0361_down first if they are applied.
drop function if exists public.advance_procurement_status(uuid, text);
drop function if exists public.procurement_gate_violation(uuid, public.procurement_status);
drop function if exists public.procurement_evidenced_step(uuid);
drop function if exists public.procurement_step_rank(public.procurement_status);
drop function if exists public.set_procurement_gates(jsonb);
drop function if exists public.get_procurement_gates();
drop function if exists public.procurement_gate_message(text);
drop function if exists public.procurement_gate(uuid, text);
alter table public.organizations drop column if exists procurement_gates;
drop view if exists public.erp_purchase_orphans;
drop view if exists public.erp_purchase_documents_linked;
drop table if exists public.procurement_erp_links;
drop function if exists public.guard_procurement_erp_link_org();
delete from public.erp_purchase_documents where erp_doctype in ('Purchase Receipt','Payment Entry');
alter table public.erp_purchase_documents drop constraint erp_purchase_documents_erp_doctype_check;
alter table public.erp_purchase_documents add constraint erp_purchase_documents_erp_doctype_check
  check (erp_doctype in ('Purchase Order','Purchase Invoice'));
```
then append **0335's `upsert_erp_purchase_documents` body verbatim** (lines 52–114 of `supabase/migrations/0335_erp_purchase_documents.sql`,
i.e. without `net_total`) followed by `alter table public.erp_purchase_documents drop column if exists net_total;`.

### S0-4 Re-baseline AC-EPR-006 (deliberate; owner ruling 2026-10-23)
In `supabase/tests/erp_purchase_documents.test.sql` replace the AC-EPR-006 assertion (lines 116–126) with:
```sql
select ok(
  not exists ((select * from project_mapped_actuals('03350000-0000-0000-0000-0000000000d1')
               except select * from actuals_before)
              union all
              (select * from actuals_before
               except select * from project_mapped_actuals('03350000-0000-0000-0000-0000000000d1')))
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prosrc ilike '%erp_purchase_documents%'
                     and p.proname not in ('upsert_erp_purchase_documents','guard_procurement_erp_link_org',
                       'procurement_evidenced_step','procurement_gate_violation','procurement_ledger_held',
                       'refresh_erp_linked_purchase_total','link_erp_purchase_documents','unlink_erp_purchase_document',
                       'guard_procurement_document_record'))
  and not exists (select 1 from pg_views where schemaname = 'public' and definition ilike '%erp_purchase_documents%'
                    and viewname not in ('erp_purchase_documents_linked','erp_purchase_orphans')),
  'AC-EPR-006 (re-baselined by AC-PFE-005) ERP purchases never feed actuals; only the named link/commitment readers touch the table');
```
(The list names 0361's functions too, so A does not need to edit this file.)

### S0-5 Verify
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/procurement_flexible_foundation.test.sql supabase/tests/erp_purchase_documents.test.sql'` → GREEN (14 + 24).
Mutation: change `else false end` in `procurement_gate` to `else true end`, re-run → `AC-PFE-003 every gate is OFF by default` RED; revert.

---

## 3. Slice A — linking, no double count, orphans (0361)

### A-1 Failing test: links (AC-PFE-004, 008, 019, 023; link paths of 003 and 013)
File `supabase/tests/procurement_erp_links.test.sql`:
```sql
-- procurement_erp_links.test.sql — 0361. Owns AC-PFE-004, AC-PFE-008, AC-PFE-019, AC-PFE-023; link paths of AC-PFE-003/013.
begin;
select plan(28);

insert into organizations (id, name, default_currency) values
  ('03610000-0000-0000-0000-00000000000a','PFE A','IDR'), ('03610000-0000-0000-0000-00000000000b','PFE B','IDR');
insert into auth.users (id, email) values
  ('03610000-0000-0000-0000-0000000000a1','pfe-fin1@example.com'), ('03610000-0000-0000-0000-0000000000a2','pfe-fin2@example.com'),
  ('03610000-0000-0000-0000-0000000000a3','pfe-pm@example.com'),   ('03610000-0000-0000-0000-0000000000a4','pfe-eng@example.com'),
  ('03610000-0000-0000-0000-0000000000a5','pfe-admin@example.com'),('03610000-0000-0000-0000-0000000000b1','pfe-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03610000-0000-0000-0000-0000000000a1','03610000-0000-0000-0000-00000000000a','Fin One','pfe-fin1@example.com','Finance','active'),
  ('03610000-0000-0000-0000-0000000000a2','03610000-0000-0000-0000-00000000000a','Fin Two','pfe-fin2@example.com','Finance','active'),
  ('03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-00000000000a','PM','pfe-pm@example.com','Project Manager','active'),
  ('03610000-0000-0000-0000-0000000000a4','03610000-0000-0000-0000-00000000000a','Eng','pfe-eng@example.com','Engineer','active'),
  ('03610000-0000-0000-0000-0000000000a5','03610000-0000-0000-0000-00000000000a','Admin','pfe-admin@example.com','Admin','active'),
  ('03610000-0000-0000-0000-0000000000b1','03610000-0000-0000-0000-00000000000b','B Fin','pfe-b@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-00000000000a','PFE P1','Ongoing Project'),
  ('03610000-0000-0000-0000-0000000000d2','03610000-0000-0000-0000-00000000000a','PFE P2','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03610000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03610000-0000-0000-0000-0000000000d1":"ERP-A","03610000-0000-0000-0000-0000000000d2":"ERP-B"}}'::jsonb,
   now(), 'active');
insert into companies (id, org_id, name, type) values
  ('03610000-0000-0000-0000-0000000000c1','03610000-0000-0000-0000-00000000000a','Supplier One','Vendor'),
  ('03610000-0000-0000-0000-0000000000c3','03610000-0000-0000-0000-00000000000a','Supplier Three','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03610000-0000-0000-0000-00000000000a','companies','03610000-0000-0000-0000-0000000000c1','erpnext','SUP-1'),
  ('03610000-0000-0000-0000-00000000000a','procurement','pmo-pi','erpnext','PINV-PMO');
select upsert_erp_purchase_documents('03610000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-2","supplier":"SUP-2","supplier_name":"Supplier Two","currency":"IDR","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-3","supplier":"SUP-3","supplier_name":"Supplier Three","currency":"IDR","grand_total":50,"net_total":50,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Order","erp_name":"PO-USD","supplier":"SUP-1","supplier_name":"Supplier One","currency":"USD","grand_total":50,"net_total":50,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-C","supplier":"SUP-1","currency":"IDR","grand_total":5,"erp_docstatus":2,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-PMO","supplier":"SUP-1","currency":"IDR","grand_total":5,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-P2","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":5,"net_total":5,"erp_docstatus":1,"erp_project":"ERP-B","erp_modified":"2026-02-01"},
 {"erp_doctype":"Payment Entry","erp_name":"PE-1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":666,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-D1","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":660,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-D2","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":660,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-G","supplier":"SUP-1","supplier_name":"Supplier One","currency":"IDR","grand_total":10,"net_total":10,"erp_docstatus":1,"erp_project":"ERP-A","erp_modified":"2026-02-01"}
]$$::jsonb);
insert into procurements (id, org_id, title, requested_by_id, project_id, vendor_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03610000-0000-0000-0000-0000000000e1','03610000-0000-0000-0000-00000000000a','PUR1','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c1','IDR',1000,'Ordered',null,null),
  ('03610000-0000-0000-0000-0000000000e3','03610000-0000-0000-0000-00000000000a','PUR3','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c3','IDR',100,'Ordered',null,null),
  ('03610000-0000-0000-0000-0000000000e4','03610000-0000-0000-0000-00000000000a','PURA','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1','03610000-0000-0000-0000-0000000000c1','IDR',1000,'Vendor Invoiced','03610000-0000-0000-0000-0000000000a1',1000),
  ('03610000-0000-0000-0000-0000000000e5','03610000-0000-0000-0000-00000000000a','PURC','03610000-0000-0000-0000-0000000000a3','03610000-0000-0000-0000-0000000000d1',null,'IDR',10,'Cancelled',null,null);
select set_config('pfe.outbox_before', (select count(*)::text from external_command_outbox), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.r', link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]')::text, true);
select is(current_setting('pfe.r')::jsonb #>> '{results,0,outcome}', 'link', 'AC-PFE-004 a Finance member links an orphan invoice');
reset role;
select is((select count(*) from procurement_erp_links where procurement_id = '03610000-0000-0000-0000-0000000000e1'), 1::bigint, 'AC-PFE-004 one link row');
select is((select status::text from procurements where id = '03610000-0000-0000-0000-0000000000e1'), 'Vendor Invoiced', 'AC-PFE-004 status derived to Vendor Invoiced');
select is((select count(*)::text from external_command_outbox), current_setting('pfe.outbox_before'), 'AC-PFE-004 FR-PFE-022 linking creates no outbox command');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'skip', 'FR-PFE-028 re-linking to the same purchase is a skip');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e3"}]') #>> '{results,0,reason}', 'document_linked_to_another_purchase', 'AC-PFE-008 one purchase per document');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'supplier_mismatch', 'AC-PFE-008 supplier differs from the mapped vendor');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-3","procurement_id":"03610000-0000-0000-0000-0000000000e3","sharepoint":{"drive_id":"drv","item_id":"itm","web_url":"https://example.sharepoint.com/sites/s/Shared%20Documents/Bill.pdf","name":"Bill.pdf","kind":"file"}}]') #>> '{results,0,outcome}', 'link', 'FR-PFE-024 an unmapped vendor matches by name');
select is(link_erp_purchase_documents('[{"erp_name":"PO-USD","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'currency_mismatch', 'AC-PFE-008 currency differs');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-P2","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'project_mismatch', 'AC-PFE-008 project differs');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-C","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'document_cancelled', 'FR-PFE-023 cancelled documents are refused');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-PMO","procurement_id":"03610000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,reason}', 'document_recorded_by_pmo', 'FR-PFE-023 PMO-pushed documents are refused');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e5"}]') #>> '{results,0,reason}', 'purchase_closed', 'FR-PFE-004 closed purchases are refused');
select is(link_erp_purchase_documents('[{"erp_name":"NOPE"}]') #>> '{results,0,reason}', 'document_not_found', 'FR-PFE-023 unknown document');
reset role;
select is((select count(*) from procurement_documents where record_kind = 'erp_document' and source = 'onedrive'
            and procurement_id = '03610000-0000-0000-0000-0000000000e3'), 1::bigint, 'FR-PFE-029 the row''s SharePoint item is attached to the linked document');

-- AC-PFE-013 link path: the approver may not link the payment that pays their own approval.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select matches(link_erp_purchase_documents('[{"erp_name":"PE-1","procurement_id":"03610000-0000-0000-0000-0000000000e4"}]') #>> '{results,0,reason}',
  'separation of duties', 'AC-PFE-013 approver cannot move their approved purchase to Paid by linking');
reset role;

-- AC-PFE-003 link path.
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03610000-0000-0000-0000-00000000000a';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-G","project_id":"03610000-0000-0000-0000-0000000000d1"}]') #>> '{results,0,reason}', 'gate_approval_before_order', 'AC-PFE-003 a gate refuses a link');
reset role;
update organizations set procurement_gates = '{}' where id = '03610000-0000-0000-0000-00000000000a';

-- AC-PFE-019 dry run = same checks, no writes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.dry', link_erp_purchase_documents($$[
  {"erp_name":"PINV-D1","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-D2","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"NOPE"}]$$, true)::text, true);
reset role;
select is((select jsonb_agg(r->>'outcome' order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.dry')::jsonb->'results') r),
  '["link","link","skip","refused","refused"]'::jsonb, 'AC-PFE-019 dry run reports link ×2, skip, refused ×2');
select ok((current_setting('pfe.dry')::jsonb #>> '{results,0,procurement_id}') is null
          and (current_setting('pfe.dry')::jsonb #>> '{results,0,new_purchase}') = 'true', 'AC-PFE-019 a would-be new purchase has no id in a dry run');
select ok(not exists (select 1 from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name in ('PINV-D1','PINV-D2'))
          and not exists (select 1 from procurements where origin = 'erp_link'), 'AC-PFE-019 a dry run writes nothing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select set_config('pfe.real', link_erp_purchase_documents($$[
  {"erp_name":"PINV-D1","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-D2","project_id":"03610000-0000-0000-0000-0000000000d1","group":"G"},
  {"erp_name":"PINV-1","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"PINV-2","procurement_id":"03610000-0000-0000-0000-0000000000e1"},
  {"erp_name":"NOPE"}]$$, false)::text, true);
reset role;
select is((select jsonb_agg(jsonb_build_array(r->>'outcome', r->>'reason') order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.real')::jsonb->'results') r),
          (select jsonb_agg(jsonb_build_array(r->>'outcome', r->>'reason') order by (r->>'row')::int) from jsonb_array_elements(current_setting('pfe.dry')::jsonb->'results') r),
  'AC-PFE-019 the real run reports exactly what the dry run reported');
select results_eq($$ select count(distinct l.procurement_id)::int, min(p.total_value), min(p.status::text), min(p.vendor_id::text), min(p.origin)
                       from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
                       join procurements p on p.id = l.procurement_id where d.erp_name in ('PINV-D1','PINV-D2') $$,
  $$ values (1, 1200.00::numeric, 'Vendor Invoiced', '03610000-0000-0000-0000-0000000000c1', 'erp_link') $$,
  'FR-PFE-026/027 one grouped new purchase, total = invoice nets, vendor adopted from the supplier mapping');

-- Authorization and tenancy.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$ select link_erp_purchase_documents('[{"erp_name":"PINV-2"}]') $$, '42501', null, 'FR-PFE-020 an Engineer cannot link');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-2"}]') #>> '{results,0,reason}', 'document_not_found', 'NFR-PFE-012 another org cannot reach the document');
reset role;
select throws_ok($$ insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
  select '03610000-0000-0000-0000-00000000000a','03610000-0000-0000-0000-0000000000e3', id from erp_purchase_documents where erp_name = 'PINV-1' $$,
  '23505', null, 'AC-PFE-008 the database refuses a second purchase for one document');

-- AC-PFE-023 unlink.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select unlink_erp_purchase_document((select l.id from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'PINV-3')) $$,
  '42501', null, 'AC-PFE-023 a Project Manager cannot unlink');
reset role;
select set_config('pfe.link3', (select l.id::text from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id where d.erp_name = 'PINV-3'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"03610000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select lives_ok(format('select unlink_erp_purchase_document(%L)', current_setting('pfe.link3')), 'AC-PFE-023 an Admin unlinks');
select ok(exists (select 1 from erp_purchase_orphans where erp_name = 'PINV-3'), 'AC-PFE-023 the document is an orphan again');
reset role;
select is((select status::text from procurements where id = '03610000-0000-0000-0000-0000000000e3'), 'Vendor Invoiced', 'AC-PFE-023 FR-PFE-003 unlinking never moves status back');

select * from finish();
rollback;
```
Run the DB test command for this file → **RED**.

### A-2 Failing test: no double count (AC-PFE-005)
File `supabase/tests/procurement_no_double_count.test.sql`:
```sql
-- procurement_no_double_count.test.sql — 0361. Owns AC-PFE-005 (FR-PFE-035..037, NFR-PFE-001/002).
begin;
select plan(8);
insert into organizations (id, name, default_currency) values
  ('03620000-0000-0000-0000-00000000000a','PFE Ledger','IDR'), ('03620000-0000-0000-0000-00000000000b','PFE Native','IDR');
insert into auth.users (id, email) values
  ('03620000-0000-0000-0000-0000000000a1','pfel@example.com'), ('03620000-0000-0000-0000-0000000000b1','pfen@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-00000000000a','L Fin','pfel@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000b1','03620000-0000-0000-0000-00000000000b','N Fin','pfen@example.com','Finance','active');
insert into projects (id, org_id, name, status) values
  ('03620000-0000-0000-0000-0000000000d1','03620000-0000-0000-0000-00000000000a','L P1','Ongoing Project'),
  ('03620000-0000-0000-0000-0000000000d2','03620000-0000-0000-0000-00000000000b','N P1','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('03620000-0000-0000-0000-00000000000a','erpnext','https://erp.example.test','test-ref',
   '{"company":"Example Co","project_map":{"03620000-0000-0000-0000-0000000000d1":"ERP-L"}}'::jsonb, now(), 'active');
select upsert_erp_purchase_documents('03620000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-L","supplier":"S","supplier_name":"S","currency":"IDR","grand_total":666,"net_total":600,"erp_docstatus":1,"erp_project":"ERP-L","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PINV-RET","supplier":"S","supplier_name":"S","currency":"IDR","grand_total":-111,"net_total":-100,"erp_docstatus":1,"is_return":true,"erp_project":"ERP-L","erp_modified":"2026-02-01"}]$$::jsonb);
insert into procurements (id, org_id, title, requested_by_id, project_id, currency, total_value, status) values
  ('03620000-0000-0000-0000-0000000000e1','03620000-0000-0000-0000-00000000000a','OL', '03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-0000000000d1','IDR',1000,'Ordered'),
  ('03620000-0000-0000-0000-0000000000e2','03620000-0000-0000-0000-00000000000a','OL2','03620000-0000-0000-0000-0000000000a1','03620000-0000-0000-0000-0000000000d1','IDR',500,'Vendor Invoiced'),
  ('03620000-0000-0000-0000-0000000000e3','03620000-0000-0000-0000-00000000000b','ON', '03620000-0000-0000-0000-0000000000b1','03620000-0000-0000-0000-0000000000d2','IDR',1000,'Vendor Invoiced');
-- OL2: a PMO-pushed invoice mirrored as submitted (exclusive: amount is pre-tax). ON: same shape in a non-ledger org.
insert into procurement_invoices (procurement_id, org_id, status, amount, tax_amount, tax_treatment, currency, erp_docstatus) values
  ('03620000-0000-0000-0000-0000000000e2','03620000-0000-0000-0000-00000000000a','Received',300,33,'exclusive','IDR',1),
  ('03620000-0000-0000-0000-0000000000e3','03620000-0000-0000-0000-00000000000b','Received',600,66,'exclusive','IDR',1);
create temp table actuals_before as select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(link_erp_purchase_documents('[{"erp_name":"PINV-L","procurement_id":"03620000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'fixture: invoice linked');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e1'), 400::numeric,
  'AC-PFE-005 open commitment excludes the linked invoice''s ledger-held net (1000 − 600)');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e2'), 200::numeric,
  'AC-PFE-005 open commitment excludes a PMO-pushed, ledger-submitted invoice (500 − 300)');
select is(project_committed_spend('03620000-0000-0000-0000-0000000000d1'), 600::numeric, 'AC-PFE-005 project committed spend = Σ open commitment');
select is(link_erp_purchase_documents('[{"erp_name":"PINV-RET","procurement_id":"03620000-0000-0000-0000-0000000000e1"}]') #>> '{results,0,outcome}', 'link', 'fixture: debit note linked');
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e1'), 500::numeric,
  'AC-PFE-005 a return reduces the ledger-held amount (1000 − (600 − 100))');
reset role;
select ok(not exists ((select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1') except select * from actuals_before)
                      union all (select * from actuals_before except select * from project_mapped_actuals('03620000-0000-0000-0000-0000000000d1'))),
  'AC-PFE-005 FR-PFE-035 actuals are unchanged by linking');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select procurement_open_commitment(p) from procurements p where p.id = '03620000-0000-0000-0000-0000000000e3'), 1000::numeric,
  'AC-PFE-005 NFR-PFE-002 a non-ledger org''s commitment is total_value');
reset role;
select * from finish();
rollback;
```

### A-3 Failing test: orphans + record targets (AC-PFE-016, 017)
File `supabase/tests/erp_purchase_orphans.test.sql`:
```sql
-- erp_purchase_orphans.test.sql — 0360/0361. Owns AC-PFE-016, AC-PFE-017.
begin;
select plan(6);
insert into organizations (id, name, default_currency) values
  ('03630000-0000-0000-0000-00000000000a','PFO A','IDR'), ('03630000-0000-0000-0000-00000000000b','PFO B','IDR');
insert into auth.users (id, email) values
  ('03630000-0000-0000-0000-0000000000a1','pfo-fin@example.com'), ('03630000-0000-0000-0000-0000000000a2','pfo-eng@example.com'),
  ('03630000-0000-0000-0000-0000000000b1','pfo-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03630000-0000-0000-0000-0000000000a1','03630000-0000-0000-0000-00000000000a','Fin','pfo-fin@example.com','Finance','active'),
  ('03630000-0000-0000-0000-0000000000a2','03630000-0000-0000-0000-00000000000a','Eng','pfo-eng@example.com','Engineer','active'),
  ('03630000-0000-0000-0000-0000000000b1','03630000-0000-0000-0000-00000000000b','B','pfo-b@example.com','Finance','active');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('03630000-0000-0000-0000-00000000000a','procurement','pmo-x','erpnext','PI-PMO');
select upsert_erp_purchase_documents('03630000-0000-0000-0000-00000000000a', $$[
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-ORPHAN","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-LINKED","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-PMO","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"PI-CANCEL","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":2,"erp_modified":"2026-02-01"}]$$::jsonb);
select upsert_erp_purchase_documents('03630000-0000-0000-0000-00000000000b',
  '[{"erp_doctype":"Purchase Invoice","erp_name":"PI-B","supplier":"S","currency":"IDR","grand_total":1,"erp_docstatus":1,"erp_modified":"2026-02-01"}]');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status) values
  ('03630000-0000-0000-0000-0000000000e1','03630000-0000-0000-0000-00000000000a','P1','03630000-0000-0000-0000-0000000000a1','IDR',1,'Draft'),
  ('03630000-0000-0000-0000-0000000000e2','03630000-0000-0000-0000-00000000000a','P2','03630000-0000-0000-0000-0000000000a1','IDR',1,'Draft');
insert into procurement_erp_links (org_id, procurement_id, erp_purchase_document_id)
  select '03630000-0000-0000-0000-00000000000a','03630000-0000-0000-0000-0000000000e1', id from erp_purchase_documents where erp_name = 'PI-LINKED';
insert into purchase_orders (id, procurement_id, org_id, status) values
  ('03630000-0000-0000-0000-0000000000f2','03630000-0000-0000-0000-0000000000e2','03630000-0000-0000-0000-00000000000a','Issued');

set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select array_agg(erp_name order by erp_name) from erp_purchase_orphans), array['PI-ORPHAN'], 'AC-PFE-016 orphans = unlinked, submitted, not PMO-pushed, own org');
select is((select count(*) from procurement_erp_links), 1::bigint, 'AC-PFE-016 Finance reads its org''s links');
select throws_ok($$ select link_procurement_sharepoint_item('03630000-0000-0000-0000-0000000000e1','purchase_order','03630000-0000-0000-0000-0000000000f2',
  '{"drive_id":"d","item_id":"i","web_url":"https://example.sharepoint.com/sites/s/a.pdf","name":"a.pdf","kind":"file"}') $$,
  '23514', null, 'AC-PFE-017 a file cannot target a record of another purchase');
select lives_ok($$ select link_procurement_sharepoint_item('03630000-0000-0000-0000-0000000000e2','purchase_order','03630000-0000-0000-0000-0000000000f2',
  '{"drive_id":"d","item_id":"i","web_url":"https://example.sharepoint.com/sites/s/a.pdf","name":"a.pdf","kind":"file"}') $$,
  'AC-PFE-017 a file targets a record of its own purchase');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*) from erp_purchase_orphans), 0::bigint, 'AC-PFE-016 an Engineer reads no orphans');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select array_agg(erp_name) from erp_purchase_orphans), array['PI-B'], 'AC-PFE-016 org B sees only its own orphans');
reset role;
select * from finish();
rollback;
```

### A-4 Write migration 0361
File `supabase/migrations/0361_procurement_erp_linking.sql`:
```sql
-- 0361 link ERP purchase documents into purchases; open commitment (spec procurement-flexible-entry; ADR-0093).
-- Rollback: supabase/migrations/rollback/0361_procurement_erp_linking_down.sql

-- §1 Purchases created from ERP documents keep their total from those documents (FR-PFE-026/027).
alter table public.procurements add column origin text
  constraint procurements_origin_check check (origin is null or origin = 'erp_link');
update public.record_history_config set omit_cols = array_append(omit_cols, 'origin')
 where table_name = 'procurements' and not ('origin' = any (omit_cols));

-- §2 A SharePoint reference may target one record of the same purchase (FR-PFE-050).
alter table public.procurement_documents
  add column record_kind text constraint procurement_documents_record_kind_check
    check (record_kind in ('purchase_request','rfq','quotation','purchase_order','goods_receipt','vendor_invoice','payment','erp_document')),
  add column record_id uuid,
  add constraint procurement_documents_record_pair check ((record_kind is null) = (record_id is null));
create function public.guard_procurement_document_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_proc uuid;
begin
  if new.record_kind is null then return new; end if;
  v_proc := case new.record_kind
    when 'purchase_request' then (select procurement_id from public.purchase_requests where id = new.record_id)
    when 'rfq'              then (select procurement_id from public.rfqs where id = new.record_id)
    when 'quotation'        then (select procurement_id from public.procurement_quotations where id = new.record_id)
    when 'purchase_order'   then (select procurement_id from public.purchase_orders where id = new.record_id)
    when 'goods_receipt'    then (select procurement_id from public.procurement_receipts where id = new.record_id)
    when 'vendor_invoice'   then (select procurement_id from public.procurement_invoices where id = new.record_id)
    when 'payment'          then (select procurement_id from public.payments where id = new.record_id)
    when 'erp_document'     then (select procurement_id from public.procurement_erp_links where erp_purchase_document_id = new.record_id)
  end;
  if v_proc is distinct from new.procurement_id then
    raise exception 'The document this file is attached to is not part of this purchase.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_document_record() from public, anon, authenticated;
create trigger procurement_documents_record_guard before insert or update of record_kind, record_id, procurement_id
  on public.procurement_documents for each row execute function public.guard_procurement_document_record();
grant insert (record_kind, record_id) on public.procurement_documents to authenticated;

-- §3 No double count (FR-PFE-035..037). Ledger-held = pre-tax ERP purchase invoices on the ledger.
create function public.procurement_ledger_held(p_procurement_id uuid) returns numeric
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce((select sum(coalesce(d.net_total, d.grand_total))
                     from public.procurement_erp_links l
                     join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = p.id and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1), 0)
       + coalesce((select sum(case when i.tax_treatment = 'inclusive' then i.amount - coalesce(i.tax_amount, 0) else i.amount end)
                     from public.procurement_invoices i
                    where i.procurement_id = p.id and i.erp_docstatus = 1 and i.erp_cancelled_at is null and i.amount is not null), 0)
    from public.procurements p
   where p.id = p_procurement_id and (auth.uid() is null or p.org_id = public.auth_org_id())
$$;
revoke all on function public.procurement_ledger_held(uuid) from public, anon;
grant execute on function public.procurement_ledger_held(uuid) to authenticated, service_role;

create function public.procurement_open_commitment(p public.procurements) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select case
    when p.status::text in ('Cancelled','Rejected') then 0::numeric
    when public.org_reads_erp_ledger() then greatest(0::numeric, coalesce(p.total_value, 0) - coalesce(public.procurement_ledger_held(p.id), 0))
    else coalesce(p.total_value, 0)::numeric end
$$;
revoke all on function public.procurement_open_commitment(public.procurements) from public, anon;
grant execute on function public.procurement_open_commitment(public.procurements) to authenticated;

create function public.project_committed_spend(p_project_id uuid) returns numeric
language sql stable security invoker set search_path = public, pg_catalog as $$
  select coalesce(sum(public.procurement_open_commitment(p)), 0)
    from public.procurements p
   where p.project_id = p_project_id and p.status::text = any (public.committed_procurement_statuses())
$$;
revoke all on function public.project_committed_spend(uuid) from public, anon;
grant execute on function public.project_committed_spend(uuid) to authenticated;

-- §4 Total of a purchase created from ERP documents (FR-PFE-027).
create function public.refresh_erp_linked_purchase_total(p_procurement_id uuid) returns void
language sql security definer set search_path = public, pg_catalog as $$
  with docs as (
    select d.erp_doctype, coalesce(d.net_total, d.grand_total) as amount
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.procurement_id = p_procurement_id and d.erp_docstatus = 1
  ), pick as (
    select coalesce(
      (select sum(amount) from docs where erp_doctype = 'Purchase Order'   having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Invoice' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Purchase Receipt' having count(*) > 0),
      (select sum(amount) from docs where erp_doctype = 'Payment Entry'    having count(*) > 0),
      0) as total
  )
  update public.procurements p set total_value = pick.total, updated_at = now()
    from pick where p.id = p_procurement_id and p.origin = 'erp_link' and p.total_value is distinct from pick.total;
$$;
revoke all on function public.refresh_erp_linked_purchase_total(uuid) from public, anon, authenticated;

-- §5 Link (FR-PFE-020..030). One code path for single, bulk, UI, CLI and dry run.
create function public.link_erp_purchase_documents(p_rows jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_results jsonb := '[]'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_created uuid[] := '{}';
  v_row jsonb; v_n integer := 0; v_matches integer;
  v_doc public.erp_purchase_documents%rowtype;
  v_proc public.procurements%rowtype;
  v_existing uuid; v_target uuid; v_project uuid; v_vendor uuid;
  v_group_key text; v_outcome text; v_reason text; v_gate text; v_vendor_supplier text; v_vendor_name text;
  v_step public.procurement_status; v_sp jsonb; v_new boolean;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Only Admin, Executive, Project Manager or Finance members can link ERP documents.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Send 1 to 500 rows per call.' using errcode = '22023';
  end if;

  begin  -- the batch; a dry run is rolled back at the end of this block (FR-PFE-030)
    for v_row in select value from jsonb_array_elements(p_rows) loop
      v_n := v_n + 1;
      v_outcome := 'link'; v_reason := null; v_target := null; v_new := false; v_doc := null; v_proc := null;
      begin  -- one row: a refusal rolls back this row only
        if jsonb_typeof(v_row) <> 'object' or coalesce(btrim(v_row->>'erp_name'), '') = '' then
          raise exception using errcode = 'PFE02', message = 'erp_name_missing';
        end if;
        select count(*) into v_matches from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'));
        if v_matches = 0 then raise exception using errcode = 'PFE02', message = 'document_not_found'; end if;
        if v_matches > 1 then raise exception using errcode = 'PFE02', message = 'document_ambiguous'; end if;
        select * into v_doc from public.erp_purchase_documents d
         where d.org_id = v_org and d.erp_name = btrim(v_row->>'erp_name')
           and (nullif(btrim(v_row->>'erp_doctype'), '') is null or d.erp_doctype = btrim(v_row->>'erp_doctype'))
         for update;
        if v_doc.erp_docstatus <> 1 then raise exception using errcode = 'PFE02', message = 'document_cancelled'; end if;
        if v_doc.pmo_owned then raise exception using errcode = 'PFE02', message = 'document_recorded_by_pmo'; end if;

        v_target  := nullif(btrim(v_row->>'procurement_id'), '')::uuid;
        v_project := nullif(btrim(v_row->>'project_id'), '')::uuid;
        select l.procurement_id into v_existing from public.procurement_erp_links l where l.erp_purchase_document_id = v_doc.id;
        if found then
          if v_target is null or v_target = v_existing then
            v_target := v_existing; v_reason := 'already_linked';
            raise exception using errcode = 'PFE03', message = 'skip';
          end if;
          raise exception using errcode = 'PFE02', message = 'document_linked_to_another_purchase';
        end if;

        if v_target is null then
          if v_project is not null and not exists (select 1 from public.projects p where p.id = v_project and p.org_id = v_org) then
            raise exception using errcode = 'PFE02', message = 'project_not_found';
          end if;
          v_group_key := coalesce(v_project::text, '-') || '|' || coalesce(nullif(btrim(v_row->>'group'), ''), v_doc.erp_name);
          v_target := (v_groups ->> v_group_key)::uuid;
          if v_target is null then
            select x.pmo_record_id::uuid into v_vendor from public.external_refs x
             where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext'
               and x.external_record_id = v_doc.supplier
               and x.pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
             order by x.created_at limit 1;
            insert into public.procurements (org_id, title, requested_by_id, project_id, vendor_id, budget_category, currency, total_value, origin)
            values (v_org,
                    coalesce(nullif(btrim(v_row->>'title'), ''), concat_ws(' ', coalesce(v_doc.supplier_name, v_doc.supplier), v_doc.erp_name)),
                    v_uid, v_project, v_vendor, nullif(btrim(v_row->>'budget_category'), '')::public.budget_category,
                    v_doc.currency, 0, 'erp_link')
            returning id into v_target;
            v_new := true;
          end if;
        end if;

        select * into v_proc from public.procurements where id = v_target for update;
        if not found or v_proc.org_id is distinct from v_org then raise exception using errcode = 'PFE02', message = 'purchase_not_found'; end if;
        if v_proc.status::text in ('Cancelled','Rejected') then raise exception using errcode = 'PFE02', message = 'purchase_closed'; end if;
        if v_doc.currency is distinct from v_proc.currency then raise exception using errcode = 'PFE02', message = 'currency_mismatch'; end if;
        if cardinality(v_doc.project_ids) > 0
           and (v_proc.project_id is null or not (v_proc.project_id = any (v_doc.project_ids))) then
          raise exception using errcode = 'PFE02', message = 'project_mismatch';
        end if;
        if exists (select 1 from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
                    where l.procurement_id = v_proc.id and d.supplier is distinct from v_doc.supplier) then
          raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
        end if;
        if v_proc.vendor_id is not null then
          v_vendor_supplier := null; v_vendor_name := null;
          select x.external_record_id into v_vendor_supplier from public.external_refs x
           where x.org_id = v_org and x.domain = 'companies' and x.external_tier = 'erpnext' and x.pmo_record_id = v_proc.vendor_id::text;
          if v_vendor_supplier is not null then
            if v_vendor_supplier is distinct from v_doc.supplier then raise exception using errcode = 'PFE02', message = 'supplier_mismatch'; end if;
          else
            select c.name into v_vendor_name from public.companies c where c.id = v_proc.vendor_id;
            if lower(btrim(coalesce(v_vendor_name, ''))) is distinct from lower(btrim(coalesce(v_doc.supplier_name, v_doc.supplier, ''))) then
              raise exception using errcode = 'PFE02', message = 'supplier_mismatch';
            end if;
          end if;
        end if;
        v_step := case v_doc.erp_doctype when 'Purchase Order' then 'Ordered' when 'Purchase Receipt' then 'Received'
                    when 'Purchase Invoice' then 'Vendor Invoiced' else 'Paid' end;
        v_gate := public.procurement_gate_violation(v_proc.id, v_step);
        if v_gate is not null then raise exception using errcode = 'PFE02', message = v_gate; end if;

        insert into public.procurement_erp_links (org_id, procurement_id, erp_purchase_document_id, linked_by)
        values (v_org, v_proc.id, v_doc.id, v_uid);
        if v_proc.vendor_id is null then
          update public.procurements p set vendor_id = x.pmo_record_id::uuid
            from (select pmo_record_id from public.external_refs
                   where org_id = v_org and domain = 'companies' and external_tier = 'erpnext' and external_record_id = v_doc.supplier
                     and pmo_record_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
                   order by created_at limit 1) x
           where p.id = v_proc.id and p.vendor_id is null;
        end if;
        if v_proc.origin = 'erp_link' then perform public.refresh_erp_linked_purchase_total(v_proc.id); end if;
        perform public.advance_procurement_status(v_proc.id, 'Derived: linked ERPNext ' || v_doc.erp_doctype || ' ' || v_doc.erp_name);
        v_sp := v_row -> 'sharepoint';
        if v_sp is not null and jsonb_typeof(v_sp) = 'object' then
          insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
          values (v_org, v_proc.id, 'Microsoft reference', v_sp->>'web_url', 'onedrive', v_sp->>'drive_id', v_sp->>'item_id',
                  v_sp->>'name', v_sp->>'kind', 'erp_document', v_doc.id);
        end if;
        perform public.log_audit('procurement.erp_link', v_org, v_uid, v_proc.id,
          jsonb_build_object('erp_doctype', v_doc.erp_doctype, 'erp_name', v_doc.erp_name, 'new_purchase', v_new));
        if v_new then
          v_groups := v_groups || jsonb_build_object(v_group_key, v_proc.id);
          v_created := v_created || v_proc.id;
        end if;
      exception
        when sqlstate 'PFE03' then v_outcome := 'skip';
        when sqlstate 'PFE02' then v_outcome := 'refused'; v_reason := sqlerrm; v_target := null;
        when invalid_text_representation then v_outcome := 'refused'; v_reason := 'invalid_id'; v_target := null;
        when insufficient_privilege or check_violation then v_outcome := 'refused'; v_reason := sqlerrm; v_target := null;
        when others then v_outcome := 'refused'; v_reason := 'error: ' || sqlerrm; v_target := null;
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'row', v_n, 'erp_doctype', v_doc.erp_doctype, 'erp_name', coalesce(v_doc.erp_name, v_row->>'erp_name'),
        'outcome', v_outcome, 'reason', v_reason,
        'procurement_id', case when p_dry_run and v_target = any (v_created) then null else v_target end,
        'new_purchase', coalesce(v_target = any (v_created), false)));
    end loop;
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
  exception when sqlstate 'PFE01' then null;
  end;
  return jsonb_build_object(
    'dry_run', p_dry_run,
    'counts', jsonb_build_object(
      'link',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'link'),
      'skip',    (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'skip'),
      'refused', (select count(*) from jsonb_array_elements(v_results) r where r->>'outcome' = 'refused')),
    'results', v_results);
end $$;
revoke all on function public.link_erp_purchase_documents(jsonb, boolean) from public, anon;
grant execute on function public.link_erp_purchase_documents(jsonb, boolean) to authenticated;

-- §6 Unlink (FR-PFE-031): status never moves back; per-document files move to the purchase.
create function public.unlink_erp_purchase_document(p_link_id uuid) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_link public.procurement_erp_links%rowtype;
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Finance') then
    raise exception 'Only an Admin or Finance member can unlink an ERP document.' using errcode = '42501';
  end if;
  select * into v_link from public.procurement_erp_links where id = p_link_id for update;
  if not found or v_link.org_id is distinct from public.auth_org_id() then
    raise exception 'link not found' using errcode = 'P0002';
  end if;
  update public.procurement_documents set record_kind = null, record_id = null
   where procurement_id = v_link.procurement_id and record_kind = 'erp_document' and record_id = v_link.erp_purchase_document_id;
  delete from public.procurement_erp_links where id = p_link_id;
  perform public.refresh_erp_linked_purchase_total(v_link.procurement_id);
  perform public.log_audit('procurement.erp_unlink', v_link.org_id, auth.uid(), v_link.procurement_id,
    jsonb_build_object('erp_purchase_document_id', v_link.erp_purchase_document_id));
end $$;
revoke all on function public.unlink_erp_purchase_document(uuid) from public, anon;
grant execute on function public.unlink_erp_purchase_document(uuid) to authenticated;

-- §7 Link a SharePoint item on a purchase or one of its documents (FR-PFE-050; CLI + app).
create function public.link_procurement_sharepoint_item(p_procurement_id uuid, p_record_kind text, p_record_id uuid, p_item jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_id uuid; v_org uuid := public.auth_org_id();
begin
  perform public.assert_is_active_member();
  if coalesce(public.auth_role()::text, '') not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'Cannot change this procurement reference.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.procurements p where p.id = p_procurement_id and p.org_id = v_org) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' or coalesce(p_item->>'kind', '') not in ('file','folder') then
    raise exception 'A SharePoint item needs drive_id, item_id, web_url, name and kind (file or folder).' using errcode = '22023';
  end if;
  insert into public.procurement_documents (org_id, procurement_id, type, link, source, ms_drive_id, ms_item_id, ms_item_name, ms_item_kind, record_kind, record_id)
  values (v_org, p_procurement_id, 'Microsoft reference', p_item->>'web_url', 'onedrive', p_item->>'drive_id', p_item->>'item_id',
          p_item->>'name', p_item->>'kind', nullif(btrim(p_record_kind), ''), p_record_id)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb) to authenticated;
```

### A-5 Rollback 0361
File `supabase/migrations/rollback/0361_procurement_erp_linking_down.sql`:
```sql
-- Reverses 0361. Linked documents become orphans again; purchases created from them stay (Draft or derived status).
drop function if exists public.link_procurement_sharepoint_item(uuid, text, uuid, jsonb);
drop function if exists public.unlink_erp_purchase_document(uuid);
drop function if exists public.link_erp_purchase_documents(jsonb, boolean);
drop function if exists public.refresh_erp_linked_purchase_total(uuid);
drop function if exists public.project_committed_spend(uuid);
drop function if exists public.procurement_open_commitment(public.procurements);
drop function if exists public.procurement_ledger_held(uuid);
drop trigger if exists procurement_documents_record_guard on public.procurement_documents;
drop function if exists public.guard_procurement_document_record();
alter table public.procurement_documents drop constraint if exists procurement_documents_record_pair,
  drop column if exists record_id, drop column if exists record_kind;
update public.record_history_config set omit_cols = array_remove(omit_cols, 'origin') where table_name = 'procurements';
alter table public.procurements drop column if exists origin;
delete from public.procurement_erp_links;
```

### A-6 Verify + mutation checks
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/procurement_erp_links.test.sql supabase/tests/procurement_no_double_count.test.sql supabase/tests/erp_purchase_orphans.test.sql supabase/tests/erp_purchase_documents.test.sql'` → GREEN.
Mutations (each: edit, reset+test, expect named test RED, revert):
- **M-A1 no double count**: in `procurement_open_commitment` replace the ledger branch with `coalesce(p.total_value, 0)` → `AC-PFE-005 open commitment excludes…` RED.
- **M-A2 one purchase per doc (DB)**: delete `constraint procurement_erp_links_one_purchase unique (erp_purchase_document_id)` from 0360 → `AC-PFE-008 the database refuses a second purchase` RED.
- **M-A3 one purchase per doc (RPC)**: replace `raise exception using errcode = 'PFE02', message = 'document_linked_to_another_purchase';` with `null;` → `AC-PFE-008 one purchase per document` RED.
- **M-A4 dry run**: delete `if p_dry_run then raise exception … 'PFE01' … end if;` → `AC-PFE-019 a dry run writes nothing` RED.
- **M-A5 supplier**: delete the vendor-mapping `supplier_mismatch` raise → `AC-PFE-008 supplier differs` RED.

---

## 4. Slice B — start anywhere (0362)

### B-1 Failing test (AC-PFE-002, 003, 007, 012, 013)
File `supabase/tests/procurement_flexible_status.test.sql`:
```sql
-- procurement_flexible_status.test.sql — 0362. Owns AC-PFE-002, AC-PFE-003, AC-PFE-007, AC-PFE-012, AC-PFE-013.
begin;
select plan(24);
select is((select count(*) from procurement_status_events where notes like 'Derived:%'), 0::bigint, 'AC-PFE-012 nothing pre-existing was derived');

insert into organizations (id, name, default_currency) values ('03620000-0000-0000-0000-0000000000f0','PFS','IDR');
insert into auth.users (id, email) values
  ('03620000-0000-0000-0000-0000000000f1','pfs-req@example.com'), ('03620000-0000-0000-0000-0000000000f2','pfs-fin1@example.com'),
  ('03620000-0000-0000-0000-0000000000f3','pfs-fin2@example.com'), ('03620000-0000-0000-0000-0000000000f4','pfs-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03620000-0000-0000-0000-0000000000f1','03620000-0000-0000-0000-0000000000f0','Req','pfs-req@example.com','Project Manager','active'),
  ('03620000-0000-0000-0000-0000000000f2','03620000-0000-0000-0000-0000000000f0','Fin1','pfs-fin1@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000f3','03620000-0000-0000-0000-0000000000f0','Fin2','pfs-fin2@example.com','Finance','active'),
  ('03620000-0000-0000-0000-0000000000f4','03620000-0000-0000-0000-0000000000f0','Admin','pfs-admin@example.com','Admin','active');
insert into procurements (id, org_id, title, requested_by_id, currency, total_value, status, approved_by_id, approved_total_value) values
  ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','D1','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a02','03620000-0000-0000-0000-0000000000f0','D2','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a03','03620000-0000-0000-0000-0000000000f0','D3','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a04','03620000-0000-0000-0000-0000000000f0','D4','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','D5','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','O6','03620000-0000-0000-0000-0000000000f1','IDR',100,'Ordered',null,null),
  ('03620000-0000-0000-0000-000000000a07','03620000-0000-0000-0000-0000000000f0','D7','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','M8','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null),
  ('03620000-0000-0000-0000-000000000a09','03620000-0000-0000-0000-0000000000f0','A9','03620000-0000-0000-0000-0000000000f1','IDR',100,'Vendor Invoiced','03620000-0000-0000-0000-0000000000f2',100),
  ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','S10','03620000-0000-0000-0000-0000000000f1','IDR',100,'Draft',null,null);

-- User writes (claims set, role stays postgres so fixtures bypass grants): evidence derives status.
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
insert into procurement_invoices (procurement_id, org_id, status, amount, currency) values ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','Received',100,'IDR');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a01'), 'Vendor Invoiced', 'AC-PFE-002 an invoice on a Draft purchase derives Vendor Invoiced');
insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a01','03620000-0000-0000-0000-0000000000f0','Issued');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a01'), 'Vendor Invoiced', 'AC-PFE-002 a later order never moves status back');
select is((select count(*) from procurement_status_events where procurement_id = '03620000-0000-0000-0000-000000000a01' and notes like 'Derived:%'), 1::bigint, 'FR-PFE-007 one derived event');
-- AC-PFE-007 many documents per step.
insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Issued'), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Issued');
insert into procurement_receipts (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Partial'), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Partial');
insert into procurement_invoices (procurement_id, org_id, status, amount, currency) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Received',50,'IDR'), ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Received',50,'IDR');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a08'), 'Vendor Invoiced', 'AC-PFE-007 furthest of many documents');
insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a08','03620000-0000-0000-0000-0000000000f0','Paid',100);
select results_eq($$ select (select status::text from procurements where id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from purchase_orders where procurement_id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from procurement_receipts where procurement_id = '03620000-0000-0000-0000-000000000a08'),
  (select count(*)::int from procurement_invoices where procurement_id = '03620000-0000-0000-0000-000000000a08') $$,
  $$ values ('Paid', 2, 2, 2) $$, 'AC-PFE-007 a paid payment derives Paid and every document stays attached');
reset request.jwt.claims;

-- Direct SQL (seed/migration/fixture) never derives (NFR-PFE-010).
insert into procurement_invoices (procurement_id, org_id, status, amount, currency) values ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a10'), 'Draft', 'NFR-PFE-010 a direct SQL write derives nothing');

-- Transition RPC: forward skip + idempotence (FR-PFE-005/006).
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a02','Paid') $$, 'FR-PFE-005 Finance pays a Draft purchase with gates off');
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a02'), 'Paid', 'FR-PFE-005 status Paid');
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a01','Vendor Invoiced') $$, 'FR-PFE-006 requesting a held document step is a no-op');
reset role;

-- Gates (AC-PFE-003): each ON refuses on the transition and on the record insert.
update organizations set procurement_gates = '{"approval_before_order":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a03','Ordered') $$, '23514', null, 'AC-PFE-003 approval_before_order refuses the transition');
reset role;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a03','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', 'Your organization requires an approval before an order.', 'AC-PFE-003 approval_before_order refuses the record');
reset request.jwt.claims;
update organizations set procurement_gates = '{"request_before_order":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a04','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  '23514', null, 'AC-PFE-003 request_before_order refuses an order without a request');
insert into purchase_requests (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','Submitted');
select lives_ok($$ insert into purchase_orders (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a05','03620000-0000-0000-0000-0000000000f0','Issued') $$,
  'AC-PFE-003 request_before_order allows an order once a request exists');
reset request.jwt.claims;
update organizations set procurement_gates = '{"receipt_before_invoice":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into procurement_invoices (procurement_id, org_id, status, amount, currency) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR') $$,
  '23514', null, 'AC-PFE-003 receipt_before_invoice refuses an invoice before a receipt');
insert into procurement_receipts (procurement_id, org_id, status) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Complete');
select lives_ok($$ insert into procurement_invoices (procurement_id, org_id, status, amount, currency) values ('03620000-0000-0000-0000-000000000a06','03620000-0000-0000-0000-0000000000f0','Received',1,'IDR') $$,
  'AC-PFE-003 receipt_before_invoice allows the invoice after a receipt');
reset request.jwt.claims;
update organizations set procurement_gates = '{"approval_before_payment":true}' where id = '03620000-0000-0000-0000-0000000000f0';
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a07','Paid') $$, '23514', null, 'AC-PFE-003 approval_before_payment refuses paying an unapproved purchase');
reset role;
update organizations set procurement_gates = '{}' where id = '03620000-0000-0000-0000-0000000000f0';

-- SoD (AC-PFE-013): approver ≠ payer on every path to Paid.
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a09','Paid') $$, '42501', null, 'AC-PFE-013 the approver cannot pay by transition');
reset role;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a09','03620000-0000-0000-0000-0000000000f0','Paid',100) $$,
  '42501', null, 'AC-PFE-013 the approver cannot pay by recording a paid payment');
reset request.jwt.claims;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03620000-0000-0000-0000-0000000000f3","role":"authenticated"}';
select lives_ok($$ select transition_procurement('03620000-0000-0000-0000-000000000a09','Paid') $$, 'AC-PFE-013 a different Finance member pays');
reset role;

-- Machine writer (ERP mirror): a refused derivation keeps the record and audits (FR-PFE-008).
update procurements set status = 'Vendor Invoiced', approved_by_id = '03620000-0000-0000-0000-0000000000f2', approved_total_value = 10 where id = '03620000-0000-0000-0000-000000000a10';
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ insert into payments (procurement_id, org_id, status, amount) values ('03620000-0000-0000-0000-000000000a10','03620000-0000-0000-0000-0000000000f0','Paid',100) $$,
  'FR-PFE-008 the mirror write is kept even when its derivation is refused');
reset request.jwt.claims;
select is((select status::text from procurements where id = '03620000-0000-0000-0000-000000000a10'), 'Vendor Invoiced', 'FR-PFE-008 status is left unchanged');
select ok(exists (select 1 from audit_events where action = 'procurement.derive_skipped' and entity_id = '03620000-0000-0000-0000-000000000a10'), 'FR-PFE-008 the skip is audited');

select * from finish();
rollback;
```
Run → **RED**.

### B-2 Write migration 0362 — §1 triggers
File `supabase/migrations/0362_procurement_start_anywhere.sql`, part 1:
```sql
-- 0362 procurement start-anywhere: derived status, gates on records, transition skips, SoD on every Paid path.
-- Spec procurement-flexible-entry (FR-PFE-001..017); ADR-0093. Rollback: rollback/0362_procurement_start_anywhere_down.sql
-- Derivation and record gates run for USER writes (auth.uid() set) and the ERP MIRROR (service_role JWT) only — never for
-- direct SQL (seed, migrations, fixtures), so existing data is never re-derived (NFR-PFE-010).

create function public.guard_procurement_record_gate() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_reason text;
begin
  if auth.uid() is null then return new; end if;   -- the ERP dispatch checked the gate before the ERP write (slice G)
  v_reason := public.procurement_gate_violation(new.procurement_id, tg_argv[0]::public.procurement_status);
  if v_reason is not null then
    raise exception '%', public.procurement_gate_message(v_reason) using errcode = '23514', detail = v_reason;
  end if;
  return new;
end $$;
revoke all on function public.guard_procurement_record_gate() from public, anon, authenticated;

create function public.advance_procurement_on_record() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is not null then
    perform public.advance_procurement_status(new.procurement_id, 'Derived: ' || tg_argv[0] || ' recorded');
  elsif coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    begin
      perform public.advance_procurement_status(new.procurement_id, 'Derived: ' || tg_argv[0] || ' recorded');
    exception when others then
      perform public.log_audit('procurement.derive_skipped', new.org_id, null, new.procurement_id,
        jsonb_build_object('record', tg_argv[0], 'reason', sqlerrm));
    end;
  end if;
  return null;
end $$;
revoke all on function public.advance_procurement_on_record() from public, anon, authenticated;

create trigger zz_purchase_orders_gate before insert on public.purchase_orders
  for each row execute function public.guard_procurement_record_gate('Ordered');
create trigger zz_procurement_receipts_gate before insert on public.procurement_receipts
  for each row execute function public.guard_procurement_record_gate('Received');
create trigger zz_procurement_invoices_gate before insert on public.procurement_invoices
  for each row execute function public.guard_procurement_record_gate('Vendor Invoiced');
create trigger zz_purchase_orders_advance after insert on public.purchase_orders
  for each row execute function public.advance_procurement_on_record('order');
create trigger zz_procurement_receipts_advance after insert on public.procurement_receipts
  for each row execute function public.advance_procurement_on_record('receipt');
create trigger zz_procurement_invoices_advance after insert on public.procurement_invoices
  for each row execute function public.advance_procurement_on_record('vendor invoice');
create trigger zz_payments_advance after insert or update of status on public.payments
  for each row when (new.status = 'Paid') execute function public.advance_procurement_on_record('payment');
```

### B-3 0362 §2 — the update guard (0349 body + FR-PFE-016/017)
Append:
```sql
create or replace function public.guard_procurement_approved_total() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  if tg_op = 'UPDATE' and not public.actor_bypasses_rls()
     and (new.approved_total_value is distinct from old.approved_total_value
          or new.amount_approved_by_id is distinct from old.amount_approved_by_id) then
    raise exception 'Approved amount is server managed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'Requested' and new.status = 'Approved' then
    if auth.uid() is not null and auth.uid() = (
      select e.actor_id from public.procurement_status_events e
       where e.procurement_id = old.id and e.from_status = 'Vendor Quoted'::procurement_status
         and e.to_status = 'Requested'::procurement_status
       order by e.created_at desc, e.id desc limit 1
    ) then
      raise exception 'separation of duties: quote selector cannot approve the revised amount' using errcode = '42501';
    end if;
    new.approved_total_value := public.procurement_request_amount(new.id);
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and old.status = 'Vendor Quoted' and new.status = 'Quote Selected'
        and new.total_value > old.approved_total_value then
    new.status := 'Requested';
    new.approved_by_id := null;
    new.approved_total_value := null;
    new.amount_approved_by_id := null;
  elsif tg_op = 'UPDATE' and new.status = 'Paid' and old.status is distinct from 'Paid' then
    -- 0362 FR-PFE-016: approver ≠ payer on EVERY path to Paid (transition, a Paid payment, a linked Payment Entry).
    if auth.uid() is not null and (auth.uid() = old.approved_by_id or auth.uid() = old.amount_approved_by_id) then
      raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
    end if;
    -- 0362 FR-PFE-017: no recorded approval + approval_before_payment OFF = nothing to compare against.
    if old.approved_total_value is null then
      if old.approved_by_id is not null or public.procurement_gate(old.org_id, 'approval_before_payment') then
        raise exception 'Cannot pay without a recorded approved amount.' using errcode = '23514';
      end if;
    elsif not coalesce((select c.ok from public.procurement_payment_within_ceiling(old.id) c), false) then
      raise exception 'Vendor bill exceeds the approved amount or its currency differs; obtain approval or correct the bill before payment.' using errcode = '23514';
    end if;
  end if;
  return new;
end; $$;
```

### B-4 0362 §3 — `transition_procurement` (0284 body + lines marked `0362`)
Append the full function:
```sql
create or replace function public.transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from procurement_status; v_org uuid; v_requester uuid; v_approver uuid;
  v_project uuid; v_category public.budget_category; v_currency text; v_amount numeric; v_route record;
  v_role user_role := auth_role(); v_uid uuid := auth.uid(); v_is_admin boolean;
  v_gate text;                                                                                         -- 0362
  v_legal jsonb := jsonb_build_object(
    'Draft',           jsonb_build_array('Requested','Cancelled','Ordered','Received','Vendor Invoiced','Paid'),   -- 0362 skips
    'Requested',       jsonb_build_array('Approved','Rejected','Cancelled'),
    'Approved',        jsonb_build_array('Vendor Quoted','Ordered','Cancelled','Received','Vendor Invoiced','Paid'), -- 0362 skips
    'Vendor Quoted',   jsonb_build_array('Cancelled'),
    'Quote Selected',  jsonb_build_array('Ordered','Cancelled','Received','Vendor Invoiced','Paid'),               -- 0362 skips
    'Ordered',         jsonb_build_array('Received','Cancelled','Vendor Invoiced','Paid'),                         -- 0362 skips
    'Received',        jsonb_build_array('Vendor Invoiced','Cancelled','Paid'),                                    -- 0362 skip
    'Vendor Invoiced', jsonb_build_array('Paid','Cancelled'),
    'Rejected',        jsonb_build_array('Draft'),
    'Paid',            jsonb_build_array(),
    'Cancelled',       jsonb_build_array());
  v_allowed_roles text[];
begin
  perform public.assert_is_active_member();
  v_is_admin := (v_role = 'Admin');
  select status, org_id, requested_by_id, approved_by_id, project_id, budget_category, currency
    into v_from, v_org, v_requester, v_approver, v_project, v_category, v_currency
    from public.procurements where id = p_id for update;
  if v_from is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501'; end if;

  -- 0362 FR-PFE-006: a document step the purchase already holds (e.g. derived from the record just captured) is a no-op.
  if v_from = p_to and p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then return; end if;

  if v_from = 'Vendor Quoted' and p_to = 'Quote Selected' then
    raise exception 'select a quote to move to Quote Selected' using errcode = 'P0001';
  end if;
  if not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- SoD-a (requester ≠ approver), outside the Admin skip (OD-PROC-8).
  if v_from = 'Requested' and p_to in ('Approved','Rejected') and v_uid = v_requester then
    raise exception 'separation of duties: requester cannot approve/reject own procurement' using errcode = '42501';
  end if;
  -- SoD-b (approver ≠ payer) on every path to Paid; the update guard re-checks it (0362, FR-PFE-016).
  if p_to = 'Paid' and v_uid = v_approver then
    raise exception 'separation of duties: approver cannot pay own procurement' using errcode = '42501';
  end if;

  -- 0362 FR-PFE-010: org purchase rules.
  if p_to::text in ('Ordered','Received','Vendor Invoiced','Paid') then
    v_gate := public.procurement_gate_violation(p_id, p_to);
    if v_gate is not null then
      raise exception '%', public.procurement_gate_message(v_gate) using errcode = '23514', detail = v_gate;
    end if;
  end if;

  if v_from = 'Requested' and p_to in ('Approved','Rejected') then
    if v_project is not null and v_category is not null then
      perform pg_advisory_xact_lock(hashtextextended('spend-line:' || v_project::text || ':' || v_category::text, 0));
    end if;
    v_amount := public.procurement_request_amount(p_id);
    select * into v_route from public.spend_approval_route(v_org, v_project, v_category, v_amount, v_currency, v_requester,
             v_uid, public.procurement_submitted_at(p_id));
    if coalesce(v_route.route, 'senior') <> 'flat' and not v_is_admin
       and not coalesce(v_uid = any (v_route.approver_ids), false) then
      if v_route.route = 'admin' then
        raise exception 'approval routing: % requires an Admin (no senior approver is eligible)', v_route.reason using errcode = '42501';
      end if;
      raise exception 'approval routing: % requires a named approver', coalesce(v_route.reason, 'unknown') using errcode = '42501';
    end if;
    perform public.log_audit('procurement.approval_route', v_org, v_uid, p_id,
      jsonb_build_object('to', p_to::text, 'route', v_route.route, 'reason', v_route.reason,
        'request_amount', v_amount, 'line_budget', v_route.line_budget, 'line_used', v_route.line_used,
        'budget_category', v_category::text,
        'break_glass', (coalesce(v_route.route, 'senior') <> 'flat' and v_is_admin
                        and not coalesce(v_uid = any (v_route.approver_ids), false))));
  end if;

  if not v_is_admin then
    declare v_is_requester boolean := (v_uid is not null and v_uid = v_requester);
    begin
      if p_to = 'Cancelled' then
        if v_from in ('Draft','Requested') and v_is_requester then
          v_allowed_roles := array['Executive','Project Manager','Finance','Engineer'];
        else
          v_allowed_roles := array['Project Manager','Finance','Executive'];
        end if;
      else
        v_allowed_roles := case
          when v_from = 'Draft'     and p_to = 'Requested' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Requested' and p_to in ('Approved','Rejected') then array['Project Manager','Finance','Executive']
          when v_from = 'Rejected'  and p_to = 'Draft' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array[]::text[] end
          when v_from = 'Approved'  and p_to = 'Vendor Quoted' then array['Project Manager','Finance']
          when p_to = 'Ordered'                                then array['Project Manager','Finance']                    -- 0362: also from Draft
          when v_from = 'Ordered'   and p_to = 'Received' then case when v_is_requester then array['Executive','Project Manager','Finance','Engineer'] else array['Project Manager'] end
          when p_to = 'Received'                               then array['Project Manager','Finance']                    -- 0362: skip into Received
          when p_to = 'Vendor Invoiced'                        then array['Finance']
          when p_to = 'Paid'                                   then array['Finance']
          else array[]::text[]
        end;
      end if;
      if not (v_role::text = any (v_allowed_roles)) then
        raise exception 'not authorized for transition % -> %', v_from, p_to using errcode = '42501';
      end if;
    end;
  end if;

  update public.procurements set
    status             = p_to,
    pr_number          = case when p_to = 'Requested' then coalesce(pr_number, next_procurement_doc_number(org_id, 'PR')) else pr_number end,
    po_number          = case when p_to = 'Ordered'   then coalesce(po_number, next_procurement_doc_number(org_id, 'PO')) else po_number end,
    approved_by_id     = case when p_to = 'Approved'  then v_uid  else approved_by_id end,
    approval_notes     = case when p_to = 'Approved'  then p_notes else approval_notes end,
    rejection_notes    = case when p_to = 'Rejected'  then p_notes else rejection_notes end,
    vendor_invoiced_at = case when p_to in ('Vendor Invoiced','Paid') then coalesce(vendor_invoiced_at, now()) else vendor_invoiced_at end,  -- 0362: skips to Paid keep the stamp
    updated_at         = now()
  where id = p_id;

  if p_to = 'Requested' then
    insert into public.purchase_requests (procurement_id, pr_number, status, date)
    select p_id, p.pr_number, 'Submitted', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_requests pr where pr.procurement_id = p_id and pr.pr_number = p.pr_number);
  elsif p_to = 'Ordered' then
    insert into public.purchase_orders (procurement_id, po_number, status, date)
    select p_id, p.po_number, 'Issued', current_date from public.procurements p
     where p.id = p_id and not exists (select 1 from public.purchase_orders po where po.procurement_id = p_id and po.po_number = p.po_number);
  elsif p_to = 'Paid' then
    update public.payments set status = 'Paid', date = coalesce(date, current_date)
     where procurement_id = p_id and status = 'Scheduled';
    insert into public.payments (procurement_id, invoice_id, pay_number, status, date, amount, currency)
    select p_id,
           case when count(i.id) filter (where i.amount is not null) = 1
                then (array_agg(i.id) filter (where i.amount is not null))[1] else null end,
           next_procurement_doc_number(v_org, 'PAY'), 'Paid', current_date,
           coalesce(sum(i.amount + case when i.tax_treatment = 'exclusive' then coalesce(i.tax_amount, 0) else 0 end
                        - coalesce(i.withheld_amount, 0)) filter (where i.amount is not null), p.total_value),
           p.currency
      from public.procurements p left join public.procurement_invoices i on i.procurement_id = p.id
     where p.id = p_id and not exists (select 1 from public.payments pay where pay.procurement_id = p_id)
     group by p.id;
  end if;

  insert into public.procurement_status_events (procurement_id, org_id, from_status, to_status, actor_id, notes)
  values (p_id, v_org, v_from, p_to, auth.uid(), p_notes);
end; $$;
```
Note the one behaviour change outside skips: `vendor_invoiced_at` is now also stamped on a transition to Paid when it was never stamped (a skip to Paid from Draft/Ordered/Received), so debt aging has a date; for the classic Vendor Invoiced → Paid path it was already set.

### B-5 Rollback 0362
File `supabase/migrations/rollback/0362_procurement_start_anywhere_down.sql`:
```sql
-- Reverses 0362: drops derivation/gate triggers; restores 0349's guard and 0284's transition_procurement.
drop trigger if exists zz_payments_advance on public.payments;
drop trigger if exists zz_procurement_invoices_advance on public.procurement_invoices;
drop trigger if exists zz_procurement_receipts_advance on public.procurement_receipts;
drop trigger if exists zz_purchase_orders_advance on public.purchase_orders;
drop trigger if exists zz_procurement_invoices_gate on public.procurement_invoices;
drop trigger if exists zz_procurement_receipts_gate on public.procurement_receipts;
drop trigger if exists zz_purchase_orders_gate on public.purchase_orders;
drop function if exists public.advance_procurement_on_record();
drop function if exists public.guard_procurement_record_gate();
```
then append, verbatim: `supabase/migrations/0349_procurement_integrity_guards.sql` lines 101–143 (the 0349 `guard_procurement_approved_total` body)
and `supabase/migrations/0284_procurement_money_consistency.sql` lines 73–267 (the 0284 `transition_procurement` body).

### B-6 Rollback round-trip test (NFR-PFE-011)
File `scripts/procurement-flexible-rollback.test.sql`:
```sql
begin;
select plan(4);
-- @0362_DOWN@
-- @0361_DOWN@
-- @0360_DOWN@
select hasnt_table('public','procurement_erp_links','down: link table gone');
select hasnt_column('public','organizations','procurement_gates','down: gates column gone');
-- @0360_UP@
-- @0361_UP@
-- @0362_UP@
select has_table('public','procurement_erp_links','up again: link table');
select has_function('public','link_erp_purchase_documents', array['jsonb','boolean'], 'up again: link RPC');
select * from finish();
rollback;
```
File `scripts/test-procurement-flexible-rollback.sh` (`chmod +x`):
```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
test_file=supabase/tests/procurement_flexible_rollback.generated.test.sql
cleanup() { rm -f "$test_file"; }
trap cleanup EXIT
python3 - "$test_file" <<'PY'
from pathlib import Path
import sys
out = Path(sys.argv[1])
text = Path('scripts/procurement-flexible-rollback.test.sql').read_text()
for marker, source in [
    ('-- @0362_DOWN@', 'supabase/migrations/rollback/0362_procurement_start_anywhere_down.sql'),
    ('-- @0361_DOWN@', 'supabase/migrations/rollback/0361_procurement_erp_linking_down.sql'),
    ('-- @0360_DOWN@', 'supabase/migrations/rollback/0360_procurement_flexible_foundation_down.sql'),
    ('-- @0360_UP@', 'supabase/migrations/0360_procurement_flexible_foundation.sql'),
    ('-- @0361_UP@', 'supabase/migrations/0361_procurement_erp_linking.sql'),
    ('-- @0362_UP@', 'supabase/migrations/0362_procurement_start_anywhere.sql'),
]:
    text = text.replace(marker, Path(source).read_text())
out.write_text(text)
PY
supabase test db "$test_file"
```
B owns both files (they need all three migrations; B merges after A, so B adds them in its last task after rebasing on A).
Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && scripts/test-procurement-flexible-rollback.sh'` → GREEN.

### B-7 Verify the new test
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/procurement_flexible_status.test.sql'` → GREEN (24).

### B-8 Mutation checks
- **M-B1 SoD**: in the guard, replace `auth.uid() = old.approved_by_id or ` with nothing → `AC-PFE-013 the approver cannot pay by recording a paid payment` RED.
- **M-B2 gates**: in `guard_procurement_record_gate` replace the `raise` with `null;` → `AC-PFE-003 approval_before_order refuses the record` RED.
- **M-B3 never backwards**: in `advance_procurement_status` (0360) change `<=` to `<>` → `AC-PFE-002 a later order never moves status back` RED.

### B-9 Re-baseline existing procurement pgTAP (deliberate behaviour change, ADR-0093)
Run every existing file that writes procurement records under a user JWT:
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db $(grep -lE "create_purchase_order|create_procurement_receipt|create_procurement_invoice|capture_vendor_invoice|create_payment|transition_procurement" supabase/tests/*.sql | tr "\n" " ")'
```
For each RED assertion, classify and record the classification in the PR body:
(a) the test asserted the status *stayed* after a record was created → update the expected status to the derived one and cite FR-PFE-002;
(b) the test then called `transition_procurement` to a step the record already derived → leave it (FR-PFE-006 makes it a no-op) — if it now fails with "illegal transition", that is a defect in B, fix B;
(c) anything else → **stop and report** to the Director; do not edit the assertion.
Never weaken an SoD, RLS or ceiling assertion.

---

## 5. Slice F — sweep feed for receipts and payments (FR-PFE-040, AC-PFE-020)

### F-1 Failing test
Append to `pmo-portal/src/lib/adapterSeam/erpnext/purchaseMirrorFeed.test.ts`:
```ts
describe('AC-PFE-020 receipts and supplier payments', () => {
  it('AC-PFE-020: maps a Purchase Receipt with net and grand totals', () => {
    expect(toPurchaseMirrorRow('Purchase Receipt', {
      name: 'MAT-PRE-1', supplier: 'SUP-1', supplier_name: 'Supplier One', posting_date: '2026-02-03', currency: 'IDR',
      grand_total: 1110, net_total: 1000, status: 'To Bill', docstatus: 1, is_return: 0, project: 'ERP-A', modified: '2026-02-03 10:00:00',
    })).toMatchObject({ erp_doctype: 'Purchase Receipt', erp_name: 'MAT-PRE-1', supplier: 'SUP-1', doc_date: '2026-02-03',
      grand_total: '1110', net_total: '1000', erp_status: 'To Bill', erp_project: 'ERP-A', bill_no: null, outstanding_amount: null });
  });
  it('AC-PFE-020: maps a Pay-type supplier Payment Entry (party → supplier, paid_amount → totals)', () => {
    expect(toPurchaseMirrorRow('Payment Entry', {
      name: 'ACC-PAY-1', party: 'SUP-1', party_name: 'Supplier One', posting_date: '2026-02-04', paid_from_account_currency: 'IDR',
      paid_amount: 1110, status: 'Submitted', docstatus: 1, project: 'ERP-A', modified: '2026-02-04 10:00:00',
    })).toMatchObject({ erp_doctype: 'Payment Entry', supplier: 'SUP-1', supplier_name: 'Supplier One', currency: 'IDR',
      grand_total: '1110', net_total: null, doc_date: '2026-02-04' });
  });
  it('AC-PFE-020: the feed reads all four doctypes and filters Payment Entries to supplier payments', async () => {
    const paths: string[] = [];
    const client = fakeErpClient((path) => { paths.push(decodeURIComponent(path)); return { data: [] }; });
    await feedPurchaseMirror(fakeServiceClient(), { client, orgId: 'org-1', company: 'Example Co' });
    expect(paths.some((p) => p.includes('/api/resource/Purchase Receipt'))).toBe(true);
    const pe = paths.find((p) => p.includes('/api/resource/Payment Entry'));
    expect(pe).toContain('["payment_type","=","Pay"]');
    expect(pe).toContain('["party_type","=","Supplier"]');
  });
});
```
`fakeErpClient` / `fakeServiceClient`: reuse the helpers already defined at the top of this test file for AC-EPR-001 (same names if present;
if that file names them differently, call those — do not add a second fake). Run
`cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/purchaseMirrorFeed.test.ts` → RED.

### F-2 Implement
In `purchaseMirrorFeed.ts`:
```ts
export type PurchaseDoctype = 'Purchase Order' | 'Purchase Receipt' | 'Purchase Invoice' | 'Payment Entry';
export const PURCHASE_DOCTYPES: readonly PurchaseDoctype[] = ['Purchase Order', 'Purchase Receipt', 'Purchase Invoice', 'Payment Entry'];

const FIELDS: Record<PurchaseDoctype, readonly string[]> = {
  'Purchase Order': ['name', 'supplier', 'supplier_name', 'transaction_date', 'schedule_date', 'currency',
    'grand_total', 'net_total', 'status', 'docstatus', 'project', 'modified'],
  'Purchase Receipt': ['name', 'supplier', 'supplier_name', 'posting_date', 'currency',
    'grand_total', 'net_total', 'status', 'docstatus', 'is_return', 'project', 'modified'],
  'Purchase Invoice': ['name', 'supplier', 'supplier_name', 'posting_date', 'due_date', 'bill_no', 'currency',
    'grand_total', 'net_total', 'outstanding_amount', 'status', 'docstatus', 'is_return', 'project', 'modified'],
  'Payment Entry': ['name', 'party', 'party_name', 'posting_date', 'paid_from_account_currency',
    'paid_amount', 'status', 'docstatus', 'project', 'modified'],
};
/** Extra list filters per doctype: only supplier payments are purchase documents. */
const EXTRA_FILTERS: Partial<Record<PurchaseDoctype, unknown[]>> = {
  'Payment Entry': [['payment_type', '=', 'Pay'], ['party_type', '=', 'Supplier']],
};
```
`PurchaseMirrorRow` gains `net_total: string | null;`. Replace `toPurchaseMirrorRow` body with:
```ts
export function toPurchaseMirrorRow(doctype: PurchaseDoctype, d: Record<string, unknown>): PurchaseMirrorRow | null {
  const status = Number(d.docstatus);
  if (status !== 1 && status !== 2) return null;
  const isPi = doctype === 'Purchase Invoice';
  const isPo = doctype === 'Purchase Order';
  const isPe = doctype === 'Payment Entry';
  return {
    erp_doctype: doctype,
    erp_name: String(d.name),
    supplier: str(isPe ? d.party : d.supplier),
    supplier_name: str(isPe ? d.party_name : d.supplier_name) ?? str(isPe ? d.party : d.supplier),
    doc_date: date(isPo ? d.transaction_date : d.posting_date),
    due_date: isPi ? date(d.due_date) : isPo ? date(d.schedule_date) : null,
    bill_no: isPi ? str(d.bill_no) : null,
    currency: str(isPe ? d.paid_from_account_currency : d.currency),
    grand_total: money(isPe ? d.paid_amount : d.grand_total),
    net_total: isPe ? null : money(d.net_total),
    outstanding_amount: isPi ? money(d.outstanding_amount) : null,
    erp_status: str(d.status),
    erp_docstatus: status,
    is_return: Boolean(d.is_return),
    erp_project: str(d.project),
    erp_modified: String(d.modified),
  };
}
```
In `readPage`, after `const filters: unknown[] = [...]` add `filters.push(...(EXTRA_FILTERS[doctype] ?? []));`. Update the header comment:
"ADR-0093: documents are linked into purchases by `link_erp_purchase_documents`, never adopted; nothing here creates a procurement."
Verify the vitest command → GREEN, plus `npx vitest run src/lib/adapterSeam/erpnext` (the sweep tests).

### F-3 Bench check before merge (field names)
`Purchase Receipt.project` and `Payment Entry.project` must exist on the client's ERPNext version, or the list call fails the whole pass.
Run the served purchase-feed smoke against the dev bench as `docs/environments.md` describes, under `scripts/with-erpnext-lock.sh`; if a field is
rejected, drop `project` from that doctype's FIELDS (attribution then comes only from linking) and note it in the PR.

---

## 6. Slice G — gate in the ERP dispatch (FR-PFE-010, part of AC-PFE-003/010)

### G-1 Failing test
File `supabase/functions/adapter-dispatch/procurementGateGuard.test.ts`:
```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { checkProcurementGate } from './procurementGateGuard.ts';

function fakeClient(opts: { orgRow?: unknown; rowError?: boolean; violation?: string | null; rpcError?: boolean }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    calls,
    from: (_table: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () =>
        opts.rowError ? { data: null, error: { message: 'boom' } } : { data: opts.orgRow ?? null, error: null } }) }) }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return opts.rpcError ? { data: null, error: { message: 'boom' } } : { data: opts.violation ?? null, error: null };
    },
  };
  return client;
}
const cmd = (kind: string, operation = 'create') =>
  ({ domain: 'procurement', operation, record: { id: 'r1', procurementId: 'p1', erp_doc_kind: kind } });

Deno.test('AC-PFE-003: a gate violation refuses the procurement create before any ERP write', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' }, violation: 'gate_approval_before_order' });
  assertEquals(await checkProcurementGate(c as never, 'o1', cmd('purchase-order')), { ok: false, status: 422, message: 'gate_approval_before_order' });
  assertEquals(c.calls[0], { fn: 'procurement_gate_violation', args: { p_procurement_id: 'p1', p_step: 'Ordered' } });
});
Deno.test('AC-PFE-010: a create the gates allow passes unchanged', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' }, violation: null });
  assertEquals((await checkProcurementGate(c as never, 'o1', cmd('purchase-invoice'))).ok, true);
  assertEquals(c.calls[0].args.p_step, 'Vendor Invoiced');
});
Deno.test('payment maps to Paid, goods-receipt to Received', async () => {
  const c = fakeClient({ orgRow: { org_id: 'o1' } });
  await checkProcurementGate(c as never, 'o1', cmd('payment'));
  await checkProcurementGate(c as never, 'o1', cmd('goods-receipt'));
  assertEquals(c.calls.map((x) => x.args.p_step), ['Paid', 'Received']);
});
Deno.test('other domains, kinds and operations are not this gate', async () => {
  const c = fakeClient({});
  assertEquals((await checkProcurementGate(c as never, 'o1', { ...cmd('quotation') })).ok, true);
  assertEquals((await checkProcurementGate(c as never, 'o1', cmd('purchase-order', 'transition'))).ok, true);
  assertEquals((await checkProcurementGate(c as never, 'o1', { ...cmd('purchase-order'), domain: 'revenue' })).ok, true);
  assertEquals(c.calls.length, 0);
});
Deno.test('fails closed: purchase of another org, unreadable row, RPC failure, missing id', async () => {
  assertEquals((await checkProcurementGate(fakeClient({ orgRow: null }) as never, 'o1', cmd('purchase-order'))).message, 'purchase-not-found');
  assertEquals((await checkProcurementGate(fakeClient({ rowError: true }) as never, 'o1', cmd('purchase-order'))).message, 'gate-check-failed');
  assertEquals((await checkProcurementGate(fakeClient({ orgRow: { org_id: 'o1' }, rpcError: true }) as never, 'o1', cmd('purchase-order'))).message, 'gate-check-failed');
  const noId = { domain: 'procurement', operation: 'create', record: { id: 'r1', erp_doc_kind: 'purchase-order' } };
  assertEquals((await checkProcurementGate(fakeClient({}) as never, 'o1', noId as never)).message, 'gate-check-failed');
});
```
File `supabase/functions/adapter-dispatch/procurementGateWiring.test.ts`:
```ts
import { assert } from 'jsr:@std/assert@1';
Deno.test('AC-PFE-010: adapter-dispatch runs the procurement gate before the ERP path', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const gate = src.indexOf('checkProcurementGate(serviceClient');
  const erpPath = src.indexOf('checkRevenueErpPathTarget(serviceClient');
  assert(gate > 0 && erpPath > gate, 'the gate is called, and before any adapter/outbox work');
});
```
Run `deno test -A supabase/functions/adapter-dispatch/procurementGateGuard.test.ts supabase/functions/adapter-dispatch/procurementGateWiring.test.ts` → RED.
(Check `scripts/check-edge-fn-test-binding.mjs --self-test` still passes: these tests import the shipped module / read the shipped file; no copied handler.)

### G-2 Implement
File `supabase/functions/adapter-dispatch/procurementGateGuard.ts`:
```ts
/**
 * FR-PFE-010 (#1319): an org's purchase rules (organizations.procurement_gates) for every PMO-authored procurement
 * document that the ERP path would create. Same question the database asks on the transition RPC, record inserts and
 * links (procurement_gate_violation), asked here BEFORE any adapter/outbox/ERP work, because on an ERP-owned org the
 * PMO record is only written after the ERP document exists. Fails closed on any unreadable input.
 */
export type ProcurementGateClient = {
  from(table: string): { select(cols: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> } } } };
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
};
export interface ProcurementGateResult { ok: boolean; status: number; message: string }
interface GateCommand { domain: string; operation: string; record: { id: string; procurementId?: unknown; erp_doc_kind?: unknown } }

const OK: ProcurementGateResult = { ok: true, status: 200, message: '' };
const FAILED: ProcurementGateResult = { ok: false, status: 422, message: 'gate-check-failed' };
const STEP_BY_KIND: Record<string, 'Ordered' | 'Received' | 'Vendor Invoiced' | 'Paid'> = {
  'purchase-order': 'Ordered', 'goods-receipt': 'Received', 'purchase-invoice': 'Vendor Invoiced', payment: 'Paid',
};

export async function checkProcurementGate(client: ProcurementGateClient, orgId: string, command: GateCommand): Promise<ProcurementGateResult> {
  if (command.domain !== 'procurement' || String(command.operation) !== 'create') return OK;
  const step = STEP_BY_KIND[String(command.record.erp_doc_kind)];
  if (!step) return OK;
  const procurementId = command.record.procurementId;
  if (typeof procurementId !== 'string' || procurementId === '') return FAILED;
  const { data: row, error: rowError } = await client.from('procurements').select('org_id').eq('id', procurementId).eq('org_id', orgId).maybeSingle();
  if (rowError) { console.error('[adapter-dispatch] procurement gate read failed:', rowError); return FAILED; }
  if (!row) return { ok: false, status: 422, message: 'purchase-not-found' };
  const { data, error } = await client.rpc('procurement_gate_violation', { p_procurement_id: procurementId, p_step: step });
  if (error) { console.error('[adapter-dispatch] procurement_gate_violation failed:', error); return FAILED; }
  return data === null || data === undefined ? OK : { ok: false, status: 422, message: String(data) };
}
```
In `supabase/functions/adapter-dispatch/index.ts`: add after line 83 `import { checkProcurementGate } from './procurementGateGuard.ts';`
and insert immediately after the `checkSiProjectGate` block (after its closing `}` at line 1076):
```ts
  // FR-PFE-010 (#1319) — the org's purchase rules, before any adapter/outbox/ERP work (rejection = no outbox row).
  {
    const procurementGate = await checkProcurementGate(serviceClient as never, orgId, command as never);
    if (!procurementGate.ok) {
      return new Response(JSON.stringify({ error: 'commit-rejected', message: procurementGate.message }), {
        status: procurementGate.status,
        headers,
      });
    }
  }
```
Verify the deno command → GREEN; then `deno test -A supabase/functions/adapter-dispatch/` (the whole function suite) → GREEN.

---

## 7. Slice C — API guard tier and `pmo purchases` (0363; AC-PFE-011, 018)

### C-1 Failing pgTAP
File `supabase/tests/api_client_purchase_surface.test.sql`:
```sql
-- api_client_purchase_surface.test.sql — 0363. Owns AC-PFE-018.
begin;
select plan(6);
insert into organizations (id, name, default_currency) values ('03630000-0000-0000-0000-0000000000c0','API PFE','IDR');
insert into auth.users (id, email) values ('03630000-0000-0000-0000-0000000000c1','api-fin@example.com'), ('03630000-0000-0000-0000-0000000000c2','api-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('03630000-0000-0000-0000-0000000000c1','03630000-0000-0000-0000-0000000000c0','Fin','api-fin@example.com','Finance','active'),
  ('03630000-0000-0000-0000-0000000000c2','03630000-0000-0000-0000-0000000000c0','Eng','api-eng@example.com','Engineer','active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000c1","role":"authenticated","client_id":"pmo-cli"}';
set local request.method = 'POST'; set local request.path = '/rpc/link_erp_purchase_documents';
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may POST the link RPC');
set local request.path = '/rpc/link_procurement_sharepoint_item';
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may POST the SharePoint RPC');
set local request.method = 'GET'; set local request.path = '/erp_purchase_orphans';
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 Finance token may GET orphans');
set local request.method = 'POST'; set local request.path = '/rpc/unlink_erp_purchase_document';
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 unlink stays app-only');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"03630000-0000-0000-0000-0000000000c2","role":"authenticated","client_id":"pmo-cli"}';
set local request.method = 'POST'; set local request.path = '/rpc/link_erp_purchase_documents';
select throws_ok('select public.api_client_request_guard()', '42501', null, 'AC-PFE-018 an Engineer token is refused');
set local request.method = 'GET'; set local request.path = '/projects';
select lives_ok('select public.api_client_request_guard()', 'AC-PFE-018 the shipped surface is unchanged');
reset role;
select * from finish();
rollback;
```
→ RED.

### C-2 Migration 0363
File `supabase/migrations/0363_api_client_purchase_surface.sql` — the 0337 body (lines 767–833 of
`supabase/migrations/0337_contract_quantities.sql`) with the lines marked `0363`. **Before writing, check
`grep -l "function public.api_client_request_guard()" supabase/migrations/03*.sql | sort | tail -1`; if a migration newer than 0337 exists on
`origin/dev`, start from that body instead and keep its lists.**
```sql
-- 0363 OAuth API-client guard: a procurement-writer tier for `pmo purchases` (FR-PFE-062; owner ruling 2026-10-23
-- overrides DD-API-3 for these three endpoints — none writes to ERPNext or moves money). Amends 0337.
-- Rollback: supabase/migrations/rollback/0363_api_client_purchase_surface_down.sql (re-creates 0337's body).
create or replace function public.api_client_request_guard()
  returns void language plpgsql security invoker set search_path = '' as $$
declare
  -- API CLIENT SURFACE — keep in step with scripts/pmo.mjs.
  write_tables constant text[] := array['projects', 'project_milestones', 'tasks', 'meetings', 'crm_activities', 'companies', 'contacts'];
  read_only_tables constant text[] := array['profiles', 'external_domain_ownership'];
  rpcs constant text[] := array['get_project_milestones'];
  admin_write_tables constant text[] := array['budget_versions', 'budget_line_items', 'boq_items'];
  admin_rpcs constant text[] := array['set_project_contract_value', 'transition_project'];
  -- PROCUREMENT-WRITER TIER (`pmo purchases`, #1319) — keep in step with scripts/lib/pmo-purchases.mjs.        -- 0363
  purchase_rpcs constant text[] := array['link_erp_purchase_documents', 'link_procurement_sharepoint_item'];   -- 0363
  purchase_read_views constant text[] := array['erp_purchase_orphans'];                                       -- 0363
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  method text := current_setting('request.method', true);
  path text := coalesce(current_setting('request.path', true), '');
  target text;
begin
  if claims is null or not (claims ? 'client_id') then return; end if;
  if coalesce(headers ->> 'accept-profile', 'public') <> 'public' or coalesce(headers ->> 'content-profile', 'public') <> 'public' then
    raise exception using errcode = '42501', message = 'OAuth API clients may use the public schema only';
  end if;
  if coalesce(headers ->> 'prefer', '') ilike '%resolution=%' then
    raise exception using errcode = '42501', message = 'OAuth API clients may not upsert (Prefer: resolution=)';
  end if;
  if path like '/rpc/%' then
    target := substr(path, 6);
    if method = 'POST' and target = any (rpcs) then return; end if;
    if method = 'POST' and target = any (admin_rpcs) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then return; end if;
    end if;
    if method = 'POST' and target = any (purchase_rpcs) then                                                      -- 0363
      if coalesce(public.auth_role()::text in ('Admin','Executive','Project Manager','Finance') and public.is_active_member(), false) then return; end if;  -- 0363
    end if;                                                                                                       -- 0363
  else
    target := substr(path, 2);
    if method = 'GET' and (target = any (write_tables) or target = any (read_only_tables)) then return; end if;
    if method in ('POST', 'PATCH') and target = any (write_tables) then return; end if;
    if method in ('GET', 'POST') and target = any (admin_write_tables) then
      if coalesce(public.auth_role() = 'Admin'::public.user_role and public.is_active_member(), false) then return; end if;
    end if;
    if method = 'GET' and target = any (purchase_read_views) then                                                 -- 0363
      if coalesce(public.auth_role()::text in ('Admin','Executive','Project Manager','Finance') and public.is_active_member(), false) then return; end if;  -- 0363
    end if;                                                                                                       -- 0363
  end if;
  raise exception using errcode = '42501',
    message = format('%s %s is not available to OAuth API clients', method, path),
    hint = 'The API client surface is documented in docs/runbooks/pmo-cli.md';
end; $$;
revoke all on function public.api_client_request_guard() from public;
grant execute on function public.api_client_request_guard() to anon, authenticated, service_role;
notify pgrst, 'reload config';
```
Rollback file `supabase/migrations/rollback/0363_api_client_purchase_surface_down.sql`: lines 767–833 of 0337 verbatim, then the same
`revoke`/`grant`/`notify` three lines. Verify the pgTAP → GREEN, plus `supabase test db supabase/tests/api_client_request_guard.test.sql`.

### C-3 Failing node test for the CLI
File `scripts/pmo-purchases.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, rowsFromCsv, validateLinkRows, runLink, PURCHASE_RPCS, PURCHASE_READ_VIEWS, MAX_BATCH } from './lib/pmo-purchases.mjs';

const CSV = 'erp_doctype,erp_name,procurement_id,project_id,group,title,budget_category,sp_drive_id,sp_item_id,sp_web_url,sp_name,sp_kind\n'
  + 'Purchase Invoice,PINV-1,,11111111-1111-1111-1111-111111111111,G,"Steel, batch 1",,,,,,\n'
  + 'Purchase Invoice,PINV-2,,11111111-1111-1111-1111-111111111111,G,,,d1,i1,https://example.sharepoint.com/a.pdf,a.pdf,file\n'
  + ',PINV-3,22222222-2222-2222-2222-222222222222,,,,,,,,,\n';

test('AC-PFE-011: CSV rows become link rows (quoted commas, optional SharePoint item)', () => {
  const rows = rowsFromCsv(CSV);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: '11111111-1111-1111-1111-111111111111', group: 'G', title: 'Steel, batch 1' });
  assert.deepEqual(rows[1].sharepoint, { drive_id: 'd1', item_id: 'i1', web_url: 'https://example.sharepoint.com/a.pdf', name: 'a.pdf', kind: 'file' });
  assert.deepEqual(rows[2], { erp_name: 'PINV-3', procurement_id: '22222222-2222-2222-2222-222222222222' });
});

test('AC-PFE-011: --dry-run sends p_dry_run true; the real run sends false; outcomes are printed per row', async () => {
  const sent = [];
  const api = { rpc: async (name, body) => { sent.push({ name, body });
    return { dry_run: body.p_dry_run, counts: { link: body.p_rows.length, skip: 0, refused: 0 },
             results: body.p_rows.map((r, i) => ({ row: i + 1, erp_name: r.erp_name, outcome: 'link', reason: null })) }; } };
  const rows = rowsFromCsv(CSV);
  const dry = await runLink(api, rows, { dryRun: true });
  const real = await runLink(api, rows, { dryRun: false });
  assert.equal(sent[0].name, 'link_erp_purchase_documents');
  assert.equal(sent[0].body.p_dry_run, true);
  assert.equal(sent[1].body.p_dry_run, false);
  assert.deepEqual(sent[0].body.p_rows, sent[1].body.p_rows, 'identical rows in both runs');
  assert.deepEqual(dry.counts, { link: 3, skip: 0, refused: 0 });
  assert.deepEqual(real.results.map((r) => r.row), [1, 2, 3]);
});

test('AC-PFE-011: more than 500 rows are sent in batches and renumbered across batches', async () => {
  const sizes = [];
  const api = { rpc: async (_n, body) => { sizes.push(body.p_rows.length);
    return { dry_run: true, counts: { link: body.p_rows.length, skip: 0, refused: 0 }, results: body.p_rows.map((_, i) => ({ row: i + 1, outcome: 'link' })) }; } };
  const rows = Array.from({ length: MAX_BATCH + 2 }, (_, i) => ({ erp_name: `PINV-${i}` }));
  const out = await runLink(api, rows, { dryRun: true });
  assert.deepEqual(sizes, [MAX_BATCH, 2]);
  assert.equal(out.results.at(-1).row, MAX_BATCH + 2);
  assert.equal(out.counts.link, MAX_BATCH + 2);
});

test('AC-PFE-011: invalid rows are refused before anything is sent', () => {
  assert.deepEqual(validateLinkRows([{ erp_name: '' }, { erp_name: 'X', procurement_id: 'p', project_id: 'q' }, { erp_name: 'Y', sharepoint: { kind: 'zip' } }]), [
    'row 1: erp_name is required',
    'row 2: give procurement_id or project_id, not both',
    'row 3: sharepoint needs drive_id, item_id, web_url, name and kind file|folder',
  ]);
});

test('AC-PFE-018: the CLI purchase tier matches the latest guard migration', async () => {
  const fs = await import('node:fs'); const path = await import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'supabase', 'migrations');
  const latest = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => /function public\.api_client_request_guard\(\)/.test(fs.readFileSync(path.join(dir, f), 'utf8'))).pop();
  const sql = fs.readFileSync(path.join(dir, latest), 'utf8');
  const list = (name) => [...sql.match(new RegExp(`${name}\\s+constant\\s+text\\[\\]\\s*:=\\s*array\\[([^\\]]*)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(list('purchase_rpcs'), [...PURCHASE_RPCS].sort());
  assert.deepEqual(list('purchase_read_views'), Object.keys(PURCHASE_READ_VIEWS).sort());
});

test('parseCsv handles CRLF and escaped quotes', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x ""y""",z\r\n'), [['a', 'b'], ['x "y"', 'z']]);
});
```
Run `node --test scripts/pmo-purchases.test.mjs` → RED.

### C-4 Implement `scripts/lib/pmo-purchases.mjs`
```js
/**
 * `pmo purchases` (#1319, FR-PFE-060..063): bulk-link ERPNext purchase documents into PMO purchases, read the orphan list,
 * link a SharePoint item. Every check lives in the database RPC; --dry-run calls the same RPC with p_dry_run = true.
 * Node 22 standard library only.
 */
export const PURCHASE_RPCS = Object.freeze(['link_erp_purchase_documents', 'link_procurement_sharepoint_item']);
export const PURCHASE_READ_VIEWS = Object.freeze({
  erp_purchase_orphans: Object.freeze(['id', 'erp_doctype', 'erp_name', 'supplier', 'supplier_name', 'doc_date', 'currency',
    'grand_total', 'net_total', 'erp_status', 'project_ids']),
});
export const CSV_COLUMNS = Object.freeze(['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title',
  'budget_category', 'sp_drive_id', 'sp_item_id', 'sp_web_url', 'sp_name', 'sp_kind']);
export const MAX_BATCH = 500;
const ROW_FIELDS = ['erp_doctype', 'erp_name', 'procurement_id', 'project_id', 'group', 'title', 'budget_category'];
const SP_FIELDS = ['drive_id', 'item_id', 'web_url', 'name', 'kind'];

/** RFC 4180 subset: quoted fields, "" escapes, CRLF or LF. Returns rows of strings (trailing empty line dropped). */
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** CSV with the CSV_COLUMNS header → link rows (empty cells omitted; sp_* → sharepoint). */
export function rowsFromCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  return body.map((cells) => {
    const get = (k) => (idx[k] === undefined ? '' : (cells[idx[k]] ?? '').trim());
    const row = {};
    for (const k of ROW_FIELDS) if (get(k) !== '') row[k] = get(k);
    const sp = {};
    for (const k of SP_FIELDS) if (get(`sp_${k}`) !== '') sp[k] = get(`sp_${k}`);
    if (Object.keys(sp).length > 0) row.sharepoint = sp;
    return row;
  });
}

/** CLI-side shape checks only (the database decides everything else). */
export function validateLinkRows(rows) {
  const problems = [];
  if (!Array.isArray(rows) || rows.length === 0) return ['the file has no rows'];
  rows.forEach((r, i) => {
    const n = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { problems.push(`row ${n}: must be an object`); return; }
    if (typeof r.erp_name !== 'string' || r.erp_name.trim() === '') problems.push(`row ${n}: erp_name is required`);
    if (r.procurement_id && r.project_id) problems.push(`row ${n}: give procurement_id or project_id, not both`);
    if (r.sharepoint !== undefined) {
      const s = r.sharepoint;
      if (!s || SP_FIELDS.some((k) => typeof s[k] !== 'string' || s[k] === '') || !['file', 'folder'].includes(s.kind)) {
        problems.push(`row ${n}: sharepoint needs drive_id, item_id, web_url, name and kind file|folder`);
      }
    }
  });
  return problems;
}

/** Send rows in batches of MAX_BATCH; merge results with global row numbers. */
export async function runLink(api, rows, { dryRun }) {
  const out = { dry_run: Boolean(dryRun), counts: { link: 0, skip: 0, refused: 0 }, results: [] };
  for (let start = 0; start < rows.length; start += MAX_BATCH) {
    const batch = rows.slice(start, start + MAX_BATCH);
    const res = await api.rpc('link_erp_purchase_documents', { p_rows: batch, p_dry_run: Boolean(dryRun) });
    for (const r of res.results ?? []) out.results.push({ ...r, row: start + Number(r.row) });
    for (const k of Object.keys(out.counts)) out.counts[k] += Number(res.counts?.[k] ?? 0);
  }
  return out;
}
```
Verify `node --test scripts/pmo-purchases.test.mjs` → GREEN.

### C-5 Wire `pmo purchases` into `scripts/pmo.mjs`
1. Import: `import { MAX_BATCH, PURCHASE_READ_VIEWS, rowsFromCsv, runLink, validateLinkRows } from './lib/pmo-purchases.mjs';`
2. `COMMANDS`: add `'purchases'`.
3. `VALUE_FLAGS`: add `'project'`; `BOOL_FLAGS`: add `'csv'`.
4. `USAGE`: add lines
   `  pmo purchases orphans [--project <id>] [--limit n]`
   `  pmo purchases link <file.json | file.csv | -> [--csv] [--dry-run]   (Admin, Executive, Project Manager, Finance)`
   `  pmo purchases link-file <json | @file | ->`
5. In `dispatch`, before `default:` add:
```js
    case 'purchases': {
      const [sub, arg] = positionals;
      if (sub === 'orphans') {
        const q = new URLSearchParams({ select: PURCHASE_READ_VIEWS.erp_purchase_orphans.join(','), order: 'doc_date.desc,id.asc' });
        if (flags.project) q.set('project_ids', `cs.{${flags.project}}`);
        if (flags.limit !== undefined) {
          if (!/^[1-9]\d*$/.test(String(flags.limit))) throw usage(`--limit must be a positive integer: got '${flags.limit}'`);
          q.set('limit', String(flags.limit));
        }
        return authed(ctx, 'GET', `/rest/v1/erp_purchase_orphans?${q}`);
      }
      if (sub === 'link') {
        if (!arg) throw usage('purchases link needs a file: pmo purchases link <file.json|file.csv|-> [--dry-run]');
        const isCsv = Boolean(flags.csv) || /\.csv$/i.test(arg);
        let rows;
        if (isCsv) {
          let text;
          if (arg === '-') { const chunks = []; for await (const c of ctx.stdin) chunks.push(c); text = Buffer.concat(chunks.map((c) => (typeof c === 'string' ? Buffer.from(c) : c))).toString('utf8'); }
          else { try { text = fs.readFileSync(arg.replace(/^@/, ''), 'utf8'); } catch (e) { throw usage(`Could not read ${arg}: ${e.code ?? e.message}`); } }
          rows = rowsFromCsv(text);
        } else {
          rows = await readPayload(ctx, arg === '-' ? '-' : `@${arg.replace(/^@/, '')}`);
        }
        const problems = validateLinkRows(rows);
        if (problems.length > 0) throw new CliError(`The link file has ${problems.length} problem(s); nothing was sent.`, { exit: 2, code: 'invalid_link_file', details: problems });
        const api = { rpc: (name, body) => authed(ctx, 'POST', `/rest/v1/rpc/${name}`, { body }) };
        return runLink(api, rows, { dryRun: Boolean(flags['dry-run']) });
      }
      if (sub === 'link-file') {
        const body = await readPayload(ctx, arg);
        if (!body || typeof body !== 'object' || Array.isArray(body) || !body.procurement_id || !body.item) {
          throw usage('link-file takes {"procurement_id": "...", "record_kind": "vendor_invoice|erp_document|...", "record_id": "...", "item": {drive_id, item_id, web_url, name, kind}}');
        }
        return authed(ctx, 'POST', '/rest/v1/rpc/link_procurement_sharepoint_item', { body: {
          p_procurement_id: body.procurement_id, p_record_kind: body.record_kind ?? null, p_record_id: body.record_id ?? null, p_item: body.item } });
      }
      throw usage(`Unknown purchases command '${sub ?? ''}'. Use orphans, link or link-file.`);
    }
```
(`MAX_BATCH` import is used by the usage text: append `  (link sends ${MAX_BATCH} rows per call)` to the `purchases link` usage line.)
6. Add to `scripts/pmo.test.mjs` (existing harness `runCli`):
```js
test('AC-PFE-011: pmo purchases link --dry-run posts p_dry_run true and prints the outcome per row', async () => {
  const configDir = tmpDir();
  const file = path.join(configDir, 'rows.json');
  fs.writeFileSync(file, JSON.stringify([{ erp_name: 'PINV-1', project_id: '11111111-1111-1111-1111-111111111111' }]));
  try {
    const bodies = [];
    const r = await runCli(['purchases', 'link', file, '--dry-run'], { configDir, signedIn: true,
      fetch: async (url, init) => { if (String(url).includes('/rpc/link_erp_purchase_documents')) { bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ dry_run: true, counts: { link: 1, skip: 0, refused: 0 }, results: [{ row: 1, erp_name: 'PINV-1', outcome: 'link', reason: null }] })); } } });
    assert.equal(r.code, 0);
    assert.equal(bodies[0].p_dry_run, true);
    assert.match(r.out, /"outcome": "link"/);
  } finally { fs.rmSync(configDir, { recursive: true, force: true }); }
});
```
If `runCli`'s option names for a signed-in session and fetch stub differ (read its definition at the top of `scripts/pmo.test.mjs`), use those
names — the assertion body stays as written. Verify `node --test scripts/pmo.test.mjs scripts/pmo-purchases.test.mjs` → GREEN (AC-CLI-015 must stay green).
7. Update `docs/runbooks/pmo-cli.md` with a "Loading purchase history" section: the CSV header, the dry-run-first rule, the reason codes from FR-PFE-023.

---

## 8. Slice D1 — FE history path (AC-PFE-006, 015)

### D1-1 Regenerate types (first commit; D2 rebases on it)
After S0 and A are on `origin/dev`: `cd /Users/ariefsaid/Coding/PMO-wt-pfe-d1 && git merge origin/dev && scripts/with-db-lock.sh supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`.
Verify `cd pmo-portal && npm run typecheck` → 0 errors.

### D1-2 Repository: failing test then implementation
Add to `pmo-portal/src/lib/repositories/erpPurchases.test.ts` (reuse its existing supabase mock):
```ts
it('AC-PFE-006: list reads the linked view and exposes procurementId and netTotal', async () => {
  // existing mock returns one row for any from(); add procurement_id/net_total to that row fixture
  const rows = await listErpPurchases('p1');
  expect(fromSpy).toHaveBeenCalledWith('erp_purchase_documents_linked');
  expect(rows[0]).toMatchObject({ procurementId: null, netTotal: 600 });
});
it('AC-PFE-004: linkErpPurchaseDocuments calls the RPC with rows and the dry-run flag', async () => {
  rpcSpy.mockResolvedValueOnce({ data: { dry_run: true, counts: { link: 1, skip: 0, refused: 0 }, results: [] }, error: null });
  await linkErpPurchaseDocuments([{ erp_name: 'PINV-1', project_id: 'p1' }], true);
  expect(rpcSpy).toHaveBeenCalledWith('link_erp_purchase_documents', { p_rows: [{ erp_name: 'PINV-1', project_id: 'p1' }], p_dry_run: true });
});
```
(Name the spies after the mocks already in this file; add an `rpc` spy to its supabase mock if it has none.) Run → RED.
Implement in `pmo-portal/src/lib/repositories/erpPurchases.ts` (replace the file):
```ts
/**
 * ERP purchase documents (0335/0360/0361). Read: `erp_purchase_documents_linked` (RLS-scoped; procurementId = the purchase a
 * document is linked to, null = orphan). Write: only through link/unlink RPCs (ADR-0093: linked, never adopted, never pushed).
 */
import { supabase } from '@/src/lib/supabase/client';
import type { Json } from '@/src/lib/supabase/database.types';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import { AppError } from '@/src/lib/appError';

export type ErpPurchaseDoctype = 'Purchase Order' | 'Purchase Receipt' | 'Purchase Invoice' | 'Payment Entry';

export interface ErpPurchaseRow {
  id: string; doctype: ErpPurchaseDoctype; name: string; supplier: string | null; docDate: string | null;
  dueDate: string | null; billNo: string | null; currency: string | null; grandTotal: number | null; netTotal: number | null;
  outstanding: number | null; erpStatus: string | null; isReturn: boolean; projectIds: string[];
  procurementId: string | null; linkId: string | null;
}
export interface ErpLinkRow {
  erp_doctype?: ErpPurchaseDoctype; erp_name: string; procurement_id?: string | null; project_id?: string | null;
  group?: string; title?: string; budget_category?: string | null;
  sharepoint?: { drive_id: string; item_id: string; web_url: string; name: string; kind: 'file' | 'folder' };
}
export interface ErpLinkResult {
  row: number; erp_doctype: ErpPurchaseDoctype | null; erp_name: string | null; outcome: 'link' | 'skip' | 'refused';
  reason: string | null; procurement_id: string | null; new_purchase: boolean;
}
export interface ErpLinkResponse { dry_run: boolean; counts: { link: number; skip: number; refused: number }; results: ErpLinkResult[] }

const COLUMNS = 'id, erp_doctype, erp_name, supplier, supplier_name, doc_date, due_date, bill_no, currency, grand_total, net_total, outstanding_amount, erp_status, is_return, project_ids, procurement_id, link_id';
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
type Raw = { id: string; erp_doctype: string; erp_name: string; supplier: string | null; supplier_name: string | null; doc_date: string | null;
  due_date: string | null; bill_no: string | null; currency: string | null; grand_total: number | string | null; net_total: number | string | null;
  outstanding_amount: number | string | null; erp_status: string | null; is_return: boolean; project_ids: string[] | null;
  procurement_id: string | null; link_id: string | null };
const toRow = (r: Raw): ErpPurchaseRow => ({
  id: r.id, doctype: r.erp_doctype as ErpPurchaseDoctype, name: r.erp_name, supplier: r.supplier_name ?? r.supplier,
  docDate: r.doc_date, dueDate: r.due_date, billNo: r.bill_no, currency: r.currency, grandTotal: num(r.grand_total),
  netTotal: num(r.net_total), outstanding: num(r.outstanding_amount), erpStatus: r.erp_status, isReturn: r.is_return,
  projectIds: r.project_ids ?? [], procurementId: r.procurement_id, linkId: r.link_id,
});
const byDateDesc = (a: ErpPurchaseRow, b: ErpPurchaseRow) => (b.docDate ?? '').localeCompare(a.docDate ?? '') || a.name.localeCompare(b.name);

/** Submitted documents PMO did not push, linked or not (aging needs both; orphans = procurementId null). Paged past max_rows. */
export async function listErpPurchases(projectId?: string): Promise<ErpPurchaseRow[]> {
  const rows = await fetchAllRowsByKeyset((afterId, limit) => {
    let q = supabase.from('erp_purchase_documents_linked').select(COLUMNS).eq('erp_docstatus', 1).eq('pmo_owned', false);
    if (projectId) q = q.contains('project_ids', [projectId]);
    q = q.order('id', { ascending: true });
    return (afterId === null ? q : q.gt('id', afterId)).limit(limit);
  });
  return (rows as unknown as Raw[]).map(toRow).sort(byDateDesc);
}

/** Whether the org has any orphan — decides if Procurement shows the "not in a purchase" banner. */
export async function hasErpPurchases(): Promise<boolean> {
  const { data, error } = await supabase.from('erp_purchase_orphans').select('id').limit(1);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).length > 0;
}

/** Documents linked to one purchase (FR-PFE-032). */
export async function listLinkedErpDocuments(procurementId: string): Promise<ErpPurchaseRow[]> {
  const { data, error } = await supabase.from('erp_purchase_documents_linked').select(COLUMNS).eq('procurement_id', procurementId);
  if (error) throw new AppError(error.message, error.code);
  return ((data ?? []) as unknown as Raw[]).map(toRow).sort(byDateDesc);
}

export async function linkErpPurchaseDocuments(rows: ErpLinkRow[], dryRun = false): Promise<ErpLinkResponse> {
  const { data, error } = await supabase.rpc('link_erp_purchase_documents', { p_rows: rows as unknown as Json, p_dry_run: dryRun });
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as ErpLinkResponse;
}

export async function unlinkErpPurchaseDocument(linkId: string): Promise<void> {
  const { error } = await supabase.rpc('unlink_erp_purchase_document', { p_link_id: linkId });
  if (error) throw new AppError(error.message, error.code);
}
```
`src/lib/repositories/types.ts` — replace `ErpPurchaseRepository` with:
```ts
/** ADR-0093: ERP purchase documents, linked into purchases (never adopted, never pushed). */
export interface ErpPurchaseRepository {
  list(projectId?: string): Promise<ErpPurchaseRow[]>;
  hasAny(): Promise<boolean>;
  listLinked(procurementId: string): Promise<ErpPurchaseRow[]>;
  link(rows: ErpLinkRow[], dryRun?: boolean): Promise<ErpLinkResponse>;
  unlink(linkId: string): Promise<void>;
}
```
(import `ErpLinkRow, ErpLinkResponse` beside `ErpPurchaseRow`), and in the org-settings repository interface (next to `getDownPaymentItem`):
```ts
  getProcurementGates(): Promise<ProcurementGates>;
  setProcurementGates(patch: Partial<ProcurementGates>): Promise<ProcurementGates>;
```
`src/lib/repositories/index.ts`: import the three new functions; replace the `erpPurchases` object:
```ts
const erpPurchases: ErpPurchaseRepository = {
  list: (projectId) => wrap(() => listErpPurchases(projectId)),
  hasAny: () => wrap(() => hasErpPurchases()),
  listLinked: (procurementId) => wrap(() => listLinkedErpDocuments(procurementId)),
  link: (rows, dryRun) => wrap(() => linkErpPurchaseDocuments(rows, dryRun ?? false)),
  unlink: (linkId) => wrap(() => unlinkErpPurchaseDocument(linkId)),
};
```
and in the org-settings object next to line 1050:
```ts
  getProcurementGates: () => wrap(() => getOrgProcurementGates()),
  setProcurementGates: (patch) => wrap(() => setOrgProcurementGates(patch)),
```
`src/lib/db/orgs.ts` — append:
```ts
/** FR-PFE-011 — the org's purchase rules (all OFF by default). */
export interface ProcurementGates {
  request_before_order: boolean; approval_before_order: boolean; approval_before_payment: boolean; receipt_before_invoice: boolean;
}
export async function getOrgProcurementGates(): Promise<ProcurementGates> {
  const { data, error } = await supabase.rpc('get_procurement_gates');
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as ProcurementGates;
}
/** Admin-only, audited server-side (set_procurement_gates). */
export async function setOrgProcurementGates(patch: Partial<ProcurementGates>): Promise<ProcurementGates> {
  const { data, error } = await supabase.rpc('set_procurement_gates', { p_gates: patch as unknown as Json });
  if (error) throw new AppError(error.message, error.code);
  return data as unknown as ProcurementGates;
}
```
(add `import type { Json } from '@/src/lib/supabase/database.types';` if absent). `types.ts` imports `ProcurementGates` from `@/src/lib/db/orgs`.
Verify `npx vitest run src/lib/repositories` → GREEN; `npm run typecheck` → 0.

### D1-3 Hooks
`src/hooks/useErpPurchaseLinks.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { ErpLinkRow } from '@/src/lib/repositories/erpPurchases';

export function useLinkedErpDocuments(procurementId: string | null | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['linked-erp-documents', orgId, procurementId],
    queryFn: () => repositories.erpPurchases.listLinked(procurementId as string),
    enabled: Boolean(orgId && procurementId),
  });
}

/** Link / unlink invalidate every figure a link can move: orphans, purchases, committed spend, linked lists. */
function useInvalidateLinks() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['erp-purchases', orgId] }),
    qc.invalidateQueries({ queryKey: ['erp-purchases-any', orgId] }),
    qc.invalidateQueries({ queryKey: ['linked-erp-documents', orgId] }),
    qc.invalidateQueries({ queryKey: ['procurements', orgId] }),
    qc.invalidateQueries({ queryKey: ['project-committed-spend', orgId] }),
  ]);
}
export function useLinkErpDocuments() {
  const invalidate = useInvalidateLinks();
  return useMutation({
    mutationFn: (args: { rows: ErpLinkRow[]; dryRun?: boolean }) => repositories.erpPurchases.link(args.rows, args.dryRun),
    onSuccess: (res) => { if (!res.dry_run) void invalidate(); },
  });
}
export function useUnlinkErpDocument() {
  const invalidate = useInvalidateLinks();
  return useMutation({ mutationFn: (linkId: string) => repositories.erpPurchases.unlink(linkId), onSuccess: () => void invalidate() });
}
```
(`useErpPurchases.ts` is unchanged: its query keys are the ones invalidated above.)

### D1-4 Reason text (failing test first)
`pages/procurement/erpLinkReasons.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { erpLinkReasonText } from './erpLinkReasons';
const t = (_k: string, fallback: string) => fallback;
describe('erpLinkReasonText', () => {
  it('FR-PFE-023: every refusal code reads as a sentence', () => {
    for (const code of ['document_not_found','document_ambiguous','document_cancelled','document_recorded_by_pmo','document_linked_to_another_purchase',
      'purchase_not_found','purchase_closed','project_not_found','supplier_mismatch','project_mismatch','currency_mismatch',
      'gate_request_before_order','gate_approval_before_order','gate_receipt_before_invoice','gate_approval_before_payment']) {
      expect(erpLinkReasonText(code, t)).not.toBe(code);
    }
  });
  it('passes server sentences through', () => {
    expect(erpLinkReasonText('separation of duties: approver cannot pay own procurement', t)).toBe('separation of duties: approver cannot pay own procurement');
  });
});
```
`pages/procurement/erpLinkReasons.ts`:
```ts
type T = (key: string, fallback: string) => string;
/** FR-PFE-023 refusal codes → plain sentences (finance namespace). Unknown text (SoD, server sentences) passes through. */
export function erpLinkReasonText(reason: string | null, t: T): string {
  switch (reason) {
    case 'document_not_found': return t('erpLinks.reason.notFound', 'This ERPNext document is not in PMO yet. Wait for the next sync.');
    case 'document_ambiguous': return t('erpLinks.reason.ambiguous', 'Several ERPNext documents have this number. Add the document type.');
    case 'document_cancelled': return t('erpLinks.reason.cancelled', 'This document is cancelled in ERPNext.');
    case 'document_recorded_by_pmo': return t('erpLinks.reason.pmoOwned', 'PMO created this document; it is already on its purchase.');
    case 'document_linked_to_another_purchase': return t('erpLinks.reason.linkedElsewhere', 'This document already belongs to another purchase.');
    case 'purchase_not_found': return t('erpLinks.reason.purchaseNotFound', 'Purchase not found.');
    case 'purchase_closed': return t('erpLinks.reason.purchaseClosed', 'This purchase is cancelled or rejected.');
    case 'project_not_found': return t('erpLinks.reason.projectNotFound', 'Project not found.');
    case 'supplier_mismatch': return t('erpLinks.reason.supplier', 'The supplier differs from this purchase’s supplier.');
    case 'project_mismatch': return t('erpLinks.reason.project', 'The document belongs to a different project.');
    case 'currency_mismatch': return t('erpLinks.reason.currency', 'The document’s currency differs from this purchase.');
    case 'gate_request_before_order': return t('erpLinks.reason.gateRequest', 'Your organization requires a purchase request before an order.');
    case 'gate_approval_before_order': return t('erpLinks.reason.gateApprovalOrder', 'Your organization requires an approval before an order.');
    case 'gate_receipt_before_invoice': return t('erpLinks.reason.gateReceipt', 'Your organization requires a goods receipt before a vendor invoice.');
    case 'gate_approval_before_payment': return t('erpLinks.reason.gateApprovalPayment', 'Your organization requires an approval before payment.');
    default: return reason ?? '';
  }
}
```

### D1-5 Orphan section (AC-PFE-006) — failing test then component
`pages/procurement/ErpOrphansSection.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
const linkMock = vi.fn();
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [] }) }));
import { ErpOrphansSection } from './ErpOrphansSection';
const row = (n: string) => ({ id: n, doctype: 'Purchase Invoice' as const, name: n, supplier: 'Supplier One', docDate: '2026-02-01', dueDate: null,
  billNo: null, currency: 'IDR', grandTotal: 1000, netTotal: 900, outstanding: 0, erpStatus: 'Paid', isReturn: false, projectIds: ['p1'],
  procurementId: null, linkId: null });
describe('ErpOrphansSection', () => {
  it('AC-PFE-006: each orphan offers Link to purchase and New purchase from this; selecting two offers bulk actions', async () => {
    render(<MemoryRouter><ErpOrphansSection rows={[row('PINV-1'), row('PINV-2'), row('PINV-3')]} projectId="p1" canLink /></MemoryRouter>);
    expect(screen.getAllByRole('button', { name: /Link to purchase/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /New purchase from this/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select PINV-2' }));
    expect(screen.getByRole('button', { name: 'Link 2 to purchase' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'New purchase from 2' })).toBeVisible();
  });
  it('AC-PFE-006: New purchase from this links the document into a new purchase on the project', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 },
      results: [{ row: 1, outcome: 'link', reason: null, procurement_id: 'new-1', new_purchase: true }] });
    render(<MemoryRouter><ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /New purchase from this/ }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', project_id: 'p1' }] });
  });
  it('a refused row shows its reason and no navigation happens', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 0, skip: 0, refused: 1 },
      results: [{ row: 1, outcome: 'refused', reason: 'supplier_mismatch', procurement_id: null, new_purchase: false }] });
    render(<MemoryRouter><ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: /New purchase from this/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The supplier differs');
  });
  it('without link rights the rows are read-only', () => {
    render(<MemoryRouter><ErpOrphansSection rows={[row('PINV-1')]} projectId="p1" canLink={false} /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Link to purchase/ })).toBeNull();
  });
});
```
`pages/procurement/ErpOrphansSection.tsx`:
```tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import { formatCurrency, formatDate } from '@/src/lib/format';
import type { ErpLinkRow, ErpPurchaseDoctype, ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { LinkErpDocumentsDialog } from './LinkErpDocumentsDialog';
import { erpLinkReasonText } from './erpLinkReasons';

export function erpDoctypeLabel(t: (k: string, f: string) => string, d: ErpPurchaseDoctype): string {
  return ({
    'Purchase Order': t('erpPurchases.type.order', 'Purchase order'),
    'Purchase Receipt': t('erpPurchases.type.receipt', 'Goods receipt'),
    'Purchase Invoice': t('erpPurchases.type.invoice', 'Supplier invoice'),
    'Payment Entry': t('erpPurchases.type.payment', 'Supplier payment'),
  } as const)[d];
}

export interface ErpOrphansSectionProps {
  /** Orphans only (procurementId === null). */
  rows: ErpPurchaseRow[];
  /** Project scope: new purchases land on this project, and the link dialog offers its purchases. */
  projectId?: string;
  canLink: boolean;
}

/** FR-PFE-041 — ERPNext documents not yet in a purchase, with single and bulk link / new purchase. */
export const ErpOrphansSection: React.FC<ErpOrphansSectionProps> = ({ rows, projectId, canLink }) => {
  const { t } = useTranslation('finance');
  const navigate = useNavigate();
  const link = useLinkErpDocuments();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogRows, setDialogRows] = useState<ErpPurchaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = rows.filter((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const newPurchaseFrom = async (docs: ErpPurchaseRow[]) => {
    setError(null);
    const group = docs.length > 1 ? `bulk-${docs[0].name}` : undefined;
    const linkRows: ErpLinkRow[] = docs.map((d) => ({
      erp_doctype: d.doctype, erp_name: d.name,
      project_id: projectId ?? (d.projectIds.length === 1 ? d.projectIds[0] : null),
      ...(group ? { group } : {}),
    }));
    const res = await link.mutateAsync({ rows: linkRows });
    const refused = res.results.find((r) => r.outcome === 'refused');
    if (refused) { setError(erpLinkReasonText(refused.reason, t)); return; }
    const target = res.results.find((r) => r.procurement_id)?.procurement_id;
    if (target) navigate(`/procurement/${target}`);
  };

  return (
    <div>
      {canLink && chosen.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => setDialogRows(chosen)}>
            {t('erpLinks.bulkLink', 'Link {{count}} to purchase', { count: chosen.length })}
          </Button>
          <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => void newPurchaseFrom(chosen)}>
            {t('erpLinks.bulkNew', 'New purchase from {{count}}', { count: chosen.length })}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="mb-2 text-[13px] text-destructive-text">{error}</p>}
      <table className="w-full text-[13px]" aria-label={t('erpLinks.orphansTitle', 'ERPNext documents not in a purchase')}>
        <thead className="text-left text-muted-foreground">
          <tr>
            {canLink && <th className="w-8 py-2" scope="col"><span className="sr-only">{t('erpLinks.select', 'Select')}</span></th>}
            <th className="py-2" scope="col">{t('erpPurchases.column.document', 'Document')}</th>
            <th className="py-2" scope="col">{t('erpPurchases.column.supplier', 'Supplier')}</th>
            <th className="py-2" scope="col">{t('erpPurchases.column.date', 'Date')}</th>
            <th className="py-2 text-right" scope="col">{t('erpPurchases.column.amount', 'Amount')}</th>
            {canLink && <th className="py-2" scope="col"><span className="sr-only">{t('erpLinks.actions', 'Actions')}</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              {canLink && (
                <td className="py-2">
                  <input type="checkbox" aria-label={t('erpLinks.selectOne', 'Select {{name}}', { name: r.name })}
                    checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
              )}
              <td className="py-2"><span className="font-mono">{r.name}</span>
                <span className="block text-muted-foreground">{erpDoctypeLabel(t, r.doctype)}</span></td>
              <td className="py-2">{r.supplier ?? '—'}</td>
              <td className="py-2">{formatDate(r.docDate)}</td>
              <td className="py-2 text-right tabular-nums">{r.grandTotal === null || !r.currency ? '—' : formatCurrency(r.grandTotal, r.currency)}</td>
              {canLink && (
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDialogRows([r])}>{t('erpLinks.linkOne', 'Link to purchase')}</Button>
                    <Button size="sm" variant="outline" disabled={link.isPending} onClick={() => void newPurchaseFrom([r])}>
                      {t('erpLinks.newOne', 'New purchase from this')}
                    </Button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {dialogRows && (
        <LinkErpDocumentsDialog docs={dialogRows} projectId={projectId}
          onClose={() => setDialogRows(null)} onLinked={(id) => { setDialogRows(null); setSelected(new Set()); navigate(`/procurement/${id}`); }} />
      )}
    </div>
  );
};
```
Run the test → GREEN once D1-6 exists (write D1-6 test + component in the same sitting; the orphan test mocks the dialog's hooks only).

### D1-6 Link dialog
`pages/procurement/LinkErpDocumentsDialog.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
const linkMock = vi.fn();
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({ useLinkErpDocuments: () => ({ mutateAsync: linkMock, isPending: false }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [
  { id: 'pur-1', title: 'Steel', status: 'Ordered', project_id: 'p1' }, { id: 'pur-2', title: 'Other', status: 'Ordered', project_id: 'p2' },
  { id: 'pur-3', title: 'Old', status: 'Cancelled', project_id: 'p1' }] }) }));
import { LinkErpDocumentsDialog } from './LinkErpDocumentsDialog';
const doc = { id: 'd1', doctype: 'Purchase Invoice' as const, name: 'PINV-1', supplier: 'S', docDate: null, dueDate: null, billNo: null, currency: 'IDR',
  grandTotal: 1, netTotal: 1, outstanding: 0, erpStatus: null, isReturn: false, projectIds: ['p1'], procurementId: null, linkId: null };
describe('LinkErpDocumentsDialog', () => {
  it('AC-PFE-004: links the chosen documents to the chosen open purchase of the project', async () => {
    linkMock.mockResolvedValueOnce({ dry_run: false, counts: { link: 1, skip: 0, refused: 0 }, results: [{ row: 1, outcome: 'link', procurement_id: 'pur-1' }] });
    const onLinked = vi.fn();
    render(<LinkErpDocumentsDialog docs={[doc]} projectId="p1" onClose={() => {}} onLinked={onLinked} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Purchase' }));
    expect(screen.queryByText('Other')).toBeNull();
    expect(screen.queryByText('Old')).toBeNull();
    await userEvent.click(screen.getByText('Steel'));
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(linkMock).toHaveBeenCalledWith({ rows: [{ erp_doctype: 'Purchase Invoice', erp_name: 'PINV-1', procurement_id: 'pur-1' }] });
    expect(onLinked).toHaveBeenCalledWith('pur-1');
  });
});
```
`pages/procurement/LinkErpDocumentsDialog.tsx`:
```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Combobox } from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { erpLinkReasonText } from './erpLinkReasons';

const CLOSED = new Set(['Cancelled', 'Rejected']);

/** FR-PFE-020 — pick an open purchase (the project's, when scoped) and link the documents to it. Same idiom as the set-vendor panel. */
export const LinkErpDocumentsDialog: React.FC<{
  docs: ErpPurchaseRow[]; projectId?: string; onClose: () => void; onLinked: (procurementId: string) => void;
}> = ({ docs, projectId, onClose, onLinked }) => {
  const { t } = useTranslation('finance');
  const { data: purchases = [] } = useProcurements();
  const link = useLinkErpDocuments();
  const [target, setTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const options = useMemo(() => purchases
    .filter((p) => !CLOSED.has(String(p.status)) && (!projectId || p.project_id === projectId))
    .map((p) => ({ value: p.id, label: p.title, sub: String(p.status) })), [purchases, projectId]);

  const submit = async () => {
    if (!target) return;
    setErrors([]);
    const res = await link.mutateAsync({ rows: docs.map((d) => ({ erp_doctype: d.doctype, erp_name: d.name, procurement_id: target })) });
    const refused = res.results.filter((r) => r.outcome === 'refused');
    if (refused.length > 0) { setErrors(refused.map((r) => `${r.erp_name ?? ''}: ${erpLinkReasonText(r.reason, t)}`)); return; }
    onLinked(target);
  };

  return (
    <div role="dialog" aria-label={t('erpLinks.dialogTitle', 'Link to purchase')} className="mt-3 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
      <Combobox label={t('erpLinks.purchase', 'Purchase')} noun={t('erpLinks.purchaseNoun', 'purchase')} value={target}
        onChange={(v) => setTarget(v)} loadOptions={async () => options}
        placeholder={t('erpLinks.choosePurchase', 'Choose a purchase…')} />
      <Button variant="primary" size="sm" disabled={!target || link.isPending} onClick={() => void submit()}>{t('erpLinks.link', 'Link')}</Button>
      <Button variant="outline" size="sm" onClick={onClose}>{t('erpLinks.cancel', 'Cancel')}</Button>
      {errors.length > 0 && <ul role="alert" className="w-full text-[13px] text-destructive-text">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
};
```
(If the `Combobox` trigger's accessible role/name differ from `combobox`/label in its own tests, use the query its existing tests use — e.g.
`ProcurementCreate.test.tsx` — and keep the assertions.)

### D1-7 Linked documents on the purchase (AC-PFE-015)
`pages/procurement/LinkedErpDocuments.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/src/hooks/useErpPurchaseLinks', () => ({
  useLinkedErpDocuments: () => ({ data: [{ id: 'd1', doctype: 'Purchase Invoice', name: 'ACC-PINV-0001', supplier: 'S', docDate: '2026-02-01',
    dueDate: null, billNo: 'INV-7', currency: 'IDR', grandTotal: 4321000, netTotal: 3900000, outstanding: 0, erpStatus: 'Paid', isReturn: false,
    projectIds: [], procurementId: 'p', linkId: 'l1' }], isPending: false, isError: false }),
  useUnlinkErpDocument: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { role: 'Finance', org_id: 'o' } }) }));
import { LinkedErpDocuments } from './LinkedErpDocuments';
describe('LinkedErpDocuments', () => {
  it('AC-PFE-015: shows ERP number, date, amount, currency and ERP status, marked From ERPNext', () => {
    render(<LinkedErpDocuments procurementId="p" />);
    const row = screen.getByRole('row', { name: /ACC-PINV-0001/ });
    expect(row).toHaveTextContent('From ERPNext');
    expect(row).toHaveTextContent('Supplier invoice');
    expect(row).toHaveTextContent(/4[.,]321[.,]000/);
    expect(row).toHaveTextContent('Paid');
    expect(screen.getByRole('button', { name: 'Unlink ACC-PINV-0001' })).toBeVisible();
  });
});
```
`pages/procurement/LinkedErpDocuments.tsx`:
```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, StatusPill } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { formatCurrency, formatDate } from '@/src/lib/format';
import { useLinkedErpDocuments, useUnlinkErpDocument } from '@/src/hooks/useErpPurchaseLinks';
import { erpDoctypeLabel } from './ErpOrphansSection';

/** FR-PFE-032 — ERPNext documents linked to this purchase. Read-only except Unlink (Admin/Finance; the RPC enforces it). */
export const LinkedErpDocuments: React.FC<{ procurementId: string }> = ({ procurementId }) => {
  const { t } = useTranslation('finance');
  const { data = [] } = useLinkedErpDocuments(procurementId);
  const unlink = useUnlinkErpDocument();
  const role = useAuth().currentUser?.role;
  const canUnlink = role === 'Admin' || role === 'Finance'; // UX only — unlink_erp_purchase_document is the authority
  if (data.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="linked-erp-heading">
      <h3 id="linked-erp-heading" className="mb-2 text-[15px] font-semibold">{t('erpLinks.linkedTitle', 'Documents from ERPNext')}</h3>
      <table className="w-full text-[13px]">
        <tbody>
          {data.map((d) => (
            <tr key={d.id} aria-label={d.name} className="border-t border-border">
              <td className="py-2"><span className="font-mono">{d.name}</span>
                <span className="block text-muted-foreground">{erpDoctypeLabel(t, d.doctype)} · <StatusPill variant="neutral">{t('erpLinks.fromErp', 'From ERPNext')}</StatusPill></span></td>
              <td className="py-2">{formatDate(d.docDate)}</td>
              <td className="py-2 text-right tabular-nums">{d.grandTotal === null || !d.currency ? '—' : formatCurrency(d.grandTotal, d.currency)}</td>
              <td className="py-2">{d.erpStatus ?? '—'}</td>
              <td className="py-2 text-right">
                {canUnlink && d.linkId && (
                  <Button size="sm" variant="outline" disabled={unlink.isPending}
                    aria-label={t('erpLinks.unlinkOne', 'Unlink {{name}}', { name: d.name })}
                    onClick={() => unlink.mutate(d.linkId as string)}>{t('erpLinks.unlink', 'Unlink')}</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
```

### D1-8 Replace the read-only sections with the orphan list (FR-PFE-041/042)
`pages/project-detail/ErpPurchasesSection.tsx` — keep the aging over **all** rows; render orphans with actions:
- heading key `erpLinks.orphansTitle` "ERPNext documents not in a purchase"; sub-line keeps `erpPurchases.countedInActuals`;
- `const orphans = rows.filter((r) => r.procurementId === null);` render `null` when `orphans.length === 0 && aging.length === 0`;
- replace `<ErpPurchasesTable rows={rows} today={today} sharedMarker />` with
  `<ErpOrphansSection rows={orphans} projectId={projectId} canLink={canView} />`;
- the `Link to="/erp-purchases"` text becomes `erpLinks.allOrphans` "All unlinked ERPNext documents".
Update `ErpPurchasesSection.test.tsx`: its row fixtures gain `procurementId: null, linkId: null, netTotal: null`; the link-name assertion becomes
`'All unlinked ERPNext documents'`; add one case: a linked row (procurementId 'x') is counted in aging but not listed.
`pages/ErpPurchases.tsx`: list `rows.filter((r) => r.procurementId === null)` through `<ErpOrphansSection rows={…} canLink={may('view','procurement')} />`,
title `erpLinks.orphansTitle`. Update `pages/ErpPurchases.test.tsx` the same way.
`pages/procurement/ErpPurchasesTable.tsx`: `secondaryCell` uses `erpDoctypeLabel(t, r.doctype)` (four doctypes); nothing else.
`pages/Procurement.tsx` line 365: link text → `t('erpLinks.bannerLink', 'ERPNext documents not in a purchase')` (namespace as used there).
Run `npx vitest run pages/procurement pages/project-detail pages/ErpPurchases.test.tsx pages/Procurement.test.tsx` → GREEN.

### D1-9 Locales
Add every `erpLinks.*` key above and `erpPurchases.type.receipt`, `erpPurchases.type.payment` to `public/locales/en/finance.json` (English
fallback text as written) and `public/locales/id/finance.json` (Bahasa Indonesia: e.g. "Tautkan ke pembelian", "Pembelian baru dari dokumen ini",
"Dokumen ERPNext yang belum masuk pembelian", "Dari ERPNext", "Lepaskan tautan"). Rebase onto `origin/dev` immediately before the PR (#1070).
Gate: typecheck, eslint on touched files, `npx vitest run --changed origin/dev`.

---

## 9. Slice D2 — start-at-step, gates admin, committed figures, files per document

### D2-1 Capture offer honours a start step (AC-PFE-010) — failing test then code
`pages/procurement/ledgerCapture.startAt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { nextExpectedType } from './ledgerCapture';
describe('nextExpectedType with a start step', () => {
  it('AC-PFE-010: a Draft purchase started at Invoice offers only the vendor invoice capture (skipped steps get none)', () => {
    expect(nextExpectedType('Draft', new Set(), 'vendor_invoice')).toBe('vendor_invoice');
  });
  it('the start step applies only while the ledger is empty', () => {
    expect(nextExpectedType('Vendor Invoiced', new Set(['Invoice'] as never), 'vendor_invoice')).not.toBe('vendor_invoice');
  });
  it('without a start step the shipped gate is unchanged', () => {
    expect(nextExpectedType('Draft', new Set())).toBe(nextExpectedType('Draft', new Set(), null));
  });
});
```
`pages/procurement/ledgerCapture.ts` — change the signature and first lines:
```ts
export function nextExpectedType(
  status: ProcurementStatus,
  existingTypes: ReadonlySet<RecordType>,
  startAt: RecordKind | null = null,
): RecordKind | null {
  if (TERMINAL_STATUSES.has(status)) return null;
  // FR-PFE-001: a purchase started at a later step captures that step's document first (Draft, empty ledger only).
  if (startAt && status === 'Draft' && existingTypes.size === 0) return startAt;
```
(rest unchanged). `LedgerCaptureRow.tsx`: add prop `startAt?: RecordKind | null` and call `nextExpectedType(status, existingTypes, startAt ?? null)`.
`ProcurementLedger.tsx`: add `startAt?: RecordKind | null` to `ProcurementLedgerProps`, destructure it in `ProcurementLedgerContent`, and pass
`startAt={startAt}` to `<LedgerCaptureRow …>`.

### D2-2 "First document" on the create page — failing test then code
Add to `pages/ProcurementCreate.test.tsx` (reuse its render helper and mocks):
```tsx
it('AC-PFE-001: choosing Order as the first document opens the purchase at the order capture', async () => {
  renderCreate({ role: 'Project Manager' });
  await userEvent.type(screen.getByLabelText(/Title/), 'Cement');
  await userEvent.selectOptions(screen.getByLabelText('First document'), 'purchase_order');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(navigateMock).toHaveBeenCalledWith('/procurement/new-id?startAt=purchase_order', { replace: true });
});
it('an Engineer sees no First document choice (only a request)', () => {
  renderCreate({ role: 'Engineer' });
  expect(screen.queryByLabelText('First document')).toBeNull();
});
```
(Use the file's existing helper/mocks; if its helper is named differently or the create mock returns another id, keep its names and assert
the `?startAt=purchase_order` suffix.) In `pages/ProcurementCreate.tsx`:
```tsx
import type { RecordKind } from './procurement/RecordCaptureForm';
const START_OPTIONS: { value: '' | RecordKind; label: string }[] = [
  { value: '', label: 'Request (approval first)' }, { value: 'purchase_order', label: 'Order' },
  { value: 'goods_receipt', label: 'Goods receipt' }, { value: 'vendor_invoice', label: 'Vendor invoice' }, { value: 'payment', label: 'Payment' },
];
```
state `const [startAt, setStartAt] = useState<'' | RecordKind>('');`; `const canStartLater = may('view', 'procurement');` and inside the
`<FormGrid>` after the budget-category `SelectField`:
```tsx
{canStartLater && (
  <SelectField id="procurement-create-start-at" label={t('procurement:create.startAt', 'First document')}
    value={startAt} onChange={(v) => setStartAt(v as '' | RecordKind)}
    options={START_OPTIONS.map((o) => ({ value: o.value, label: t(`procurement:create.startAt.${o.value || 'request'}`, o.label) }))}
    helper={t('procurement:create.startAtHelper', 'Start from the document you already have. Your organization’s purchase rules still apply.')} />
)}
```
and replace `navigate(\`/procurement/${savedId}\`, { replace: true });` with
`navigate(startAt ? \`/procurement/${savedId}?startAt=${startAt}\` : \`/procurement/${savedId}\`, { replace: true });`.
In `pages/ProcurementDetails.tsx`: read `const startAtParam = new URLSearchParams(location.search).get('startAt');` (use the file's existing
`useLocation()`/`useSearchParams()` value), `const startAt = (['purchase_order','goods_receipt','vendor_invoice','payment'] as const).find((k) => k === startAtParam) ?? null;`
and pass `startAt={startAt}` to `<ProcurementLedger …>` (line 1073). Mount `<LinkedErpDocuments procurementId={p.id} />` directly after
`</ProcurementLedger>`'s self-closing tag (after line 1098) and import it from `./procurement/LinkedErpDocuments`.

### D2-3 Payment-first: "Mark as Paid" when a payment is recorded early
In the `nextActions` function of `pages/ProcurementDetails.tsx` add a parameter `hasPaymentRecord: boolean = false` (after `routeAllows`) and,
directly after the shipped `Vendor Invoiced → Paid` block:
```ts
  // FR-PFE-005 payment-first: a recorded (scheduled) payment can be paid from an earlier step. Same role and SoD rule as above.
  if (hasPaymentRecord && status !== 'Vendor Invoiced' && ['Draft', 'Approved', 'Quote Selected', 'Ordered', 'Received'].includes(status)
      && INVOICE_PAY_ROLES.has(role) && !isApprover) {
    actions.push({ to: 'Paid', label: t('procurementDetail.action.markAsPaid', 'Mark as Paid'), variant: 'primary' });
  }
```
Pass `(p.payments?.length ?? 0) > 0` at its call site (use the detail's payments array name as it exists on `p`). Add a unit case to
`pages/ProcurementDetails.test.tsx`: a Draft purchase with one scheduled payment shows "Mark as Paid" to Finance and not to its approver.

### D2-4 Gates admin (AC-PFE-014)
`pages/admin/OrgProcurementGates.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
const getMock = vi.fn(); const setMock = vi.fn(); let canManage = true;
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: { getProcurementGates: getMock, setProcurementGates: setMock } } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => canManage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o' } }) }));
import OrgProcurementGates from './OrgProcurementGates';
const OFF = { request_before_order: false, approval_before_order: false, approval_before_payment: false, receipt_before_invoice: false };
const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><OrgProcurementGates /></QueryClientProvider>);
describe('OrgProcurementGates', () => {
  it('AC-PFE-014: an Admin turns on approval before payment', async () => {
    canManage = true; getMock.mockResolvedValue(OFF); setMock.mockResolvedValue({ ...OFF, approval_before_payment: true });
    renderIt();
    await userEvent.click(await screen.findByRole('switch', { name: 'Approval required before payment' }));
    expect(setMock).toHaveBeenCalledWith({ approval_before_payment: true });
  });
  it('AC-PFE-014: a non-Admin sees the rules read-only', async () => {
    canManage = false; getMock.mockResolvedValue(OFF);
    renderIt();
    expect(await screen.findByRole('switch', { name: 'Approval required before payment' })).toBeDisabled();
  });
});
```
`pages/admin/OrgProcurementGates.tsx`:
```tsx
import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FieldError, ListState } from '@/src/components/ui';
import type { ProcurementGates } from '@/src/lib/db/orgs';

const KEYS: { key: keyof ProcurementGates; label: string }[] = [
  { key: 'request_before_order', label: 'Request required before order' },
  { key: 'approval_before_order', label: 'Approval required before order' },
  { key: 'receipt_before_invoice', label: 'Receipt required before invoice' },
  { key: 'approval_before_payment', label: 'Approval required before payment' },
];

/** FR-PFE-011 — four org purchase rules, all off by default; Admin-only (set_procurement_gates is the authority). */
export default function OrgProcurementGates() {
  const { t } = useTranslation();
  const orgId = useAuth().currentUser?.org_id;
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const queryKey = ['org-procurement-gates', orgId];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getProcurementGates(), enabled: Boolean(orgId) });
  const mutation = useMutation({
    mutationFn: (patch: Partial<ProcurementGates>) => repositories.orgSettings.setProcurementGates(patch),
    onSuccess: (gates) => qc.setQueryData(queryKey, gates),
  });
  return (
    <section aria-labelledby="procurement-gates-heading">
      <h2 id="procurement-gates-heading" className="text-[15px] font-semibold">{t('pfe.gates.heading', 'Purchase rules')}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{t('pfe.gates.intro', 'All off: a purchase can start at any step. Turn a rule on only when your accounting needs it.')}</p>
      {query.isError ? <ListState variant="error" title={t('pfe.gates.loadError', "Couldn't load purchase rules")} onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={4} />
        : (
          <ul className="mt-3 space-y-2">
            {KEYS.map(({ key, label }) => (
              <li key={key} className="flex items-center gap-3 text-[13px]">
                <button type="button" role="switch" aria-checked={query.data?.[key] ?? false} aria-label={t(`pfe.gates.${key}`, label)}
                  disabled={!canManage || mutation.isPending}
                  onClick={() => mutation.mutate({ [key]: !(query.data?.[key] ?? false) })}
                  className="h-5 w-9 rounded-full border border-border aria-checked:bg-primary disabled:opacity-60" />
                <span>{t(`pfe.gates.${key}`, label)}</span>
              </li>
            ))}
          </ul>
        )}
      {!canManage && <p className="mt-2 text-[13px] text-muted-foreground">{t('uxs11.onlyAdmin', 'Only an Admin can change this.')}</p>}
      {mutation.isError && <FieldError>{classifyMutationError(mutation.error).detail}</FieldError>}
    </section>
  );
}
```
Mount in `pages/Administration.tsx` directly after `<OrgDownPaymentItem />` (line 240): `<OrgProcurementGates />` (+ import). If the shared UI
library already has a `Switch`, use it instead of the button (keep `role="switch"` + name so the test holds).

### D2-5 Committed figures read the server (AC-PFE-005 client side; FR-PFE-037)
Add to `src/lib/db/procurements.test.ts`:
```ts
it('FR-PFE-037: committed spend is the server open commitment, not a client sum', async () => {
  rpcSpy.mockResolvedValueOnce({ data: 400, error: null });
  await expect(getProjectCommittedSpend('p1')).resolves.toBe(400);
  expect(rpcSpy).toHaveBeenCalledWith('project_committed_spend', { p_project_id: 'p1' });
});
```
(delete the shipped test that asserted the old `.from('procurements').in('status', …)` query shape for this function — it encodes the duplicate
logic this change removes; say so in the PR.) Replace `getProjectCommittedSpend` in `src/lib/db/procurements.ts`:
```ts
/**
 * Committed spend for ONE project — SINGLE DEFINITION is SQL `project_committed_spend` (0361, FR-PFE-037): Σ open commitment over
 * Ordered..Paid purchases; in an ERP-ledger org an invoice already on the ledger is not counted again (ADR-0093).
 */
export async function getProjectCommittedSpend(projectId: string): Promise<number> {
  const { data, error } = await supabase.rpc('project_committed_spend', { p_project_id: projectId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
```
Add `open_commitment:procurement_open_commitment` to the `SELECT` constant (computed field) and `open_commitment?: number | null;` to
`ProcurementWithRefs`. In `src/lib/procurement-summary.ts` change the sum to
`committedTotal += Number((row as { open_commitment?: number | null }).open_commitment ?? row.total_value) || 0;` and add to
`procurement-summary.test.ts`: `it('FR-PFE-037: uses the server open commitment when present', …)` with one row
`{ status: 'Ordered', total_value: 1000, open_commitment: 400 }` → `committedTotal` 400.

### D2-6 Files per document and folders (AC-PFE-009)
`src/lib/db/procurementCrud.ts` — `createMicrosoftProcurementDocument` gains an optional 4th parameter
`target?: { recordKind: 'purchase_request' | 'rfq' | 'quotation' | 'purchase_order' | 'goods_receipt' | 'vendor_invoice' | 'payment' | 'erp_document'; recordId: string }`
and spreads `...(target ? { record_kind: target.recordKind, record_id: target.recordId } : {})` into the insert. `ProcurementMicrosoftReferences.tsx`:
- add a "Attach to" `SelectField` (options: "This purchase" + one per ledger record and linked ERP document, passed in as a new prop
  `targets: { value: string; label: string; recordKind: …; recordId: string }[]`), sent as `target`;
- render a row whose `ms_item_kind === 'folder'` with the folder icon, its name and "Open folder" — no status or category text for folders;
- group rows with a `record_kind` under the record's label.
`ProcurementDetails.tsx` builds `targets` from `ledgerRows` and the linked documents and passes it. Test in
`pages/procurement/ProcurementMicrosoftReferences.test.tsx`:
```tsx
it('AC-PFE-009: a linked folder shows as a folder without status or category; a file shows under its ERP invoice', () => {
  renderRefs({ rows: [
    { id: 'f', source: 'onedrive', ms_item_kind: 'folder', ms_item_name: 'Supplier docs', link: 'https://example.sharepoint.com/f', status: 'Draft', record_kind: null, record_id: null },
    { id: 'x', source: 'onedrive', ms_item_kind: 'file', ms_item_name: 'Bill.pdf', link: 'https://example.sharepoint.com/b', status: 'Draft', record_kind: 'erp_document', record_id: 'd1' }],
    targets: [{ value: 'erp_document:d1', label: 'ACC-PINV-0001', recordKind: 'erp_document', recordId: 'd1' }] });
  const folder = screen.getByRole('listitem', { name: /Supplier docs/ });
  expect(folder).toHaveTextContent('Open folder');
  expect(folder).not.toHaveTextContent('Draft');
  expect(screen.getByRole('group', { name: 'ACC-PINV-0001' })).toHaveTextContent('Bill.pdf');
});
```
(`renderRefs` = the file's existing render helper; extend its props with `targets`.) The record-folder action (`RecordFolderAction`) is not
changed: it keys on the purchase id, so mid-chain and link-created purchases get it; when the org has no default library it shows the shipped
"Folder not linked. Ask an Admin…" text (production fact 2026-10-23).

### D2-7 Locales and gate
Add `procurement:create.startAt*` keys to `public/locales/{en,id}/procurement.json` and `pfe.gates.*` to `public/locales/{en,id}/common.json`
(id: "Aturan pembelian", "Wajib permintaan sebelum pesanan", "Wajib persetujuan sebelum pesanan", "Wajib penerimaan barang sebelum faktur",
"Wajib persetujuan sebelum pembayaran", "Dokumen pertama"). Rebase before the PR. Gate: typecheck, eslint, `vitest run --changed origin/dev`.

---

## 10. Slice E — e2e journeys

Conventions: `docs/e2e-parallel-conventions.md` (each spec `// @e2e-isolation: self-isolated`, seeds its own rows with the service role, cleans up).
No spec may assume a SharePoint default library (production fact): no spec clicks "Create folder in SharePoint".

### E-1 `pmo-portal/e2e/AC-PFE-021-new-purchase-from-erp-invoice.spec.ts`
```ts
// @e2e-isolation: self-isolated — creates its own project and ERP invoice row, deletes them (and the purchase it makes) after.
/** AC-PFE-021 — goal: the ERP invoice becomes a PMO purchase on the project, shown From ERPNext, status Vendor Invoiced, gone from the orphan list. */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from './helpers';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const svcKey = requireServiceRoleKey();
test.skip(!svcKey, 'AC-PFE-021: SUPABASE_SERVICE_ROLE_KEY not set (local) — skipping');

test('AC-PFE-021: New purchase from an ERPNext invoice', async ({ page }) => {
  const admin = createClient(SUPABASE_URL, svcKey!);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const projectId = crypto.randomUUID();
  const invoice = `ACC-PINV-PFE-${suffix}`;
  await admin.from('projects').insert({ id: projectId, org_id: ORG_ID, name: `PFE e2e ${suffix}`, status: 'Ongoing Project' }).throwOnError();
  await admin.from('erp_purchase_documents').insert({ org_id: ORG_ID, erp_doctype: 'Purchase Invoice', erp_name: invoice, supplier: `SUP-${suffix}`,
    supplier_name: `PFE Supplier ${suffix}`, doc_date: '2026-02-01', currency: 'IDR', grand_total: 4_321_000, net_total: 3_900_000,
    outstanding_amount: 0, erp_status: 'Paid', erp_docstatus: 1, project_ids: [projectId], erp_modified: '2026-02-01 10:00:00' }).throwOnError();
  let purchaseId: string | null = null;
  try {
    await signIn(page, 'finance@acme.test');
    await page.goto(`/projects/${projectId}/procurement`);
    const orphans = page.getByRole('table', { name: 'ERPNext documents not in a purchase' });
    await orphans.locator('tr', { hasText: invoice }).getByRole('button', { name: 'New purchase from this' }).click();
    await expect(page).toHaveURL(/\/procurement\/[0-9a-f-]{36}/);
    purchaseId = page.url().match(/procurement\/([0-9a-f-]{36})/)![1];
    await page.getByRole('tab', { name: /Documents/ }).click();
    const linked = page.getByRole('row', { name: invoice });
    await expect(linked).toContainText('From ERPNext');
    await expect(linked).toContainText(/4[.,]321[.,]000/);
    await expect(page.getByText('Vendor Invoiced').first()).toBeVisible();
    await page.goto(`/projects/${projectId}/procurement`);
    await expect(page.getByRole('row', { name: new RegExp(invoice) })).toHaveCount(0);
  } finally {
    if (purchaseId) {
      await admin.from('procurement_erp_links').delete().eq('procurement_id', purchaseId);
      await admin.from('procurement_status_events').delete().eq('procurement_id', purchaseId);
      await admin.from('procurements').delete().eq('id', purchaseId);
    }
    await admin.from('erp_purchase_documents').delete().eq('org_id', ORG_ID).eq('erp_name', invoice);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
```
(The status oracle reads the status as the detail header renders it; if the header uses a label other than the raw status, assert that label —
the goal oracle is "the purchase is at the invoiced step".)

### E-2 `pmo-portal/e2e/AC-PFE-022-bulk-link-orphans.spec.ts`
Same seeding as E-1 with two invoices `…-A`, `…-B` (same supplier, same project) and one purchase inserted with the service role
(`status: 'Ordered'`, `project_id`, `currency: 'IDR'`, `total_value: 5_000_000`, `requested_by_id` = the seeded Finance profile id read via
`admin.from('profiles').select('id').eq('email','finance@acme.test').single()`, `title: 'PFE bulk ' + suffix`). Journey: open the project's
Procurement tab → tick `Select …-A` and `Select …-B` → "Link 2 to purchase" → choose the purchase title → "Link" → on the purchase page both rows
show "From ERPNext". Cleanup: links, status events, the purchase, the two documents, the project.

### E-3 `pmo-portal/e2e/AC-PFE-001-start-at-order.spec.ts`
Sign in as `pm@acme.test` → `/procurement/new` → title, project (a seeded project), "First document" = Order → Save → the order capture form is
open → fill reference `PO-PFE-<suffix>` and amount → save → the page shows status Ordered and the ledger lists the PO; no "Submit Request" step
was taken. Cleanup the purchase with the service role. (Seed org is not ERP-owned for procurement, so this is the native path; the push path is
proven by AC-PFE-010 + the shipped push tests.)

### E-4 Re-baseline
Update `e2e/AC-EPR-008-erp-purchases.spec.ts`: region name → "ERPNext documents not in a purchase", link → "All unlinked ERPNext documents",
URL unchanged; goal oracles (supplier, amount, project on the org list) unchanged. Then run the procurement journeys:
`scripts/e2e-local.sh procurement` and `scripts/e2e-local.sh AC-PFE`. For any journey that clicked a "mark" button after recording a
document and now finds the step already reached (derived status), update the steps only (BDD rule: deliberate UX change), never the goal
oracle; list each in the PR.

---

## 11. Traceability (AC → owning test, slice)

| AC | Layer | Owning test | Slice |
|---|---|---|---|
| AC-PFE-001 | e2e | `e2e/AC-PFE-001-start-at-order.spec.ts` | E (DB proof: B-1 FR-PFE-005) |
| AC-PFE-002 | pgTAP | `procurement_flexible_status.test.sql` | B |
| AC-PFE-003 | pgTAP | `procurement_flexible_status.test.sql` (+ link path in `procurement_erp_links.test.sql`, dispatch in `procurementGateGuard.test.ts`) | B (A, G) |
| AC-PFE-004 | pgTAP | `procurement_erp_links.test.sql` | A |
| AC-PFE-005 | pgTAP | `procurement_no_double_count.test.sql` | A (client read: D2-5) |
| AC-PFE-006 | unit | `pages/procurement/ErpOrphansSection.test.tsx` | D1 |
| AC-PFE-007 | pgTAP | `procurement_flexible_status.test.sql` | B |
| AC-PFE-008 | pgTAP | `procurement_erp_links.test.sql` | A |
| AC-PFE-009 | unit | `pages/procurement/ProcurementMicrosoftReferences.test.tsx` | D2 |
| AC-PFE-010 | unit | `pages/procurement/ledgerCapture.startAt.test.ts` (+ `procurementGateWiring.test.ts`) | D2 (G) |
| AC-PFE-011 | node | `scripts/pmo-purchases.test.mjs` | C |
| AC-PFE-012 | pgTAP | `procurement_flexible_status.test.sql` + rollback round trip (B-6) | B |
| AC-PFE-013 | pgTAP | `procurement_flexible_status.test.sql` (+ link path in A) | B |
| AC-PFE-014 | unit | `pages/admin/OrgProcurementGates.test.tsx` | D2 |
| AC-PFE-015 | unit | `pages/procurement/LinkedErpDocuments.test.tsx` | D1 |
| AC-PFE-016 | pgTAP | `erp_purchase_orphans.test.sql` | A |
| AC-PFE-017 | pgTAP | `erp_purchase_orphans.test.sql` | A |
| AC-PFE-018 | pgTAP | `api_client_purchase_surface.test.sql` | C |
| AC-PFE-019 | pgTAP | `procurement_erp_links.test.sql` | A |
| AC-PFE-020 | unit | `purchaseMirrorFeed.test.ts` | F |
| AC-PFE-021 | e2e | `e2e/AC-PFE-021-new-purchase-from-erp-invoice.spec.ts` | E |
| AC-PFE-022 | e2e | `e2e/AC-PFE-022-bulk-link-orphans.spec.ts` | E |
| AC-PFE-023 | pgTAP | `procurement_erp_links.test.sql` | A |

Mutation checks (money rules): M-A1 (no double count), M-A2/M-A3 (one purchase per document, DB and RPC), M-A4 (dry run writes nothing),
M-A5 (supplier), M-B1 (approver ≠ payer), M-B2 (gates), M-B3 (never backwards), S0-5 (gates default off).

## 12. Risks the reviewers should press on
- **Derivation vs existing journeys** (B-9, E-4): recording a document now moves status. Contained by FR-PFE-006 (idempotent transition) and by
  skipping direct-SQL writes; the remaining fallout is enumerated, not guessed.
- **Gate default OFF relaxes today's enforced chain on the live org** (approval no longer required before payment on the new paths). Owner
  ruled default OFF; see §13 Q1.
- **Field availability in ERPNext** for Purchase Receipt / Payment Entry `project` (F-3).
- **Guard body drift**: 0363 must start from the newest `api_client_request_guard` on `origin/dev` (C-2); 0362 restates `transition_procurement`
  and the 0349 guard — any sibling migration that also redefines either must be rebased onto 0362's body, not the reverse.
- **ADR number**: 0093 is taken here; if a sibling lands 0093 first, renumber this ADR and its two references (spec header, plan header).
