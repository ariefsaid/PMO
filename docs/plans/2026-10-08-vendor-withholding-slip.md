# #911 — Vendor withholding slip: design + TDD implementation plan

**Date:** 2026-10-08. **Spec:** `docs/specs/vendor-withholding-slip.spec.md`.
**Delivery status:** PLAN ONLY. This document changes no source/schema/tests, and contains no gate-pass claim.
**Fixed rulings:** DD-BUPOT-1..3 in the spec §2. **Owner questions:** none; spec sign-off and UI sketch-glance remain checkpoints.
**Executor for the eventual build:** Director-dispatched per issue, not an ordinary factory slice: this adds money reconciliation and authenticated writer contracts (`docs/factory-workflow.md:136-140`, Executor routing). Implementer and ui-implementer are the role contracts; spec/code-quality/security reviewers all run, plus rendered Discover/QA acceptance. No production authorization is implied.

## 1. Evidence and architecture

### Existing seam, not a rewrite

- Invoice identity comes from `procurement_invoices.procurement_id` (`supabase/migrations/0006_procurement_lifecycle.sql:47-56`); vendor identity is its procurement's `vendor_id` (`supabase/migrations/0001_init_schema.sql:92-108`). Do not use a quotation's vendor or guess from a display name.
- The withholding column is finite signed `numeric(14,2)` (`supabase/migrations/0269_vendor_invoice_withholding.sql:22-34`). Bill type can be null on the ERP template path (`supabase/migrations/0273_vendor_tax_defaults.sql:161-168`). New slip links therefore need explicit unknown-type evidence and cannot just filter every null type away.
- The mirror guard enumerates pinned fields and lets the service-role mirror refresh them (`supabase/migrations/0273_vendor_tax_defaults.sql:171-209`). Keep it unchanged; never add a slip constraint that rejects an ERP bill refresh.
- Bill amounts/withholding are already projected into ledger invoice rows (`pmo-portal/src/lib/db/procurementLedger.ts:325-359`); the amount cell shows VAT/PPh/net (`pmo-portal/pages/procurement/ProcurementLedger.tsx:151-176`). Extend that composition, not the record-kind union or bill monetary calculation.
- The e-Faktur row menu/modal and detail-page callbacks are the local evidence-recording precedent (`pmo-portal/pages/procurement/ProcurementLedger.tsx:372-399`; `pmo-portal/pages/ProcurementDetails.tsx:1032-1047`). Merge actions instead of replacing the menu.
- Detail reads use the joined invoice bundle (`pmo-portal/src/lib/db/procurementLifecycle.ts:179-215`); the existing detail key is `['procurement', orgId, id]` (`pmo-portal/src/hooks/useProcurementDetail.ts:36-55`). New slip reads/writes go through their own typed repository and hook, not direct DAL calls in JSX.
- History has classification and static visibility arms (`supabase/migrations/0260_record_change_history.sql:26-40,230-249`); the catalog test asserts 12 tables (`supabase/tests/record_changes_catalog_gate.test.sql:73-78`). Writer completeness has an explicit 66-name declaration (`supabase/tests/0178_anon_executable_definers.test.sql:103-167,171-190`). Both counts are intended contracts: extend the declared scope, retain all planted-defect tests.
- The isolation denominator enumerates actual public tables and non-trigger definers (`scripts/check-isolation-denominator.mjs:36-70`). Add the two tables and three writers to its manifest, preserving the gate's polarity.

No new infrastructure/dependency/ERP protocol is required. DD-BUPOT-2 already decides separate-header schema shape; this plan documents its feature-local implementation, not a new cross-cutting architecture ruling. No additional ADR is proposed.

### Data flow

```
ProcurementDetails / ProcurementLedger
  → useVendorWithholdingSlips (org-scoped React Query)
  → repositories.vendorWithholdingSlips (typed seam; AppError conversion)
  → db/vendorWithholdingSlips (Supabase RPCs only)
  → three authenticated writer RPCs / three invoker reader RPCs
  → slip header + immutable bill links + audit/history

#898 → same repository register readers → invoker register views
ERP feed → existing invoice money refresh → current-vs-snapshot comparison on read
```

No `routeDomainWrite`, adapter-dispatch, external outbox or pending-push state for a slip operation. Bill create/approval/payment remain unchanged. No new edge function or seed tax identity.

### Scaling and failure choices

- Normalize header and links; do not repeat slip amount on each bill or store slip number on an invoice.
- Read server-side coverage in one page of IDs (≤100) and paged candidates across cases. Never fetch one slip per row. The header carries expected `invoice_count`, so inaccessible links cannot make a partial aggregate look complete.
- Use exact SQL numeric comparisons; reader DTO money is decimal **text**, not a JS binary sum. UI totals use `bigint` minor units; maximum valid value is `999999999999.99`. A 100-bill sum may exceed that even if every bill is individually valid: refuse before casting/storing a header.
- Serialize this feature's short writes per org with a transaction advisory lock. That is a small, monthly evidence-recording workload, not an ERP money queue; tenants do not contend with each other. No network I/O occurs while locked. A future measured hot-tenant bottleneck can narrow locking; do not introduce a global lock across orgs.
- Current-vs-snapshot validation is read-derived. Mirrors never update slip records, and edits never silently replace issued monetary facts. Review links stay reserved until void.
- Dates are date-only strings; compare future dates to the org's timezone, not the DB session calendar. Explicit tax period avoids pretending issue date is necessarily the reporting month.

## 2. Exact schema contract

**Requested migration slot:** `supabase/migrations/0278_vendor_withholding_slips.sql`.
**Rollback:** `supabase/migrations/rollback/0278_vendor_withholding_slips_down.sql`.
0278 is the brief's **placeholder slot**, not evidence it is available when build starts. Before build, inspect `supabase/migrations/0278*` and run `scripts/check-migration-collisions.sh`; a collision is a Director sequencing decision. Never overwrite an existing migration; use the sanctioned renumber script if needed and amend these paths atomically. Do not change historical migrations.

### Header: `public.vendor_withholding_slips`

```sql
id uuid primary key,                         -- stable client intent UUID, not a tax number
org_id uuid not null references public.organizations(id),
vendor_id uuid not null,
slip_number text not null,
slip_date date not null,
tax_period date not null,
pph_type text not null check (pph_type in ('pph23','pph4_2')),
currency text not null check (currency ~ '^[A-Z]{3}$'),
tax_base numeric(14,2) not null,
withheld_amount numeric(14,2) not null,
invoice_count integer not null check (invoice_count between 1 and 100),
status text not null default 'active' check (status in ('active','void')),
revision integer not null default 1 check (revision > 0),
created_by uuid not null references public.profiles(id),
created_at timestamptz not null default now(),
updated_at timestamptz not null default now(),
voided_by uuid references public.profiles(id),
voided_at timestamptz,
void_reason text,
create_payload jsonb not null,
unique (org_id,id),
foreign key (org_id,vendor_id) references public.companies(org_id,id) on delete restrict
```

Additional checks:
- number equals `btrim(number)`, length 1–100, no `[[:cntrl:]]`;
- money `> 0 AND < 'Infinity'::numeric`, base/amount ≤ `999999999999.99`, amount ≤ base (NaN/±Infinity refused);
- period equals `date_trunc('month', tax_period)::date`;
- active → all void fields null; void → actor/time and trimmed nonblank reason 1–500 characters;
- no user-stated org/actor defaults. Writers supply trusted values. The future-date/period checks are in RPCs, not volatile table CHECKs.

