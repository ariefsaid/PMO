# Plan — vendor withholding (PPh 23 / PPh 4(2)) on ERPNext-owned procurement (#876)

- **Spec:** `docs/specs/vendor-withholding.spec.md` (amends `erpnext-adapter.spec.md` FR-ENA-115/116; retires AC-520-11)
- **ADR:** `docs/adr/0082-vendor-withholding-gross-amount-and-withheld-column.md`
- **Decisions:** DD-VWH-1..9 (spec §2; appended to `docs/decisions.md` by Task 21)
- **Lane:** money path → **Director-dispatched** (not the ADW). Builder model: opus for Tasks 5–12, sonnet for 13–19.
- **Migration slot:** `0266` only (+ `supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql`).
- **Worktree:** `$WT` = the issue worktree the Director creates off `origin/dev`. Agents run no git.

## 1. Design in one screen

```
ERPNext Purchase Invoice header                         procurement_invoices (PMO mirror)
  grand_total            1,090,000  (net payable)  ──┐   amount           1,110,000  = grand_total + deducted (gross)
  total_taxes_and_charges   90,000  (VAT − PPh)    ──┼─► tax_amount         110,000  = total_taxes + deducted (VAT)
  taxes_and_charges_deducted 20,000 (PPh)          ──┼─► withheld_amount     20,000  (NEW, 0266)
  outstanding_amount     1,090,000 → 0 after PE    ──┘   erp_outstanding_amount, status (Paid when 0)
                                                         net payable shown = amount − withheld_amount
```

- **Outbound** (`erpPurchaseTaxRows.ts`): Deduct rows are sent when well-formed; malformed withholding is refused
  before any ERP write (DD-VWH-4). One `Account` read per Deduct row, create only.
- **Mirror** (`piFromDoc` → `upsertInvoiceMirror`): integer-cents derivation from the header; byte-identical when
  nothing is deducted (DD-VWH-2).
- **Feed** (`erpnextFeedDeps.updateMirror`): a PI change carrying the whole money header refreshes money + status —
  this is how a bill reaches Paid after a payment (DD-VWH-5, FR-ENA-116 built).
- **Cost** never reads `procurement_invoices` (actuals = GL mirror by mapped expense account) — proven on the bench GL
  in AC-VWH-005 (DD-VWH-8).
- **Display** (`ProcurementLedger` amount cell): VAT · Tax withheld (PPh) · Net payable under a withholding bill
  (DD-VWH-6). Nothing changes for other rows.
- **Sales symmetry**: `resolveSalesTaxRows` refuses a negative rate (DD-VWH-9).

Scaling: no new queries on any read path; the sweep reuses its existing per-doc update (one extra header field in the
list request); the outbound create adds ≤ (number of Deduct rows) GETs, never on replay.

## 2. Files

| File | Change |
|---|---|
| `supabase/migrations/0266_vendor_invoice_withholding.sql` | NEW — column, bounds, mirror-guard line, on-database grant assert |
| `supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql` | NEW — reverse |
| `supabase/tests/0266_vendor_withholding.test.sql` | NEW — AC-VWH-008/009 |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated (never hand-edited) |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts` | `piFromDoc` derivation + field list |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` | AC-VWH-004 |
| `pmo-portal/src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts` | accept well-formed Deduct rows, refuse malformed |
| `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts` | AC-VWH-001..003; AC-520-11 test retired |
| `supabase/functions/adapter-dispatch/readModelWriters.ts` | writer states `withheld_amount` |
| `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` | AC-VWH-006 |
| `supabase/functions/_shared/erpnextFeedDeps.ts` | `purchaseInvoiceFieldPatch` |
| `supabase/functions/_shared/erpnextFeedDeps.test.ts` | AC-VWH-007 |
| `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.ts` | negative-rate refusal |
| `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts` | NEW — AC-VWH-013 |
| `pmo-portal/src/lib/vendorWithholding.ts` + `.test.ts` | NEW — AC-VWH-010 |
| `pmo-portal/src/lib/db/procurementLedger.ts` + `.test.ts` | Invoice row carries VAT + withheld — AC-VWH-011 |
| `pmo-portal/pages/procurement/vendorInvoiceTestIds.ts` | `VI_WITHHOLDING_TEST_IDS` |
| `pmo-portal/pages/procurement/WithholdingBreakdown.tsx` | NEW |
| `pmo-portal/pages/procurement/ProcurementLedger.tsx` + `.test.tsx` | amount cell — AC-VWH-012 |
| `pmo-portal/public/locales/{en,id}/common.json` | `procurementDetail.withholding.*` |
| `pmo-portal/e2e/serial/AC-VWH-005-vendor-withholding.spec.ts` | NEW — AC-VWH-005 |
| `scripts/check-e2e-skips.mjs` | allowlist entry for AC-VWH-005 |
| `docs/reviews/2026-10-07-vendor-withholding-erp-spike.md` | NEW — Task 0 evidence |

## 3. Traceability

| AC | Owning test (layer) | Tasks |
|---|---|---|
| AC-VWH-001/002/003 | `purchaseInvoiceTaxTemplate.test.ts` (Vitest) | 7, 8 |
| AC-VWH-004 | `bodies/bodies.test.ts` (Vitest) | 5, 6 |
| AC-VWH-005 | `e2e/serial/AC-VWH-005-vendor-withholding.spec.ts` (served e2e, bench) | 0, 19 |
| AC-VWH-006 | `readModelWriters.money.test.ts` (Deno) | 9, 10 |
| AC-VWH-007 | `_shared/erpnextFeedDeps.test.ts` (Deno) | 11, 12 |
| AC-VWH-008/009 | `supabase/tests/0266_vendor_withholding.test.sql` (pgTAP) | 1, 2 |
| AC-VWH-010 | `src/lib/vendorWithholding.test.ts` (Vitest) | 15 |
| AC-VWH-011 | `src/lib/db/procurementLedger.test.ts` (Vitest) | 16 |
| AC-VWH-012 | `pages/procurement/ProcurementLedger.test.tsx` (RTL) | 17, 18 |
| AC-VWH-013 | `erpSalesTaxRows.test.ts` (Vitest) | 13, 14 |

---

## Task 0 — Bench spike: confirm ERPNext's withholding arithmetic (GATE, ~5 min)

Writes only `docs/reviews/2026-10-07-vendor-withholding-erp-spike.md`. Run with the bench credentials exported in the
shell (never printed, never committed), under the ERPNext lock.

```bash
cd "$WT" && scripts/with-erpnext-lock.sh bash -c '
B=http://localhost:8080
H=(-H "Authorization: token ${ERPNEXT_BENCH_API_KEY}:${ERPNEXT_BENCH_API_SECRET}" -H "Content-Type: application/json")
ROWS='"'"'[{"charge_type":"On Net Total","account_head":"Spike PPN Masukan - PSC","description":"PPN 11%","rate":11,"category":"Total","add_deduct_tax":"Add"},{"charge_type":"On Net Total","account_head":"Spike PPh 23 Payable - PSC","description":"PPh 23 2%","rate":2,"category":"Total","add_deduct_tax":"Deduct"}]'"'"'
echo "S1 parent"; curl -s "${H[@]}" "$B/api/resource/Account/Duties%20and%20Taxes%20-%20PSC" | jq ".data | {name,is_group,root_type}"
for A in "Spike PPN Masukan" "Spike PPh 23 Payable"; do
  curl -s "${H[@]}" -X POST "$B/api/resource/Account" -d "$(jq -n --arg n "$A" "{account_name:\$n,parent_account:\"Duties and Taxes - PSC\",company:\"PMO Smoke Co\",account_type:\"Tax\",is_group:0}")" | jq -r ".data.name // .exc_type"
done
echo "S2 template"; curl -s "${H[@]}" -X POST "$B/api/resource/Purchase%20Taxes%20and%20Charges%20Template" \
  -d "$(jq -n --argjson r "$ROWS" "{title:\"Spike PPN11 PPh23\",company:\"PMO Smoke Co\",taxes:\$r}")" | jq -r ".data.name // .exc_type"
mkpi() { curl -s "${H[@]}" -X POST "$B/api/resource/Purchase%20Invoice" -d "$(jq -n --argjson r "$ROWS" "{supplier:\"Spike Supplier\",company:\"PMO Smoke Co\",items:[{item_code:\"SPIKE-ITEM-1\",qty:1,rate:1000000}],taxes_and_charges:\"Spike PPN11 PPh23 - PSC\",taxes:\$r}")" | jq -r .data.name; }
PI=$(mkpi); curl -s "${H[@]}" -X PUT "$B/api/resource/Purchase%20Invoice/$PI" -d "{\"docstatus\":1}" >/dev/null
echo "S3 header"; curl -s "${H[@]}" "$B/api/resource/Purchase%20Invoice/$PI" | jq ".data | {name,currency,net_total,taxes_and_charges_added,taxes_and_charges_deducted,total_taxes_and_charges,grand_total,rounded_total,outstanding_amount,modified}"
M0=$(curl -s "${H[@]}" "$B/api/resource/Purchase%20Invoice/$PI" | jq -r .data.modified)
echo "S4 list"; curl -s "${H[@]}" -G "$B/api/resource/Purchase%20Invoice" --data-urlencode "filters=[[\"name\",\"=\",\"$PI\"]]" --data-urlencode "fields=[\"name\",\"grand_total\",\"total_taxes_and_charges\",\"taxes_and_charges_deducted\",\"outstanding_amount\"]" | jq .data
echo "S5 GL"; curl -s "${H[@]}" -G "$B/api/resource/GL%20Entry" --data-urlencode "filters=[[\"voucher_no\",\"=\",\"$PI\"],[\"is_cancelled\",\"=\",0]]" --data-urlencode "fields=[\"account\",\"debit\",\"credit\"]" | jq .data
pe() { curl -s "${H[@]}" -X POST "$B/api/resource/Payment%20Entry" -d "$(jq -n --arg pi "$1" --argjson amt "$2" "{payment_type:\"Pay\",party_type:\"Supplier\",party:\"Spike Supplier\",company:\"PMO Smoke Co\",paid_amount:\$amt,received_amount:\$amt,paid_from:\"Cash - PSC\",paid_to:\"Creditors - PSC\",references:[{reference_doctype:\"Purchase Invoice\",reference_name:\$pi,allocated_amount:\$amt}]}")"; }
PE=$(pe "$PI" 1090000 | jq -r .data.name); curl -s "${H[@]}" -X PUT "$B/api/resource/Payment%20Entry/$PE" -d "{\"docstatus\":1}" >/dev/null
echo "S6 after net payment"; curl -s "${H[@]}" "$B/api/resource/Purchase%20Invoice/$PI" | jq --arg m0 "$M0" ".data | {status,outstanding_amount,modified,modified_changed:(.modified != \$m0)}"
PI2=$(mkpi); curl -s "${H[@]}" -X PUT "$B/api/resource/Purchase%20Invoice/$PI2" -d "{\"docstatus\":1}" >/dev/null
echo "S7 gross payment"; pe "$PI2" 1110000 | jq "{name: .data.name, exc_type, _server_messages}"
echo "S8 version"; curl -s "${H[@]}" "$B/api/method/frappe.utils.change_log.get_versions" | jq .message.erpnext.version
'
```

