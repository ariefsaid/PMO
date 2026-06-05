# Plan: Procurement lifecycle (procure-to-pay) module (build-wave #2)

- **Spec:** `docs/specs/procurement-lifecycle.spec.md` (FR-PROC-001..018, AC-800..816).
- **Decisions:** `docs/decisions.md` OD-PROC-1/2/3/4/6 (binding) + OD-BUDGET-2 (downstream contract);
  ratified owner-flags OD-PROC-A/B/D ACCEPTED; OD-PROC-C resolved in ADR-0012.
- **ADR written:** `docs/adr/0012-procurement-transition-rpc.md` — `transition_procurement` state-machine
  RPC (map-as-data + role×transition matrix + SoD + atomic mint) + shared `next_procurement_doc_number`
  minter (per-(org,prefix,day) counter table) + thin child-creation RPCs + parent-org guards. Generalizes
  ADR-0011.
- **Layer ownership:** ADR-0010. Each AC has exactly one owning test at the lowest sufficient layer.

Strict TDD: every behavior task writes a failing test (RED) first, then the minimum implementation (GREEN).
The eng-planner writes ONLY this plan + the ADR; the implementer writes the code/tests. Run `npm`/`vitest`/
`playwright` from `pmo-portal/`; run `supabase test db` and `supabase db reset` from the repo root.

---

## 1. Design

### 1.1 Architecture & data flow

```
ProcurementDetails (pages/ProcurementDetails.tsx)   ← UI: status, PR/VQ/PO/GR/VI trail, gated actions
  ├─ useProcurementDetail(procurementId)            ← header + children + receipts/invoices   (read)
  └─ useProcurementMutations(procurementId)         ← transition + create GR/VI/quotation      (write)
        │                                              (TanStack useMutation; invalidates detail key)
        ▼
src/lib/db/procurementLifecycle.ts  (DAL — typed module; mirrors budgets.ts RPC-cast pattern)
  reads:  getProcurementDetail(procurementId)
  writes: transitionProcurement(id,to,notes?)  · createQuotation · createReceipt · createInvoice  (all RPC)
        │
        ▼
Supabase Postgres
  procurements + 3 existing children + RLS already exist (0001/0002) — REUSED AS-IS, not rewritten.
  NEW migration 0006_procurement_lifecycle.sql:
    • schema deltas: procurements (+pr_number,+po_number,+approval_notes,+rejection_notes,+approved_by_id),
      procurement_quotations (+vq_number); enums procurement_receipt_status / procurement_invoice_status;
      tables procurement_receipts / procurement_invoices (+RLS, parent-org guard); procurement_doc_counters
    • next_procurement_doc_number(org,prefix)        security definer  (atomic per-(org,prefix,day) mint)
    • transition_procurement(id,to,notes)            security definer  (map + matrix + SoD + atomic mint)
    • create_procurement_quotation / _receipt / _invoice  security definer (parent-org guard + mint)
```

**Org seam:** the DAL NEVER sends `org_id` on any write. All five functions are `security definer` (bypass
RLS) and therefore re-assert `auth_org_id()` + `auth_role()` (+ parent-org guard on the child creators)
**internally** (ADR-0011/0012). The read sends no `org_id` — `procurements_select` and the new
`procurement_receipts_select` / `procurement_invoices_select` (`org_id = auth_org_id()`) scope it.

### 1.2 Transition state machine (the map, as data — FR-PROC-001/002, OD-PROC-6 seam)

The legal `(from → {to})` superset and the per-transition allowed-role set live as **data literals inside
`transition_procurement`** (a `jsonb` map + a role-set lookup). See ADR-0012 §"The transition map" for the
full table. The function: load row `for update` → assert org → assert `(from,to)` legal (else `P0001`) →
assert role + SoD (else `42501`) → single `update` that sets status + any minted PR#/PO# (via
`coalesce(existing, minted)` so already-minted numbers are immutable) + approver/notes stamps. The minted
number write and the status write are the SAME `update` ⇒ atomic (NFR-PROC-ATOM-001).

