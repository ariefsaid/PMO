# Plan — purchase capture: place an ERP order and its project-less invoices as one purchase (#2277)

Spec: `docs/specs/capture-order-invoices.spec.md` · Parent: #2195 (map #450) · Base: B1 on `dev` (merge 78ff44236,
`supabase/migrations/0882_capture_invoice_assignment.sql`) and the capture fixes on `dev` (523ac8b6, b2b4089a) ·
Tier: **money path** — ships alone, Director-dispatched, three reviewers (security-auditor at full depth on the RPCs,
grants and the linker exception).

**Migration number: `NNNN` — number on request.** The coordinator assigns it at build start
(`scripts/renumber-migration.sh` if it collides). Every `NNNN` below — file names, `-- NNNN` line markers, the rollback
harness — takes that number. If B2 (`docs/plans/2026-11-15-capture-split-invoices.md`) lands first, rebase onto its
bodies: both replace `assign_capture_invoices`, `capture_assignment_row` and `capture_assignment_claim`; the second to
land keeps the first's `-- <its number>` lines and adds its own.

**Request guard: no change.** `api_client_request_guard()` keeps its 0882 body: family rows travel through
`assign_capture_invoices` (already in the 0882 `capture_assign_rpcs` tier) and the attachment undo through
`undo_captured_purchase` (already in the 0688 `purchase_rpcs` tier, matched by name). This slice is therefore **not** in
the one-at-a-time guard chain. If review asks for a separate undo RPC instead (Design §4), that RPC needs a guard line and
then queues **after #1857** in the chain; do not take that route without the Director re-sequencing it.

## Design

```
pmo purchases assign file.json ─► purchase-capture (action: assign, unchanged) ─► assign_capture_invoices(rows, revision, dry_run)
                                                                                    │ fence → actor → binding → revision → feed (B1)
                                                                                    │ batch read: sources ∪ invoice_ids (NFR-001)
                                                                                    ▼ rows in source order
                                                   decision project | set_aside ─► capture_assignment_row (B1, unchanged path)
                                                   decision order_family        ─► capture_assignment_family (new)
                                                                                     order-name lock → docs → order checks
                                                                                     family completeness (MC-4)
                                                                                     per untagged invoice: B1 validate (p_family_order)
                                                                                     target: none → create | record-only W → attach
                                                                                     claim: one B1 'project' decision per untagged invoice
                                                                                     link_erp_purchase_documents (I-2, I-3 unchanged)
                                                                                     stage, capture row, decisions.procurement_id, audit
reads (unchanged): capture_assigned_gl (decision = 'project') · cost_attribution_engine voucher anti-join · procurement_ledger_held(_many)
undo: undo_captured_purchase(purchase, reason, dry_run, p_attach_request_id default null)  — whole purchase | one attachment
```

Decisions:

1. **Per-invoice B1 decisions, not a new placement kind.** Each untagged invoice gets an ordinary `decision = 'project'`
   row, so `capture_assigned_gl`, the attribution engine's voucher anti-join, the report's `placed`/`tagged_in_erp` and
   ERP-tag precedence work unchanged (MC-2, MC-5) and need no new proof of their own beyond the family fixtures. Two new
   nullable columns tie them together: `family_request_id`, `family_order_document_id`. Each decision's own
   `request_id` is derived, `md5(family_request || ':' || invoice)::uuid`, so B1's unique request key holds.
2. **Decisions before links.** The linker's I-3 exception admits an untagged invoice only with an active `project`
   decision on the purchase's project; writing the decisions first, in the same transaction, uses that rule as is. I-2
   (order and invoice in one purchase) is the double-count control and is not touched.
3. **Commitment is not recomputed.** `procurement_ledger_held(_many)` already subtracts every linked submitted invoice's
   net total, whatever its tag; linking the whole family to one purchase is what makes MC-3 hold. Preview reports
   before/after through those same readers.
4. **Attachment undo through the existing undo RPC.** `undo_captured_purchase` gains `p_attach_request_id uuid default
   null` (the 3-argument function is dropped, so PostgREST sees one function; the CLI's named-argument call keeps
   working). A separate RPC was rejected: it would need a guard line and wait behind #1857.
5. **Attach only to a captured record-only purchase** (owner question 1). A purchase raised in PMO runs its own money
   path (approval, SoD gates, PMO invoices); attaching ERP-native invoices there is refused
   `ordinary_purchase_requires_decision`, the reason 0866 already uses.

## Controls this change touches (each with its pgTAP proof)

| Control | Where | Changed? | Proof |
|---|---|---|---|
| Active, unbanned Admin only; feature gate `procurement` | `assign_capture_invoices`, `undo_captured_purchase` | row shape / undo branch | `2195_order_family_assignment.test.sql` (AC-015), `2195_order_family_undo.test.sql` |
| Capture fence + reviewed revision + feed caught up | `assign_capture_invoices` (B1) | no | `2195_order_family_assignment.test.sql` (AC-017) |
| One active decision per source (`erp_capture_assignment_active_source_idx`) | 0882 §1 | no | AC-021 race in `2195_order_family_assignment.test.sql` |
| Decision immutability (`guard_capture_assignment_update`) — new columns fixed at insert | 0882 §1 | no (covers new columns by construction) | `2195_order_family_assignment.test.sql` T5 |
| I-2 order and invoices in one purchase; I-3 untagged invoice needs a matching decision | linker 0882 §2b | no | `2195_order_family_ledger.test.sql` (AC-001, AC-006, AC-021) |
| Open commitment `greatest(0, value − held)` | 0858 / 0723 / 0651 | no | `2195_order_family_ledger.test.sql` (AC-001–AC-003, AC-011, AC-012) |
| Ledger-only actuals, voucher anti-join, ERP-tag precedence | `capture_assigned_gl`, `cost_attribution_engine` (0882) | no | `2195_order_family_ledger.test.sql` (AC-002, AC-014, AC-016) |
| Record-only forward-step guard | 0858 `guard_record_only_status` | no | `2195_order_family_ledger.test.sql` T13 |
| Approver ≠ payer on link (FR-PFE-016), `procurement_gate_violation` | linker | no | existing `2195_capture_purchases.test.sql`; re-run |
| Undo refuses later PMO steps incl. queued payment of a captured invoice | `undo_captured_purchase` | yes (loops decisions; attach branch) | `2195_order_family_undo.test.sql` (AC-013) |
| Overhead mark restore / `assignment_mark_changed` | `undo_captured_purchase` | yes (all decisions) | `2195_order_family_undo.test.sql` (AC-011, AC-012) |
| No ERP write / no outbox | everywhere | no | every family test asserts `erp_write = false` and zero `external_command_outbox` rows |