Record in `docs/reviews/2026-10-07-vendor-withholding-erp-spike.md` a table *Step · Expected · Observed* with:
S1 `is_group 1, root_type Liability` · S3 `currency IDR, net_total 1000000, added 110000, deducted 20000, total_taxes
90000, grand_total 1090000, outstanding 1090000` · S4 the list response includes `taxes_and_charges_deducted: 20000` ·
S5 debits: `Spike PPN Masukan - PSC 110000` + item account `1000000`; credits: `Creditors - PSC 1090000`,
`Spike PPh 23 Payable - PSC 20000` · S6 `status Paid, outstanding 0, modified_changed true` · S7 refused (allocation
above outstanding) · S8 the bench ERPNext version.

**Gate:** if S3, S4 or S5 differ from Expected → STOP, report to the Director (the mapper arithmetic is wrong). If S6
shows `modified_changed false` → STOP: the feed refresh (Tasks 11–12) cannot observe payment; ADR-0082's fallback
(payment finalize re-reads the referenced bill) replaces those tasks. If S7 is accepted → note it; DD-VWH-3's "paying
the gross is refused" becomes untrue and the Director rules.

---

## Task 1 — pgTAP, red: schema, bounds, privileges, guard (AC-VWH-008, AC-VWH-009) (~4 min)

Create `supabase/tests/0266_vendor_withholding.test.sql`:

```sql
-- 0266_vendor_withholding.test.sql — 0266_vendor_invoice_withholding.sql (#876, ADR-0082).
-- Owns AC-VWH-008 (shape + bounds) and AC-VWH-009 (not client-writable, native = 0, mirror guard).
begin;
select plan(19);

insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000001','#876 VWH Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000000a1','vwh-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000000a1','08760000-0000-0000-0000-000000000001',
   'VWH Finance','vwh-fin@example.com','Finance','active');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000000c1','08760000-0000-0000-0000-000000000001','#876 Vendor','Vendor');
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('08760000-0000-0000-0000-0000000000d1','08760000-0000-0000-0000-000000000001','#876 case','Vendor Quoted',
   '08760000-0000-0000-0000-0000000000a1','08760000-0000-0000-0000-0000000000c1');

-- §A — shape (DD-VWH-1, DD-VWH-7). The default is proven by behaviour, not by how the catalog prints it.
select col_type_is('public','procurement_invoices','withheld_amount','numeric(14,2)',
  'AC-VWH-008 withheld_amount is numeric(14,2)');
select col_not_null('public','procurement_invoices','withheld_amount',
  'AC-VWH-008 withheld_amount is NOT NULL — 0 means nothing withheld, never unknown');
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount)
values ('08760000-0000-0000-0000-00000000e000','08760000-0000-0000-0000-000000000001',
        '08760000-0000-0000-0000-0000000000d1','Received','2026-10-07', 500, 'exclusive', 0);
select is((select withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e000'),
  0.00::numeric, 'AC-VWH-008 a bill that does not state withheld_amount records 0 (PMO-native bills withhold nothing, DD-VWH-7)');

-- §B — round-trip and bounds
insert into procurement_invoices (id, org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
values ('08760000-0000-0000-0000-00000000e001','08760000-0000-0000-0000-000000000001',
        '08760000-0000-0000-0000-0000000000d1','Received','2026-10-07', 1110000, 'inclusive', 110000, 20000);
select is((select withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e001'),
  20000.00::numeric, 'AC-VWH-008 a withheld amount round-trips exactly');
select is((select amount - withheld_amount from procurement_invoices where id='08760000-0000-0000-0000-00000000e001'),
  1090000.00::numeric, 'AC-VWH-008 gross minus withheld is the net payable');
select throws_ok($$ update procurement_invoices set withheld_amount = 'NaN'::numeric
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514', null,
  'AC-VWH-008 NaN withholding is refused (the upper bound is what rejects it)');
select throws_ok($$ update procurement_invoices set withheld_amount = -1
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514', null,
  'AC-VWH-008 a negative withholding on a positive bill is refused');
select throws_ok($$ update procurement_invoices set withheld_amount = 1110000.01
                    where id='08760000-0000-0000-0000-00000000e001' $$, '23514', null,
  'AC-VWH-008 withholding above the gross bill is refused');
select throws_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                    values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                            'Received','2026-10-07', null, 'inclusive', 0, 5) $$, '23514', null,
  'AC-VWH-008 withholding on a bill with no amount is refused');
select lives_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                   values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                           'Received','2026-10-07', -1110000, 'inclusive', -110000, -20000) $$,
  'AC-VWH-008 a return (debit note) carries a negative withholding with its negative amount');
select throws_ok($$ insert into procurement_invoices (org_id, procurement_id, status, invoice_date, amount, tax_treatment, tax_amount, withheld_amount)
                    values ('08760000-0000-0000-0000-000000000001','08760000-0000-0000-0000-0000000000d1',
                            'Received','2026-10-07', -1110000, 'inclusive', -110000, 20000) $$, '23514', null,
  'AC-VWH-008 a positive withholding on a negative bill is refused (sign parity)');

-- §C — not client-writable; readable exactly where amount is (FR-VWH-008)
select ok(not has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','INSERT'),
  'AC-VWH-009 authenticated cannot INSERT withheld_amount');
select ok(not has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','UPDATE'),
  'AC-VWH-009 authenticated cannot UPDATE withheld_amount');
select ok(not has_column_privilege('anon','public.procurement_invoices','withheld_amount','INSERT')
          and not has_column_privilege('anon','public.procurement_invoices','withheld_amount','UPDATE'),
  'AC-VWH-009 anon can neither INSERT nor UPDATE withheld_amount');
select is(has_column_privilege('authenticated','public.procurement_invoices','withheld_amount','SELECT'),
          has_column_privilege('authenticated','public.procurement_invoices','amount','SELECT'),
  'AC-VWH-009 withheld_amount is readable exactly where amount is');

-- §D — a PMO-native bill records zero (procurement still PMO-owned here)
set local role authenticated;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000000d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-876-NATIVE', 1000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 110) $$,
  'AC-VWH-009 CONTROL a PMO-native vendor invoice records through the RPC');
reset role;
select is((select withheld_amount from procurement_invoices where reference_number='VI-876-NATIVE'),
  0.00::numeric, 'AC-VWH-009 a PMO-native vendor invoice records zero withholding');

-- §E — the mirror guard pins withheld_amount while procurement is externally owned. Run as the TABLE OWNER with an
-- authenticated JWT claim (the 0196 §E construction): a role-switched UPDATE would 42501 on privileges instead, for
-- the wrong reason.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('08760000-0000-0000-0000-000000000001','erpnext','procurement');
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update procurement_invoices set withheld_amount = 0
                    where id='08760000-0000-0000-0000-00000000e001' $$, '42501',
  'procurement_invoices native fields are read-only while procurement is externally-owned',
  'AC-VWH-009 the mirror guard pins withheld_amount while procurement is externally owned');
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ update procurement_invoices set withheld_amount = 10000
                   where id='08760000-0000-0000-0000-00000000e001' $$,
  'AC-VWH-009 CONTROL the service-role mirror writer still writes withheld_amount');

select * from finish();
rollback;
```

**Verify red** (column does not exist yet):
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0266_vendor_withholding.test.sql'`
→ fails (`column "withheld_amount" ... does not exist`).

## Task 2 — Migration 0266, green (AC-VWH-008, AC-VWH-009) (~5 min)

Create `supabase/migrations/0266_vendor_invoice_withholding.sql`:

```sql
-- 0266_vendor_invoice_withholding.sql — #876: vendor withholding (PPh 23 / PPh 4(2)) on ERP-owned bills.
--
-- ADR-0082, DD-VWH-1 / DD-VWH-7. One additive column, its bounds, one line in the procurement mirror guard.
--   • withheld_amount — income tax withheld from the vendor on this bill (ERPNext Purchase Invoice header
--     `taxes_and_charges_deducted`). `amount` stays the GROSS bill and `tax_amount` stays VAT only; the net payable
--     to the vendor is `amount - withheld_amount`, derived and never stored.
--   • DEFAULT 0 is deliberate: every writer other than the ERP mirror is PMO-native, where nothing is withheld, so 0
--     is a fact there; the mirror writer states the value on every create (readModelWriters.ts, AC-VWH-006).
--   • Bounds: finite (the upper bound is what rejects NaN — 0169's lesson); zero, or the same sign as `amount` and no
--     larger in magnitude (a return carries a negative withholding with its negative amount — 0196's sign parity).
--   • Grants: none issued. §3 asserts on the database being migrated that the column is not client-writable, so an
--     environment whose grants differ from local fails here instead of shipping a writable money column.
--
-- Deploy precondition (operator): bills mirrored before this migration keep their old figures until ERPNext next
-- modifies them. Before applying beyond local, list the target ERPNext's Purchase Invoices with
-- taxes_and_charges_deducted <> 0 that PMO mirrors, and re-mirror any found.
--
-- Rollback: supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql (revert the #876 edge functions
-- first — they write this column).

-- §1 — the column and its bounds.
alter table public.procurement_invoices
  add column if not exists withheld_amount numeric(14,2) not null default 0;

alter table public.procurement_invoices
  add constraint procurement_invoices_withheld_amount_bounds
  check (withheld_amount > '-Infinity'::numeric and withheld_amount < 'Infinity'::numeric
         and (withheld_amount = 0
              or (amount is not null
                  and sign(withheld_amount) = sign(amount)
                  and abs(withheld_amount) <= abs(amount))));

comment on column public.procurement_invoices.withheld_amount is
  '#876 (ADR-0082): income tax withheld from the vendor on this bill (PPh 23 / PPh 4(2)), in `currency`. ERPNext '
  'Purchase Invoice header taxes_and_charges_deducted. `amount` is the gross bill; the net payable to the vendor is '
  'amount - withheld_amount. 0 = nothing withheld.';

-- §2 — the procurement mirror guard ENUMERATES its denial set (0196 §4), so the new column must be named. Body is
-- 0196 §4's verbatim plus one line. No trigger is re-created: the trigger binds by OID and `create or replace` keeps
-- it (0189/0196). Attributes preserved: SECURITY INVOKER, `set search_path = public`.
create or replace function public.procurement_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.vi_number             is distinct from old.vi_number
     or new.invoice_date          is distinct from old.invoice_date
     or new.reference_number      is distinct from old.reference_number
     or new.amount                is distinct from old.amount
     or new.po_id                 is distinct from old.po_id
     or new.status                is distinct from old.status
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.erp_docstatus         is distinct from old.erp_docstatus
     or new.erp_modified          is distinct from old.erp_modified
     or new.erp_amended_from      is distinct from old.erp_amended_from
     or new.erp_cancelled_at      is distinct from old.erp_cancelled_at
     or new.currency              is distinct from old.currency   -- 0187 (#478)
     or new.tax_treatment         is distinct from old.tax_treatment -- 0196 (#505)
     or new.tax_amount            is distinct from old.tax_amount    -- 0196 (#505)
     or new.tax_rate              is distinct from old.tax_rate      -- 0196 (#505)
     or new.tax_template          is distinct from old.tax_template  -- 0196 (#505)
     or new.withheld_amount       is distinct from old.withheld_amount -- 0266 (#876)
     or new.id                    is distinct from old.id
     or new.procurement_id        is distinct from old.procurement_id
     or new.org_id                is distinct from old.org_id
     or new.created_at            is distinct from old.created_at
  then
    raise exception 'procurement_invoices native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- §3 — on-database assert: the new money column is not client-writable HERE (whatever the local grants were).
do $$
begin
  if has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_amount', 'INSERT')
     or has_column_privilege('authenticated', 'public.procurement_invoices', 'withheld_amount', 'UPDATE')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_amount', 'INSERT')
     or has_column_privilege('anon', 'public.procurement_invoices', 'withheld_amount', 'UPDATE')
  then
    raise exception '0266: procurement_invoices.withheld_amount would be client-writable on this database; a table-level INSERT/UPDATE grant is present (see 0174/0175) — resolve it before applying';
  end if;
end $$;

notify pgrst, 'reload schema';
```