### 1.3 Reference-number minter (FR-PROC-010/011, OD-PROC-C resolved — ADR-0012 §2)

`next_procurement_doc_number(p_org, p_prefix)` does one atomic upsert on
`procurement_doc_counters(org_id, prefix, doc_date, last_seq)`:
`insert … values(p_org,p_prefix,current_date,1) on conflict (org_id,prefix,doc_date) do update set
last_seq = last_seq + 1 returning last_seq`, then returns `prefix || '-' || to_char(current_date,'YYMMDD')
|| lpad(seq::text,4,'0')`. Collision-free under concurrency (row-lock serialization), daily-reset (date in
key), per-org, gap-tolerant (rolled-back txn leaves seq advanced — accepted). The pure formatting half is a
deterministic TS function `formatDocNumber(prefix, date, seq)` unit-tested at AC-803 (mirrors the SQL
`lpad`/`to_char`).

### 1.4 Child creation (VQ/GR/VI — FR-PROC-011, parent-org guard FR-PROC-016)

Three thin `security definer` RPCs each: assert parent procurement ∈ `auth_org_id()` + `auth_role()` in
the 4 roles → mint via the shared minter → insert child (org from parent default) → return row. RLS on the
two new tables backstops any non-RPC path with the SAME parent-org guard shape as the existing
`procurement_items_write` policy.

### 1.5 UI (NFR-PROC-UI-001)

`pages/ProcurementDetails.tsx` is rewritten off the mock-data prototype onto `useProcurementDetail`:
distinct `procurement-loading` skeleton / `procurement-empty` / error+`Retry` states; a document-trail panel
showing `pr_number`/`vq_number`/`po_number`/`gr_number`/`vi_number` + GR/VI status; stage-appropriate
transition buttons cosmetically gated by `useEffectiveRole()` (the RPC is the real authority). Every money
value via `formatCurrency`.

### 1.6 Type contract used across tasks

```ts
// src/lib/db/procurementLifecycle.ts
export type ProcurementReceiptRow = Tables<'procurement_receipts'>;
export type ProcurementInvoiceRow = Tables<'procurement_invoices'>;
export type ProcurementStatus = ProcurementRow['status'];          // procurement_status enum
export type ProcurementDetail = ProcurementWithRefs & {
  approved_by: { full_name: string } | null;
  quotations: Tables<'procurement_quotations'>[];
  receipts: ProcurementReceiptRow[];
  invoices: ProcurementInvoiceRow[];
};
export function transitionProcurement(id: string, to: ProcurementStatus, notes?: string): Promise<void>;
export function createQuotation(procurementId: string, vendorId: string, totalAmount: number, receivedDate: string): Promise<Tables<'procurement_quotations'>>;
export function createReceipt(procurementId: string, status: 'Partial'|'Complete', receiptDate: string): Promise<ProcurementReceiptRow>;
export function createInvoice(procurementId: string, status: 'Received'|'Scheduled'|'Paid', invoiceDate: string): Promise<ProcurementInvoiceRow>;
export function formatDocNumber(prefix: 'PR'|'VQ'|'PO'|'GR'|'VI', date: Date, seq: number): string;
// transition-map helper (unit-tested, pure):
export function isLegalTransition(from: ProcurementStatus, to: ProcurementStatus): boolean;
export function canCancel(role: string, isRequester: boolean, from: ProcurementStatus): boolean;
```

---

## 2. Phased task list (TDD; 2–5 min each)

### Phase A — Migration `0006_procurement_lifecycle.sql` (schema + RPCs + RLS)

> The pgTAP tests that prove A live in Phase E (written RED there, before the implementer fills the SQL).
> Phase A tasks build the migration; verify each with `supabase db reset` (applies migration + seed).