## Files

| Path | Change |
|---|---|
| `supabase/migrations/NNNN_capture_order_family.sql` | new |
| `supabase/migrations/rollback/NNNN_capture_order_family_down.sql` | new |
| `supabase/tests/2195_order_family_assignment.test.sql` | new — shape, family checks, replay, roles, revision, race |
| `supabase/tests/2195_order_family_ledger.test.sql` | new — actuals, commitment, no double count, ERP precedence, mixed tags |
| `supabase/tests/2195_order_family_undo.test.sql` | new — whole-purchase and attachment undo |
| `supabase/tests/2195_b1_undo.test.sql`, `2195_capture_continue_undo.test.sql`, `2195_capture_later.test.sql`, `2195_b1_later.test.sql`, `2195_record_only_journal.test.sql` | re-run only; edit only a literal 3-argument signature if one is asserted |
| `supabase/tests/0137_service_role_grants.test.sql`, `supabase/tests/0178_anon_executable_definers.test.sql` | new function / signature in the lists |
| `scripts/isolation-probe-denominator.json` (line with `undo_captured_purchase(uuid,text,boolean)`), `scripts/isolation-probe.sh` | 4-argument signature, new function |
| `scripts/2195-order-family-rollback.test.sql`, `scripts/test-2195-order-family-rollback.sh` | new (copy of the B1 harness) |
| `.github/workflows/ci.yml` | one step after `scripts/test-2195-b1-rollback.sh` (line 610) |
| `supabase/functions/purchase-capture/index.ts`, `index.test.ts` | `order_source_id` on `unassigned_documents` |
| `scripts/lib/pmo-capture.mjs`, `scripts/pmo-capture.test.mjs`, `scripts/lib/pmo-purchases.mjs`, `scripts/pmo-purchases.test.mjs`, `scripts/pmo.mjs`, `scripts/pmo.test.mjs` | CLI |
| `docs/runbooks/pmo-cli.md`, `docs/glossary.md`, `docs/money-path-primer.md` | docs |

## Tasks (each 2–5 minutes; red → green → commit)

Run every DB command from the repo root under the lock, reset and test in **one** hold:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`. Fixture ids in the new tests use the
prefix `21953001-` (assignment), `21953002-` (ledger), `21953003-` (undo).

### T1 — red: family columns exist (FR-008)
Create `supabase/tests/2195_order_family_assignment.test.sql` with B1's fixture header (copy lines 1–40 of
`supabase/tests/2195_b1_assignment.test.sql`, ids re-prefixed `21953001-`), add an order and two invoices billing it:
```sql
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,erp_docstatus,erp_modified,purchase_orders,currency,net_total) values
 ('21953001-0000-0000-0000-000000000020','21953001-0000-0000-0000-000000000001','Purchase Order','PO-1','A',1,'1','{}','USD',1000),
 ('21953001-0000-0000-0000-000000000021','21953001-0000-0000-0000-000000000001','Purchase Invoice','PI-1','A',1,'1','{PO-1}','USD',600),
 ('21953001-0000-0000-0000-000000000022','21953001-0000-0000-0000-000000000001','Purchase Invoice','PI-2','A',1,'1','{PO-1}','USD',300);
select has_column('public','erp_capture_invoice_assignments','family_request_id','AC-001 a decision names its family request');
select has_column('public','erp_capture_invoice_assignments','family_order_document_id','AC-001 a decision names its family order');
```
Verify red: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_order_family_assignment.test.sql'` → fails on `has_column`.

### T2 — green: columns and index
`supabase/migrations/NNNN_capture_order_family.sql` §1:
```sql
-- NNNN #2277: an active Admin places an ERP order and every invoice that bills it on one PMO project, as one record-only purchase,
-- or attaches the invoices to the captured purchase the order already has. Nothing here writes to the ERP.
-- Rollback: supabase/migrations/rollback/NNNN_capture_order_family_down.sql
alter table public.erp_capture_invoice_assignments
  add column family_request_id uuid,
  add column family_order_document_id uuid references public.erp_purchase_documents(id),
  add constraint erp_capture_invoice_assignments_family_shape
    check ((family_request_id is null) = (family_order_document_id is null) and (family_request_id is null or decision = 'project'));
create index erp_capture_assignment_family_idx
  on public.erp_capture_invoice_assignments (org_id, family_request_id) where family_request_id is not null;
```
`guard_capture_assignment_update` needs no change: it already refuses a change to any column other than the undo
columns, `procurement_id`, `original_classification` and `prior_placement`. Verify green (T1 command).

### T3 — red: row shape refusals (FR-001, FR-002)
Append to the assignment test (as `21953001-…03`, the Admin):
```sql
select is(pg_temp.preview(jsonb_build_object('request_id',gen_random_uuid(),'decision','order_family','source_id','21953001-0000-0000-0000-000000000020',
  'project_id','21953001-0000-0000-0000-000000000005')), '22023:invalid_assignment_row', 'FR-001 a family row needs invoice_ids');
select is(pg_temp.preview(jsonb_build_object('request_id',gen_random_uuid(),'decision','order_family','source_id','21953001-0000-0000-0000-000000000020',
  'project_id','21953001-0000-0000-0000-000000000005','invoice_ids',jsonb_build_array('21953001-0000-0000-0000-000000000021'),'allow_capital_as_overhead',true)),
  '22023:invalid_assignment_row', 'FR-001 no capital override on a family row');
select is(pg_temp.preview(jsonb_build_object('request_id',gen_random_uuid(),'decision','order_family','source_id','21953001-0000-0000-0000-000000000020',
  'project_id','21953001-0000-0000-0000-000000000005','invoice_ids',jsonb_build_array('21953001-0000-0000-0000-000000000021','21953001-0000-0000-0000-000000000021'))),
  '22023:invalid_assignment_row', 'FR-001 invoice ids are distinct');
```
plus one two-row batch where row 2's `source_id` is row 1's invoice → `22023:duplicate_assignment_row` (FR-002). Verify red.