**Verify green:** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0266_vendor_withholding.test.sql supabase/tests/vendor_invoice_tax_treatment.test.sql'`
→ both files pass (19/19 and the unchanged AC-VTAX file). Then `cd "$WT/pmo-portal" && npm run check:migrations`.

## Task 3 — Rollback file + rehearsal (~4 min)

Create `supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql`:

```sql
-- Rollback for 0266_vendor_invoice_withholding.sql (#876). Revert the #876 edge functions FIRST (they write
-- withheld_amount). Restores 0196 §4's mirror-guard body, then drops the constraint and the column. Bills mirrored
-- with withholding keep their GROSS `amount`; re-mirror them if the rollback is permanent.
create or replace function public.procurement_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if not public.domain_externally_owned(new.org_id, 'procurement') then
    return new;
  end if;
  if new.vi_number             is distinct from old.vi_number
     or new.invoice_date          is distinct from old.invoice_date
     or new.reference_number      is distinct from old.reference_number
     or new.amount                is distinct from old.amount
     or new.po_id                 is distinct from old.po_id
     or new.status                is distinct from old.status
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.erp_docstatus         is distinct from old.erp_docstatus
     or new.erp_modified          is distinct from old.erp_modified
     or new.erp_amended_from      is distinct from old.erp_amended_from
     or new.erp_cancelled_at      is distinct from old.erp_cancelled_at
     or new.currency              is distinct from old.currency   -- 0187 (#478)
     or new.tax_treatment         is distinct from old.tax_treatment -- 0196 (#505)
     or new.tax_amount            is distinct from old.tax_amount    -- 0196 (#505)
     or new.tax_rate              is distinct from old.tax_rate      -- 0196 (#505)
     or new.tax_template          is distinct from old.tax_template  -- 0196 (#505)
     or new.id                    is distinct from old.id
     or new.procurement_id        is distinct from old.procurement_id
     or new.org_id                is distinct from old.org_id
     or new.created_at            is distinct from old.created_at
  then
    raise exception 'procurement_invoices native fields are read-only while procurement is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

alter table public.procurement_invoices drop constraint if exists procurement_invoices_withheld_amount_bounds;
alter table public.procurement_invoices drop column if exists withheld_amount;

notify pgrst, 'reload schema';
```

**Verify** (rehearses inside a transaction, then rolls back so the local DB stays migrated):

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c "supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -qAt <<'SQL'
begin;
\i supabase/migrations/rollback/0266_vendor_invoice_withholding_down.sql
select count(*) from information_schema.columns where table_schema='public' and table_name='procurement_invoices' and column_name='withheld_amount';
select position('withheld_amount' in pg_get_functiondef('public.procurement_invoices_native_mirror_guard'::regproc));
rollback;
SQL"
```
→ prints `0` then `0`.

## Task 4 — Regenerate types (~2 min)

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'
```
**Verify:** `grep -n "withheld_amount" "$WT/pmo-portal/src/lib/supabase/database.types.ts"` lists new lines inside the
`procurement_invoices` block (Row `withheld_amount: number`, Insert/Update `withheld_amount?: number`) in addition to the
existing `incoming_payments` ones.

## Task 5 — `piFromDoc` tests, red (AC-VWH-004) (~3 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts`, inside
`describe('erpnext/bodies — fromDoc canonical mapping …')`, directly after the test
`'#505: PI_FROM_DOC_FIELDS requests every field piFromDoc reads, including the tax ones'`, add:

```ts
  // #876 (DD-VWH-2): a withholding bill's header — grand_total is the NET payable, total_taxes is VAT − PPh.
  it('AC-VWH-004 a bill with tax withheld mirrors the gross, the VAT and the withheld tax from the ERP header', () => {
    const canonical = piFromDoc({
      name: 'ACC-PINV-2026-00876', grand_total: 1090000, total_taxes_and_charges: 90000,
      taxes_and_charges_deducted: 20000, outstanding_amount: 1090000, taxes_and_charges: 'PPN 11 + PPh 23 - RIS', docstatus: 1,
    });
    expect(canonical).toMatchObject({
      amount: '1110000.00', tax_amount: '110000.00', withheld_amount: '20000.00', erp_outstanding_amount: '1090000.00',
    });
  });

  it('AC-VWH-004 a PPh-only bill (no VAT) mirrors a zero VAT, never a negative tax', () => {
    const canonical = piFromDoc({
      name: 'ACC-PINV-2026-00877', grand_total: 980000, total_taxes_and_charges: -20000,
      taxes_and_charges_deducted: 20000, outstanding_amount: 980000,
    });
    expect(canonical).toMatchObject({ amount: '1000000.00', tax_amount: '0.00', withheld_amount: '20000.00' });
  });

  it('AC-VWH-004 a return (debit note) keeps every figure negative (sign parity)', () => {
    const canonical = piFromDoc({
      name: 'ACC-PINV-RET-2026-00001', grand_total: -1090000, total_taxes_and_charges: -90000,
      taxes_and_charges_deducted: -20000, outstanding_amount: -1090000,
    });
    expect(canonical).toMatchObject({ amount: '-1110000.00', tax_amount: '-110000.00', withheld_amount: '-20000.00' });
  });

  it('AC-VWH-004 a payload without the deducted total leaves withholding unknown and the header verbatim', () => {
    const canonical = piFromDoc({ name: 'ACC-PINV-2026-00878', grand_total: 1090000, total_taxes_and_charges: 90000, outstanding_amount: 1090000 });
    expect(canonical.amount).toBe('1090000.00');
    expect(canonical.tax_amount).toBe('90000.00');
    expect(canonical).not.toHaveProperty('withheld_amount');
  });

  it('AC-VWH-004 PI_FROM_DOC_FIELDS requests taxes_and_charges_deducted (the sweep reads it from the list endpoint)', () => {
    expect(PI_FROM_DOC_FIELDS as readonly string[]).toContain('taxes_and_charges_deducted');
  });
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts -t "AC-VWH-004"`
→ 4 of 5 fail (the "unknown" case passes already).

## Task 6 — `piFromDoc` implementation, green (AC-VWH-004) (~4 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts`:

1. Add below the imports:

```ts
/** #876: adds two `mirrorMoney` decimal strings (`-?\d+\.\d{2}`) exactly, in integer cents — never a float. */
function addMoney(a: string, b: string): string {
  const sum = BigInt(a.replace('.', '')) + BigInt(b.replace('.', ''));
  const abs = sum < 0n ? -sum : sum;
  return `${sum < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
```

2. Replace the body of `piFromDoc` with:

```ts
export function piFromDoc(doc: unknown): PmoRecord {
  const d = doc as Record<string, unknown>;
  const grandTotal = mirrorMoney(d.grand_total);
  const totalTaxes = mirrorMoney(d.total_taxes_and_charges);
  // #876 (DD-VWH-2, ADR-0082): with a withholding (Deduct) row ERPNext's grand_total is the NET payable and
  // total_taxes_and_charges is VAT − withheld. PMO keeps the GROSS bill in `amount` and VAT alone in `tax_amount`, adding
  // the header's own `taxes_and_charges_deducted` back — two figures ERPNext states, summed in cents (ADR-0048 holds:
  // nothing is computed from lines). Deducted 0 ⇒ byte-identical to the pre-#876 mirror. A payload that does not carry
  // the field leaves withholding UNKNOWN: today's figures and no `withheld_amount` key, so no writer can record a guess.
  const deducted = mirrorMoney(d.taxes_and_charges_deducted);
  const headerComplete = deducted !== null && grandTotal !== null && totalTaxes !== null;
  return {
    id: String(d.name),
    vi_number: String(d.name),
    // The vendor invoice date is distinct from the ERP ledger's posting date. Legacy docs may
    // carry only posting_date; preserve that fallback while preferring the actual bill_date.
    invoice_date: typeof d.bill_date === 'string' && d.bill_date.trim()
      ? d.bill_date
      : (d.posting_date as string | null) ?? null,
    reference_number: (d.bill_no as string | null) ?? null,
    amount: headerComplete ? addMoney(grandTotal, deducted) : grandTotal,
    erp_outstanding_amount: mirrorMoney(d.outstanding_amount),
    // #505 / DD-XING-4: the header tax facts. `tax_rate` is deliberately NOT derived (the per-rate breakdown lives on
    // the `taxes` CHILD table the list endpoint cannot return).
    tax_amount: headerComplete ? addMoney(totalTaxes, deducted) : totalTaxes,
    ...(headerComplete ? { withheld_amount: deducted } : {}),
    tax_template: (d.taxes_and_charges as string | null) ?? null,
    erp_docstatus: (d.docstatus as number | null) ?? null,
    erp_modified: (d.modified as string | null) ?? null,
    erp_amended_from: (d.amended_from as string | null) ?? null,
  };
}
```

3. Replace `PI_FROM_DOC_FIELDS` with:

```ts
export const PI_FROM_DOC_FIELDS = ['name', 'modified', 'docstatus', 'amended_from', 'posting_date', 'bill_no', 'bill_date', 'grand_total', 'outstanding_amount', 'total_taxes_and_charges', 'taxes_and_charges_deducted', 'taxes_and_charges'] as const;
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts src/lib/adapterSeam/erpnext/purchaseProjectReferences.test.ts src/lib/adapterSeam/erpnext/doctypeBodies.test.ts`
→ all pass (AC-DPP-003 and the #505 tests unchanged: their fixtures carry no deducted field).

## Task 7 — Template tests, red; retire AC-520-11 (AC-VWH-001..003) (~5 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts`:

1. Above `function erpFetch`, add:

```ts
/** #876: the ERPNext Account `root_type` the withholding check reads (one GET per Deduct row). */
const ACCOUNTS: Record<string, string> = { 'PPh 23 - SC': 'Liability', 'PPh 4(2) - SC': 'Liability', 'Discount - SC': 'Income' };
```

2. Change `function erpFetch(templates: Row[] = TEMPLATES, docs: Row[] = templates) {` to
`function erpFetch(templates: Row[] = TEMPLATES, docs: Row[] = templates, accounts: Record<string, string> = ACCOUNTS) {`
and, directly before `if (init?.method === 'POST') {`, insert:

```ts
    if (path.startsWith('/api/resource/Account/')) {
      const name = path.slice('/api/resource/Account/'.length);
      return name in accounts
        ? Response.json({ data: { name, root_type: accounts[name] } })
        : new Response('{"exc_type":"DoesNotExistError"}', { status: 404 });
    }
```

3. Delete the whole `it.each([['a Deduct row', …], ['a negative rate', …]])('AC-520-11 …')` block (AC-520-11 is
retired by DD-VWH-4 — a deliberate requirement change, recorded in the #520 plan and the spec §5).

4. Append at the end of the file:

```ts
const PPH23 = { charge_type: 'On Net Total', account_head: 'PPh 23 - SC', rate: 2, description: 'PPh 23', category: 'Total', add_deduct_tax: 'Deduct' };
const SENT_PPH23 = { charge_type: 'On Net Total', account_head: 'PPh 23 - SC', description: 'PPh 23', rate: 2, category: 'Total', add_deduct_tax: 'Deduct', included_in_print_rate: 0 };
const malformed = (reason: string) =>
  `The purchase tax template "Synthetic Input VAT" withholds tax in a way PMO cannot record: ${reason}. Ask your ERP administrator to correct the template (or pick another), then record the invoice again.`;

describe('vendor withholding templates (#876)', () => {
  it('AC-VWH-001 a VAT + PPh 23 template is sent with its Deduct row intact (Total only, exclusive)', async () => {
    const { body, writes } = await push({ taxTemplate: 'Synthetic Input VAT' }, [{ ...STANDARD, taxes: [STANDARD.taxes[0], PPH23] }]);
    expect(writes).toHaveLength(1);
    expect(body.taxes_and_charges).toBe('Synthetic Input VAT');
    expect(body.taxes).toEqual([SENT_ROWS[0], SENT_PPH23]);
  });

  it('AC-VWH-002 a PPh-only template (a Deduct row, no VAT row) is sent, not refused', async () => {
    const { body } = await push({ taxTemplate: 'Synthetic Input VAT' }, [{ ...STANDARD, taxes: [PPH23] }]);
    expect(body.taxes).toEqual([SENT_PPH23]);
  });

  it.each([
    ['a negative-rate Add row (disguised withholding)', [{ ...STANDARD.taxes[0], rate: -2 }], 'a row has a negative rate'],
    ['a negative-rate Deduct row', [STANDARD.taxes[0], { ...PPH23, rate: -2 }], 'a row has a negative rate'],
    ['a rate above 100%', [{ ...STANDARD.taxes[0], rate: 101 }], 'a row has a rate above 100%'],
    ['a Deduct row counted in valuation', [STANDARD.taxes[0], { ...PPH23, category: 'Valuation and Total' }], 'a withholding row must count toward the invoice total only'],
    ['a Deduct row included in the item price', [STANDARD.taxes[0], { ...PPH23, included_in_print_rate: 1 }], 'a withholding row cannot be included in the item price'],
    ['a Deduct row on a non-liability account', [STANDARD.taxes[0], { ...PPH23, account_head: 'Discount - SC' }], 'a withholding row must post to a tax-payable (liability) account'],
    ['withholding rates adding up to 100%', [{ ...PPH23, rate: 60 }, { ...PPH23, account_head: 'PPh 4(2) - SC', rate: 40 }], 'its withholding rates add up to 100% or more'],
  ] as Array<[string, Row[], string]>)('AC-VWH-003 a template with %s is refused (config-rejected) before any ERPNext write', async (_label, taxes, reason) => {
    const erp = erpFetch([{ ...STANDARD, taxes }]);
    const err = await resolve(command({ taxTemplate: 'Synthetic Input VAT' }), erp).then(() => null, (e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ code: 'config-rejected', message: malformed(reason) });
    // ADR-0072: the refusal names the template, never the ERP company or an account.
    expect(err!.message).not.toContain(COMPANY);
    expect(err!.message).not.toMatch(/ - SC/);
    expect(erp.writes).toEqual([]);
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts -t "AC-VWH"`
→ AC-VWH-001/002 fail (old blanket refusal), AC-VWH-003 fails on the message.

## Task 8 — `erpPurchaseTaxRows.ts`, green (AC-VWH-001..003) (~4 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts`:

1. Replace the file header's last sentence ("A withholding template (any Deduct row or negative rate) is refused before
any ERP write: PMO's vendor-invoice mirror cannot hold a negative tax on a positive invoice (DD-VI-3).") with:

```ts
 * #876 (DD-VWH-4, ADR-0082): withholding (PPh) rows — `add_deduct_tax: 'Deduct'` — are sent when well-formed, because
 * the vendor-invoice mirror records them (`withheld_amount`, 0266). A malformed one is refused before any ERP write: a
 * negative rate anywhere (a negative Add row is withholding ERPNext would not count as deducted), a rate above 100%, a
 * Deduct row not counted in the Total only, a Deduct row included in the item price, a Deduct row whose account is not
 * a Liability, or Deduct rates adding up to 100% or more. Messages name the template, never the company or an account.
```

2. In `ErpPurchaseTaxRow`, change `add_deduct_tax: 'Add';` to `add_deduct_tax: 'Add' | 'Deduct';`.

3. Replace `const WITHHOLDING = 'This template withholds tax …';` with:

```ts
function malformedWithholding(templateName: string, reason: string): AppError {
  return new AppError(
    `The purchase tax template "${templateName}" withholds tax in a way PMO cannot record: ${reason}. Ask your ERP administrator to correct the template (or pick another), then record the invoice again.`,
    'config-rejected',
  );
}
```

4. In `resolvePurchaseTaxRows`, replace everything from `const rows: ErpPurchaseTaxRow[] = [];` to the closing
`return rows;` with:

```ts
  const rows: ErpPurchaseTaxRow[] = [];
  let withheldRate = 0;
  for (const row of template.taxes ?? []) {
    if (row.charge_type !== 'On Net Total') {
      throw new AdapterError('commit-rejected', `The purchase tax template "${templateName}" has a "${String(row.charge_type)}" row; only "On Net Total" rows can be sent for a vendor invoice`);
    }
    const account = typeof row.account_head === 'string' ? row.account_head : '';
    const rate = Number(row.rate);
    const category = row.category ?? 'Total';
    const addDeduct = row.add_deduct_tax ?? 'Add';
    if (!account || !Number.isFinite(rate)
        || !(CATEGORIES as readonly unknown[]).includes(category) || !(ADD_DEDUCT as readonly unknown[]).includes(addDeduct)) {
      throw new AdapterError('commit-rejected', `The purchase tax template "${templateName}" has an incomplete row`);
    }
    if (rate < 0) throw malformedWithholding(templateName, 'a row has a negative rate');
    if (rate > 100) throw malformedWithholding(templateName, 'a row has a rate above 100%');
    const included: 0 | 1 = Number(row.included_in_print_rate) === 1 ? 1 : 0;
    if (addDeduct === 'Deduct') {
      if (category !== 'Total') throw malformedWithholding(templateName, 'a withholding row must count toward the invoice total only');
      if (included === 1) throw malformedWithholding(templateName, 'a withholding row cannot be included in the item price');
      const ledger = (await getDoc(deps, 'Account', account)) as { root_type?: unknown } | null;
      if (ledger?.root_type !== 'Liability') {
        throw malformedWithholding(templateName, 'a withholding row must post to a tax-payable (liability) account');
      }
      withheldRate += rate;
    }
    const costCenter = typeof row.cost_center === 'string' && row.cost_center ? row.cost_center : '';
    rows.push({
      charge_type: 'On Net Total', account_head: account,
      description: typeof row.description === 'string' && row.description ? row.description : account,
      rate, category: category as ErpPurchaseTaxRow['category'],
      add_deduct_tax: addDeduct as ErpPurchaseTaxRow['add_deduct_tax'],
      included_in_print_rate: included,
      ...(costCenter ? { cost_center: costCenter } : {}),
    });
  }
  if (withheldRate >= 100) throw malformedWithholding(templateName, 'its withholding rates add up to 100% or more');
  if (rows.length === 0) {
    throw new AppError(`The purchase tax template "${templateName}" has no tax rows in ERPNext. Add its rows in ERPNext (or pick another template), then record the invoice again.`, 'config-rejected');
  }
  return rows;
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts`
→ every AC-520-* (except the retired 11) and AC-VWH-001..003 pass.

## Task 9 — Dispatch writer tests, red (AC-VWH-006) (~3 min)

Append to `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts`:

```ts
// ============================================================================
// #876 (0266, DD-VWH-1/7) — the PI mirror states withheld_amount on every create and never nulls it on an update.
// ============================================================================

Deno.test({
  name: 'AC-VWH-006 a created PI mirror with tax withheld stores the gross amount, the VAT and the withheld tax',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    await getReadModelWriter('procurement').upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      {
        id: 'pmo-pi-876-1', vi_number: 'ACC-PINV-2026-00876', invoice_date: '2026-10-07', amount: '1110000.00',
        erp_outstanding_amount: '1090000.00', erp_docstatus: 1, erp_modified: '2026-10-07 10:00:00.000000',
        tax_amount: '110000.00', withheld_amount: '20000.00', tax_template: 'PPN 11 + PPh 23 - RIS',
      },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pi-876-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice' } },
    );
    const row = calls.find((c) => c.method === 'insert' && c.table === 'procurement_invoices')!.args[0] as Record<string, unknown>;
    assertEquals(row.amount, '1110000.00');
    assertEquals(row.tax_amount, '110000.00');
    assertEquals(row.withheld_amount, '20000.00');
    assertEquals(row.status, 'Received', 'the net 1,090,000 is still owed');
  },
});

Deno.test({
  name: 'AC-VWH-006 a PI create whose canonical carries no withholding states 0.00 — it never relies on the column default',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    await getReadModelWriter('procurement').upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pi-876-2', vi_number: 'ACC-PINV-2026-00879', amount: '5000.00', erp_outstanding_amount: '5000.00', erp_docstatus: 0 },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pi-876-2', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice' } },
    );
    const row = calls.find((c) => c.method === 'insert' && c.table === 'procurement_invoices')!.args[0] as Record<string, unknown>;
    assertEquals(row.withheld_amount, '0.00');
  },
});

Deno.test({
  name: 'AC-VWH-006 a PI update omits withheld_amount when the canonical does not carry it (never zeroes a recorded withholding)',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    await getReadModelWriter('procurement').upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pi-876-3', vi_number: 'ACC-PINV-2026-00880', amount: '5000.00', erp_outstanding_amount: '0.00', erp_docstatus: 1 },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-876-3', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00880', verb: 'submit' } },
    );
    const patch = calls.find((c) => c.method === 'update' && c.table === 'procurement_invoices')!.args[0] as Record<string, unknown>;
    assert(!('withheld_amount' in patch), 'an absent withholding must be omitted, not written');
  },
});
```

**Verify red:** `cd "$WT/supabase/functions/adapter-dispatch" && deno test readModelWriters.money.test.ts --filter "AC-VWH-006"`
→ the first two fail (`withheld_amount` undefined), the third passes.

## Task 10 — Dispatch writer, green (AC-VWH-006) (~2 min)

In `supabase/functions/adapter-dispatch/readModelWriters.ts`, `upsertInvoiceMirror`:

1. Directly after `if (piTaxTemplate !== null) patch.tax_template = piTaxTemplate;` add:

```ts
  // #876 (0266, DD-VWH-1/7): the tax withheld rides with `amount` (both come from the same ERP header read, piFromDoc).
  // Omitted when the canonical does not carry it, so a status tick never zeroes a recorded withholding.
  const piWithheld = (canonical.withheld_amount as string | null | undefined) ?? null;
  if (piWithheld !== null) patch.withheld_amount = piWithheld;
```

2. In the create `insert({...})`, directly after `tax_amount: piTaxAmount ?? '0.00',` add:

```ts
      // #876: stated on every create — the column's DEFAULT 0 is for PMO-native bills, never relied on here.
      withheld_amount: piWithheld ?? '0.00',
```

**Verify green:** `cd "$WT/supabase/functions/adapter-dispatch" && deno test readModelWriters.money.test.ts readModelWriters.crossOrg.test.ts`
→ all pass.

## Task 11 — Feed refresh tests, red (AC-VWH-007) (~4 min)

In `supabase/functions/_shared/erpnextFeedDeps.test.ts`, add to the imports:

```ts
import { piFromDoc } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts';
```

and append:

```ts
Deno.test('AC-VWH-007 a mirrored bill change carrying its money header refreshes gross, VAT, withheld, outstanding and the derived status (paid detection)', async () => {
  const { client, calls } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'purchase-invoice');
  await deps.updateMirror('pmo-pi-1', piFromDoc({
    name: 'ACC-PINV-2026-00876', docstatus: 1, modified: '2026-10-07 11:00:00.000000',
    grand_total: 1090000, total_taxes_and_charges: 90000, taxes_and_charges_deducted: 20000, outstanding_amount: 0,
  }), Date.parse('2026-10-07T11:00:00.000Z'));
  const update = calls.find((c) => c.table === 'procurement_invoices' && c.op === 'update');
  assert(!!update, 'expected a procurement_invoices update');
  const p = update!.patch!;
  assert(p.amount === '1110000.00' && p.tax_amount === '110000.00' && p.withheld_amount === '20000.00', `money refreshed: ${JSON.stringify(p)}`);
  assert(p.erp_outstanding_amount === '0.00' && p.status === 'Paid', 'the net paid in ERPNext ⇒ Paid in PMO');
  assert(p.tax_treatment === 'inclusive', 'the marker rides with the gross amount');
});

Deno.test('AC-VWH-007 a bill change WITHOUT the whole money header leaves money and status untouched (a header missing the deducted total, or a lifecycle-only webhook)', async () => {
  const partials = [
    // The dangerous one: the NET grand total with no deducted figure — writing it would record the net as the gross.
    { name: 'ACC-PINV-2026-00876', docstatus: 1, modified: '2026-10-07 11:00:00.000000',
      grand_total: 1090000, total_taxes_and_charges: 90000, outstanding_amount: 0 },
    { name: 'ACC-PINV-2026-00876', docstatus: 1, modified: '2026-10-07 11:00:00.000000', outstanding_amount: 0 },
  ];
  for (const doc of partials) {
    const { client, calls } = fakeServiceClient({});
    const deps = createErpFeedDeps(client, 'org-1', 'purchase-invoice');
    await deps.updateMirror('pmo-pi-1', piFromDoc(doc), Date.parse('2026-10-07T11:00:00.000Z'));
    const p = calls.find((c) => c.table === 'procurement_invoices' && c.op === 'update')!.patch!;
    for (const key of ['amount', 'tax_amount', 'withheld_amount', 'erp_outstanding_amount', 'status', 'tax_treatment']) {
      assert(!(key in p), `a partial payload must not write ${key}: ${JSON.stringify(p)}`);
    }
  }
});

Deno.test('AC-VWH-007 the money refresh is scoped to purchase-invoice — a payment change writes no invoice money fields', async () => {
  const { client, calls } = fakeServiceClient({});
  const deps = createErpFeedDeps(client, 'org-1', 'payment');
  await deps.updateMirror('pmo-pay-1', {
    id: 'ACC-PAY-2026-00001', amount: '1090000.00', tax_amount: '0.00', withheld_amount: '0.00',
    erp_outstanding_amount: '0.00', erp_docstatus: 1,
  }, Date.parse('2026-10-07T11:00:00.000Z'));
  const p = calls.find((c) => c.op === 'update')!.patch!;
  assert(!('withheld_amount' in p) && !('erp_outstanding_amount' in p) && !('status' in p), `payment patch: ${JSON.stringify(p)}`);
});
```

**Verify red:** `cd "$WT/supabase/functions/erpnext-sweep" && deno test ../_shared/erpnextFeedDeps.test.ts --filter "AC-VWH-007"`
→ the first test fails; the other two pass (they guard the all-or-nothing rule and the kind scope once the patch lands).

## Task 12 — Feed refresh, green (AC-VWH-007) (~4 min)

In `supabase/functions/_shared/erpnextFeedDeps.ts`:

1. After `import { deriveSiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/siStatus.ts';` add:

```ts
import { derivePiStatus } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/piStatus.ts';
```

2. In `updateMirror`, change the patch to:

```ts
      const patch = {
        ...mirrorStatusPatch(kind, canonical, sourceModMs),
        ...(await revenueFieldPatch(serviceClient, orgId, kind, canonical)),
        ...purchaseInvoiceFieldPatch(kind, canonical),
        ...(await employeeFieldPatch(serviceClient, orgId, kind, pmoRecordId, canonical)),
      };
```

3. Directly above `async function revenueFieldPatch(` add:

```ts
/**
 * #876 (DD-VWH-5, FR-VWH-005) — FR-ENA-116's paid-detection, built. A mirrored Purchase Invoice's money and derived
 * status follow ERPNext on every inbound change that carries the WHOLE money header (`piFromDoc`: gross `amount`, VAT
 * `tax_amount`, `withheld_amount`, `erp_outstanding_amount`). All-or-nothing: a webhook carrying only part of it (an
 * operator-configured field subset) writes none of it, so a partial payload can never record a net total as the gross,
 * pair a new gross with a stale withholding, or flip a settled bill back to Received. `tax_treatment` rides with
 * `amount` (readModelWriters.ts' rule: 'inclusive' is a fact about a gross that includes VAT). Before this, a bill's
 * money was written only by its own dispatch, so a bill paid in ERPNext never showed Paid in PMO.
 */
function purchaseInvoiceFieldPatch(kind: ErpDocKind, canonical: PmoRecord): Record<string, unknown> {
  if (kind !== 'purchase-invoice') return {};
  const amount = canonical.amount as string | null | undefined;
  const taxAmount = canonical.tax_amount as string | null | undefined;
  const withheld = canonical.withheld_amount as string | null | undefined;
  const outstanding = canonical.erp_outstanding_amount as string | null | undefined;
  if (amount == null || taxAmount == null || withheld == null || outstanding == null) return {};
  return {
    amount, tax_amount: taxAmount, withheld_amount: withheld, tax_treatment: 'inclusive',
    erp_outstanding_amount: outstanding, status: derivePiStatus(outstanding),
  };
}
```

**Verify green:** `cd "$WT/supabase/functions/erpnext-sweep" && deno test ../_shared/erpnextFeedDeps.test.ts && deno test receiptWithholdingFeed.test.ts`
then `cd "$WT/pmo-portal" && npm run typecheck:edge` → all pass.

## Task 13 — Sales symmetry test, red (AC-VWH-013) (~3 min)

Create `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolveSalesTaxRows } from './erpSalesTaxRows.ts';

/** ERPNext fake: the default-template list answers one name; the single-doc read answers `rows`. */
function deps(rows: Array<Record<string, unknown>>) {
  const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Sales Taxes and Charges Template') return Response.json({ data: [{ name: 'Synthetic Output VAT' }] });
    return Response.json({ data: { name: 'Synthetic Output VAT', taxes: rows } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'k', apiSecret: 's', baseUrl: 'https://erp.example.test' };
}
const VAT = { charge_type: 'On Net Total', account_head: 'Output VAT - SC', rate: 11, description: 'Output VAT' };

describe('sales tax rows — symmetry with vendor withholding (#876, DD-VWH-9)', () => {
  it('AC-VWH-013 a default sales template with a negative-rate row is refused (config-rejected) before any ERPNext write', async () => {
    await expect(resolveSalesTaxRows(deps([VAT, { ...VAT, account_head: 'Withholding - SC', rate: -2 }]), 'Synthetic Co'))
      .rejects.toMatchObject({
        code: 'config-rejected',
        message: 'The default sales tax template "Synthetic Output VAT" has a negative rate. Client withholding is recorded on the receipt, not the invoice — ask your ERP administrator to remove the row, then raise the invoice again.',
      });
  });

  it('AC-VWH-013 CONTROL a positive-rate default template still resolves its rows', async () => {
    await expect(resolveSalesTaxRows(deps([VAT]), 'Synthetic Co')).resolves.toEqual([
      { charge_type: 'On Net Total', account_head: 'Output VAT - SC', description: 'Output VAT', rate: 11 },
    ]);
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts`
→ the first test fails (resolves), the CONTROL passes.

## Task 14 — Sales symmetry, green (AC-VWH-013) (~2 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/erpSalesTaxRows.ts`:

1. Add `import { AppError } from '../../appError.ts';` above `import { AdapterError } from '../contract.ts';`.
2. Directly after the line `if (!account || !Number.isFinite(rate)) throw new AdapterError(…incomplete row…);` add:

```ts
    // #876 (DD-VWH-9): a negative sales row would land an invoice whose mirror 0188 refuses (tax below zero on a
    // positive invoice). Client withholding belongs on the receipt (#762, DD-RCPT-1), never on the invoice.
    if (rate < 0) {
      throw new AppError(`The default sales tax template "${String(found[0].name)}" has a negative rate. Client withholding is recorded on the receipt, not the invoice — ask your ERP administrator to remove the row, then raise the invoice again.`, 'config-rejected');
    }
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.withholding.test.ts`
→ pass.

## Task 15 — Display figures helper, red → green (AC-VWH-010) (~4 min)

Create `pmo-portal/src/lib/vendorWithholding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { withholdingFigures } from './vendorWithholding';

describe('withholdingFigures (#876, DD-VWH-6)', () => {
  it('AC-VWH-010 net payable is the gross bill minus the tax withheld, in exact cents', () => {
    expect(withholdingFigures(1110000, 110000, 20000)).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(1234567.89, 135802.47, 24691.36)).toEqual({ vat: 135802.47, withheld: 24691.36, netPayable: 1209876.53 });
  });

  it('AC-VWH-010 no figures when nothing was withheld or a figure is unknown', () => {
    expect(withholdingFigures(1110000, 110000, 0)).toBeNull();
    expect(withholdingFigures(1110000, 110000, null)).toBeNull();
    expect(withholdingFigures(1110000, 110000, undefined)).toBeNull();
    expect(withholdingFigures(null, 110000, 20000)).toBeNull();
    expect(withholdingFigures(1110000, null, 20000)).toBeNull();
    expect(withholdingFigures(1110000, 110000, Number.NaN)).toBeNull();
  });

  it('AC-VWH-010 a return (negative bill) keeps its sign', () => {
    expect(withholdingFigures(-1110000, -110000, -20000)).toEqual({ vat: -110000, withheld: -20000, netPayable: -1090000 });
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/vendorWithholding.test.ts` → fails (module missing).

Create `pmo-portal/src/lib/vendorWithholding.ts`:

```ts
/**
 * #876 (DD-VWH-6, FR-VWH-007) — the three labelled figures a vendor invoice with tax withheld shows: the VAT on the
 * bill, the tax withheld (PPh — owed to the tax office, not the vendor) and the net payable to the vendor. `amount` is
 * the GROSS bill (DD-VWH-1), so net payable = amount − withheld, in integer cents so it never carries a float artifact.
 * Null when nothing was withheld or any figure is unknown: the caller then renders the bill exactly as before.
 */
export interface WithholdingFigures {
  vat: number;
  withheld: number;
  netPayable: number;
}

const cents = (n: number): number => Math.round(n * 100);

export function withholdingFigures(
  amount: number | null | undefined,
  taxAmount: number | null | undefined,
  withheldAmount: number | null | undefined,
): WithholdingFigures | null {
  if (amount == null || taxAmount == null || withheldAmount == null) return null;
  if (![amount, taxAmount, withheldAmount].every(Number.isFinite) || withheldAmount === 0) return null;
  return { vat: taxAmount, withheld: withheldAmount, netPayable: (cents(amount) - cents(withheldAmount)) / 100 };
}
```

**Verify green:** same command → 3 pass.

## Task 16 — Ledger row carries VAT + withheld, red → green (AC-VWH-011) (~4 min)

Append to `pmo-portal/src/lib/db/procurementLedger.test.ts`:

```ts
describe('AC-VWH-011: a vendor invoice row carries its VAT and tax withheld (#876)', () => {
  it('AC-VWH-011 the Invoice row carries tax_amount and withheld_amount; a row without them is unchanged', () => {
    const vi = {
      id: 'vi-876', org_id: 'org-1', procurement_id: 'proc-1', vi_number: 'VI-2026-0876', status: 'Received',
      invoice_date: '2026-10-07', created_at: '2026-10-07T08:00:00Z', po_id: null, reference_number: 'INV-876',
      amount: 1110000, currency: 'IDR', tax_treatment: 'inclusive', tax_amount: 110000, withheld_amount: 20000,
    };
    const [row] = buildLedgerRows(makeDetail({ invoices: [vi] }));
    expect(row).toMatchObject({ type: 'Invoice', amount: 1110000, taxAmount: 110000, withheldAmount: 20000, currency: 'IDR' });
    const [plain] = buildLedgerRows(makeDetail({ invoices: [{ ...vi, tax_amount: undefined, withheld_amount: undefined }] }));
    expect(plain).not.toHaveProperty('taxAmount');
    expect(plain).not.toHaveProperty('withheldAmount');
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/procurementLedger.test.ts -t "AC-VWH-011"` → fails.

In `pmo-portal/src/lib/db/procurementLedger.ts`:

1. In `interface LedgerRow`, directly after `taxBaseDenominator?: number;` add:

```ts
  /** #876 (DD-VWH-6) — vendor invoice only: VAT on the bill (`tax_amount`) and the tax withheld (`withheld_amount`).
   *  Present only on rows that carry a withholding fact, so every other row is byte-identical to before. */
  taxAmount?: number | null;
  withheldAmount?: number | null;
```

2. In `interface MakeRowExtra`, add `taxAmount?: number | null;` and `withheldAmount?: number | null;`.
3. In `makeRow`, change the destructuring to
`const { groupRef, taxTreatment, taxRate, taxBaseNumerator, taxBaseDenominator, taxBaseUnknown, taxAmount, withheldAmount } = extra;`
and directly after `taxRate, taxBaseNumerator, taxBaseDenominator, taxBaseUnknown,` in the returned object add:

```ts
    ...(withheldAmount !== undefined ? { taxAmount: taxAmount ?? null, withheldAmount } : {}),
```

4. In the vendor-invoice `extra` object (section 6), directly after `taxBaseUnknown: vi.erp_docstatus != null,` add:

```ts
          taxAmount: vi.tax_amount,
          withheldAmount: vi.withheld_amount,
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/procurementLedger.test.ts` → all pass.

## Task 17 — Breakdown render test, red (AC-VWH-012) (~3 min)

In `pmo-portal/pages/procurement/ProcurementLedger.test.tsx`:

1. Change `import { render, screen, fireEvent } from '@testing-library/react';` to
`import { render, screen, fireEvent, within } from '@testing-library/react';`.
2. After `import type { ProcurementDetail } from '../../src/lib/db/procurementLifecycle';` add
`import { formatCurrency } from '@/src/lib/format';`.
3. Append:

```ts
describe('AC-VWH-012: a vendor invoice with tax withheld shows VAT, tax withheld and net payable (#876)', () => {
  const withholdingRow: LedgerRow = {
    ...SAMPLE_ROWS[1], id: 'vi-876', systemNumber: 'VI-2026-0876', recordId: 'vi-876',
    amount: 1110000, currency: 'IDR', taxAmount: 110000, withheldAmount: 20000,
  };

  it('AC-VWH-012 the three figures are shown, each labelled, in the bill currency', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[withholdingRow]} />);
    const breakdown = screen.getAllByTestId('vi-withholding-breakdown')[0];
    expect(within(breakdown).getByText('VAT')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-vat').textContent).toBe(formatCurrency(110000, 'IDR'));
    expect(within(breakdown).getByText('Tax withheld (PPh)')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-withheld').textContent).toBe(formatCurrency(20000, 'IDR'));
    expect(within(breakdown).getByText('Net payable')).toBeInTheDocument();
    expect(within(breakdown).getByTestId('vi-withholding-net').textContent).toBe(formatCurrency(1090000, 'IDR'));
  });

  it('AC-VWH-012 a vendor invoice with nothing withheld renders no breakdown (unchanged)', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[{ ...SAMPLE_ROWS[1], taxAmount: 0, withheldAmount: 0 }]} />);
    expect(screen.queryByTestId('vi-withholding-breakdown')).toBeNull();
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/ProcurementLedger.test.tsx -t "AC-VWH-012"`
→ the first fails (no breakdown), the second passes.

## Task 18 — Breakdown component + cell + i18n, green (AC-VWH-012) (~5 min)

1. Append to `pmo-portal/pages/procurement/vendorInvoiceTestIds.ts`:

```ts
/** #876 (DD-VWH-6): the withholding breakdown under a vendor invoice's amount in the procurement ledger. */
export const VI_WITHHOLDING_TEST_IDS = {
  breakdown: 'vi-withholding-breakdown',
  vat: 'vi-withholding-vat',
  withheld: 'vi-withholding-withheld',
  net: 'vi-withholding-net',
} as const;
```

2. Create `pmo-portal/pages/procurement/WithholdingBreakdown.tsx`:

```tsx
/**
 * #876 (DD-VWH-6, FR-VWH-007) — the labelled withholding figures under a vendor invoice's amount: VAT, the tax
 * withheld (PPh — owed to the tax office, not the vendor) and the net payable to the vendor. Display only; the figures
 * come from `withholdingFigures` (integer cents) and the currency is the bill's own.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/src/lib/format';
import type { WithholdingFigures } from '@/src/lib/vendorWithholding';
import { VI_WITHHOLDING_TEST_IDS } from './vendorInvoiceTestIds';

export const WithholdingBreakdown: React.FC<{ figures: WithholdingFigures; currency: string }> = ({ figures, currency }) => {
  const { t } = useTranslation();
  return (
    <dl
      data-testid={VI_WITHHOLDING_TEST_IDS.breakdown}
      className="grid grid-cols-[auto_auto] justify-end gap-x-2 text-right text-[12px] text-muted-foreground"
    >
      <dt>{t('procurementDetail.withholding.vat', 'VAT')}</dt>
      <dd className="tabular-nums" data-testid={VI_WITHHOLDING_TEST_IDS.vat}>{formatCurrency(figures.vat, currency)}</dd>
      <dt>{t('procurementDetail.withholding.withheld', 'Tax withheld (PPh)')}</dt>
      <dd className="tabular-nums" data-testid={VI_WITHHOLDING_TEST_IDS.withheld}>{formatCurrency(figures.withheld, currency)}</dd>
      <dt className="font-semibold text-foreground">{t('procurementDetail.withholding.netPayable', 'Net payable')}</dt>
      <dd className="tabular-nums font-semibold text-foreground" data-testid={VI_WITHHOLDING_TEST_IDS.net}>
        {formatCurrency(figures.netPayable, currency)}
      </dd>
    </dl>
  );
};
```

3. In `pmo-portal/pages/procurement/ProcurementLedger.tsx`, add imports
`import { WithholdingBreakdown } from './WithholdingBreakdown';` and
`import { withholdingFigures } from '@/src/lib/vendorWithholding';`, and replace the `amount` column's `cell` with:

```tsx
    // #876 (DD-VWH-6): a vendor invoice with tax withheld adds VAT · Tax withheld (PPh) · Net payable under its gross
    // total; every other row renders exactly as before.
    cell: (row) => {
      if (row.amount == null) return <span className="text-[12px] text-muted-foreground">—</span>;
      const total = (
        <span className="inline-flex items-baseline justify-end gap-1.5">
          <span className="tabular-nums">{formatCurrency(row.amount, row.currency)}</span>
          <TaxBasisLabel treatment={row.taxTreatment} taxBaseUnknown={row.taxBaseUnknown} taxRate={row.taxRate} taxBaseNumerator={row.taxBaseNumerator} taxBaseDenominator={row.taxBaseDenominator} />
        </span>
      );
      const figures = row.type === 'Invoice' ? withholdingFigures(row.amount, row.taxAmount, row.withheldAmount) : null;
      return figures ? (
        <div className="inline-flex flex-col items-end gap-0.5">
          {total}
          <WithholdingBreakdown figures={figures} currency={row.currency} />
        </div>
      ) : total;
    },
```

4. In `pmo-portal/public/locales/en/common.json`, inside `"procurementDetail"`, add (alphabetical key position):
`"withholding": { "netPayable": "Net payable", "vat": "VAT", "withheld": "Tax withheld (PPh)" }`.
In `pmo-portal/public/locales/id/common.json`, same position:
`"withholding": { "netPayable": "Jumlah neto dibayar", "vat": "PPN", "withheld": "Pajak dipotong (PPh)" }`.

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/ProcurementLedger.test.tsx pages/procurement/vendorInvoiceTestIds.test.ts && npm run check:i18n`
→ all pass.

## Task 19 — Served e2e on the bench (AC-VWH-005) (~5 min to write; run per command)

Create `pmo-portal/e2e/serial/AC-VWH-005-vendor-withholding.spec.ts`:

```ts
// @e2e-isolation: serial — flips the shared org's procurement ownership, its ERPNext binding and its default currency (org-global state).
/**
 * AC-VWH-005 — vendor withholding (#876, ADR-0082) through the REAL served `adapter-dispatch` and `erpnext-sweep`
 * against the local ERPNext bench. Never `page.route` (money-command rule).
 *
 * Stated money facts, so the oracle is not an accident of fixtures:
 *  - currency IDR: the bench company "PMO Smoke Co" bills in IDR (asserted), and for this test the PMO org's default
 *    currency is IDR (set here, restored after), so the mirrored bill is denominated in IDR;
 *  - VAT: the template's PPN 11% Add row. The project VAT flag (OD-TAX-4) is a SALES-side fact and is not involved —
 *    this procurement has no project;
 *  - withholding: the template's PPh 23 2% Deduct row, posted to a liability account.
 *
 * Goal: the bill is recorded with withholding; PMO shows gross / VAT / withheld / outstanding; the vendor is paid the
 * NET; the bill ends Paid in PMO with gross, VAT and withheld intact; and the cost ERPNext posts is gross of the PPh.
 *
 * Run: cd pmo-portal && ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh ../scripts/serve-functions.sh -- \
 *        npx playwright test --project=serial e2e/serial/AC-VWH-005-vendor-withholding.spec.ts
 * Env: the same served-lane + bench set as AC-WHT-002 (exported in the shell; never committed).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const SWEEP_SECRET = process.env.ERPNEXT_SWEEP_SECRET ?? 'e2e-erpnext-sweep-secret';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const ADMIN_EMAIL = 'admin@acme.test';
const SEED_PASSWORD = 'Passw0rd!dev';

const COMPANY = 'PMO Smoke Co';
const TAX_PARENT = 'Duties and Taxes - PSC';
const VAT_ACCOUNT = 'Spike PPN Masukan - PSC';
const PPH_ACCOUNT = 'Spike PPh 23 Payable - PSC';
const TEMPLATE = 'Spike PPN11 PPh23 - PSC';
const TEMPLATE_ROWS = [
  { charge_type: 'On Net Total', account_head: VAT_ACCOUNT, description: 'PPN 11%', rate: 11, category: 'Total', add_deduct_tax: 'Add' },
  { charge_type: 'On Net Total', account_head: PPH_ACCOUNT, description: 'PPh 23 2%', rate: 2, category: 'Total', add_deduct_tax: 'Deduct' },
];

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-VWH-005: the served lane is up but its bench dependencies are incomplete — never a silent skip.');
test.skip(!READY, 'AC-VWH-005 requires the local served-functions lane and the throwaway ERPNext bench.');
test.setTimeout(180_000);

type Doc = Record<string, unknown>;
type GlRow = { account: string; debit: number; credit: number };

const resource = (doctype: string, name?: string) =>
  `/api/resource/${encodeURIComponent(doctype)}${name === undefined ? '' : `/${encodeURIComponent(name)}`}`;

async function erp(method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BENCH_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown };
  return { status: res.status, data: json.data };
}

async function readDoc(doctype: string, name: string): Promise<Doc> {
  const res = await erp('GET', resource(doctype, name));
  expect(res.status, `${doctype} ${name} read-back`).toBe(200);
  return res.data as Doc;
}

/** Bench fixtures are created once and reused across runs. */
async function ensureDoc(doctype: string, name: string, body: Doc): Promise<Doc> {
  const existing = await erp('GET', resource(doctype, name));
  if (existing.status === 200) return existing.data as Doc;
  const created = await erp('POST', resource(doctype), body);
  expect(created.status, `${doctype} ${name} must be creatable on the bench`).toBe(200);
  expect((created.data as Doc).name).toBe(name);
  return created.data as Doc;
}

async function glFor(voucher: string): Promise<GlRow[]> {
  const params = new URLSearchParams({
    filters: JSON.stringify([['voucher_no', '=', voucher], ['is_cancelled', '=', 0]]),
    fields: JSON.stringify(['account', 'debit', 'credit']),
    limit_page_length: '100',
  });
  const res = await erp('GET', `${resource('GL Entry')}?${params}`);
  expect(res.status).toBe(200);
  return res.data as GlRow[];
}

const total = (rows: GlRow[], side: 'debit' | 'credit') => rows.reduce((sum, r) => sum + Number(r[side]), 0);

async function dispatch(token: string, record: Doc): Promise<{ status: number; body: { externalRecordId?: string; message?: string } }> {
  const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: 'procurement', operation: 'create', record, idempotencyKey: crypto.randomUUID() }),
  });
  return { status: res.status, body: (await res.json()) as { externalRecordId?: string; message?: string } };
}