- **A1** — Add enums + schema deltas. In `supabase/migrations/0006_procurement_lifecycle.sql` create
  `create type procurement_receipt_status as enum ('Partial','Complete');` and
  `create type procurement_invoice_status as enum ('Received','Scheduled','Paid');`; then
  `alter table procurements add column pr_number text, add column po_number text, add column approval_notes
  text, add column rejection_notes text, add column approved_by_id uuid references profiles(id);` and
  `alter table procurement_quotations add column vq_number text;`. *(FR-PROC-012)*
  Verify: `supabase db reset` exits 0.

- **A2** — Create the two child tables + indexes. Append `procurement_receipts(id uuid pk default
  gen_random_uuid(), org_id uuid not null references organizations(id) default
  '00000000-0000-0000-0000-000000000001', procurement_id uuid not null references procurements(id) on delete
  cascade, gr_number text, receipt_date date, status procurement_receipt_status not null, created_at
  timestamptz not null default now())` + `create index procurement_receipts_procurement_idx on
  procurement_receipts(procurement_id);`; analogous `procurement_invoices(… vi_number text, invoice_date
  date, status procurement_invoice_status not null …)` + its index. *(FR-PROC-013/014)*
  Verify: `supabase db reset` exits 0.

- **A3** — RLS on both new tables (read-in-org + 4-role write + parent-org guard). Append, for each table,
  `alter table <t> enable row level security;`, `create policy <t>_select on <t> for select using (org_id =
  auth_org_id());`, and a `create policy <t>_write on <t> for all using (org_id = auth_org_id() and
  auth_role() in ('Admin','Executive','Project Manager','Finance') and exists (select 1 from procurements p
  where p.id = <t>.procurement_id and p.org_id = auth_org_id())) with check (<same predicate>);` — copy the
  exact shape of `procurement_items_write` in `0002_rls.sql`. *(FR-PROC-015/016)*
  Verify: `supabase db reset` exits 0.

- **A4** — Counter table + `next_procurement_doc_number`. Append `create table procurement_doc_counters
  (org_id uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001', prefix
  text not null, doc_date date not null, last_seq int not null, primary key (org_id, prefix, doc_date));`
  + `alter table procurement_doc_counters enable row level security;` + a read-in-org select policy (no write
  policy — minter-only). Then the `security definer set search_path = public` function per ADR-0012 §2
  (upsert `on conflict … do update set last_seq = last_seq + 1 returning last_seq`; return
  `p_prefix||'-'||to_char(current_date,'YYMMDD')||lpad(v_seq::text,4,'0')`). Add `revoke all … from public;
  grant execute … to authenticated; revoke execute … from anon;`. *(FR-PROC-010, NFR-PROC-SEQ-001)*
  Verify: `supabase db reset` exits 0.

- **A5** — `transition_procurement(p_id uuid, p_to procurement_status, p_notes text default null)` —
  `security definer set search_path = public`. Body per ADR-0012 §1: load row `for update` (raise `P0002` if
  null); raise `42501` if `org_id is distinct from auth_org_id()`; carry the legal-pair map + allowed-role
  sets as `jsonb`/array literals, raise `P0001` if `(status,p_to)` not legal; raise `42501` on role/SoD
  deny (SoD-a `requested_by_id = auth.uid()` on Approved/Rejected; SoD-b `approved_by_id = auth.uid()` on
  Paid; cancel boundary OD-PROC-B); single `update` setting `status = p_to`, `pr_number =
  coalesce(pr_number, next_procurement_doc_number(org_id,'PR'))` only when `p_to='Requested'`, `po_number =
  coalesce(po_number, next_procurement_doc_number(org_id,'PO'))` only when `p_to='Ordered'`, `approved_by_id
  = auth.uid()` + `approval_notes = p_notes` when `p_to='Approved'`, `rejection_notes = p_notes` when
  `p_to='Rejected'`, `updated_at = now()`. Add the inline `-- SECURITY: this re-assertion MUST stay …`
  comment (ADR-0011 lesson). Add the revoke/grant/revoke-anon ACL trio.
  *(FR-PROC-001..009/011/018, NFR-PROC-ATOM-001)*
  Verify: `supabase db reset` exits 0.