### T4 — green: `assign_capture_invoices` accepts family rows
Replace `assign_capture_invoices` with 0882's body plus these lines, each marked `-- NNNN`:
```sql
       or exists (select 1 from jsonb_object_keys(v_row) k where k not in ('request_id','source_id','decision','project_id','accept_set_aside','allow_capital_as_overhead','invoice_ids'))  -- NNNN
       or v_row->>'decision' not in ('project','set_aside','order_family')                                                                                                     -- NNNN
       or (v_row->>'decision' in ('project','order_family')) is distinct from (coalesce(v_row->>'project_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')  -- NNNN
       or ((v_row->>'decision' = 'order_family') is distinct from (v_row ? 'invoice_ids'))                                                                                    -- NNNN
       or (v_row->>'decision' = 'order_family' and (v_row ? 'allow_capital_as_overhead' or jsonb_typeof(v_row->'invoice_ids') <> 'array'                                     -- NNNN
            or jsonb_array_length(v_row->'invoice_ids') not between 1 and 50                                                                                                    -- NNNN
            or exists (select 1 from jsonb_array_elements(v_row->'invoice_ids') x where jsonb_typeof(x) <> 'string'                                                            -- NNNN
                        or x#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')                                                                       -- NNNN
            or (select count(distinct lower(x#>>'{}')) from jsonb_array_elements(v_row->'invoice_ids') x) <> jsonb_array_length(v_row->'invoice_ids')))                         -- NNNN
```
(the old `decision not in ('project','set_aside')` and `(decision = 'project') is distinct from (…project_id…)` lines are
the two replaced; the down restores them). The normalised row adds
`'invoice_ids', (select coalesce(jsonb_agg(lower(x#>>'{}') order by lower(x#>>'{}')),'[]'::jsonb) from jsonb_array_elements(coalesce(v_row->'invoice_ids','[]'::jsonb)) x)`.
The duplicate check becomes "every id in `source_id ∪ invoice_ids` over all rows is distinct". The batch read passes
`array(select (r->>'source_id')::uuid from … union all select (x#>>'{}')::uuid from …, jsonb_array_elements(r->'invoice_ids') x)`.
The row loop dispatches `case when v_item.r->>'decision' = 'order_family' then public.capture_assignment_family(…) else
public.capture_assignment_row(…) end`, same arguments. Verify green (T3 asserts) and B1 unchanged:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_order_family_assignment.test.sql supabase/tests/2195_b1_assignment.test.sql'`.

### T5 — red: order checks and completeness (FR-003–FR-005, AC-004–AC-007)
Add order fixtures: `PO-Q` tagged with Project Q (`project_ids = '{<Q>}'`), `PO-R` with a submitted return invoice
(`is_return = true`), `PI-X` billing `{PO-1,PO-2}`, and the snapshot/ledger/vendor fixtures of
`2195_b1_assignment.test.sql` round 2 for PI-1/PI-2 (mapped expense rows 600 / 300). Assert, through
`pg_temp.preview_row(p_row) returns jsonb` (the whole first result):
```sql
select is(pg_temp.preview_row(pg_temp.family('PO-1', array['PI-1']))->>'reason','family_incomplete','AC-004 every invoice of the order is named');
select is(pg_temp.preview_row(pg_temp.family('PO-1', array['PI-1']))->'missing_invoice_ids',
          jsonb_build_array('21953001-0000-0000-0000-000000000022'),'AC-004 the missing invoice is returned');
select is(pg_temp.preview_row(pg_temp.family('PO-2', array['PI-X']))->>'reason','family_ambiguous','AC-005 an invoice billing two orders is refused');
select is(pg_temp.preview_row(pg_temp.family('PO-Q', array['PI-Q']))->>'reason','family_project_conflict','AC-006 an order tagged with another project');
select is(pg_temp.preview_row(pg_temp.family('PO-R', array['PI-R']))->>'reason','family_has_return','AC-007 a return invoice in the family');
```
(`pg_temp.family(order_name, invoice_names)` builds the row from the fixture ids for Project P.) Plus the guard-polarity
mutation: in a scratch transaction, `update erp_purchase_documents set purchase_orders = '{}' where erp_name = 'PI-2'`
and assert the AC-004 row now previews `create` — the refusal is bound to the data, not to the row count. Verify red.