interface Seed { companyId: string; procurementId: string; piRecordId: string; peRecordId: string; priorCurrency: string }

async function seed(admin: SupabaseClient): Promise<Seed> {
  const { data: org, error: orgErr } = await admin.from('organizations').select('default_currency').eq('id', ORG_ID).single();
  if (orgErr || !org) throw new Error(`read org currency failed: ${orgErr?.message}`);
  const priorCurrency = (org as { default_currency: string }).default_currency;
  const { error: currencyErr } = await admin.from('organizations').update({ default_currency: 'IDR' }).eq('id', ORG_ID);
  if (currencyErr) throw new Error(`set org currency failed: ${currencyErr.message}`);

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const companyId = crypto.randomUUID();
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: ORG_ID, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed companies failed: ${companyErr.message}`);
  const { error: refErr } = await admin.from('external_refs').upsert(
    { org_id: ORG_ID, domain: 'companies', pmo_record_id: companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier' },
    { onConflict: 'org_id,domain,external_record_id' },
  );
  if (refErr) throw new Error(`seed external_refs failed: ${refErr.message}`);
  const { data: proc, error: procErr } = await admin.from('procurements')
    .insert({ org_id: ORG_ID, title: `AC-VWH-005 case ${suffix}`, vendor_id: companyId, status: 'Ordered' })
    .select('id').single();
  if (procErr || !proc) throw new Error(`seed procurements failed: ${procErr?.message}`);
  const { error: bindingErr } = await admin.from('external_org_bindings').upsert({
    org_id: ORG_ID, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15,
    config: { company: COMPANY, default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
    activated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,external_tier' });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  const { error: flipErr } = await admin.from('external_domain_ownership')
    .upsert({ org_id: ORG_ID, external_tier: 'erpnext', domain: 'procurement' }, { onConflict: 'org_id,external_tier,domain' });
  if (flipErr) throw new Error(`seed ownership failed: ${flipErr.message}`);
  return { companyId, procurementId: (proc as { id: string }).id, piRecordId: crypto.randomUUID(), peRecordId: crypto.randomUUID(), priorCurrency };
}

async function cleanup(admin: SupabaseClient, s: Seed): Promise<void> {
  await admin.from('external_domain_ownership').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext').eq('domain', 'procurement');
  await admin.from('external_org_bindings').delete().eq('org_id', ORG_ID).eq('external_tier', 'erpnext');
  await admin.from('payments').delete().eq('procurement_id', s.procurementId);
  await admin.from('procurement_invoices').delete().eq('procurement_id', s.procurementId);
  await admin.from('procurements').delete().eq('id', s.procurementId);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'procurement').in('pmo_record_id', [s.piRecordId, s.peRecordId]);
  await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'companies').eq('pmo_record_id', s.companyId);
  await admin.from('companies').delete().eq('id', s.companyId);
  await admin.from('organizations').update({ default_currency: s.priorCurrency }).eq('id', ORG_ID);
}

test('AC-VWH-005 a bill with PPh withheld is recorded gross with VAT and withholding, paid at the net, and ends Paid in PMO with its cost gross of the withholding', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);
  const authClient = createClient(AUTH_URL, ANON_KEY);
  const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: SEED_PASSWORD });
  if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);
  const token = signIn.session.access_token;

  // Bench facts this journey states rather than assumes.
  expect((await readDoc('Company', COMPANY)).default_currency, 'the bench company bills in IDR').toBe('IDR');
  expect(await readDoc('Account', TAX_PARENT)).toMatchObject({ is_group: 1, root_type: 'Liability' });
  await ensureDoc('Account', VAT_ACCOUNT, { account_name: 'Spike PPN Masukan', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  await ensureDoc('Account', PPH_ACCOUNT, { account_name: 'Spike PPh 23 Payable', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  const template = await ensureDoc('Purchase Taxes and Charges Template', TEMPLATE, { title: 'Spike PPN11 PPh23', company: COMPANY, taxes: TEMPLATE_ROWS });
  expect((template.taxes as Doc[]).map((r) => [r.account_head, r.rate, r.add_deduct_tax, r.category]))
    .toEqual(TEMPLATE_ROWS.map((r) => [r.account_head, r.rate, r.add_deduct_tax, r.category]));

  const s = await seed(admin);
  try {
    // 1. Record the bill with the withholding template (IDR 1,000,000 net).
    const pi = await dispatch(token, {
      id: s.piRecordId, procurementId: s.procurementId, vendorId: s.companyId, erp_doc_kind: 'purchase-invoice',
      items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }], taxTemplate: TEMPLATE,
    });
    expect(pi.status, `PI dispatch failed: ${pi.body.message}`).toBe(200);
    const piName = pi.body.externalRecordId!;
    expect(await readDoc('Purchase Invoice', piName)).toMatchObject({
      docstatus: 1, currency: 'IDR', net_total: 1000000, taxes_and_charges_added: 110000,
      taxes_and_charges_deducted: 20000, grand_total: 1090000, outstanding_amount: 1090000,
    });

    // 2. Cost stays gross (FR-VWH-006): the item is debited at the net total; the PPh is a liability credit.
    const gl = await glFor(piName);
    expect(total(gl.filter((r) => r.account === PPH_ACCOUNT), 'credit'), 'PPh withheld is a liability credit').toBe(20000);
    expect(total(gl.filter((r) => r.account === 'Creditors - PSC'), 'credit'), 'the vendor is owed the net').toBe(1090000);
    expect(total(gl.filter((r) => r.account === VAT_ACCOUNT), 'debit'), 'input VAT').toBe(110000);
    expect(total(gl.filter((r) => r.account !== VAT_ACCOUNT), 'debit'), 'the cost is posted gross of withholding').toBe(1000000);

    // 3. PMO's bill: gross, VAT, withheld, outstanding — in IDR.
    const bill = () => admin.from('procurement_invoices')
      .select('amount,tax_amount,withheld_amount,erp_outstanding_amount,status,currency,tax_template')
      .eq('id', s.piRecordId).single();
    const { data: recorded, error: recordedErr } = await bill();
    expect(recordedErr).toBeNull();
    expect(recorded).toMatchObject({
      amount: 1110000, tax_amount: 110000, withheld_amount: 20000, erp_outstanding_amount: 1090000,
      status: 'Received', currency: 'IDR', tax_template: TEMPLATE,
    });

    // 4. Pay the vendor the NET.
    const pe = await dispatch(token, {
      id: s.peRecordId, procurementId: s.procurementId, vendorId: s.companyId, invoiceId: s.piRecordId,
      erp_doc_kind: 'payment', paid_amount: 1090000,
      references: [{ reference_doctype: 'Purchase Invoice', reference_name: piName, allocated_amount: 1090000 }],
    });
    expect(pe.status, `PE dispatch failed: ${pe.body.message}`).toBe(200);
    expect(await readDoc('Purchase Invoice', piName)).toMatchObject({ status: 'Paid', outstanding_amount: 0 });

    // 5. The feed brings the settlement back: Paid in PMO, gross / VAT / withheld unchanged.
    const sweep = await fetch(`${FUNCTIONS_URL}/functions/v1/erpnext-sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SWEEP_SECRET}` },
      body: JSON.stringify({ org_id: ORG_ID }),
    });
    expect([200, 202]).toContain(sweep.status);
    await sweep.arrayBuffer();
    await expect.poll(async () => (await bill()).data?.status, { timeout: 15_000 }).toBe('Paid');
    const { data: settled } = await bill();
    expect(settled).toMatchObject({ status: 'Paid', erp_outstanding_amount: 0, amount: 1110000, tax_amount: 110000, withheld_amount: 20000 });
  } finally {
    await cleanup(admin, s);
  }
});
```