- **A6** — `create_procurement_quotation(p_procurement_id uuid, p_vendor_id uuid, p_total_amount
  numeric, p_received_date date)` — `security definer set search_path = public`: assert parent procurement
  `org_id = auth_org_id()` and `auth_role() in (4 roles)` (else `42501`); `insert into
  procurement_quotations (procurement_id, vendor_id, total_amount, received_date, vq_number) values
  (p_procurement_id, p_vendor_id, p_total_amount, p_received_date,
  next_procurement_doc_number((select org_id from procurements where id = p_procurement_id),'VQ'))
  returning *;`. ACL trio. *(FR-PROC-011/016)*
  Verify: `supabase db reset` exits 0.

- **A7** — `create_procurement_receipt(p_procurement_id uuid, p_status procurement_receipt_status,
  p_receipt_date date)` — same `security definer` guard shape as A6; insert into `procurement_receipts`
  with `gr_number = next_procurement_doc_number(<parent org>,'GR')` `returning *`. ACL trio.
  *(FR-PROC-011/016)*
  Verify: `supabase db reset` exits 0.

- **A8** — `create_procurement_invoice(p_procurement_id uuid, p_status procurement_invoice_status,
  p_invoice_date date)` — same guard shape; insert into `procurement_invoices` with `vi_number =
  next_procurement_doc_number(<parent org>,'VI')` `returning *`. ACL trio. *(FR-PROC-011/016)*
  Verify: `supabase db reset` exits 0.

### Phase B — DAL `src/lib/db/procurementLifecycle.ts` (unit, TDD)

- **B1** *(RED)* — In `src/lib/db/procurementLifecycle.test.ts` write the transition-map unit tests:
  `isLegalTransition('Draft','Requested')===true`, `isLegalTransition('Draft','Paid')===false`,
  `isLegalTransition('Paid','Requested')===false`. Title: `it('AC-800: transition map accepts legal pairs,
  rejects illegal jumps and terminal exits (FR-PROC-001)', …)`. *(AC-800)*
  Verify: `npm test -- procurementLifecycle` FAILS (module/function absent).

- **B2** *(GREEN)* — Implement `isLegalTransition(from,to)` in `procurementLifecycle.ts` backed by the same
  `(from→{to})` literal map as the RPC (single TS source `LEGAL_TRANSITIONS`). *(AC-800, FR-PROC-001)*
  Verify: `npm test -- procurementLifecycle` PASSES B1.

- **B3** *(RED→GREEN)* — Skippable-stage test: `it('AC-801: Approved→Ordered (skip sourcing),
  Approved→Vendor Quoted, Quote Selected→Ordered are legal (FR-PROC-002)', …)` asserting all three true;
  then ensure `LEGAL_TRANSITIONS` contains those edges. *(AC-801, FR-PROC-002)*
  Verify: `npm test -- procurementLifecycle` PASSES.

- **B4** *(RED→GREEN)* — Cancel-boundary test + `canCancel(role,isRequester,from)`:
  `it('AC-802: requester may cancel at Requested, not at Ordered; Paid/Cancelled never cancellable
  (FR-PROC-002/009, OD-PROC-B)', …)` — `canCancel('Engineer',true,'Requested')===true`,
  `canCancel('Engineer',true,'Ordered')===false`, `canCancel('Project Manager',false,'Ordered')===true`,
  `canCancel('Project Manager',false,'Paid')===false`, `canCancel('Project Manager',false,'Cancelled')===
  false`. Implement `canCancel`. *(AC-802, FR-PROC-002/009)*
  Verify: `npm test -- procurementLifecycle` PASSES.