Indexes:
```sql
create unique index vendor_withholding_slips_number_uq
  on public.vendor_withholding_slips (org_id, lower(btrim(slip_number)))
  where status = 'active';
create index vendor_withholding_slips_register_idx
  on public.vendor_withholding_slips (org_id, tax_period desc, id desc);
create index vendor_withholding_slips_vendor_idx
  on public.vendor_withholding_slips (org_id, vendor_id, tax_period desc, id desc);
```

### Links: `public.vendor_withholding_slip_bills`

```sql
id uuid primary key default gen_random_uuid(),
org_id uuid not null references public.organizations(id),
slip_id uuid not null,
invoice_id uuid not null,
procurement_id uuid not null,
withheld_at_record numeric(14,2) not null,
pph_type_at_record text check (pph_type_at_record in ('pph23','pph4_2')),
type_source text not null check (type_source in ('bill','declared')),
currency text not null check (currency ~ '^[A-Z]{3}$'),
created_at timestamptz not null default now(),
released_at timestamptz,
unique (slip_id,invoice_id),
foreign key (org_id,slip_id) references public.vendor_withholding_slips(org_id,id) on delete restrict,
foreign key (org_id,invoice_id) references public.procurement_invoices(org_id,id) on delete restrict,
foreign key (org_id,procurement_id) references public.procurements(org_id,id) on delete restrict
```

`withheld_at_record` must be positive and finite. `type_source = 'declared'` iff original type is null; known type must equal header type. Currency must equal header currency. Source procurement and vendor are validated/locked at record time, and rechecked against current rows on read. Preserve links when voided; only `released_at` changes.

Add UNIQUE constraints `(org_id,id)` named `bupot_companies_org_id_id_uq`, `bupot_procurements_org_id_id_uq`, `bupot_invoices_org_id_id_uq` on `companies`, `procurements`, `procurement_invoices` respectively for these composite FKs (only if an equivalent unique key is not already present at build time). Register every name the migration actually owns for rollback; do not drop an incumbent key. These are supporting indexes, not a conversion of existing write grants.

```sql
create unique index vendor_withholding_slip_bills_active_invoice_uq
  on public.vendor_withholding_slip_bills (org_id, invoice_id)
  where released_at is null;
create index vendor_withholding_slip_bills_slip_idx
  on public.vendor_withholding_slip_bills (org_id, slip_id, invoice_id);
create index vendor_withholding_slip_bills_procurement_idx
  on public.vendor_withholding_slip_bills (org_id, procurement_id, invoice_id);
create index vendor_withholding_slip_bills_invoice_history_idx
  on public.vendor_withholding_slip_bills (org_id, invoice_id, slip_id);
```

The invoice reservation index includes mismatched active links. A deferred constraint trigger on **both** header and links, `assert_vendor_withholding_slip_integrity()`, checks at transaction end: header count = retained links count ≥1; amount = retained snapshot sum; header/link org/type/currency agreement; active header means every `released_at IS NULL`, void header means every release stamp equals `voided_at`. It validates snapshots, **not mutable current invoice money**. Attach `vendor_withholding_slips_integrity` and `vendor_withholding_slip_bills_integrity` AFTER INSERT OR UPDATE OR DELETE, DEFERRABLE INITIALLY DEFERRED. No client EXECUTE on this trigger function. This prevents a partial multi-statement RPC from committing while allowing complete atomic voids.

## 3. Server access and writer signatures

Both business tables: ENABLE + FORCE RLS. Explicitly revoke all grants from PUBLIC/anon/authenticated; grant authenticated SELECT on business columns (exclude `create_payload`). No client DML policies or column grants. Trusted service-role table access is for controlled server maintenance/local isolated fixture cleanup, never the SPA. Foreign keys are RESTRICT, so user cascade deletion cannot erase retained evidence.

Header SELECT policy: `org_id = auth_org_id() AND is_active_member() AND EXISTS` own-org visible vendor. Link SELECT policy: same org/member plus a visible source invoice; the composite FK already enforces the header's org. Do **not** require header SELECT visibility for reading the source-visible link: a hidden header must not hide the reservation and manufacture “Not recorded”. A visible active link with an unreadable header yields `unavailable`, without exposing header facts. The header has expected count independent of visible links. All source joins run under caller RLS. A header whose vendor is unreadable is unavailable to that caller, not exposed via a definer reader.

Every writer uses `SECURITY DEFINER SET search_path = pg_catalog, public`, schema-qualified public objects, `public.assert_is_active_member()`, explicit `auth.uid()` nonnull, and explicit `public.auth_role() IN ('Admin','Finance')`. Resolve IDs using `org_id = public.auth_org_id()`; return the same `P0002 / bupot-not-found` for missing/foreign targets. Only authenticated EXECUTE; revoke PUBLIC/anon/service_role EXECUTE (maintenance uses controlled SQL, not impersonated RPCs). Trigger helpers are not client-callable. End migration with actual catalog assertions for grants, RLS, enabled triggers and indexes, then `NOTIFY pgrst, 'reload schema'`.

Exact APIs (all successful writes return only `{slip_id uuid, revision integer}`):

```sql
record_vendor_withholding_slip(
  p_slip_id uuid, p_vendor_id uuid, p_slip_number text,
  p_slip_date date, p_tax_period date, p_pph_type text,
  p_tax_base numeric, p_withheld_amount numeric,
  p_invoice_ids uuid[], p_declared_invoice_ids uuid[] default '{}'
) returns table (slip_id uuid, revision integer);

correct_vendor_withholding_slip(
  p_slip_id uuid, p_expected_revision integer, p_slip_number text,
  p_slip_date date, p_tax_period date, p_reason text
) returns table (slip_id uuid, revision integer);

void_vendor_withholding_slip(
  p_slip_id uuid, p_expected_revision integer, p_reason text
) returns table (slip_id uuid, revision integer);
```

There is deliberately no currency parameter: the writer derives the single currency from locked source bills; the UI labels and candidate filter use that currency. No `org_id`, created_by, status, withheld snapshot or ERP account parameter.

### Record transaction algorithm