In `scripts/check-e2e-skips.mjs`, directly after the `serial/AC-WHT-002-receipt-withholding.spec.ts` entry, add:

```js
  {
    file: 'serial/AC-VWH-005-vendor-withholding.spec.ts',
    reason: 'Vendor withholding settlement proof requires the local served-functions lane and throwaway ERPNext bench.',
    restore: 'Run with scripts/serve-functions.sh against the local ERPNext bench.',
    verified: '2026-10-07',
  },
```

**Verify:**
1. `cd "$WT/pmo-portal" && npm run check:e2e-isolation && node ../scripts/check-e2e-skips.mjs --self-test`
2. With the served-lane and bench env exported:
   `cd "$WT/pmo-portal" && ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh ../scripts/serve-functions.sh -- npx playwright test --project=serial e2e/serial/AC-VWH-005-vendor-withholding.spec.ts`
   → 1 passed. Then re-run `AC-ENA-053` and `AC-WHT-002` the same way (neighbours on the same mirror and the same
   sweep) → both pass.

## Task 20 — Mutation checks (~5 min; each mutation reverted before the next)

Every mutation must turn the named test RED; record each (file, mutation, red test) in the PR body.

| # | Mutate | Expect red | Command |
|---|---|---|---|
| M1 | `erpPurchaseTaxRows.ts`: `ledger?.root_type !== 'Liability'` → `false` | AC-VWH-003 "non-liability account" | `npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts` |
| M2 | same file: `if (withheldRate >= 100)` → `if (withheldRate > 100)` | AC-VWH-003 "adding up to 100%" | same |
| M3 | `purchaseInvoice.ts`: `amount: headerComplete ? addMoney(grandTotal, deducted) : grandTotal` → `amount: grandTotal` | AC-VWH-004 (gross) | `npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| M4 | `readModelWriters.ts`: delete `withheld_amount: piWithheld ?? '0.00',` | AC-VWH-006 "states 0.00" | `deno test readModelWriters.money.test.ts` |
| M5 | `erpnextFeedDeps.ts`: delete `withheld == null ||` from the all-or-nothing guard | AC-VWH-007 "WITHOUT the whole money header" (first partial) | `deno test ../_shared/erpnextFeedDeps.test.ts` |
| M6 | 0266: delete the `or new.withheld_amount …` guard line | AC-VWH-009 "mirror guard pins" | `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0266_vendor_withholding.test.sql'` |
| M7 | 0266: delete `and sign(withheld_amount) = sign(amount)` | AC-VWH-008 "sign parity" | same as M6 |
| M8 | `vendorWithholding.ts`: `netPayable: (cents(amount) - cents(withheldAmount)) / 100` → `netPayable: amount` | AC-VWH-010 | `npx vitest run src/lib/vendorWithholding.test.ts` |
| M9 | `erpSalesTaxRows.ts`: `if (rate < 0)` → `if (rate < -100)` | AC-VWH-013 | `npx vitest run src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts` |