- **B5** *(RED→GREEN)* — Ref-number formatter: `it('AC-803: formatDocNumber pads width-4 — PO+2026-06-04+1
  → PO-2606040001, seq 42 → PO-2606040042 (FR-PROC-010)', …)`. Implement `formatDocNumber(prefix,date,seq)`
  = `${prefix}-${yy}${mm}${dd}${String(seq).padStart(4,'0')}`. *(AC-803, FR-PROC-010)*
  Verify: `npm test -- procurementLifecycle` PASSES.

- **B6** *(RED→GREEN)* — DAL RPC error surfacing: mock `supabase.rpc` to resolve
  `{data:null, error:{message:'not authorized', code:'42501'}}`; `it('AC-806: transitionProcurement
  surfaces the RPC 42501/P0001 error (does not swallow) (FR-PROC-003/004)', …)` asserts `await
  expect(transitionProcurement(id,'Approved')).rejects.toThrow('not authorized')`. Implement
  `transitionProcurement` calling `supabase.rpc('transition_procurement',{p_id:id,p_to:to,p_notes:notes ??
  null})` with the `// @ts-expect-error` + `as unknown as` cast (mirror `budgets.ts`). *(AC-806,
  FR-PROC-003/004)*
  Verify: `npm test -- procurementLifecycle` PASSES.

- **B7** *(RED→GREEN)* — `getProcurementDetail` + the three create* DAL fns. Test (mock-builder, mirrors
  `budgets.test.ts`): `getProcurementDetail` selects `'*, project:projects(name,code),
  vendor:companies(name), requested_by:profiles!procurements_requested_by_id_fkey(full_name),
  approved_by:profiles!procurements_approved_by_id_fkey(full_name),
  quotations:procurement_quotations(*), receipts:procurement_receipts(*),
  invoices:procurement_invoices(*)'` for the id and returns the shaped row; `createReceipt` calls
  `rpc('create_procurement_receipt',{p_procurement_id, p_status, p_receipt_date})` and returns the row.
  Title each `it('AC-816 (DAL): …')`. Implement the four functions. *(supports AC-816)*
  Verify: `npm test -- procurementLifecycle` PASSES.

### Phase C — Hook `src/hooks/useProcurementDetail.ts` (unit, TDD)

- **C1** *(RED→GREEN)* — In `src/hooks/useProcurementDetail.test.ts`: `it('AC-816 (hook):
  useProcurementDetail keys cache by [procurement, orgId, id] and calls getProcurementDetail', …)` using
  a `QueryClientProvider` + mocked DAL + mocked `useAuth` (mirror `useBudget.test.ts`). Implement
  `useProcurementDetail(id)` (useQuery, key `['procurement', orgId, id]`, `enabled: Boolean(orgId && id)`).
  *(supports AC-816)*
  Verify: `npm test -- useProcurementDetail` PASSES.

- **C2** *(RED→GREEN)* — `it('AC-816 (hook): useProcurementMutations.transition invalidates the detail key
  on success', …)`. Implement `useProcurementMutations(id)` exposing `transition`, `createQuotation`,
  `createReceipt`, `createInvoice` (each `useMutation`, `onSuccess` invalidates `['procurement', orgId, id]`),
  mirroring `useBudgetMutations`. *(supports AC-816)*
  Verify: `npm test -- useProcurementDetail` PASSES.

### Phase D — UI `pages/ProcurementDetails.tsx` (unit, TDD)

- **D1** *(RED→GREEN)* — In `pages/ProcurementDetails.test.tsx`: `it('AC-804: renders procurement-loading
  skeleton while pending, procurement-empty when no row, error + Retry that re-runs the query
  (NFR-PROC-UI-001)', …)` driving the three `useProcurementDetail` states via a mocked hook; assert
  `getByTestId('procurement-loading')`, `getByTestId('procurement-empty')`, and that clicking `Retry` calls
  `refetch`. Rewrite `ProcurementDetails.tsx` off mock data onto `useProcurementDetail(procurementId)` with
  the three states + `data-testid`s. *(AC-804, NFR-PROC-UI-001)*
  Verify: `npm test -- ProcurementDetails` PASSES.