1. Assert caller role/member first. Validate scalars; before numeric(14,2) coercion require `p = round(p,2)`, finite positive/in-range, amount ≤ base. Distinct IDs, no null IDs, cardinality 1–100; unknown-type declaration IDs must be distinct/no-null and exactly the selected unknown-type set. Validate date/period against `now() AT TIME ZONE organizations.default_timezone`, with UTC fallback only if unset.
2. Lock `pg_advisory_xact_lock(hashtextextended('vendor-withholding-slip:' || auth_org_id()::text,0))` for all three writers. Canonicalize payload as JSONB: trimmed number, ISO dates, numeric values, type/vendor, sorted selected IDs and sorted declaration IDs. Keep `create_payload` immutable.
3. If that slip ID already exists **in this org**, compare persisted original payload. Identical → return ID/current revision, no event; different → `23505 / bupot-intent-conflict`. This comparison precedes revalidating changed source facts, so a lost-response retry after a correction/void never mints again. Foreign ID collision yields the generic not-found/conflict outcome with no row data.
4. Read selected invoice parent IDs scoped to org; lock selected procurements in UUID order `FOR SHARE`, then selected invoices in UUID order `FOR UPDATE`. Re-read after locks, verify complete ID count and parent/vendor/org consistency. Parent locks prevent vendor reassignment while recording. Existing mirrors lock invoices naturally; a mirror completing later is handled by read-derived review, not a slip-trigger write.
5. Require common vendor/currency, positive withholding, no ERP cancel stamp/docstatus 2 and no Cancelled parent. Check known types and exact unknown declarations. Require no unreleased invoice link. Check exact sum = entered amount and ≤ max value. Take no vendor-default, VAT or GL shortcut.
6. Insert header trusted org/vendor/currency/actor + original payload, then every immutable link in sorted ID order. Log `vendor_withholding_slip.record` (entity ID = slip, source invoice IDs and money/type facts). Deferred integrity checks must pass before commit. Any error rolls back header, links, audit and history.

All three writers use the advisory lock first. Metadata correction/void lock the own-org header `FOR UPDATE` after that lock; they do not acquire parent/invoice row locks because they do not change/re-validate source money. This avoids a lock-order inversion with mirrors. Void releases the reservation while holding the feature lock; a record call cannot interleave half a void.

### Correction and void

Correction: validate reason (trimmed, 1–500) and facts; lock; require active/current revision. Compare only allowed metadata; identical current values → no-op (no revision/event). Otherwise update metadata, `updated_at=clock_timestamp()`, `revision=revision+1`; log `vendor_withholding_slip.correct` with from/to and reason. No correction parameter can mutate base/amount/links/type/vendor/currency.

Void: lock; require active/current revision and reason; stamp one `clock_timestamp()` into header and all retained links, increment revision, log `vendor_withholding_slip.void`. A repeated void is a no-op only if revision equals expected+1, same trimmed reason and same `voided_by = auth.uid()`; otherwise stale/void-state conflict. Do not restore or delete. This releases coverage and active-number reservation, not an external tax document. A replacement uses a new intent UUID and may keep the same issued number; the earlier voided header/link evidence is retained and accessible from bill history.

Error contract (Postgres code + stable DETAIL, never a foreign ID/value in copy):
`42501 / bupot-not-permitted`; `P0002 / bupot-not-found`; `23514 / bupot-invalid-facts`, `bupot-ineligible-bill`, `bupot-amount-mismatch`, `bupot-type-confirmation`, `bupot-bill-limit`; `23505 / bupot-number-conflict`, `bupot-bill-covered`, `bupot-intent-conflict`; `40001 / bupot-stale`; `23514 / bupot-voided`. Translate these in one `bupotRefusal()` map; preserve originals through AppError for diagnostics, never print raw machine keys in the DOM.

## 4. Reads, coverage, history and register seam

### Views / readers

Create `vendor_withholding_slip_register` and `vendor_withholding_bill_register` as **`security_invoker = true`** views, never security-definer views. Columns/grain/total rules are spec §6. Underlying numerics stay numeric; RPC DTOs return money using `::text`. Add these invoker RPCs (no client-callable-definer declaration):

```sql
list_vendor_withholding_slips(
  p_vendor_id uuid default null, p_tax_period date default null,
  p_invoice_id uuid default null,
  p_before_period date default null, p_before_id uuid default null,
  p_limit integer default 50
);
list_vendor_withholding_bills(
  p_vendor_id uuid default null, p_pph_type text default null,
  p_currency text default null, p_invoice_ids uuid[] default null,
  p_candidates_only boolean default false,
  p_after_date date default null, p_after_id uuid default null,
  p_after_null_date boolean default false, p_limit integer default 50
);
get_vendor_withholding_slip(p_slip_id uuid);
```

All are SECURITY INVOKER, stable, pinned search path; revoke PUBLIC/anon EXECUTE and explicitly grant authenticated. Return typed TABLE DTOs for list readers; `get` returns a JSONB detail envelope `{header, bills}` with decimal-string money and at most 100 retained links. No record → P0002; no caller-supplied org. `p_limit` clamps 1–100; reject ID arrays over 100. Exhaustive reader SQL column names are the spec §6 tables; no `SELECT *` from a secret-bearing table. Detail excludes `create_payload`, retains release stamps, includes current facts only where visible, and returns `unavailable` when count is incomplete.

For the bill's “Bukti potong history” menu, `list_vendor_withholding_slips(p_invoice_id => invoiceId)` filters headers by an invoker `EXISTS` on **all retained links**, including released links; return a paged active/void list, not just its current coverage. Use the invoice-history index. No client-side filtering of one capped vendor page.

Header pages: `(tax_period DESC, slip_id DESC)`; cursor predicate `(tax_period,slip_id) < (p_before_period,p_before_id)`, both cursor parts present or neither. Bill pages: `invoice_date ASC NULLS LAST, invoice_id ASC`; when `p_after_id` absent there is no cursor; otherwise:

```sql
(not p_after_null_date and
  (invoice_date > p_after_date or
   (invoice_date = p_after_date and invoice_id > p_after_id) or invoice_date is null))
or (p_after_null_date and invoice_date is null and invoice_id > p_after_id)
```

Reject malformed cursor combinations. Return next cursor from the last actual row; a full page prompts one more page if necessary (page size 101 is never requested). Candidate mode: positive, not-cancelled, unreserved bills of the fixed vendor/currency, either selected known type or unknown; unavailable bills never qualify. Candidate list shows unknown types, not an implicit classification. Candidate selection can span pages; retain a map keyed by invoice ID. No more than 100 selected IDs, and no “select all unseen”.

Coverage algorithm: group retained links once by slip; compare count to header.invoice_count, snapshot sum to header amount, current sum to header amount, **each** current amount to its snapshot, parent vendor, original/current type rules, currency and cancellation. Checking only the sum would hide two offsetting bill corrections. A known original type requires the current type to equal that original/header type; dropping it to null is review. An originally declared null may stay null or become the confirmed header type, never a different known type. Precedence: void → void header; incomplete visible sources → unavailable; any mismatch → needs-review; otherwise reconciled. For bill rows, active link takes precedence over zero/negative current amounts so that a bill whose withholding was removed from an active slip still shows needs-review, not not-required. Without an active link: negative → return-review; zero → not-required; positive → not-recorded. Stable review keys: `amount-changed`, `vendor-changed`, `type-changed`, `currency-changed`, `bill-cancelled`, `case-cancelled`, `source-unavailable`.

Review queries are bounded by requested page/vendor/period first; use the slip/link indexes. Audit `EXPLAIN (ANALYZE, BUFFERS)` on throwaway many-row fixtures for both views/list readers: pagination must not aggregate every org's bills or issue a scalar query per row. Do not cache a permanent boolean `slipped` on the invoice.

### `record_history_config` classification — every column exactly once

Header entity `vendor_withholding_slip`, table `vendor_withholding_slips`, no parent (a slip can cross projects).
- **captured:** `vendor_id:ref`, `slip_number:text`, `slip_date:date`, `tax_period:date`, `pph_type:enum`, `currency:text`, `tax_base:money`, `withheld_amount:money`, `invoice_count:number`, `status:enum`, `voided_at:timestamp`, `voided_by:ref`.
- **flag_cols:** `void_reason` (free-text reasons are not copied into diff history).
- **omit_cols:** `id`, `org_id`, `created_at`, `created_by`, `updated_at`, `revision`, `create_payload`.