Vitest commands run from `$WT/pmo-portal` under `../scripts/with-test-lock.sh`; Deno commands from
`$WT/supabase/functions/adapter-dispatch` (M4) and `$WT/supabase/functions/erpnext-sweep` (M5). After M6/M7, run the
reset once more on the restored migration.

## Task 21 — Docs (Director, docs-only, direct to `dev`) (~4 min)

1. Append to `docs/decisions.md`:

```markdown
**DD-VWH-1..9 (Director, 2026-10-07, #876, under OD-ERP-3/OD-ERP-4) — vendor withholding on ERP-owned bills.**
Ruled as written in `docs/specs/vendor-withholding.spec.md` §2 and ADR-0082: a new `procurement_invoices.withheld_amount`
(not null, default 0, sign-matched to `amount`, never larger); `amount` stays the gross bill and `tax_amount` stays VAT,
net payable = gross − withheld, derived (DD-VWH-1) · read back from the ERPNext header: gross = grand_total + deducted,
VAT = total taxes + deducted, withheld = deducted, outstanding verbatim; a payload without the field leaves withholding
unknown (DD-VWH-2) · Paid = ERPNext outstanding zero, i.e. the net paid; withheld tax is owed to the tax office
(DD-VWH-3) · DD-VI-3a is lifted for well-formed withholding templates; refused: any negative rate, any rate above 100%,
a Deduct row not counted in the Total only, included in the item price, or on a non-liability account, Deduct rates
summing to 100% or more (DD-VWH-4) · a mirrored bill's money and status refresh from any feed change carrying the whole
money header — FR-ENA-116's paid-detection, built (DD-VWH-5) · the ledger shows VAT, Tax withheld (PPh) and Net payable
under a withholding bill, nothing else changes (DD-VWH-6) · the column default is a fact for PMO-native bills; the
mirror always states the value (DD-VWH-7) · no cost, actual, commitment or budget figure is reduced by withholding;
never map a PPh payable account into a budget category (DD-VWH-8) · sales symmetry: client withholding stays on the
receipt, and a negative sales tax row is refused (DD-VWH-9). Plan: `docs/plans/2026-10-07-vendor-withholding.md`.
```