- **D2** *(RED→GREEN)* — `it('AC-805: an Engineer viewing a Requested procurement is NOT offered
  Approve/Reject; a Finance viewer is (FR-PROC-006, UI gate)', …)` — mock `useEffectiveRole` to `'Engineer'`
  then `'Finance'`; assert `queryByRole('button',{name:/approve/i})` is null for Engineer, present for
  Finance. Add the cosmetic role gate (helper `allowedActions(status, role, isRequester)` reusing
  `isLegalTransition`/`canCancel`) to the action bar. *(AC-805, FR-PROC-006)*
  Verify: `npm test -- ProcurementDetails` PASSES.

- **D3** *(GREEN, no new behavior)* — Wire the document-trail panel: render `pr_number`, selected
  quotation `vq_number`, `po_number`, each receipt `gr_number`+status, each invoice `vi_number`+status; all
  money via `formatCurrency` from `@/src/lib/format`. Buttons call `useProcurementMutations`. (Covered
  end-to-end by AC-816; no isolated unit AC.)
  Verify: `npm run typecheck` exits 0 AND `npm test -- ProcurementDetails` PASSES.

### Phase E — pgTAP (the DB is the real gate; written RED first, then Phase A fills the SQL)

> Each file: `begin; select plan(N); …fixtures as table owner…; set local role authenticated; set local
> request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'; …asserts…; reset role; select *
> from finish(); rollback;` (mirror `0008`/`0010`). Run all: `supabase test db` from repo root.

- **E1** — `supabase/tests/0013_procurement_transition_tenant.test.sql`: org-A user calls
  `transition_procurement(<org-B procurement>, 'Requested')` → `throws_ok(…, '42501', …,
  'AC-807: cross-org transition raises 42501')`. *(AC-807, FR-PROC-004)*
  Verify: `supabase test db` reports this file pass.

- **E2** — `0014_procurement_role_gate.test.sql`: Engineer calls `transition_procurement(<Requested proc>,
  'Approved')` → `42501` (`AC-808: Engineer cannot Approve`); a Finance user (not requester) calls it →
  `lives_ok` + `is(status,'Approved')` (`AC-808: Finance approves`). *(AC-808, FR-PROC-006)*
  Verify: file passes.

- **E3** — `0015_procurement_sod.test.sql` (plan 4): requester-is-PM X calls Approve → `42501`
  (`AC-809: SoD-a requester≠approver`); other authorized user Approves → `lives_ok` + `is(approved_by_id,…)`;
  set up a `Vendor Invoiced` proc approved by Finance-Y, Y calls Paid → `42501` (`AC-810: SoD-b
  approver≠payer`); a different Finance user Pays → `lives_ok`. *(AC-809, AC-810, FR-PROC-006/009)*
  Verify: file passes.

- **E4** — `0016_procurement_mint_atomicity.test.sql` (plan 3): transition a `Draft` proc to `Requested`,
  then `is(status,'Requested')` AND `matches(pr_number,'^PR-\d{10}$')` AND `is(pr_number is not
  null,true)` in one read (`AC-811: atomic status+PR# mint`); drive `…→Ordered` and
  `matches(po_number,'^PO-\d{10}$')`. *(AC-811, FR-PROC-011/012, NFR-PROC-ATOM-001)*
  Verify: file passes.

- **E5** — `0017_procurement_ref_uniqueness.test.sql` (plan 2): mint two PO numbers same org/day via two
  `transition_procurement(…,'Ordered')` calls on two procs; `isnt(po_a, po_b, 'AC-812: distinct ####
  suffixes — no collision')` and `matches(po_a,'0001$','AC-812: first of the day ends 0001 (daily reset)')`
  (reset the counter table for the test day in fixtures so the first mint is deterministic). *(AC-812,
  FR-PROC-010, NFR-PROC-SEQ-001)*
  Verify: file passes.