Link entity `vendor_withholding_slip_bill`, table `vendor_withholding_slip_bills`, parent_type `vendor_withholding_slip`, parent_col `slip_id`, parent_via null.
- **captured:** `slip_id:ref`, `invoice_id:ref`, `procurement_id:ref`, `withheld_at_record:money`, `pph_type_at_record:enum`, `type_source:enum`, `currency:text`, `released_at:timestamp`.
- **flag_cols:** none.
- **omit_cols:** `id`, `org_id`, `created_at`.

Attach `<table>_zz_record_change` AFTER INSERT OR UPDATE FOR EACH ROW. Extend `record_history_visible(text,uuid)` with two invoker `EXISTS` arms against the source tables, preserving every existing arm/body/ACL. Do not mutate the generic capture trigger or pretend one header belongs to one project. Detail uses `<RecordHistory entityType="vendor_withholding_slip" includeChildren />`; add field kinds/labels/PPh/status label rendering to history UI. Financial fields render with the slip/link currency; unresolved actor refs use existing fallback, not raw identifiers.

Audit is complementary to generic history: INSERT history contains attribution, not values (`supabase/migrations/0260_record_change_history.sql:173-208`), so the record audit supplies the original facts/link IDs. Correction audit retains reason and from/to; void audit retains reason/affected IDs. Audit visibility is unchanged; normal Finance still sees record/link change history, whereas audit details remain under their established RLS (`supabase/migrations/0260_record_change_history.sql:262-275,318-339`).

## 5. Typed frontend contract / UI

Create `pmo-portal/src/lib/vendorWithholdingSlip.ts` for UI types/parsers only:

```ts
type DecimalMoney = string;
type SlipCoverage = 'not-required' | 'return-review' | 'not-recorded'
  | 'slipped' | 'needs-review' | 'unavailable';
type RecordSlipInput = {
  slipId: string; vendorId: string; slipNumber: string;
  slipDate: string; taxPeriod: string; pphType: PphType;
  taxBase: DecimalMoney; withheldAmount: DecimalMoney;
  invoiceIds: string[]; declaredInvoiceIds: string[];
};
type CorrectSlipInput = {
  slipId: string; expectedRevision: number; slipNumber: string;
  slipDate: string; taxPeriod: string; reason: string;
};
type VoidSlipInput = { slipId: string; expectedRevision: number; reason: string };
type SlipWriteResult = { slipId: string; revision: number };
```

Reuse `PphType` from `vendorWithholding.ts`; generated table/RPC shapes come from `database.types.ts`, not copied DB row interfaces. Decimal helpers: parse signed decimal strings to bigint cents; positive form parser rejects zero/negative/control/nondecimal/>2 precision/out-of-range; aggregate bigint before formatting canonical two decimals. Locale drafts may use the shared locale parser but must convert to the same exact decimal contract. Test maximum boundary rather than `Number` summation. `bupotRefusal(error)` returns translated copy key/remedy, with stale → Reload, conflicts → inspect existing coverage, structural invalid input → edit facts, transport unknown → retry **same intent**.

New DAL `pmo-portal/src/lib/db/vendorWithholdingSlips.ts`: `recordSlip`, `correctSlip`, `voidSlip`, `listSlips`, `listBills`, `getSlip`. New repository `pmo-portal/src/lib/repositories/vendorWithholdingSlips.ts` wraps these six; add `vendorWithholdingSlips` to `repositories/index.ts` and its interface/types. List methods return `{rows,nextCursor}`; coverage convenience method pages batches of at most 100 invoice IDs through listBills. In candidate-only reads use server eligibility, not client-only filters. No org/actor in DAL arguments.

New hook `pmo-portal/src/hooks/useVendorWithholdingSlips.ts`: one coverage query per invoice-ID batch, lazy detail and candidate infinite queries; record/correct/void mutations. Keys begin `['vendorWithholdingSlips',orgId]`, suffixed by coverage/detail/candidates/register and canonical params. On successful mutation invalidate that whole own-org prefix, `['procurement',orgId]` (all affected cases), and own-org record-history prefix. Do not invalidate a specific source case only: grouped slips cross cases. No optimistically fabricated Slipped state. Disable queries without org/IDs; surface loading and error distinctly.

Policy: add entity `vendorWithholdingSlip` with `view` for active readable-context roles, `create`/`edit`/`archive` (void) Finance/Admin. `usePermission` supplies the real role; it does not itself suppress view-as writes (`pmo-portal/src/auth/usePermission.tsx:20-26`). For this feature pass `record: {viewOnly: effectiveRole !== realRole}` from `useEffectiveRole` (`pmo-portal/src/auth/impersonation.tsx:14-21,49-61`) and make each new writer predicate require `ctx.record?.viewOnly !== true` as well as Finance/Admin. Retain the real-role authority; do not change shared impersonation behaviour for other features. Do not reuse procurement case `canWrite` or require “nonterminal” status for evidence writes.

Exact UI files:
- `pmo-portal/pages/procurement/VendorWithholdingSlipCell.tsx`: existing Amount composition receives compact coverage label/number/date and View; unknown/unavailable is explicit, not a blank or zero. No new ledger column.
- `pmo-portal/pages/procurement/VendorWithholdingSlipModal.tsx`: shared EntityFormModal/useEntityForm, TextField/SelectField/FormGrid/FieldError plus shared Checkbox/DataTable candidate selection; vendor/currency pinned, starting bill preselected, external facts and chosen PPh type, explicit per-unknown-ID confirmation, paged candidates, count/exact sum/difference, persistent submitError. Validate on blur/submit, never mount; one stable intent UUID per opened capture/uncertain retry. Display type confirmation warning before saving.
- `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.tsx`: complete record + linked bills/cross-case links, reconciled/review/void state and reasons, RecordHistory; metadata-only correction EntityFormModal and ConfirmDialog/reason for Void. Void copy explicitly says it does not cancel a DJP document. View retains released snapshots. Header-level actions use their own permissions and revision.
- `pmo-portal/pages/procurement/ProcurementLedger.tsx`: compose new cell below withholding; merge e-Faktur and slip row-menu actions even when e-Faktur is unavailable; add props for coverage state/actions, leaving case capture and monetary rows alone.
- `pmo-portal/pages/ProcurementDetails.tsx`: wire new hook/repository permissions and URL search param `bupot` (preserve other params); entry points Record/View/History, cross-case links to `/procurement/:id?bupot=:slipId`, back closes only the panel selection. Retained void detail is URL-openable even when no active link remains.
- `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`: literal `bupot.*` keys for all fields/actions/states/refusals/reasons; add history field/kind keys where needed.

Operate-mode sketch intent: incumbent ledger identity → quiet evidence state beside withheld amount → one capture modal with an exact reconciliation focal point → secondary detail panel with the issued facts and all bills. No additional dashboard/tab/sidebar/approval inbox. Long issued numbers wrap; money stays tabular; date uses `formatDateOnly`. Shared 32px controls, mobile card/table reflow, accessible labelled checkbox text toggling, persistent modal errors and focus return. Owner sketch-glance must confirm this shape before implementation, not reopen DD-BUPOT-1..3.