### T6 — green: `capture_assignment_family` (order checks, completeness)
New internal function in §3 of the migration:
```sql
create function public.capture_assignment_family(p_org uuid, p_binding uuid, p_actor uuid, p_row jsonb, p_revision text, p_dry_run boolean, p_batch jsonb default null)
returns jsonb language plpgsql set search_path = public, pg_catalog as $$
declare
  v_request uuid := (p_row->>'request_id')::uuid; v_project uuid := (p_row->>'project_id')::uuid;
  v_invoices uuid[] := array(select (x#>>'{}')::uuid from jsonb_array_elements(p_row->'invoice_ids') x order by 1);
  v_order public.erp_purchase_documents%rowtype; v_family uuid[]; v_missing uuid[]; v_extra uuid[];
  v_target uuid; v_target_row public.procurements%rowtype; v_mode text; v_digest text; v_base jsonb; v_reason text;
  v_inv public.erp_purchase_documents%rowtype; v_val jsonb; v_items jsonb := '[]'::jsonb; v_claim jsonb; v_ids uuid[] := '{}';
  v_rows jsonb := '[]'::jsonb; v_result jsonb; v_purchase uuid; v_prior_stage text; v_stage text; v_before numeric; v_after numeric;
begin
  v_digest := encode(extensions.digest(convert_to(jsonb_build_object('decision','order_family','source_id',p_row->>'source_id','project_id',v_project,
    'invoice_ids',to_jsonb(v_invoices),'accept_set_aside',coalesce((p_row->>'accept_set_aside')::boolean,false))::text,'UTF8'),'sha256'),'hex');
  v_base := jsonb_build_object('request_id',v_request,'source_id',(p_row->>'source_id')::uuid,'decision','order_family','erp_write',false);
  -- Replay: a family request is stored on its decisions (or, for a family of tagged invoices only, on its capture row).
  if not p_dry_run then perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':assign:' || v_request::text,0)); end if;
  if exists (select 1 from public.erp_purchase_captures c where c.org_id = p_org and c.request_id = md5(v_request::text || ':family')::uuid) then
    return v_base || (select case when c.payload->>'digest' <> v_digest then jsonb_build_object('outcome','refused','reason','request_conflict')
                                  when c.undone_at is not null then jsonb_build_object('outcome','refused','reason','undone')
                                  else jsonb_build_object('outcome','skip','procurement_id',c.procurement_id) end
                        from public.erp_purchase_captures c where c.org_id = p_org and c.request_id = md5(v_request::text || ':family')::uuid);
  end if;
  select * into v_order from public.erp_purchase_documents where org_id = p_org and id = (p_row->>'source_id')::uuid;
  if not found or not exists (select 1 from public.projects where id = v_project and org_id = p_org) then return v_base || jsonb_build_object('outcome','not_found'); end if;
  -- Lock order (NFR-002): order name, as the linker does, then the documents by id, then the purchase.
  perform public.lock_erp_order_family(p_org, array[v_order.erp_name]);
  perform 1 from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices || v_order.id) order by id for update;
  begin
    if v_order.erp_doctype <> 'Purchase Order' then v_reason := 'source_kind_unsupported';
    elsif v_order.erp_docstatus <> 1 then v_reason := 'document_cancelled';
    elsif public.erp_document_recorded_by_pmo(p_org, v_order.erp_doctype, v_order.erp_name) then v_reason := 'document_recorded_by_pmo';
    elsif cardinality(v_order.project_ids) > 1 then v_reason := 'document_spans_projects';
    elsif cardinality(v_order.project_ids) = 1 and v_order.project_ids[1] <> v_project then v_reason := 'family_project_conflict';
    elsif v_order.currency is null then v_reason := 'currency_unknown';
    elsif exists (select 1 from public.erp_purchase_documents i where i.org_id = p_org and i.erp_doctype = 'Purchase Invoice' and i.erp_docstatus = 1
                   and i.is_return and v_order.erp_name = any(i.purchase_orders)) then v_reason := 'family_has_return';
    end if;
    if v_reason is not null then raise exception using errcode = 'PFE02', message = v_reason; end if;
    select l.procurement_id into v_target from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = v_order.id;
    v_family := array(select i.id from public.erp_purchase_documents i where i.org_id = p_org and i.erp_doctype = 'Purchase Invoice' and i.erp_docstatus = 1
                        and not i.is_return and v_order.erp_name = any(i.purchase_orders)
                        and not exists (select 1 from public.procurement_erp_links l where l.org_id = p_org and l.erp_purchase_document_id = i.id
                                          and l.procurement_id is not distinct from v_target)
                      order by i.id);
    v_missing := array(select unnest(v_family) except select unnest(v_invoices) order by 1);
    v_extra := array(select unnest(v_invoices) except select unnest(v_family) order by 1);
    if cardinality(v_missing) > 0 or cardinality(v_extra) > 0 then
      return v_base || jsonb_build_object('outcome','refused','reason','family_incomplete','missing_invoice_ids',to_jsonb(v_missing),'extra_invoice_ids',to_jsonb(v_extra));
    end if;
    -- … T8 (invoices), T10 (target, claim, link) continue here
  exception when sqlstate 'PFE02' then return v_base || jsonb_build_object('outcome','refused','reason',v_reason);
  end;
end $$;
revoke execute on function public.capture_assignment_family(uuid,uuid,uuid,jsonb,text,boolean,jsonb) from public, anon, authenticated, service_role;
```
An `extra` invoice that is already linked elsewhere stays `family_incomplete` (it is not in the family set); T8 adds
`source_already_linked` for that case before completeness. Verify green (T5).

### T7 — red: B1 invoice checks inside a family (FR-006, AC-008, AC-016)
Fixtures: `PO-C` billed by `PI-C` whose only ledger row is an Asset account; `PO-S` billed by `PI-S` whose ledger
`as_of` is after the latest snapshot; `PO-M` billed by untagged `PI-M1` and `PI-M2` tagged with P. Assert
`capital_spending_not_assignable`, `snapshot_refresh_required`, and that the `PO-M` preview is `create` with
`invoices[*].tagged = [false, true]`. Verify red.