- **E6** — `0018_procurement_new_table_rls.test.sql` (plan 3): Engineer `select` on
  `procurement_receipts`/`procurement_invoices` in-org returns rows (`AC-813: read allowed`); Engineer
  direct `insert` into `procurement_receipts` → `42501` (`AC-813: write blocked`); Finance inserts a
  receipt whose `procurement_id` is an **org-B** procurement → `42501` (`AC-813: parent-org guard`).
  *(AC-813, FR-PROC-015/016)*
  Verify: file passes.

- **E7** — `0019_procurement_orgid_anon.test.sql` (plan 2): direct insert into `procurement_receipts`
  supplying an explicit foreign `org_id` → `42501` (`AC-814: org_id not client-supplied`); as role `anon`,
  `throws_ok($$ select transition_procurement(…) $$, '42501', …, 'AC-814: anon cannot execute the RPC')`
  (and one create* RPC). *(AC-814, FR-PROC-017)*
  Verify: file passes.

- **E8** — `0020_procurement_committed_contract.test.sql` (plan 2): a proc driven to `Ordered` →
  `ok((select status in ('Ordered','Received','Vendor Invoiced','Paid') from procurements where id=…),
  'AC-815: Ordered is in the Committed set')`; a `Quote Selected` proc → `ok(status not in (…),
  'AC-815: Quote Selected is NOT committed')`. *(AC-815, FR-PROC-018, OD-BUDGET-2)*
  Verify: file passes.

### Phase F — Seed + E2E + full gate

- **F1** — Seed enrichment. In `supabase/seed.sql` §procurements: backfill the existing `Ordered` row
  `60000000-…-002` with `pr_number='PR-2601100001'`, `po_number='PO-2601100001'`, set its quotation
  `is_selected=true`+`vq_number='VQ-2601100001'`, and add a `procurement_receipts` row
  (`gr_number='GR-2601100001'`, status `Partial`); backfill the `Paid` row `60000000-…-005` with full
  PR/VQ/PO trail + a `procurement_invoices` row (`vi_number='VI-2512010001'`, status `Paid`) + distinct
  `approved_by_id` (a3 finance) ≠ `requested_by_id` (a2); leave the `Requested` row `60000000-…-003` with
  `pr_number='PR-2601200001'` only (empty-trail case). Do NOT hard-code `org_id` on any new insert (column
  default). Keep `YYMMDD` consistent with each row's `created_at`. *(seed for AC-804/815/816 data)*
  Verify: `supabase db reset` exits 0 (seed applies).

- **F2** *(RED)* — `pmo-portal/e2e/AC-816-procure-to-pay.spec.ts`. `test('AC-816 full procure-to-pay happy
  path: Draft→Requested→Approved→Ordered→Received→Vendor Invoiced→Paid with PR/PO/GR/VI trail', …)`:
  `login(page,'finance@acme.test')` for pay steps and a distinct requester for SoD where needed (use admin
  break-glass `admin@acme.test` to drive the role hops on a fresh `Draft` proc whose `requested_by_id` ≠
  admin); navigate `/procurement/<draft id>`; click each stage action; create the GR (status Complete) and
  VI (status Paid); assert final `ProcurementStatusBadge` text `Paid` and that the trail shows `PR-`, `PO-`,
  `GR-`, `VI-` numbers (`expect(page.getByText(/^PR-\d{10}$/))…`). *(AC-816, FR-PROC-002/005/006/008/009/010/
  011, NFR-PROC-UI-001)*
  Verify: `npx playwright test AC-816` FAILS first (UI/RPC not wired), then PASSES after D1-D3.

- **F3** — Full gate. Run, from `pmo-portal/`: `npm run typecheck` (0 errors), `npm run lint`
  (`--max-warnings=0`), `npm test` (all green, ≥80% lines on changed files), `npx playwright test`; and from
  repo root `supabase test db` (all pgTAP green). *(quality gates, charter DoD)*
  Verify: all five commands exit 0.

---

## 3. Traceability (AC → owning layer → task)