## 6. Rollback and proof surface

Rollback is explicit SQL, not `db reset` as a production reversal:
1. Revert/disable the new FE first. Export slip/link evidence through the authorized operational process before any destructive rollback; production reversal needs explicit per-instance approval. No export of real data into this public repo.
2. Drop the three reader functions, register views, three writer functions and feature integrity triggers/functions, with **full signatures** above; do not `CASCADE` unrelated objects.
3. Drop the two history capture triggers; delete only their two registry rows; restore the pre-0278 `record_history_visible` body preserving all other arms and its ACL.
4. Drop link then header tables. Do not delete `record_changes`/audit rows; old evidence remains retained but source visibility no longer resolves it. Document this consequence.
5. Drop only supporting unique constraints/indexes added by 0278 after all referencing new FKs are gone; leave bill money, grants, mirror guards and other feature tables untouched. Notify PostgREST.

Local rollback proof: a pgTAP file applies the down file via `\ir ../migrations/rollback/0278_vendor_withholding_slips_down.sql` inside BEGIN/ROLLBACK, then proves new objects removed, incumbent source bills/withholding unchanged, remaining history catalog complete, old writer ACLs still intact. Transaction rollback restores the forward schema for later tests. Do not run this against a hosted target.

Add the **three writer names only** to `supabase/tests/0178_anon_executable_definers.test.sql`:
`record_vendor_withholding_slip`, `correct_vendor_withholding_slip`, `void_vendor_withholding_slip`.
This checkout's 66 becomes 69; manually re-derive after integration, do not auto-count the list or delete self-tests. Add paired membership/role/tenant tests in `0278_vendor_withholding_slips_access.test.sql`. Invoker readers and non-executable trigger helpers stay outside the definer allowlist.

Catalog test amendment: 12 becomes 14 explicitly in `record_changes_catalog_gate.test.sql`; retain classification, trigger and source-visibility planted-defect checks. Add two table entries and actual writer signatures to `scripts/isolation-probe-denominator.json`; trigger-returning functions and invoker readers are not entries in its non-trigger-definer list.

## 7. TDD microtasks (43 tasks, each 2–5 minutes)

Each behaviour row specifies **RED test first → minimal GREEN change → exact verify command**. Times are for the named micro-change, not the entire slice. Do not merge these into a 30-minute “implement the schema” task. No production code before a binding failing test. Scaffold/inspection/generated-type tasks are explicitly labelled, not presented as behaviour proofs.

### Command setup for the eventual builder (repo root)

These shell functions contain the exact verification commands used below. They are **instructions**, not executed during this PLAN ONLY delivery. They use only the local stack and machine-global test/DB locks. `dbtest` chains reset+scoped tests in **one hold** because 0278 changes schema; inner-loop repeated tests can omit reset only when this worktree's schema is known unchanged under the same hold.

```bash
unit() { scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run "$@"' bash "$@"; }
dbtest() { scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db "$@"' bash "$@"; }
```

Do not use bare full-suite verify, install/regenerate a lockfile, inspect secret files or run a hosted DB command. Commands using source tests below are future-build instructions; only docs are written now.

### Database tasks

| # / minutes | RED → GREEN / exact paths / ACs | Verify |
|---|---|---|
| **01 / 2** | **Inspection only.** Check `supabase/migrations/0278*` slot and existing `(org_id,id)` unique keys on companies/procurements/invoices; record owned constraint names in migration/rollback header. Confirm spec approval/executor before any build. | `scripts/check-migration-collisions.sh` |
| **02 / 5** | **Test scaffold only.** New `supabase/tests/0278_vendor_withholding_slips_schema.test.sql`: BEGIN/plan/ROLLBACK, named synthetic vendor, two case/bill fixtures, helper JWT contexts like `supabase/tests/0273_vendor_tax_accounts_native_withholding.test.sql`; assertions must call real public writers, never cloned implementations. Set both bills withholding 20,000/30,000 and type pph23 in same currency. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` (scaffold only; no behaviour claimed) |
| **03 / 5** | RED AC-BUPOT-001 table/column/domain assertions → GREEN header DDL/number/money/status checks + owned composite company FK in `0278_vendor_withholding_slips.sql`. Temporary schema task does not declare record RPC success. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **04 / 5** | RED AC-BUPOT-002/005 link schema/snapshot/unique reservation assertions → GREEN link DDL + owned invoice/procurement composite keys and indexes (§2), both table FORCE RLS and initial explicit grants. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **05 / 5** | RED AC-BUPOT-002/003 empty/partial/incorrect-sum commit tests (`SET CONSTRAINTS ALL IMMEDIATE` inside savepoint) → GREEN deferred snapshot integrity trigger on both tables. Assert offsetting currency/type differences and void release consistency. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **06 / 5** | RED AC-BUPOT-008 normal/disabled/foreign/anon contexts in new `supabase/tests/0278_vendor_withholding_slips_access.test.sql` → GREEN record RPC signature and member/role/org gates, fixed path and explicit ACL. Test denial before inspecting targets. | `dbtest supabase/tests/0278_vendor_withholding_slips_access.test.sql` |
| **07 / 5** | RED AC-BUPOT-001 numeric/date/period input cases through real RPC → GREEN scalar validation **before casts** and org-calendar comparisons. Include org morning boundary, NaN/infinity, 0.001 excess precision, max value and over-limit. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **08 / 5** | RED AC-BUPOT-002/003 ID count, duplicate/null IDs, wrong vendor/org/currency/cancel and Paid eligibility → GREEN advisory lock, sorted parent/invoice locks and complete re-read/eligibility in record RPC. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **09 / 5** | RED AC-BUPOT-004 unknown-type selection/declaration exact set and known conflict → GREEN declaration validator and original-type/type-source link snapshot construction; assert no invoice column changes. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **10 / 5** | RED AC-BUPOT-002/003 successful two-case grouping and ±0.01 mismatches → GREEN exact SQL SUM/entered amount comparison and atomic header+link INSERTs. Save no partial record on any error. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **11 / 5** | RED AC-BUPOT-005 duplicate active number/bill, same-number replacement after void, and same/different intent cases → GREEN original canonical create_payload comparison before mutable-source validation, constraint-error mapping. Verify a reused ID never returns a foreign row. | `dbtest supabase/tests/0278_vendor_withholding_slips_schema.test.sql` |
| **12 / 5** | RED AC-BUPOT-006 in new `supabase/tests/0278_vendor_withholding_slips_lifecycle.test.sql`: correction reason, revision, immutable money/type/links and no-op → GREEN metadata-only correction RPC (§3), actual ACL and audit event. | `dbtest supabase/tests/0278_vendor_withholding_slips_lifecycle.test.sql` |
| **13 / 5** | RED AC-BUPOT-007 void/retry/replace and stale update cases → GREEN void RPC with one timestamp, retained/released links, terminal state and identity-bound retry. Add AC-BUPOT-005 intent retries after correction/void. | `dbtest supabase/tests/0278_vendor_withholding_slips_lifecycle.test.sql` |
| **14 / 5** | RED AC-BUPOT-008 direct DML/table-column grants/FK tenant graft/cascade retention across both orgs → GREEN own-org/member/source-visible SELECT policies, trusted grants and end-migration catalog assertions. Include every writer role permutation, not just record. | `dbtest supabase/tests/0278_vendor_withholding_slips_access.test.sql` |
| **15 / 5** | RED AC-BUPOT-009 in new `supabase/tests/0278_vendor_withholding_slips_register.test.sql`: current-vs-snapshot changes including offsetting bill edits → GREEN header register view validation aggregation (§4), no changes to mirror code/guards. | `dbtest supabase/tests/0278_vendor_withholding_slips_register.test.sql` |
| **16 / 5** | RED AC-BUPOT-010 state precedence and unreadable-link source fixture → GREEN invoice register view, expected/visible count guard and current-null-type resolution. Check active-link amount removal is needs-review, not not-required. | `dbtest supabase/tests/0278_vendor_withholding_slips_register.test.sql` |
| **17 / 5** | RED AC-BUPOT-012 header totals/period/currency/keyset page boundaries and retained per-invoice active/void history → GREEN `list_vendor_withholding_slips` invoker reader with decimal-string money and two-part descending cursor. | `dbtest supabase/tests/0278_vendor_withholding_slips_register.test.sql` |
| **18 / 5** | RED AC-BUPOT-012 candidate/page-2/date-null-phase/batch coverage and malformed cursor → GREEN `list_vendor_withholding_bills` invoker reader with §4 predicates, server candidate eligibility, 100 bound and null-date cursor phase. | `dbtest supabase/tests/0278_vendor_withholding_slips_register.test.sql` |
| **19 / 5** | RED AC-BUPOT-008/012 full detail for active/void/incomplete/foreign IDs → GREEN `get_vendor_withholding_slip` invoker JSON envelope excluding original create_payload, complete ≤100 retained links and unavailable state. | `dbtest supabase/tests/0278_vendor_withholding_slips_access.test.sql supabase/tests/0278_vendor_withholding_slips_register.test.sql` |
| **20 / 5** | RED AC-BUPOT-011 history registry/actor/source visibility in new `supabase/tests/0278_vendor_withholding_slips_history.test.sql` → GREEN two exact classification entries, capture triggers and visibility arms (§4); record/void audit and correction reason audit. | `dbtest supabase/tests/0278_vendor_withholding_slips_history.test.sql` (the standing catalog's explicit roster count is extended in task 21) |
| **21 / 3** | **Declaration task, paired with existing RED completeness gates:** update 0178 names/count to 69 and history table count to 14 in their existing tests; add two table/three writer manifest entries in `scripts/isolation-probe-denominator.json`. No exclusions or weakened checks. | `dbtest supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/record_changes_catalog_gate.test.sql supabase/tests/0278_vendor_withholding_slips_access.test.sql`; `scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs` |
| **22 / 5** | RED rollback assertions in new `supabase/tests/0278_vendor_withholding_slips_rollback.test.sql` → GREEN exact down migration §6, invoking it transactionally; source bill money/history/old ACL preservation. | `dbtest supabase/tests/0278_vendor_withholding_slips_rollback.test.sql` |
| **23 / 3** | **Generated artifact only:** regenerate `pmo-portal/src/lib/supabase/database.types.ts` from this forward schema, never hand-invent DB row interfaces. | `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'` |