### T8 — green: per-invoice validation
`capture_assignment_validate` gains `p_family_order text default null` (drop the 5-argument function, create the
6-argument one; body is 0882's plus lines marked `-- NNNN`). The one changed line:
```sql
  if cardinality(v_doc.purchase_orders) > 0 and (p_family_order is null or v_doc.purchase_orders <> array[p_family_order]) then  -- NNNN
    return jsonb_build_object('ok',false,'reason',case when p_family_order is null then 'family_incomplete' else 'family_ambiguous' end);  -- NNNN
  end if;  -- NNNN
```
B1's caller passes nothing, so B1 behaviour is identical (B1 tests re-run in T21). In `capture_assignment_family`, after
completeness, loop `v_invoices` in id order:
```sql
    for v_inv in select * from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices) order by id loop
      if v_inv.purchase_orders <> array[v_order.erp_name] then v_reason := 'family_ambiguous'; raise exception using errcode = 'PFE02', message = v_reason; end if;
      if v_inv.supplier is distinct from v_order.supplier then v_reason := 'supplier_mismatch'; raise exception using errcode = 'PFE02', message = v_reason; end if;
      if v_inv.currency is distinct from v_order.currency then v_reason := 'currency_mismatch'; raise exception using errcode = 'PFE02', message = v_reason; end if;
      if cardinality(v_inv.project_ids) = 0 and nullif(btrim(v_inv.erp_project),'') is null then
        v_val := public.capture_assignment_validate(p_org,p_binding,jsonb_build_object('source_id',v_inv.id,'decision','project','project_id',v_project,
                   'accept_set_aside',coalesce((p_row->>'accept_set_aside')::boolean,false)),null,p_batch,v_order.erp_name);
        if not (v_val->>'ok')::boolean then v_reason := v_val->>'reason'; raise exception using errcode = 'PFE02', message = v_reason; end if;
        v_items := v_items || jsonb_build_array(jsonb_build_object('source_id',v_inv.id,'source',v_inv.erp_name,'tagged',false,
                   'mapped_amount',v_val->'mapped_amount','excluded',v_val->'excluded','prior_placement',v_val->'prior_placement','state',v_val->>'state'));
      elsif v_inv.project_ids = array[v_project] then
        v_items := v_items || jsonb_build_array(jsonb_build_object('source_id',v_inv.id,'source',v_inv.erp_name,'tagged',true,'state',
                   case v_inv.erp_status when 'Paid' then 'paid' when 'Partly Paid' then 'part_paid' else 'invoiced' end));
      else v_reason := 'family_project_conflict'; raise exception using errcode = 'PFE02', message = v_reason;
      end if;
    end loop;
```
The supplier must resolve to exactly one PMO vendor: B1's validate checks it for untagged invoices; for the order,
reuse the same `external_refs` count as 0882 line 470 (`supplier_unknown`). Verify green (T7) and T5.

### T9 — red: create, ledger and commitment (AC-001, AC-002, AC-010)
Create `supabase/tests/2195_order_family_ledger.test.sql` from `supabase/tests/2195_b1_ledger.test.sql`'s fixture block
(ids re-prefixed `21953002-`): PO-1 1000.00 untagged, PI-1 net 600.00 billing PO-1, its ledger row 600.00 on a mapped
Cost account, a rule sending untagged Cost to Project C. Assert:
```sql
select is((pg_temp.apply(pg_temp.family('PO-1', array['PI-1'])))->>'outcome','create','AC-001 one purchase is created');
select is((select count(distinct l.procurement_id)::int from procurement_erp_links l join erp_purchase_documents d on d.id = l.erp_purchase_document_id
            where d.erp_name in ('PO-1','PI-1')), 1, 'AC-001 the order and its invoice sit in one purchase');
select is(pg_temp.mapped(:'P') - pg_temp.mapped_before(:'P'), 600.00::numeric, 'AC-001 P gains the invoice ledger cost');
select is((select c.amount from procurement_open_commitments(array[pg_temp.purchase('PO-1')]) c), 400.00::numeric, 'AC-001 P keeps 400.00 open');
select is(pg_temp.mapped(:'C') - pg_temp.mapped_before(:'C'), -600.00::numeric, 'AC-002 the rule project loses it');
select is(pg_temp.org_mapped() - pg_temp.org_mapped_before(), 0::numeric, 'AC-002 organization actuals unchanged');
select is((select count(*)::int from external_command_outbox where org_id = :'org'), 0, 'AC-001 nothing queued for the ERP');
```
(`pg_temp.mapped(project)` = `sum(amount)` of `cost_attribution_project_actuals(project, null)` as Admin; the readers'
`procurement_open_commitments(uuid[])` returns `(procurement_id, amount)`, `supabase/migrations/0723_procurement_open_commitments_set_based.sql:13`.)
AC-010: the preview result has `outcome = 'create'`, `procurement_id` null, `commitment_before = '0.00'`,
`commitment_after = '400.00'`, and afterwards `count(*)` of decisions, links, procurements and captures for the org are
all unchanged. Verify red.

### T10 — green: claim, link, stage, audit (FR-008–FR-013)
`capture_assignment_claim` accepts two optional normalised keys, each line marked `-- NNNN`:
`family_request_id`, `family_order_document_id` (inserted into the new columns) and `payload_digest` taken from
`p_row->>'family_digest'` when present. In `capture_assignment_family`, after T8's loop:
```sql
    if v_target is not null then
      select * into v_target_row from public.procurements where id = v_target and org_id = p_org for update;
      if not v_target_row.record_only then v_reason := 'ordinary_purchase_requires_decision';
      elsif v_target_row.status::text in ('Cancelled','Rejected') or v_target_row.project_id is distinct from v_project
         or v_target_row.currency is distinct from v_order.currency
         or not exists (select 1 from public.erp_purchase_captures c where c.org_id = p_org and c.procurement_id = v_target and c.undone_at is null and c.kind in ('order','supplier_invoice'))
         or exists (select 1 from public.erp_purchase_captures c where c.org_id = p_org and c.procurement_id = v_target and c.kind = 'journal') then v_reason := 'family_conflict';
      end if;
      if v_reason is not null then raise exception using errcode = 'PFE02', message = v_reason; end if;
      v_mode := 'attach'; v_prior_stage := v_target_row.record_only_stage;
      select coalesce(c.amount,0) into v_before from public.procurement_open_commitments(array[v_target]) c;
    else v_mode := 'create'; v_before := 0;
    end if;
    -- Decisions first: the linker's I-3 exception admits an untagged invoice only with an active placement on the purchase's project.
    for v_inv in select * from public.erp_purchase_documents where org_id = p_org and id = any(v_invoices) and cardinality(project_ids) = 0 order by id loop
      v_claim := public.capture_assignment_claim(p_org,p_binding,p_actor,jsonb_build_object('request_id',md5(v_request::text || ':' || v_inv.id::text)::uuid,
                   'source_id',v_inv.id,'decision','project','project_id',v_project,'accept_set_aside',coalesce((p_row->>'accept_set_aside')::boolean,false),
                   'family_request_id',v_request,'family_order_document_id',v_order.id,'family_digest',v_digest),p_revision,false);
      if v_claim->>'outcome' <> 'recorded' then v_reason := coalesce(v_claim->>'reason','source_already_decided'); raise exception using errcode = 'PFE02', message = v_reason; end if;
      v_ids := v_ids || (v_claim->>'decision_id')::uuid;
    end loop;
    v_rows := case when v_mode = 'create' then jsonb_build_array(jsonb_build_object('erp_name',v_order.erp_name,'erp_doctype','Purchase Order','project_id',v_project,'group',v_request::text)) else '[]'::jsonb end
           || coalesce((select jsonb_agg(jsonb_build_object('erp_name',d.erp_name,'erp_doctype','Purchase Invoice','project_id',v_project,'group',v_request::text)
                         || case when v_mode = 'attach' then jsonb_build_object('procurement_id',v_target) else '{}'::jsonb end order by d.id)
                         from public.erp_purchase_documents d where d.org_id = p_org and d.id = any(v_invoices)),'[]'::jsonb);
    v_result := public.link_erp_purchase_documents(v_rows,false);
    if coalesce((v_result#>>'{counts,link}')::integer,0) <> jsonb_array_length(v_rows) then
      v_reason := coalesce((select r->>'reason' from jsonb_array_elements(v_result->'results') r where r->>'outcome' <> 'link' limit 1),'family_requires_decision');
      raise exception using errcode = 'PFE02', message = v_reason;
    end if;
    v_purchase := coalesce(v_target,(v_result#>>'{results,0,procurement_id}')::uuid);
    select case when bool_and(d.erp_status = 'Paid') then 'paid' when bool_or(d.erp_status in ('Paid','Partly Paid')) then 'part_paid' else 'invoiced' end into v_stage
      from public.procurement_erp_links l join public.erp_purchase_documents d on d.id = l.erp_purchase_document_id
     where l.org_id = p_org and l.procurement_id = v_purchase and d.erp_doctype = 'Purchase Invoice' and d.erp_docstatus = 1;   -- FR-011
    update public.procurements set record_only = true, record_only_stage = v_stage, record_only_reference = v_order.erp_name where id = v_purchase and org_id = p_org;
    insert into public.erp_purchase_captures(org_id,binding_id,request_id,procurement_id,payload,kind,stage,captured_by)
      values (p_org,p_binding,md5(v_request::text || ':family')::uuid,v_purchase,
        jsonb_build_object('project_id',v_project,'source_ids',to_jsonb(case when v_mode = 'create' then v_order.id || v_invoices else v_invoices end),
          'family_request_id',v_request,'decision_ids',to_jsonb(v_ids),'mode',v_mode,'prior_stage',v_prior_stage,'digest',v_digest,'assignment_origin','pmo_assignment'),
        'supplier_invoice',v_stage,p_actor);
    update public.erp_capture_invoice_assignments a set procurement_id = v_purchase,
           original_classification = (select i->>'classification' from jsonb_array_elements(v_items) i where (i->>'source_id')::uuid = a.source_document_id),
           prior_placement = (select i->'prior_placement' from jsonb_array_elements(v_items) i where (i->>'source_id')::uuid = a.source_document_id)
     where a.id = any(v_ids);
    select coalesce(c.amount,0) into v_after from public.procurement_open_commitments(array[v_purchase]) c;
    perform public.log_audit(case v_mode when 'create' then 'procurement.record_only_create' else 'procurement.erp_family_attach' end,p_org,p_actor,v_purchase,
      jsonb_build_object('project_id',v_project,'family',true,'order_id',v_order.id,'invoices',v_items,'decision_ids',to_jsonb(v_ids),
        'commitment_before',v_before,'commitment_after',v_after,'assignment_origin','pmo_assignment','erp_write',false));
    if p_dry_run then raise exception using errcode = 'PFE01', message = 'dry run'; end if;
```
and the handler gains `when sqlstate 'PFE01' then v_purchase := case when v_mode = 'attach' then v_target end;`, then
returns `v_base || jsonb_build_object('outcome',v_mode,'procurement_id',v_purchase,'would_create',p_dry_run and v_mode = 'create',
'invoices',v_items,'commitment_before',v_before::text,'commitment_after',v_after::text,'decision_ids',case when p_dry_run then '[]'::jsonb else to_jsonb(v_ids) end)`.
(`v_items` also needs `'classification', v_val->>'classification'` from T8.) The preview runs the whole write in record
mode and rolls it back, as B1 does, so `v_after` is the real reader's figure. Verify green (T9 and T5/T7).

### T11 — red→green: attach (AC-003, AC-006 attach branch)
Ledger test: capture PO-1 alone as record-only purchase W through the fixture path B1's tests use for captured orders
(insert `procurements` record-only + `procurement_erp_links` + `erp_purchase_captures kind 'order'` as owner), then apply
the family with PI-1. Assert `outcome = 'attach'`, `procurement_id = W`, W's open commitment 1000.00 → 400.00, stage
`invoiced`, no new `procurements` row. Then a W' raised in PMO (`record_only = false`) → `ordinary_purchase_requires_decision`;
a W'' on Project Q → `family_conflict`. Green by T10. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_order_family_ledger.test.sql'`.

### T12 — red→green: mixed tags and ERP precedence (AC-014, AC-016)
Ledger test: PO-M with PI-M1 untagged (ledger 200) and PI-M2 tagged P (ledger 100, in the snapshot). After apply: one
decision (PI-M1) only, P's actuals rise by 200.00 exactly. Then tag PI-M1's ledger rows with P's ERP project and refresh
the snapshot fixture: P's actuals unchanged; tag them with Q's instead: `purchase_capture_assignment_report()` row for
PI-M1 has `tagged_in_erp = true`, `erp_project_id = Q`. Green by B1's unchanged precedence.

### T13 — red→green: record-only guard holds (MC-6)
Ledger test: on the created purchase, a forward status change and a `purchase_orders` insert raise
`record_only_forward_step_refused` (0858 guard). No code change expected; if red, stop and report — the guard is not this
slice's to change.

### T14 — red→green: replay, roles, revision, race (AC-009, AC-015, AC-017, AC-021)
Assignment test: resend AC-001's request → `skip`; same `request_id` with `PI-2` added → `request_conflict`. As Finance,
Project Manager and Executive (`set local role authenticated` + claims, B1's helper) → `42501`. Another org's order or
project → `not_found`. Apply with a stale revision → `complete = false`, `reason = 'source_stale'`. Race: copy B1's
dblink section (`2195_b1_assignment.test.sql`, the "race" block): two sessions apply a family for the same committed
PO-1/PI-1; assert exactly one `create`, the other `source_already_decided` or `family_conflict`, and one purchase linked
to PO-1. Green by T10 (unique active-source index, I-2).

### T15 — red: undo (AC-011–AC-013)
Create `supabase/tests/2195_order_family_undo.test.sql` (ids `21953003-`), fixtures as T9/T11. Assert:
```sql
select is((public.undo_captured_purchase(pg_temp.purchase('PO-1'),'wrong project',false))->>'outcome','undo','AC-011 the whole purchase is undone');
select is((select count(*)::int from erp_capture_invoice_assignments where family_request_id = :'req' and undone_at is null),0,'AC-011 every decision is undone');
select is((public.undo_captured_purchase(pg_temp.purchase('PO-1'),'again',false))->>'reason','already_undone','AC-011 a second undo is a skip');
select is((public.undo_captured_purchase(:'W','wrong invoice',false,:'attach_req'))->>'outcome','undo','AC-012 one attachment is undone');
select is((select record_only_stage from procurements where id = :'W'),'ordered','AC-012 the stage before the attachment is back');
select is((select status::text||'/'||(vendor_invoiced_at is null)::text from procurements where id = :'W'),'Ordered/true','AC-012 the status before the attachment is back');
select throws_ok(format($$select public.undo_captured_purchase(%L,'x',false)$$, pg_temp.purchase('PO-P')),'55000','has_later_pmo_steps','AC-013 a queued payment blocks undo');
```
plus W's open commitment back to 1000.00, P's actuals back, the mark of a set-aside PI restored, and a changed mark →
`assignment_mark_changed`. Attaching links an invoice, which moves W's status to Vendor Invoiced; so with no invoice left
the undo restores stage, status and vendor-invoiced date from W's **earliest** attachment capture row (two attachments
undone first-to-last must still end Ordered with no date), lowering `record_only` for the change as the capture's attach
does. Verify red (the 4-argument call does not exist).

### T16 — green: `undo_captured_purchase` (FR-015–FR-017)
`drop function public.undo_captured_purchase(uuid,text,boolean);` then create
`undo_captured_purchase(p_procurement_id uuid, p_reason text, p_dry_run boolean default false, p_attach_request_id uuid default null)`
with 0896's body (#2259) plus lines marked `-- NNNN`:
- kind lookup stays 0896's ordered read (`order by captured_at, request_id limit 1`: the first capture decides); a family
  purchase's first capture is its order or original invoice, and a journal purchase takes no family invoices (`family_conflict`);
- the decision lookup becomes a loop over `select * from erp_capture_invoice_assignments where org_id = v_org and
  procurement_id = p_procurement_id and decision = 'project' and undone_at is null and (p_attach_request_id is null or
  family_request_id = p_attach_request_id) order by source_document_id for update`; every mark is checked before any is
  restored (all-or-nothing), and `v_before` sums every decision's placement;
- `p_attach_request_id` not null: require an active capture row `request_id = md5(p_attach_request_id::text || ':family')::uuid`
  with `payload->>'mode' = 'attach'` on the purchase (else `raise 'attachment_not_found' using errcode = 'P0002'`; undone
  → return `skip`/`already_undone`); run the same later-step checks; then delete only the links of
  `payload->'source_ids'`, undo those decisions, set that capture row undone, restore
  `record_only_stage = payload->>'prior_stage'`, keep the purchase's status, and audit `procurement.erp_family_attach_undo`
  with `placement_before`, `placement_after` and `commitment_after`;
- `grant execute … to authenticated` and `revoke … from public, anon` on the new signature, as 0882.
Verify green (T15) and the existing undo suites:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_order_family_undo.test.sql supabase/tests/2195_b1_undo.test.sql supabase/tests/2195_capture_continue_undo.test.sql supabase/tests/2195_capture_later.test.sql supabase/tests/2195_b1_later.test.sql supabase/tests/2195_record_only_journal.test.sql'`.
Mutation check (security-critical): comment out the later-step `raise` and confirm AC-013 goes red; restore.

### T17 — red→green: report (FR-018)
Replace `purchase_capture_assignment_report` with 0882's body plus `'family_request_id', a.family_request_id,
'family_order_id', a.family_order_document_id` (marked `-- NNNN`). Assert both keys on a family decision and null on a
B1 decision in the ledger test.

### T18 — grants, guard lists, isolation probe (FR-019)
Update `supabase/tests/0137_service_role_grants.test.sql` (new internal function revoked from `service_role`),
`supabase/tests/0178_anon_executable_definers.test.sql` (unchanged name; confirm), `scripts/isolation-probe-denominator.json`
(`undo_captured_purchase(uuid,text,boolean,uuid)`) and `scripts/isolation-probe.sh` (the new internal function). Assert in
the assignment test that `api_client_request_guard`'s body is byte-identical to 0882's:
`select is(md5(pg_get_functiondef('public.api_client_request_guard()'::regprocedure)), :'guard_md5_0882', 'no guard change')`
with the md5 taken from a reset at 0882 in T19's harness. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0137_service_role_grants.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/api_client_request_guard.test.sql' && bash scripts/isolation-probe.sh`.

### T19 — rollback (AC-020, NFR-003)
`supabase/migrations/rollback/NNNN_capture_order_family_down.sql`: refuse with `raise exception 'family_history_exists'`
when any decision has `family_request_id`; drop `capture_assignment_family`, the 4-argument undo and the 6-argument
validate; restore 0882's `assign_capture_invoices`, `capture_assignment_claim`, `capture_assignment_validate` and
`purchase_capture_assignment_report`, and 0896's `undo_captured_purchase` (3-argument, with its grants), verbatim; drop the index,
constraint and columns. Copy `scripts/test-2195-b1-rollback.sh` → `scripts/test-2195-order-family-rollback.sh` and
`scripts/2195-b1-rollback.test.sql` → `scripts/2195-order-family-rollback.test.sql`, with the static list
of each replaced function and its previous body (`0896_undo_capture_kind_order.sql` for `undo_captured_purchase`,
`0882_capture_invoice_assignment.sql` for the others). Add after
`.github/workflows/ci.yml:610`:
```yaml
      - name: 2277 order-family rollback proof
        run: scripts/with-db-lock.sh scripts/test-2195-order-family-rollback.sh
```
Verify: `scripts/with-db-lock.sh scripts/test-2195-order-family-rollback.sh`.

### T20 — red→green: route `order_source_id` (AC-019)
`supabase/functions/purchase-capture/index.test.ts`: a census with order `PO-1` and untagged invoice `PI-1` billing it →
`unassigned_documents[0].order_source_id` is PO-1's id; an invoice billing two orders → `null`. In `index.ts`, the
`unassignedDocuments` map (line 230) adds
`order_source_id: sources.find(other => other.kind === 'order' && other.family === source.family && source.family?.startsWith('order:'))?.id ?? null`
— confirm the field name against `pmo-portal/src/lib/adapterSeam/erpnext/captureHistory.ts:86` first; if the source row
does not carry `family`, add it there with a contract test in `captureHistory.contract.test.ts`. An `assign` call with a
family row passes `rows` through unchanged (assert the RPC argument). Verify:
`cd supabase/functions/purchase-capture && deno test --allow-env --allow-net index.test.ts`.

### T21 — red→green: CLI (AC-018, FR-020)
`scripts/pmo-capture.test.mjs`: `assignmentProblems` refuses a family row without `invoice_ids`, with 51 ids, a repeated
id, or `allow_capital_as_overhead`; a valid preview prints
`PO-1 → <project>: create, PI-1 600.00 (pmo_assignment), commitment 0.00 → 400.00, erp_write: false` and the exact
`--apply --revision <r>` command; an attach prints `to undo: … undo-record-only <purchase> --attach <request> --reason "<why>"`.
`scripts/pmo-purchases.test.mjs` / `scripts/pmo.test.mjs`: `undo-record-only <uuid> --attach <uuid> --reason x` sends
`{ p_procurement_id, p_reason, p_dry_run, p_attach_request_id }`; a non-UUID `--attach` is a usage error. Implement in
`scripts/lib/pmo-capture.mjs` (`assignmentProblems`, the line printer near line 97), `scripts/lib/pmo-purchases.mjs:351`
and `scripts/pmo.mjs:820` / `:1516`. Verify: `cd pmo-portal && npx vitest run ../scripts/pmo-capture.test.mjs ../scripts/pmo-purchases.test.mjs ../scripts/pmo.test.mjs`
(use the same runner the B1 PR used for these files, `git show 78ff44236 --stat`).

### T22 — docs
`docs/runbooks/pmo-cli.md`: in the assignment section replace the `family_incomplete` sentence (it names #2277) with the
family recipe (find `order_source_id` in `capture-report`, list every invoice, preview, apply, undo one attachment);
add the new reasons. `docs/glossary.md`: the three terms of the spec. `docs/money-path-primer.md`: one line under the
capture map — "an order family is one purchase; untagged invoices are B1 decisions on it; commitment comes from the
canonical readers".

### T23 — local final gate
```
npm run check:guards && npm run typecheck
npx eslint --max-warnings=0 scripts/lib/pmo-capture.mjs scripts/lib/pmo-purchases.mjs scripts/pmo.mjs supabase/functions/purchase-capture/index.ts
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/2195_order_family_assignment.test.sql supabase/tests/2195_order_family_ledger.test.sql supabase/tests/2195_order_family_undo.test.sql supabase/tests/2195_b1_assignment.test.sql supabase/tests/2195_b1_ledger.test.sql supabase/tests/2195_b1_undo.test.sql supabase/tests/2195_b1_later.test.sql supabase/tests/2195_b1_performance.test.sql supabase/tests/2195_capture_purchases.test.sql supabase/tests/2195_capture_continue_undo.test.sql supabase/tests/2195_capture_later.test.sql supabase/tests/2195_record_only_journal.test.sql supabase/tests/0137_service_role_grants.test.sql supabase/tests/api_client_request_guard.test.sql'
scripts/with-db-lock.sh scripts/test-2195-order-family-rollback.sh && scripts/with-db-lock.sh scripts/test-2195-b1-rollback.sh
```
Node's default heap; no `NODE_OPTIONS`. Paste each command's output body (not its exit code) into the PR.

## Traceability (AC → owning test, ADR-0010)

| AC | Layer | Owning test |
|---|---|---|
| AC-001 | pgTAP | `supabase/tests/2195_order_family_ledger.test.sql` |
| AC-002 | pgTAP | `2195_order_family_ledger.test.sql` |
| AC-003 | pgTAP | `2195_order_family_ledger.test.sql` |
| AC-004 | pgTAP | `supabase/tests/2195_order_family_assignment.test.sql` |
| AC-005 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-006 | pgTAP | `2195_order_family_assignment.test.sql` (tag) · `2195_order_family_ledger.test.sql` (attach targets) |
| AC-007 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-008 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-009 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-010 | pgTAP | `2195_order_family_ledger.test.sql` |
| AC-011 | pgTAP | `supabase/tests/2195_order_family_undo.test.sql` |
| AC-012 | pgTAP | `2195_order_family_undo.test.sql` |
| AC-013 | pgTAP | `2195_order_family_undo.test.sql` |
| AC-014 | pgTAP | `2195_order_family_ledger.test.sql` |
| AC-015 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-016 | pgTAP | `2195_order_family_ledger.test.sql` |
| AC-017 | pgTAP | `2195_order_family_assignment.test.sql` |
| AC-018 | Unit (Vitest) | `scripts/pmo-capture.test.mjs` (preview/apply output) · `scripts/pmo-purchases.test.mjs` (`--attach`) |
| AC-019 | Unit (Deno) | `supabase/functions/purchase-capture/index.test.ts` |
| AC-020 | Script (CI step) | `scripts/test-2195-order-family-rollback.sh` |
| AC-021 | pgTAP | `2195_order_family_assignment.test.sql` (dblink race) |

No e2e: there is no screen in this slice (the screen is the later #2195 screen slice).

## Risks

- **B2 overlap.** Both slices replace `assign_capture_invoices`, `capture_assignment_claim` and `capture_assignment_validate`;
  the second to land rebases and keeps both sets of marked lines, and its rollback harness compares against the first's
  bodies, not 0882's.
- **Face versus ledger.** Commitment subtracts each linked invoice's net total (face); actuals count mapped ledger rows.
  Excluded capital lines therefore reduce commitment but add no actuals — the existing canonical behaviour for tagged
  families, stated in the preview's `excluded`, not changed here.
- **A tag the ERP adds to the order later.** The order's ERP tag is not re-checked after placement; the report's
  per-decision `tagged_in_erp` covers the invoices, and the order's tag shows through the existing link census. A later
  slice may add an order-level flag if the owner wants one.
- **Signature change.** Dropping the 3-argument undo touches every list that names its signature; T18 and T23 run them.

## Owner questions (recommended answer first)

1. Attach invoices to a purchase raised in PMO, not captured? **Recommend no** — refuse `ordinary_purchase_requires_decision`.
2. Undo one attachment on its own? **Recommend yes** — `undo-record-only <purchase> --attach <request>`.
3. Include an invoice of the order that the ERP already tags with the same project? **Recommend yes**, linked with no PMO decision.