| AC | Owning layer | Task(s) | FR/NFR |
|---|---|---|---|
| AC-800 | Unit | B1, B2 | FR-PROC-001 |
| AC-801 | Unit | B3 | FR-PROC-002 |
| AC-802 | Unit | B4 | FR-PROC-002/009 |
| AC-803 | Unit | B5 | FR-PROC-010 |
| AC-804 | Unit | D1 | NFR-PROC-UI-001 |
| AC-805 | Unit | D2 | FR-PROC-006 |
| AC-806 | Unit | B6 | FR-PROC-003/004 |
| AC-807 | pgTAP | E1 | FR-PROC-004 |
| AC-808 | pgTAP | E2 | FR-PROC-006 |
| AC-809 | pgTAP | E3 | FR-PROC-006 |
| AC-810 | pgTAP | E3 | FR-PROC-009 |
| AC-811 | pgTAP | E4 | FR-PROC-011/012, NFR-PROC-ATOM-001 |
| AC-812 | pgTAP | E5 | FR-PROC-010, NFR-PROC-SEQ-001 |
| AC-813 | pgTAP | E6 | FR-PROC-015/016 |
| AC-814 | pgTAP | E7 | FR-PROC-017 |
| AC-815 | pgTAP | E8 | FR-PROC-018 |
| AC-816 | E2E | F2 (+ A5-A8 / B7 / C1-C2 / D1-D3 exercised) | FR-PROC-002/005/006/008/009/010/011, NFR-PROC-UI-001 |

Per-layer split: **Unit** AC-800/801/802/803/804/805/806 (7) · **pgTAP** AC-807..815 (9) · **E2E** AC-816
(1). No AC is pushed up a layer (ADR-0010).

---

## 4. Files touched (under source — by the implementer, not this planner)

New: `supabase/migrations/0006_procurement_lifecycle.sql`; `supabase/tests/0013…0020_*.test.sql` (8);
`pmo-portal/src/lib/db/procurementLifecycle.ts` (+`.test.ts`);
`pmo-portal/src/hooks/useProcurementDetail.ts` (+`.test.ts`); `pmo-portal/e2e/AC-816-procure-to-pay.spec.ts`.
Edited: `pmo-portal/pages/ProcurementDetails.tsx` (+`.test.tsx`); `supabase/seed.sql`.
Reused as-is: `procurements`/children RLS in `0002_rls.sql` (coarse `procurements_update` stays as backstop);
`src/lib/db/procurements.ts`, `src/lib/format.ts`, `src/auth/*`.

---

## 5. Risks / assumptions for the Director

- **R1 — `select … for update` inside `transition_procurement`** serializes concurrent transitions on the
  *same* procurement (correct) but does not block concurrent transitions on *different* procurements (good).
  Confirm no requirement for ordering across procurements (none in spec).
- **R2 — Gap-tolerant `####`** is a deliberate accepted property (OD-PROC-3/NFR-PROC-SEQ-001). If finance
  ever needs **gapless** document numbering for audit/compliance, that is a separate heavier design (flagged
  in ADR-0012). Assumed acceptable for MVP.
- **R3 — pgTAP `current_date` in E5 daily-reset assertion**: the test fixtures must reset/seed
  `procurement_doc_counters` for the test day so "first mint ends 0001" is deterministic regardless of prior
  rows; the implementer inserts the counter rows as table owner before the role switch.
- **R4 — `database.types.ts` regen**: the new RPCs/tables/enums won't appear in generated types until the
  local stack is regenerated; the DAL uses the established `// @ts-expect-error` + `as unknown as` cast. If
  the implementer can regenerate types cleanly, the casts can be dropped (nice-to-have, not blocking).
- **A1 — `ProcurementDetails.tsx` is still the prototype (mock data)**: D1 is a *rewrite*, not a tweak —
  budget ~2 of the 5-min tasks' worth of care here; the action-bar logic is reused but rebound to real data.