### Typed seam and UI tasks

| # / minutes | RED → GREEN / exact paths / ACs | Verify |
|---|---|---|
| **24 / 5** | RED AC-BUPOT-013 in new `pmo-portal/src/lib/vendorWithholdingSlip.test.ts`: exact decimals/max/large sum/unknown/mismatch/date helpers → GREEN DecimalMoney and bigint parsers/sum/difference in `vendorWithholdingSlip.ts`, sharing PphType, no UI rate re-computation. | `unit src/lib/vendorWithholdingSlip.test.ts` |
| **25 / 5** | RED AC-BUPOT-014 in new `pmo-portal/src/lib/db/vendorWithholdingSlips.test.ts`: all six exact RPC args, no org/actor, decimal string DTO and code/detail retention → GREEN thin DAL in `db/vendorWithholdingSlips.ts`. | `unit src/lib/db/vendorWithholdingSlips.test.ts` |
| **26 / 5** | RED AC-BUPOT-014 repository native/external no-dispatch cases + two-page/null-date cursor DTO in new `pmo-portal/src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts` → GREEN new repository, `types.ts` and `index.ts` registration. Spy on adapter route to prove it stays unused. | `unit src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts` |
| **27 / 3** | RED AC-BUPOT-015 all five real-role/read-only-view-as cases in new `pmo-portal/src/auth/policy.vendorWithholdingSlip.test.ts` → GREEN `vendorWithholdingSlip` view/create/edit/archive entries with the explicit feature `viewOnly` context and page `usePermission`, not procurement edit/terminal-state permissions. | `unit src/auth/policy.vendorWithholdingSlip.test.ts` |
| **28 / 5** | RED AC-BUPOT-019 query org keys/disabled/error/no zero fabrication and success/failure invalidation in new `pmo-portal/src/hooks/useVendorWithholdingSlips.test.tsx` → GREEN hook coverage/detail/candidates and three mutations; invalidate all grouped own-org cases and history; no pending-push. | `unit src/hooks/useVendorWithholdingSlips.test.tsx` |
| **29 / 5** | RED AC-BUPOT-016 compact coverage cell active/review/loading/error/void-only/return in new `pmo-portal/pages/procurement/VendorWithholdingSlipCell.test.tsx` → GREEN labelled cell/status/retry/number/date in `VendorWithholdingSlipCell.tsx`. Never hide a query failure as “Not recorded”. | `unit pages/procurement/VendorWithholdingSlipCell.test.tsx` |
| **30 / 5** | RED AC-BUPOT-016 e-Faktur coexistence/no new column/action on Paid/no action on ineligible rows in new `pmo-portal/pages/procurement/ProcurementLedger.bupot.test.tsx` → GREEN merged menu and amount composition props in `ProcurementLedger.tsx`. Also run existing money/e-Faktur tests. | `unit pages/procurement/ProcurementLedger.bupot.test.tsx pages/procurement/ProcurementLedger.test.tsx pages/procurement/ProcurementLedger.efaktur.test.tsx` |
| **31 / 5** | RED AC-BUPOT-017 issued facts/starting bill/vendor/currency/validation/base no-rate overwrite in new `pmo-portal/pages/procurement/VendorWithholdingSlipModal.test.tsx` → GREEN first modal form using shared primitives in `VendorWithholdingSlipModal.tsx`. | `unit pages/procurement/VendorWithholdingSlipModal.test.tsx` |
| **32 / 5** | RED AC-BUPOT-017 second-page bill/unknown confirmations/selection retention/mismatch/100 bound → GREEN paged candidate table and selection map, bigint total/difference and explicit per-ID confirmation in same modal; label text toggles shared checkbox. | `unit pages/procurement/VendorWithholdingSlipModal.test.tsx` |
| **33 / 5** | RED AC-BUPOT-017 refused and lost-response saves retain drafts/UUID/persistent error/focus; error map cases → GREEN stable intent UUID, `bupotRefusal` and submitError/retry logic. No automatic clearing/closing on an error. | `unit pages/procurement/VendorWithholdingSlipModal.test.tsx src/lib/vendorWithholdingSlip.test.ts` |
| **34 / 5** | RED AC-BUPOT-018 grouped active/void/review/unavailable detail/history read-only roles in new `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.test.tsx` → GREEN complete secondary panel and shared RecordHistory in `VendorWithholdingSlipDetails.tsx`. Money remains immutable. | `unit pages/procurement/VendorWithholdingSlipDetails.test.tsx` |
| **35 / 5** | RED AC-BUPOT-018 metadata edit/current revision/reason + void confirmation/no DJP cancellation claim/stale Reload and paged retained bill-history selection → GREEN correction modal and reason-bearing ConfirmDialog in detail component; no restore/delete. | `unit pages/procurement/VendorWithholdingSlipDetails.test.tsx` |
| **36 / 5** | RED AC-BUPOT-018 money/type/history labels in `pmo-portal/src/components/history/__tests__/RecordHistory.bupot.test.tsx` → GREEN `historyFields.ts`, `historyLabels.ts`, `useHistoryEnumLabel.ts` entries and new literal bupot/history keys in both `public/locales/{en,id}/common.json`. | `unit src/components/history/__tests__/RecordHistory.bupot.test.tsx pages/procurement/VendorWithholdingSlipDetails.test.tsx`; `cd pmo-portal && npm run check:i18n` |
| **37 / 5** | RED AC-BUPOT-016/018 wiring/URL reload/closing preserving other params/Paid case actions in new `pmo-portal/pages/__tests__/ProcurementDetails.bupot.test.tsx` → GREEN `ProcurementDetails.tsx` orchestration, new hook queries and bupot selection URL. No new primary route. | `unit pages/__tests__/ProcurementDetails.bupot.test.tsx` |
| **38 / 5** | RED AC-BUPOT-020 new `pmo-portal/e2e/AC-BUPOT-020-vendor-withholding-slip.spec.ts`: complete two-case Finance goal → GREEN fix only shipped code if wiring fails. Tag self-isolated; synthetic unique vendor/cases/bills/slip number; test normal UI to record/correct/void; inspect persisted links and unchanged bill/outbox baseline; privileged local cleanup links→header→bills→cases→vendor after assertions. | `scripts/e2e-local.sh AC-BUPOT-020` |
| **39 / 5** | RED AC-BUPOT-021 new `pmo-portal/e2e/AC-BUPOT-021-vendor-withholding-slip-visual.spec.ts`: rich unique fixtures, axes en/id × light/dark × 360/1440, axe/overflow/menu/calendar/money screenshots → GREEN UI fixes, then owner/Director-approved visual baselines (no blind update-to-green). Tag self-isolated; await fonts before screenshots. | `scripts/e2e-local.sh AC-BUPOT-021`; `scripts/check-e2e-isolation.sh`; `node scripts/check-e2e-fonts-ready.mjs` |
| **40 / 5** | **Integration-test scaffold only:** new `pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs`, two local psql child sessions, uniquely owned fixtures, explicit authentication setup, barriers/timeouts/cleanup (§8). Do not claim concurrency from a single-session test. | `scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` |
| **41 / 5** | RED duplicate record interleave corroborating AC-BUPOT-005 → GREEN only by fixing shipped lock/index/transaction logic if required. Session B waits, then refuses covered bill after A commits; one unreleased link. | `scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` |
| **42 / 5** | RED void/re-record interleave corroborating AC-BUPOT-007 → GREEN only by fixing shipped atomic release if required. B succeeds only after A's full void commit, old snapshots retained and exactly one active replacement. | `scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` |
| **43 / 5** | **Evidence assembly, not a code bucket:** collect below scoped gate outputs and RED→GREEN/mutation/concurrency results. Commission rendered Discover/three reviews/acceptance as separate bounded review runs; every finding becomes a new 2–5-min TDD task + §9 cell + retention note, then rerender. Do not compress review/fixes into this task. | §8 exact gate block and §9 review matrix |