2. Directly under the DD-VI-3a bullet in `docs/decisions.md`, add:
`  - **Superseded in part (2026-10-07, #876):** well-formed withholding templates are now sent — see DD-VWH-4.`
3. In `docs/specs/erpnext-adapter.spec.md`, directly after the FR-ENA-116 bullet (ends "**amend is desk-only in P2**."), add:
`- **Amended 2026-10-07 (#876):** withholding on the PI mirror (gross / VAT / withheld) and the PI paid-detection
  refresh from the feed — \`docs/specs/vendor-withholding.spec.md\`, ADR-0082.`
4. Delete the stray file `docs/scratch-ignore.txt` (created in error during planning).

**Verify:** `grep -n "DD-VWH-1..9\|Superseded in part (2026-10-07" docs/decisions.md` → 2 hits;
`grep -n "Amended 2026-10-07 (#876)" docs/specs/erpnext-adapter.spec.md` → 1 hit; `test ! -e docs/scratch-ignore.txt`.

## Task 22 — Local final gate (~5 min)

```bash
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npm run typecheck \
  && npm run typecheck:edge \
  && npx eslint --max-warnings=0 src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts \
       src/lib/adapterSeam/erpnext/erpSalesTaxRows.ts src/lib/vendorWithholding.ts src/lib/db/procurementLedger.ts \
       pages/procurement/WithholdingBreakdown.tsx pages/procurement/ProcurementLedger.tsx pages/procurement/vendorInvoiceTestIds.ts \
       e2e/serial/AC-VWH-005-vendor-withholding.spec.ts \
  && npm run check:guards \
  && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
cd "$WT/supabase/functions/adapter-dispatch" && deno test readModelWriters.money.test.ts readModelWriters.crossOrg.test.ts
cd "$WT/supabase/functions/erpnext-sweep" && deno test ../_shared/erpnextFeedDeps.test.ts
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0266_vendor_withholding.test.sql supabase/tests/vendor_invoice_tax_treatment.test.sql supabase/tests/erpnext_money_flip_rls.test.sql'
```
Plus Task 19's e2e run (AC-VWH-005, AC-ENA-053, AC-WHT-002). All green, outputs pasted in the PR body.

Then: 3-reviewer pass (spec, code-quality, security — the security lens on the service-role writer scoping, the
mirror guard and the 0266 grant assert) and the rendered Discover pass on the procurement Documents tab with a
withholding bill on rich seed (desktop + 390 px) before the PR.

---

## 4. Deploy (owner-gated per instance; back to front)

1. **Preconditions (operator, on the target ERPNext):** RIS's withholding templates exist with Deduct rows on liability
   accounts (OQ-VWH-2); no PPh payable account is in the budget account map (DD-VWH-8); list PMO-mirrored Purchase
   Invoices with `taxes_and_charges_deducted <> 0` and re-mirror any (0266 header); re-run Task 0's S3–S6 on the v16
   test instance if the bench used for Task 0 was v15 (DD-PBL-12 precedent).
2. **DB:** 0266 (the §3 assert fails loudly if the column would be client-writable there).
3. **Edge functions:** `adapter-dispatch`, `erpnext-sweep`, `erpnext-webhook` (all three carry the mapper or the feed
   deps). DB first is mandatory: the new functions write `withheld_amount`.
4. **FE.**

## 5. Open questions for the Director / owner

- OQ-VWH-1..3 — spec §6 (rounding, RIS's template list, bukti potong number), each parked with a default.
- OBS-VWH-002 — vendor payment from the PMO ledger on a flipped org is not wired (no `paid_amount`, `references` or
  supplier on that path). AC-VWH-005 pays through the dispatch directly, as AC-ENA-053 does. Recommend a separate
  money-path issue before RIS go-live (OD-ERP-3: no one will pay vendors in ERPNext).