## 8. Additional deterministic proofs / local final gate

### Concurrent reservation proof (not something pgTAP's single session proves)

New future-build file `pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs` uses **two `psql` child sessions** through `node:child_process` (no new dependency). This is a local integration harness, not a Vitest mock. Fixed local connection uses the public disposable Docker convention; never parameterize a hosted URL.

Under one db-lock hold, create synthetic transaction fixtures, start session A/B as authenticated Finance (each `SET LOCAL` the role/JWT), and issue two distinct record intents sharing an invoice. Force A to hold the advisory lock, observe B waiting, commit A, then B must fail `bupot-bill-covered`; count one header/one unreleased link. Second interleave: A voids existing coverage while B records replacement; B waits and succeeds only after A's complete commit, with retained old released link and one new unreleased link. Include 10-second timeout, terminate sessions on failure, always cleanup only owned fixture IDs. Inspect result bodies/errors, not just exit codes. This corroborates AC-BUPOT-005/007; their lowest-layer owners remain pgTAP.

**Verify:** `scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs`.
Tasks 40–42 implement this proof in three 2–5-minute steps: barrier/fixture harness, duplicate interleave, void/record interleave. No concurrent local stack users; no claim that a catalog lock-string assertion proves an interleave.

### Mutation-check the new enforcement

On disposable local schema, temporarily remove one role gate, one org predicate, unknown-type validator, exact-sum comparison, or active-index reservation **one at a time**. The corresponding real-RPC AC-BUPOT-008/004/003/005 test must go red. Temporarily omit a history classification/visibility arm; the unchanged catalog self-tests must name it. Restore the real migration and chain reset+targeted tests in one lock hold, then rerun green. Do not weaken tests or persist mutations. Evidence belongs in `docs/reviews/2026-10-08-vendor-withholding-slip-gates.md` with synthetic results only.

### Local final gate (eventual builder, not this planner)

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'

cd pmo-portal
npx eslint --max-warnings=0 \
  src/lib/vendorWithholdingSlip.ts src/lib/vendorWithholdingSlip.test.ts \
  src/lib/db/vendorWithholdingSlips.ts src/lib/db/vendorWithholdingSlips.test.ts \
  src/lib/repositories/vendorWithholdingSlips.ts \
  src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts \
  src/lib/repositories/index.ts src/lib/repositories/types.ts \
  src/auth/policy.ts src/auth/policy.vendorWithholdingSlip.test.ts \
  src/hooks/useVendorWithholdingSlips.ts src/hooks/useVendorWithholdingSlips.test.tsx \
  pages/procurement/VendorWithholdingSlipCell.tsx pages/procurement/VendorWithholdingSlipCell.test.tsx \
  pages/procurement/VendorWithholdingSlipModal.tsx pages/procurement/VendorWithholdingSlipModal.test.tsx \
  pages/procurement/VendorWithholdingSlipDetails.tsx pages/procurement/VendorWithholdingSlipDetails.test.tsx \
  pages/procurement/ProcurementLedger.tsx pages/procurement/ProcurementLedger.bupot.test.tsx \
  pages/ProcurementDetails.tsx pages/__tests__/ProcurementDetails.bupot.test.tsx \
  src/components/history/historyFields.ts src/components/history/historyLabels.ts \
  src/components/history/useHistoryEnumLabel.ts src/components/history/__tests__/RecordHistory.bupot.test.tsx \
  e2e/AC-BUPOT-020-vendor-withholding-slip.spec.ts e2e/AC-BUPOT-021-vendor-withholding-slip-visual.spec.ts \
  src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs
npm run check:i18n
cd ..

scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db \
  supabase/tests/0278_vendor_withholding_slips_schema.test.sql \
  supabase/tests/0278_vendor_withholding_slips_access.test.sql \
  supabase/tests/0278_vendor_withholding_slips_lifecycle.test.sql \
  supabase/tests/0278_vendor_withholding_slips_register.test.sql \
  supabase/tests/0278_vendor_withholding_slips_history.test.sql \
  supabase/tests/0278_vendor_withholding_slips_rollback.test.sql \
  supabase/tests/0178_anon_executable_definers.test.sql \
  supabase/tests/record_changes_catalog_gate.test.sql \
  supabase/tests/0269_vendor_withholding.test.sql \
  supabase/tests/0273_vendor_tax_accounts_native_withholding.test.sql \
  && node scripts/check-isolation-denominator.mjs'

scripts/with-db-lock.sh node pmo-portal/src/lib/db/vendorWithholdingSlips.concurrent.integration.mjs
scripts/e2e-local.sh AC-BUPOT-
scripts/check-e2e-isolation.sh
node scripts/check-e2e-fonts-ready.mjs
```

Run changed-code coverage as a targeted unit run under the test lock; changed-code lines must meet ≥80%, with behaviour assertions not coverage padding. CI remains the **full-suite** merge gate; do not re-run the full app/e2e/pgTAP portfolio on the shared Mac. Builder records outputs, not just `$?` after a pipe. Reviewers consume that evidence and rerun only a targeted check they doubt. No push/merge/deploy is part of this plan-only assignment.

## 9. Traceability and rendered coverage denominator

| AC | FR/NFR | Owning file / layer | Tasks |
|---|---|---|---|
| AC-BUPOT-001 | FR-001, NFR-001 | `supabase/tests/0278_vendor_withholding_slips_schema.test.sql` / pgTAP | 03,07 |
| AC-BUPOT-002 | FR-002/003 | same / pgTAP | 04,05,08,10 |
| AC-BUPOT-003 | FR-003, NFR-001 | same / pgTAP | 05,08,10 |
| AC-BUPOT-004 | FR-004 | same / pgTAP | 09 |
| AC-BUPOT-005 | FR-005 | same / pgTAP | 04,11,13; concurrent corroboration §8 |
| AC-BUPOT-006 | FR-006 | `supabase/tests/0278_vendor_withholding_slips_lifecycle.test.sql` / pgTAP | 12 |
| AC-BUPOT-007 | FR-007 | same / pgTAP | 13; concurrent corroboration §8 |
| AC-BUPOT-008 | FR-010 | `supabase/tests/0278_vendor_withholding_slips_access.test.sql` / pgTAP | 06,14,19,21 |
| AC-BUPOT-009 | FR-008 | `supabase/tests/0278_vendor_withholding_slips_register.test.sql` / pgTAP | 15 |
| AC-BUPOT-010 | FR-008/009 | same / pgTAP | 16 |
| AC-BUPOT-011 | FR-011 | `supabase/tests/0278_vendor_withholding_slips_history.test.sql` / pgTAP | 20,21 |
| AC-BUPOT-012 | FR-014, NFR-002 | `supabase/tests/0278_vendor_withholding_slips_register.test.sql` / pgTAP | 17–19 |
| AC-BUPOT-013 | NFR-001/003 | `pmo-portal/src/lib/vendorWithholdingSlip.test.ts` / Vitest | 24 |
| AC-BUPOT-014 | FR-015, NFR-002 | `pmo-portal/src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts` / Vitest; DAL references corroborate | 25,26 |
| AC-BUPOT-015 | FR-010 UX mirror | `pmo-portal/src/auth/policy.vendorWithholdingSlip.test.ts` / Vitest | 27 |
| AC-BUPOT-016 | FR-012, NFR-002 | `pmo-portal/pages/procurement/ProcurementLedger.bupot.test.tsx` / RTL; cell references corroborate | 29,30,37 |
| AC-BUPOT-017 | FR-013, NFR-003 | `pmo-portal/pages/procurement/VendorWithholdingSlipModal.test.tsx` / RTL | 31–33 |
| AC-BUPOT-018 | FR-006/007/011/012, NFR-003 | `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.test.tsx` / RTL; history/page references corroborate | 34–37 |
| AC-BUPOT-019 | FR-012/015 | `pmo-portal/src/hooks/useVendorWithholdingSlips.test.tsx` / Vitest | 28 |
| AC-BUPOT-020 | FR-002/006/007/012/015 | `pmo-portal/e2e/AC-BUPOT-020-vendor-withholding-slip.spec.ts` / cross-stack e2e | 38 |
| AC-BUPOT-021 | NFR-003 | `pmo-portal/e2e/AC-BUPOT-021-vendor-withholding-slip-visual.spec.ts` / rendered deterministic oracle | 39 |

FR prefixes in this table mean **FR-BUPOT-**, NFR prefixes mean **NFR-BUPOT-**. Each ID has one owner; other-layer occurrences are integration/regression corroboration. Rollback has additional `AC-BUPOT-008/011` references but is a migration-contract regression, not another owner.

### Routes × oracles (seed with these cells; expand on every Discover finding)

| Route / state | Oracle / proof |
|---|---|
| `/procurement/:id`, Documents, eligible uncovered invoice (including Paid) | compact status, record action independent of case edit, e-Faktur coexistence; AC-BUPOT-016/020 |
| same, capture open | stated external facts, cross-case paged selection, unknown confirmations, exact-cent mismatch, retained error/focus; AC-BUPOT-017/021 |
| `/procurement/:id?bupot=:slipId`, active | issued number/date/base/amount and complete linked cases, metadata-only edit, caller permission; AC-BUPOT-018/020 |
| same, metadata stale/refused | reason preserved, persistent in-dialog error, Reload; AC-BUPOT-018 |
| same, void confirmation and retained void | no implied DJP cancellation, release both ledgers, retained evidence; AC-BUPOT-018/020 |
| Documents, needs-review/unavailable/return-review/loading/error | no fabricated Slipped/Not recorded/zero, useful reason/retry; AC-BUPOT-016/021 |
| all above, 360/1440 × en/id × light/dark | axe, no page overflow, reachable ⋯, wrapping issued number, tabular currency/date-only, font-ready screenshots; AC-BUPOT-021 |

Rendered Discover is open-ended on rich synthetic states, not a checklist-only pass. Findings graduate to a binding test, this matrix and a retention note, then rerender. Acceptance verifies the complete AC matrix. Security reviewer specifically checks new writer/reader grants, effective source visibility, org FK seam, active-role enforcement and mutation red evidence; quality reviewer checks bounded query plans and avoids N+1. Keep open-weakness detail out of public docs/issues; only synthetic passing/fixed evidence goes into the public review report.

## 10. OPEN OWNER QUESTIONS

**None.** Technical implementation choices are stated above for Director ratification. Do not ask the owner to choose SQL schema, tolerances, executor or test layer; do not re-open the three fixed rulings. Sign-off/sketch-glance and a later explicit production instruction remain separate checkpoints.
