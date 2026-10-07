# Plan — #876 slice 2: vendor tax set up in PMO, with editable amounts

- **Spec:** `docs/specs/vendor-withholding.spec.md` §7 (FR-VWH-010..020, AC-VWH-020..036; amends FR-VWH-008,
  AC-VWH-009, AC-VWH-010 in place)
- **ADR:** `docs/adr/0084-vendor-bill-tax-entered-amounts.md` (Proposed)
- **Decisions:** OD-VWH-1 (owner); DD-VWH-10..14 (Director, ruled); DD-VWH-15..22 (planner, **Director to ratify
  before Task 3** — spec §7.2)
- **Lane:** money path → **Director-dispatched**, not the ADW. Builder: opus for Tasks 0–14 (DB, dispatch, served
  tests), sonnet for Tasks 15–26 (UI). Reviewers: spec + code-quality + security (security depth on 0272's guard
  trigger, the definer function, the org column grants and the dispatch's row building).
- **Base:** `origin/dev` **after** the slice-1 PR (#876 slice 1, branch `feat/876-vendor-withholding`, migration 0266)
  has merged. If it has not, cut the slice-2 branch from `feat/876-vendor-withholding` and rebase onto `dev` once it
  lands. Every file and test below assumes slice 1's code is present.
- **Migration slot:** `0272` only (+ `supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql`).
- **Worktree:** `$WT` = the issue worktree the Director creates. Agents run no git.

## 1. Design in one screen

```
companies.default_vat_rate / default_pph_type / default_pph_rate      organizations.input_vat_account
   (set only via set_vendor_tax_defaults: Admin/Finance, audited;        pph23_payable_account / pph4_2_payable_account
    guard trigger refuses every other client write — DD-VWH-16)          (column grants, Admin-only policy, audited)
            │ pre-fill only (DD-VWH-19)                                               │ read by the dispatch on send
            ▼                                                                         ▼
Bill form ─ standalone: amount + treatment → VAT pre-filled, PPh pre-filled ─► create_procurement_invoice / capture_vendor_invoice
          │                                   (editable; latch per field)         (+ p_withheld_amount, DD-VWH-10)
          └ ERP-bound: "Enter the tax amounts" (default) | named template (DD-VWH-15)
                       VAT, PPh type, PPh amount pre-filled on the items total
                       ─► dispatch record { vatAmount, withheldAmount, pphType }
                              │ resolvePurchaseInvoiceTaxes (server): drop client rows + marker; template XOR amounts;
                              │ shape-check; withheld ≤ items total; read org accounts; check each in ERPNext
                              ▼
                       ERPNext PI: items (net) + taxes [Actual VAT Add, Actual PPh Deduct], taxes_and_charges ''
                              │ mirror unchanged (DD-VWH-2): gross = grand_total + deducted, VAT, withheld
```

- **Scaling:** the bill form adds one company read (react-query, 30 s stale, same cache key as the company page);
  the dispatch adds one `organizations` row read + ≤ 2 ERPNext Account GETs per create, none on replay; the guard
  trigger is three `is distinct from` comparisons per companies write; all lookups are by primary key.
- **No duplicate logic:** one pure module (`src/lib/vendorWithholding.ts`) owns every client-side money computation;
  one hook module (`src/hooks/useVendorBillTax.ts`) and one component module (`VendorBillTaxFields.tsx`) serve BOTH
  vendor-bill entry points; one server function pair (`erpPurchaseTaxRows.ts`) builds every ERP tax row.

## 2. Files

| File | Change |
|---|---|
| `supabase/migrations/0272_vendor_tax_defaults.sql` | NEW |
| `supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql` | NEW |
| `supabase/tests/0272_vendor_tax_defaults.test.sql` | NEW — AC-VWH-020/021/022 |
| `supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql` | NEW — AC-VWH-023/024 |
| `supabase/tests/0266_vendor_withholding.test.sql` | AC-VWH-009 description amended |
| `supabase/tests/0178_anon_executable_definers.test.sql` | allow-list + count |
| `scripts/isolation-probe-denominator.json` | definer signatures |
| `pmo-portal/src/lib/supabase/database.types.ts` | regenerated |
| `pmo-portal/src/lib/vendorWithholding.ts` + `.test.ts` | basis-aware figures; defaults + suggestions + parsers |
| `pmo-portal/pages/procurement/ProcurementLedger.tsx` + `.test.tsx` | call-site passes the basis; AC-VWH-026 render |
| `pmo-portal/src/auth/policy.ts` + `policy.vendorTax.test.ts` | `vendorTaxDefault.manage` |
| `pmo-portal/src/lib/db/companies.ts` + `companies.taxDefaults.test.ts` | `setCompanyTaxDefaults` |
| `pmo-portal/src/lib/db/orgs.ts` + `orgs.vendorTax.test.ts` | `get/setOrgVendorTaxAccounts` |
| `pmo-portal/src/lib/db/procurementLifecycle.ts` + `.test.ts` | `withheldAmount`, `erpTaxAmounts` |
| `pmo-portal/src/lib/repositories/types.ts`, `index.ts`, `index.test.ts`, `procurement.external.test.ts` | seams |
| `pmo-portal/src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts` | entered-amount rows |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` | `resolvePurchaseInvoiceTaxes` |
| `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts` | NEW — AC-VWH-033 |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts` + `bodies/bodies.test.ts` | AC-VWH-034 |
| `supabase/functions/adapter-dispatch/vendorTaxAmounts.test.ts` | NEW — AC-VWH-035 |
| `pmo-portal/src/hooks/useSuggestedMoney.ts` + `.test.ts` | NEW |
| `pmo-portal/src/hooks/useVendorTaxDefault.ts`, `useVendorBillTax.ts` | NEW |
| `pmo-portal/pages/procurement/vendorInvoiceTestIds.ts` | `VI_VENDOR_TAX_TEST_IDS` |
| `pmo-portal/pages/procurement/VendorBillTaxFields.tsx` | NEW |
| `pmo-portal/pages/procurement/RecordCaptureForm.tsx` + `RecordCaptureForm.vendorTax.test.tsx` (NEW) + `RecordCaptureForm.taxTemplate.test.tsx` | wiring; one retired case |
| `pmo-portal/pages/procurement/ProcurementDecisionZone.tsx`, `vendorInvoiceTax.ts` | inline capture + props |
| `pmo-portal/pages/ProcurementDetails.tsx` + `pages/__tests__/ProcurementDetails.externalRef.test.tsx` | forwarding |
| `pmo-portal/pages/company/VendorTaxDefaultsCard.tsx` + `.test.tsx` (NEW), `pages/CompanyDetail.tsx` | AC-VWH-028 |
| `pmo-portal/pages/admin/OrgVendorTaxAccounts.tsx` + `.test.tsx` (NEW), `pages/Administration.tsx` | AC-VWH-029 |
| `pmo-portal/public/locales/{en,id}/common.json` | `procurementDetail.vendorTax.*`, `erpTaxTemplate.*`, `companyDetail.vendorTax.*`, `admin.vendorTaxAccounts.*` |
| `pmo-portal/e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts` + `scripts/check-e2e-skips.mjs` | AC-VWH-036 |
| `docs/reviews/2026-10-07-vendor-withholding-erp-spike.md` | Task 0 addendum |

## 3. Traceability

| AC | Owning test (layer) | Tasks |
|---|---|---|
| AC-VWH-020/021/022 | `supabase/tests/0272_vendor_tax_defaults.test.sql` (pgTAP) | 1, 3 |
| AC-VWH-023/024 | `supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql` (pgTAP) | 2, 3 |
| AC-VWH-009 (amended) | `supabase/tests/0266_vendor_withholding.test.sql` (pgTAP) | 5 |
| AC-VWH-025/026, AC-VWH-010 (amended) | `src/lib/vendorWithholding.test.ts` (Vitest); AC-VWH-026 render in `ProcurementLedger.test.tsx` (RTL) | 6, 7 |
| AC-VWH-027 | `src/auth/policy.vendorTax.test.ts` (Vitest) | 8 |
| AC-VWH-032 | DAL / repository Vitest files (Task 9) + page RTL (Task 19) | 9, 10, 19, 20 |
| AC-VWH-035 | `supabase/functions/adapter-dispatch/vendorTaxAmounts.test.ts` (Deno, shipped handler) | 11, 13 |
| AC-VWH-033 | `src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts` (Vitest) | 12, 13 |
| AC-VWH-034 | `src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` (Vitest) | 14 |
| AC-VWH-030 | `RecordCaptureForm.vendorTax.test.tsx` (RTL) + `useSuggestedMoney.test.ts` + page RTL | 15, 16, 17, 18, 19, 20 |
| AC-VWH-031 | `RecordCaptureForm.vendorTax.test.tsx` (RTL) | 16, 17, 18 |
| AC-VWH-028 | `pages/company/VendorTaxDefaultsCard.test.tsx` (RTL) | 21, 22 |
| AC-VWH-029 | `pages/admin/OrgVendorTaxAccounts.test.tsx` (RTL) | 23, 24 |
| AC-VWH-036 | `e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts` (served e2e, bench) | 0, 25 |

---

## Task 0 — Bench spike: an empty template and fixed `Actual` rows with a default template present (GATE, ~5 min)

The slice-1 spike addendum proved `Actual` rows land their stated amounts. This closes the one remaining unknown:
whether ERPNext applies a **default** purchase tax template when PMO sends `taxes_and_charges: ''`. Writes only the
addendum below. Bench credentials exported in the shell (never printed, never committed), under the ERPNext lock.

```bash
cd "$WT" && scripts/with-erpnext-lock.sh bash -c '
B=http://localhost:8080
H=(-H "Authorization: token ${ERPNEXT_BENCH_API_KEY}:${ERPNEXT_BENCH_API_SECRET}" -H "Content-Type: application/json")
DEF='"'"'[{"charge_type":"On Net Total","account_head":"Spike PPN Masukan - PSC","description":"Default VAT 11%","rate":11,"category":"Total","add_deduct_tax":"Add"}]'"'"'
echo "D1 default template"; curl -s "${H[@]}" -X POST "$B/api/resource/Purchase%20Taxes%20and%20Charges%20Template" \
  -d "$(jq -n --argjson r "$DEF" "{title:\"Spike Default VAT\",company:\"PMO Smoke Co\",is_default:1,taxes:\$r}")" | jq -r ".data.name // .exc_type"
mk() { curl -s "${H[@]}" -X POST "$B/api/resource/Purchase%20Invoice" -d "$(jq -n --argjson t "$1" "{supplier:\"Spike Supplier\",company:\"PMO Smoke Co\",items:[{item_code:\"SPIKE-ITEM-1\",qty:1,rate:1000000}],taxes_and_charges:\"\",taxes:\$t}")" | jq -r ".data.name // .exc_type"; }
PI0=$(mk "[]"); curl -s "${H[@]}" -X PUT "$B/api/resource/Purchase%20Invoice/$PI0" -d "{\"docstatus\":1}" >/dev/null
echo "D2 no-tax bill, default template present"; curl -s "${H[@]}" "$B/api/resource/Purchase%20Invoice/$PI0" | jq ".data | {name,taxes_and_charges,net_total,total_taxes_and_charges,grand_total,rows:(.taxes|length)}"
ROWS='"'"'[{"charge_type":"Actual","account_head":"Spike PPN Masukan - PSC","description":"VAT","tax_amount":110000,"category":"Total","add_deduct_tax":"Add"},{"charge_type":"Actual","account_head":"Spike PPh 23 Payable - PSC","description":"PPh 23","tax_amount":20000,"category":"Total","add_deduct_tax":"Deduct"}]'"'"'
PI1=$(mk "$ROWS"); curl -s "${H[@]}" -X PUT "$B/api/resource/Purchase%20Invoice/$PI1" -d "{\"docstatus\":1}" >/dev/null
echo "D3 entered amounts, default template present"; curl -s "${H[@]}" "$B/api/resource/Purchase%20Invoice/$PI1" | jq ".data | {name,taxes_and_charges,taxes_and_charges_added,taxes_and_charges_deducted,grand_total,outstanding_amount,rows:[.taxes[]|{charge_type,account_head,add_deduct_tax,tax_amount}]}"
echo "D4 restore"; curl -s "${H[@]}" -X PUT "$B/api/resource/Purchase%20Taxes%20and%20Charges%20Template/Spike%20Default%20VAT%20-%20PSC" -d "{\"is_default\":0,\"disabled\":1}" | jq -r ".data.name // .exc_type"
'
```

Append to `docs/reviews/2026-10-07-vendor-withholding-erp-spike.md` a section **"Addendum 2 — empty template with a
default present (slice 2, Task 0)"** with a table *Step · Expected · Observed*: D1 `Spike Default VAT - PSC` ·
D2 `total_taxes_and_charges 0, grand_total 1000000, rows 0` · D3 `added 110000, deducted 20000, grand_total 1090000,
outstanding 1090000, exactly the two Actual rows` · D4 `Spike Default VAT - PSC` (disabled). List the two document
names left on the bench.

**Gate:** if D2 shows any tax or row, or D3 shows a third row → **STOP** and report to the Director: ERPNext applies the
default over an explicit empty table, and DD-VWH-13's zero-tax case needs a different body (do not improvise one). If
D1 errors because the template already exists from an earlier run, PUT `{"is_default":1,"disabled":0}` on it and
continue.

---

## Task 1 — pgTAP red: company vendor tax defaults (AC-VWH-020, AC-VWH-021, AC-VWH-022) (~5 min)

Create `supabase/tests/0272_vendor_tax_defaults.test.sql`:

```sql
-- 0272_vendor_tax_defaults.test.sql — 0272 §1–§3 (#876 slice 2; OD-VWH-1; DD-VWH-11, DD-VWH-16).
-- Owns AC-VWH-020 (shape + bounds), AC-VWH-021 (who may set the defaults; audited; outside the companies ERP mirror
-- guard) and AC-VWH-022 (no other client write path; function grants).
begin;
select plan(35);

-- Fixtures, written as the table owner with NO JWT (the §2 guard lets a no-JWT session through: migrations, seed).
insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000201','#876 S2 Org','IDR'),
  ('08760000-0000-0000-0000-000000000202','#876 S2 Other Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000002a1','s2-admin@example.com'),
  ('08760000-0000-0000-0000-0000000002a2','s2-fin@example.com'),
  ('08760000-0000-0000-0000-0000000002a3','s2-pm@example.com'),
  ('08760000-0000-0000-0000-0000000002a4','s2-exec@example.com'),
  ('08760000-0000-0000-0000-0000000002a5','s2-eng@example.com'),
  ('08760000-0000-0000-0000-0000000002a6','s2-gone@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000002a1','08760000-0000-0000-0000-000000000201','S2 Admin','s2-admin@example.com','Admin','active'),
  ('08760000-0000-0000-0000-0000000002a2','08760000-0000-0000-0000-000000000201','S2 Finance','s2-fin@example.com','Finance','active'),
  ('08760000-0000-0000-0000-0000000002a3','08760000-0000-0000-0000-000000000201','S2 PM','s2-pm@example.com','Project Manager','active'),
  ('08760000-0000-0000-0000-0000000002a4','08760000-0000-0000-0000-000000000201','S2 Exec','s2-exec@example.com','Executive','active'),
  ('08760000-0000-0000-0000-0000000002a5','08760000-0000-0000-0000-000000000201','S2 Eng','s2-eng@example.com','Engineer','active'),
  ('08760000-0000-0000-0000-0000000002a6','08760000-0000-0000-0000-000000000201','S2 Gone','s2-gone@example.com','Finance','disabled');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000002c1','08760000-0000-0000-0000-000000000201','#876 S2 Vendor','Vendor'),
  ('08760000-0000-0000-0000-0000000002c2','08760000-0000-0000-0000-000000000201','#876 S2 Internal','Internal'),
  ('08760000-0000-0000-0000-0000000002c3','08760000-0000-0000-0000-000000000202','#876 S2 Foreign Vendor','Vendor');

-- §A shape and bounds (AC-VWH-020): owner, no JWT, so only the CHECKs decide.
select col_type_is('public','companies','default_vat_rate','numeric(6,3)','AC-VWH-020 default_vat_rate is numeric(6,3)');
select col_type_is('public','companies','default_pph_rate','numeric(6,3)','AC-VWH-020 default_pph_rate is numeric(6,3)');
select col_type_is('public','companies','default_pph_type','text','AC-VWH-020 default_pph_type is text');
select throws_ok($$ update companies set default_vat_rate = 100.001 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a VAT rate above 100% is refused');
select throws_ok($$ update companies set default_vat_rate = 'NaN' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a NaN VAT rate is refused (the upper bound is what rejects it)');
select throws_ok($$ update companies set default_vat_rate = -0.001 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a negative VAT rate is refused');
select throws_ok($$ update companies set default_pph_type = 'pph21', default_pph_rate = 2 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 an unknown withholding type is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a withholding type with no rate is refused');
select throws_ok($$ update companies set default_pph_rate = 2 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a withholding rate with no type is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23', default_pph_rate = 100 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a 100% withholding rate is refused');
select throws_ok($$ update companies set default_pph_type = 'pph23', default_pph_rate = 0 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '23514', null, 'AC-VWH-020 a 0% withholding rate is refused (no withholding is type none)');
select lives_ok($$ update companies set default_vat_rate = 0, default_pph_type = 'pph4_2', default_pph_rate = 1.75
                   where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-020 a non-VAT vendor (0%) withholding PPh 4(2) at 1.75% is accepted');

-- §B set_vendor_tax_defaults (AC-VWH-021)
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 11, 'pph23', 2) $$,
  'AC-VWH-021 Finance sets a vendor''s tax defaults');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(11.000,pph23,2.000)', 'AC-VWH-021 the defaults are stored as given');
select is((select count(*)::int from audit_events where action = 'company.tax_defaults.change'
            and entity_id = '08760000-0000-0000-0000-0000000002c1' and actor_id = '08760000-0000-0000-0000-0000000002a2'),
  1, 'AC-VWH-021 the change is audited with its actor');
select is((select (detail->'from'->>'pph_type') || '>' || (detail->'to'->>'pph_type') from audit_events
            where action = 'company.tax_defaults.change' and entity_id = '08760000-0000-0000-0000-0000000002c1'),
  'pph4_2>pph23', 'AC-VWH-021 the audit states the previous and the new values');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a1","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 12, null, null) $$,
  'AC-VWH-021 Admin changes the VAT rate and clears the withholding');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(12.000,,)', 'AC-VWH-021 clearing the withholding clears type and rate together');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a3","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 a Project Manager is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a4","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 an Executive is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a5","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', 'only Admin or Finance can set a vendor''s tax defaults', 'AC-VWH-021 an Engineer is refused');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a6","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 1, null, null) $$,
  '42501', null, 'AC-VWH-021 a disabled Finance account is refused (active-member gate)');
reset role;
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c3', 11, null, null) $$,
  'P0002', 'company not found', 'AC-VWH-021 another organization''s vendor is not found (no cross-org write, no existence leak)');
select throws_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c2', 11, null, null) $$,
  'P0001', 'an internal company has no vendor tax defaults', 'AC-VWH-021 an Internal company has no vendor tax defaults');
reset role;
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c1'),
  '(12.000,,)', 'AC-VWH-021 every refusal left the defaults unchanged');
select is((select row(default_vat_rate, default_pph_type, default_pph_rate)::text from companies
            where id = '08760000-0000-0000-0000-0000000002c3'),
  '(,,)', 'AC-VWH-021 the other organization''s vendor is untouched');

-- Companies owned by ERPNext: the defaults are outside the mirror guard; the guard itself is unchanged.
insert into external_domain_ownership (org_id, external_tier, domain) values
  ('08760000-0000-0000-0000-000000000201','erpnext','companies');
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select set_vendor_tax_defaults('08760000-0000-0000-0000-0000000002c1', 11, 'pph4_2', 1.75) $$,
  'AC-VWH-021 the defaults can be set while companies are owned by ERPNext');
select throws_ok($$ update companies set name = 'Renamed' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '42501', 'company native fields are read-only while companies are externally-owned',
  'AC-VWH-021 CONTROL the ERP mirror guard still pins the vendor''s name');
reset role;
delete from external_domain_ownership where org_id = '08760000-0000-0000-0000-000000000201' and domain = 'companies';

-- §C no other client write path (AC-VWH-022)
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000002a1","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ update companies set default_vat_rate = 5 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  '42501', 'vendor tax defaults are changed only through set_vendor_tax_defaults',
  'AC-VWH-022 an Admin''s direct UPDATE is refused — even after set_vendor_tax_defaults ran in this transaction (the flag is cleared)');
select throws_ok($$ insert into companies (org_id, name, type, default_pph_type, default_pph_rate)
                    values ('08760000-0000-0000-0000-000000000201','#876 S2 Sneaky','Vendor','pph23',2) $$,
  '42501', 'vendor tax defaults are changed only through set_vendor_tax_defaults',
  'AC-VWH-022 a direct INSERT carrying a default is refused');
select lives_ok($$ update companies set short_name = 'S2V' where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-022 CONTROL other company edits are unaffected');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$ update companies set default_vat_rate = 10 where id = '08760000-0000-0000-0000-0000000002c1' $$,
  'AC-VWH-022 CONTROL the service role (ERP mirror, importers) is not refused');
select ok(not has_function_privilege('anon', 'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)', 'execute'),
  'AC-VWH-022 anon cannot execute set_vendor_tax_defaults');
select ok(has_function_privilege('authenticated', 'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)', 'execute'),
  'AC-VWH-022 authenticated can execute it (its body gates the role)');
select ok(not has_function_privilege('authenticated', 'public.companies_tax_defaults_guard()', 'execute')
          and not has_function_privilege('anon', 'public.companies_tax_defaults_guard()', 'execute'),
  'AC-VWH-022 the guard trigger function is not client-callable');

select * from finish();
rollback;
```

**Verify red:** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0272_vendor_tax_defaults.test.sql'`
→ fails (`column "default_vat_rate" does not exist`).

## Task 2 — pgTAP red: org tax accounts + standalone withholding (AC-VWH-023, AC-VWH-024) (~5 min)

Create `supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql`:

```sql
-- 0272_vendor_tax_accounts_native_withholding.test.sql — 0272 §4–§6 (#876 slice 2; DD-VWH-10, DD-VWH-12).
-- Owns AC-VWH-023 (org vendor-bill tax accounts: shape, Admin-only, audited, grants) and AC-VWH-024 (a standalone
-- vendor invoice records a stated withholding through both create functions; the create audit records it).
begin;
select plan(24);

insert into organizations (id, name, default_currency) values
  ('08760000-0000-0000-0000-000000000301','#876 S2B Org','IDR');
insert into auth.users (id, email) values
  ('08760000-0000-0000-0000-0000000003a1','s2b-admin@example.com'),
  ('08760000-0000-0000-0000-0000000003a2','s2b-fin@example.com'),
  ('08760000-0000-0000-0000-0000000003a3','s2b-req@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('08760000-0000-0000-0000-0000000003a1','08760000-0000-0000-0000-000000000301','S2B Admin','s2b-admin@example.com','Admin','active'),
  ('08760000-0000-0000-0000-0000000003a2','08760000-0000-0000-0000-000000000301','S2B Finance','s2b-fin@example.com','Finance','active'),
  ('08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-000000000301','S2B Requester','s2b-req@example.com','Engineer','active');
insert into companies (id, org_id, name, type) values
  ('08760000-0000-0000-0000-0000000003c1','08760000-0000-0000-0000-000000000301','#876 S2B Vendor','Vendor');
insert into procurements (id, org_id, title, status, requested_by_id, vendor_id) values
  ('08760000-0000-0000-0000-0000000003d1','08760000-0000-0000-0000-000000000301','#876 S2B quoted','Vendor Quoted',
   '08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-0000000003c1'),
  ('08760000-0000-0000-0000-0000000003d2','08760000-0000-0000-0000-000000000301','#876 S2B received','Received',
   '08760000-0000-0000-0000-0000000003a3','08760000-0000-0000-0000-0000000003c1');

-- §A org vendor-bill tax accounts (AC-VWH-023)
select has_column('public','organizations','input_vat_account','AC-VWH-023 organizations.input_vat_account exists');
select has_column('public','organizations','pph23_payable_account','AC-VWH-023 organizations.pph23_payable_account exists');
select has_column('public','organizations','pph4_2_payable_account','AC-VWH-023 organizations.pph4_2_payable_account exists');
select throws_ok($$ update organizations set input_vat_account = '   ' where id = '08760000-0000-0000-0000-000000000301' $$,
  '23514', null, 'AC-VWH-023 a blank account name is refused');
select throws_ok($$ update organizations set pph23_payable_account = repeat('x', 141) where id = '08760000-0000-0000-0000-000000000301' $$,
  '23514', null, 'AC-VWH-023 an account name longer than the ERPNext link limit is refused');
select ok(has_column_privilege('authenticated','public.organizations','input_vat_account','UPDATE')
      and has_column_privilege('authenticated','public.organizations','pph23_payable_account','UPDATE')
      and has_column_privilege('authenticated','public.organizations','pph4_2_payable_account','UPDATE'),
  'AC-VWH-023 authenticated holds the three column UPDATE grants (the Admin-only policy decides the row)');
select ok(not (has_column_privilege('anon','public.organizations','input_vat_account','UPDATE')
            or has_column_privilege('anon','public.organizations','pph23_payable_account','UPDATE')
            or has_column_privilege('anon','public.organizations','pph4_2_payable_account','UPDATE')
            or has_column_privilege('authenticated','public.organizations','input_vat_account','INSERT')
            or has_column_privilege('anon','public.organizations','input_vat_account','INSERT')),
  'AC-VWH-023 no other client write privilege on the three columns');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a1","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ update organizations set input_vat_account = 'Input VAT - S2', pph23_payable_account = 'PPh 23 Payable - S2'
                   where id = '08760000-0000-0000-0000-000000000301' $$,
  'AC-VWH-023 an Admin sets the vendor-bill tax accounts');
reset role;
select is((select input_vat_account || '|' || pph23_payable_account from organizations where id = '08760000-0000-0000-0000-000000000301'),
  'Input VAT - S2|PPh 23 Payable - S2', 'AC-VWH-023 the Admin''s accounts are stored');
select is((select count(*)::int from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301' and actor_id = '08760000-0000-0000-0000-0000000003a1'),
  1, 'AC-VWH-023 the change is audited with its actor');
select is((select detail->'to'->>'pph23' from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301'),
  'PPh 23 Payable - S2', 'AC-VWH-023 the audit states the new value');

set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ update organizations set pph23_payable_account = 'Hijack - S2' where id = '08760000-0000-0000-0000-000000000301' $$,
  'AC-VWH-023 CONTROL a Finance UPDATE is not an error — it reaches no row');
reset role;
select is((select pph23_payable_account from organizations where id = '08760000-0000-0000-0000-000000000301'),
  'PPh 23 Payable - S2', 'AC-VWH-023 a Finance user cannot change the accounts (Admin-only policy)');
select is((select count(*)::int from audit_events where action = 'org.vendor_tax_accounts.change'
            and org_id = '08760000-0000-0000-0000-000000000301'),
  1, 'AC-VWH-023 and nothing more was audited');

-- §B standalone withholding (AC-VWH-024), procurement PMO-owned
set local request.jwt.claims = '{"sub":"08760000-0000-0000-0000-0000000003a2","role":"authenticated"}';
set local role authenticated;
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-WH', 1000000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 110000, p_withheld_amount => 20000) $$,
  'AC-VWH-024 Finance records a standalone bill with PPh withheld');
select lives_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NONE', 500000::numeric,
                     p_tax_treatment => 'exclusive', p_tax_amount => 55000) $$,
  'AC-VWH-024 CONTROL a bill that states no withholding still records');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NOAMT', null::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 5) $$,
  '23514', null, 'AC-VWH-024 a withholding on a bill with no amount is refused');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-NEG', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => -1) $$,
  '23514', null, 'AC-VWH-024 a negative withholding on a positive bill is refused');
select throws_ok($$ select create_procurement_invoice('08760000-0000-0000-0000-0000000003d1'::uuid,
                      'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-BIG', 1000::numeric,
                      p_tax_treatment => 'exclusive', p_tax_amount => 0, p_withheld_amount => 1000.01) $$,
  '23514', null, 'AC-VWH-024 a withholding above the bill amount is refused');
select lives_ok($$ select capture_vendor_invoice('08760000-0000-0000-0000-0000000003d2'::uuid,
                     'Received'::procurement_invoice_status, '2026-10-07'::date, 'VI-S2-CAP', 2000000::numeric, null,
                     p_tax_treatment => 'exclusive', p_tax_amount => 220000, p_withheld_amount => 40000) $$,
  'AC-VWH-024 Mark Vendor Invoiced (the atomic capture) records PPh withheld');
reset role;
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-WH'),
  20000.00::numeric, 'AC-VWH-024 the stated withholding is stored on the bill');
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-NONE'),
  0.00::numeric, 'AC-VWH-024 a bill that states none records 0');
select is((select withheld_amount from procurement_invoices where reference_number = 'VI-S2-CAP'),
  40000.00::numeric, 'AC-VWH-024 the capture path forwards the withholding');
select is((select (detail->>'withheld_amount') || '|' || (detail->>'tax_amount') from audit_events
            where action = 'procurement_invoice.create'
              and entity_id = (select id from procurement_invoices where reference_number = 'VI-S2-WH')),
  '20000.00|110000.00', 'AC-VWH-024 the create audit records the VAT and the tax withheld');

select * from finish();
rollback;
```

**Verify red:** `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql'`
→ fails (`column "input_vat_account" does not exist`).

## Task 3 — Migration 0272, green (AC-VWH-020..024) (~5 min)

**Precondition:** the Director has ratified DD-VWH-15..22 (spec §7.2). Create
`supabase/migrations/0272_vendor_tax_defaults.sql`:

```sql
-- 0272_vendor_tax_defaults.sql — #876 slice 2: vendor tax set up in PMO (OD-VWH-1; DD-VWH-10..12; ADR-0084).
--
--   §1 companies: the vendor's default tax treatment (DD-VWH-11) — a form PRE-FILL only. No server path reads these
--      when a bill is recorded (DD-VWH-19): the bill's entered amounts are the authority, so changing a default never
--      re-states an old bill.
--   §2 companies_tax_defaults_guard (DD-VWH-16): the three columns change only through §3. `companies` carries
--      table-level INSERT/UPDATE grants to authenticated (0075) under a four-role UPDATE policy (0097), and a column
--      REVOKE cannot subtract from a table-level grant, so the rule is a trigger honouring §3's transaction-local flag
--      (the 0252 pattern). Converting companies to column grants was rejected: every FUTURE companies column would
--      silently become client-unwritable (0175's snapshot semantics). Exempt: the service role (ERP companies mirror,
--      importers) and a session with no JWT (migrations, seed, psql).
--   §3 set_vendor_tax_defaults(): SECURITY DEFINER; active member; Admin/Finance; own org; not Internal; audited.
--      Deliberately OUTSIDE companies_native_mirror_guard: ERPNext holds no such fact for PMO to mirror.
--   §4 organizations: input_vat_account, pph23_payable_account, pph4_2_payable_account (DD-VWH-12) on the
--      tax_prepaid_account precedent (0232): column UPDATE grant + the Admin-only organizations UPDATE policy, audited.
--      The dispatch checks each account in ERPNext on send (ADR-0084 §4).
--   §5 create_procurement_invoice / capture_vendor_invoice gain p_withheld_amount numeric default 0 (DD-VWH-10).
--      Bodies are 0238's verbatim plus the parameter; signature change ⇒ drop + create (0238 precedent).
--   §6 the procurement-invoice create audit (0178 L3) also records tax_amount and withheld_amount (0232 precedent).
--   §7 on-database asserts: hosted Supabase's grant defaults differ from local Docker, so the intended function and
--      column privileges are asserted HERE, on the database being migrated.
--
-- Rollback: supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql (revert the slice-2 adapter-dispatch first —
-- it reads §4's columns and sends §5's parameter).

-- §1 — the vendor's default tax treatment.
alter table public.companies
  add column default_vat_rate numeric(6,3),
  add column default_pph_type text,
  add column default_pph_rate numeric(6,3);

alter table public.companies
  add constraint companies_default_vat_rate_range
    check (default_vat_rate is null or (default_vat_rate >= 0 and default_vat_rate <= 100)),
  add constraint companies_default_pph_type_domain
    check (default_pph_type is null or default_pph_type in ('pph23', 'pph4_2')),
  add constraint companies_default_pph_pair
    check ((default_pph_type is null) = (default_pph_rate is null)),
  add constraint companies_default_pph_rate_range
    check (default_pph_rate is null or (default_pph_rate > 0 and default_pph_rate < 100));

comment on column public.companies.default_vat_rate is
  '#876 slice 2 (OD-VWH-1): the VAT rate (percent) a new bill from this vendor is pre-filled with. NULL = not set; '
  '0 = the vendor charges no VAT. Pre-fill only — never read by a write path. Set via set_vendor_tax_defaults().';
comment on column public.companies.default_pph_type is
  '#876 slice 2: the income tax withheld from this vendor by default — pph23 or pph4_2; NULL = none. Set together with '
  'default_pph_rate via set_vendor_tax_defaults().';
comment on column public.companies.default_pph_rate is
  '#876 slice 2: the PPh rate (percent, above 0 and below 100) that pre-fills the tax withheld on a new bill.';

-- §2 — the only-through-§3 rule.
create or replace function public.companies_tax_defaults_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('pmo.vendor_tax_defaults_write', true), '') = 'on'
     or auth.jwt() is null
     or coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.default_vat_rate is not null or new.default_pph_type is not null or new.default_pph_rate is not null then
      raise exception 'vendor tax defaults are changed only through set_vendor_tax_defaults' using errcode = '42501';
    end if;
  elsif new.default_vat_rate is distinct from old.default_vat_rate
     or new.default_pph_type is distinct from old.default_pph_type
     or new.default_pph_rate is distinct from old.default_pph_rate then
    raise exception 'vendor tax defaults are changed only through set_vendor_tax_defaults' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke all on function public.companies_tax_defaults_guard() from public, anon, authenticated;
create trigger companies_tax_defaults_guard before insert or update on public.companies
  for each row execute function public.companies_tax_defaults_guard();

-- §3 — the one client write path.
create or replace function public.set_vendor_tax_defaults(
  p_company_id uuid, p_vat_rate numeric default null, p_pph_type text default null, p_pph_rate numeric default null)
  returns public.companies language plpgsql security definer set search_path = public as $$
declare
  v_row  public.companies;
  v_from jsonb;
begin
  perform public.assert_is_active_member();
  if auth_role() not in ('Admin', 'Finance') then
    raise exception 'only Admin or Finance can set a vendor''s tax defaults' using errcode = '42501';
  end if;
  select * into v_row from public.companies where id = p_company_id and org_id = auth_org_id() for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_row.type = 'Internal' then
    raise exception 'an internal company has no vendor tax defaults' using errcode = 'P0001';
  end if;
  v_from := jsonb_build_object('vat_rate', v_row.default_vat_rate, 'pph_type', v_row.default_pph_type,
                               'pph_rate', v_row.default_pph_rate);
  perform set_config('pmo.vendor_tax_defaults_write', 'on', true);
  update public.companies
     set default_vat_rate = p_vat_rate,
         default_pph_type = nullif(btrim(p_pph_type), ''),
         default_pph_rate = p_pph_rate
   where id = p_company_id
   returning * into v_row;
  -- Cleared at once: the flag is transaction-local, so leaving it on would let a later direct UPDATE in the same
  -- transaction past §2 (0252's rule; AC-VWH-022 proves it).
  perform set_config('pmo.vendor_tax_defaults_write', '', true);
  perform public.log_audit('company.tax_defaults.change', v_row.org_id, auth.uid(), v_row.id,
    jsonb_build_object('from', v_from,
                       'to', jsonb_build_object('vat_rate', v_row.default_vat_rate, 'pph_type', v_row.default_pph_type,
                                                'pph_rate', v_row.default_pph_rate)));
  return v_row;
end; $$;
revoke all on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) to authenticated;
comment on function public.set_vendor_tax_defaults(uuid, numeric, text, numeric) is
  '#876 slice 2 (DD-VWH-11): sets a vendor''s default tax treatment. Active Admin/Finance member of the company''s org; '
  'not Internal; audited (company.tax_defaults.change). The only client path past companies_tax_defaults_guard.';

-- §4 — the org's vendor-bill tax accounts.
alter table public.organizations
  add column input_vat_account text
    constraint organizations_input_vat_account_check
    check (input_vat_account is null or length(btrim(input_vat_account)) between 1 and 140),
  add column pph23_payable_account text
    constraint organizations_pph23_payable_account_check
    check (pph23_payable_account is null or length(btrim(pph23_payable_account)) between 1 and 140),
  add column pph4_2_payable_account text
    constraint organizations_pph4_2_payable_account_check
    check (pph4_2_payable_account is null or length(btrim(pph4_2_payable_account)) between 1 and 140);
grant update (input_vat_account, pph23_payable_account, pph4_2_payable_account) on public.organizations to authenticated;
-- The existing own-org, active-member, Admin-only organizations UPDATE policy applies (0231/0232).

create or replace function public.audit_org_vendor_tax_accounts() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.input_vat_account is distinct from old.input_vat_account
     or new.pph23_payable_account is distinct from old.pph23_payable_account
     or new.pph4_2_payable_account is distinct from old.pph4_2_payable_account then
    perform public.log_audit('org.vendor_tax_accounts.change', new.id, auth.uid(), new.id,
      jsonb_build_object(
        'from', jsonb_build_object('input_vat', old.input_vat_account, 'pph23', old.pph23_payable_account,
                                   'pph4_2', old.pph4_2_payable_account),
        'to',   jsonb_build_object('input_vat', new.input_vat_account, 'pph23', new.pph23_payable_account,
                                   'pph4_2', new.pph4_2_payable_account)));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_vendor_tax_accounts() from public, anon, authenticated;
create trigger organizations_audit_vendor_tax_accounts after update on public.organizations
  for each row execute function public.audit_org_vendor_tax_accounts();

-- §5 — standalone bills may record tax withheld (DD-VWH-10). 0238's bodies plus p_withheld_amount.
drop function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text);
drop function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text);
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref,
     withheld_amount)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''),
            coalesce(p_withheld_amount, 0))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric) from public;
grant  execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric) from anon;

create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null,
  p_withheld_amount numeric default 0)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template,
    p_tax_base_numerator => p_tax_base_numerator,
    p_tax_base_denominator => p_tax_base_denominator,
    p_external_ref   => p_external_ref,
    p_withheld_amount => p_withheld_amount);

  return v_invoice;
end; $$;
revoke all     on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric) from public;
grant  execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric) from anon;

-- §6 — the create audit states the VAT and the tax withheld (0178 L3 body + two keys).
create or replace function public.audit_procurement_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',          new.status::text,
                                              'amount',          new.amount,
                                              'vi_number',       new.vi_number,
                                              'procurement_id',  new.procurement_id,
                                              'tax_amount',      new.tax_amount,
                                              'withheld_amount', new.withheld_amount));
  return new;
end; $$;

-- §7 — on-database asserts.
do $$
declare
  v_fn  regprocedure;
  v_col text;
begin
  foreach v_fn in array array[
    'public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric)'::regprocedure,
    'public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric)'::regprocedure,
    'public.set_vendor_tax_defaults(uuid,numeric,text,numeric)'::regprocedure] loop
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0272: % is executable by anon on this database — revoke it before applying', v_fn;
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0272: % lost its authenticated EXECUTE grant', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.companies_tax_defaults_guard()'::regprocedure,
                              'public.audit_org_vendor_tax_accounts()'::regprocedure] loop
    if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '0272: trigger function % is executable by a client role on this database', v_fn;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.companies'::regclass
                   and tgname = 'companies_tax_defaults_guard' and tgenabled <> 'D') then
    raise exception '0272: companies_tax_defaults_guard is not attached and enabled';
  end if;
  foreach v_col in array array['input_vat_account','pph23_payable_account','pph4_2_payable_account'] loop
    if has_column_privilege('anon', 'public.organizations', v_col, 'UPDATE')
       or has_column_privilege('anon', 'public.organizations', v_col, 'INSERT')
       or has_column_privilege('authenticated', 'public.organizations', v_col, 'INSERT') then
      raise exception '0272: organizations.% would be writable beyond the Admin column grant on this database (see 0192)', v_col;
    end if;
    if not has_column_privilege('authenticated', 'public.organizations', v_col, 'UPDATE') then
      raise exception '0272: organizations.% is missing its authenticated UPDATE column grant', v_col;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
```

**Verify green:**
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0272_vendor_tax_defaults.test.sql supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql supabase/tests/0266_vendor_withholding.test.sql supabase/tests/0107_capture_vendor_invoice_atomic.test.sql supabase/tests/vendor_invoice_tax_treatment.test.sql'`
→ 35/35, 24/24, and the three neighbours unchanged. Then `cd "$WT/pmo-portal" && npm run check:migrations`.

## Task 4 — Rollback file + rehearsal (~5 min)

Create `supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql`:

```sql
-- Rollback for 0272_vendor_tax_defaults.sql (#876 slice 2). Revert the slice-2 adapter-dispatch and FE FIRST (they read
-- §4's columns and send §5's parameter). Restores 0238's two create functions and 0178's create audit, then drops the
-- org settings, the vendor-defaults function, guard and columns. Standalone bills that recorded a withholding keep it
-- (withheld_amount is 0266's column).

drop trigger if exists organizations_audit_vendor_tax_accounts on public.organizations;
drop function if exists public.audit_org_vendor_tax_accounts();
alter table public.organizations
  drop column if exists input_vat_account,
  drop column if exists pph23_payable_account,
  drop column if exists pph4_2_payable_account;

create or replace function public.audit_procurement_invoice_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('procurement_invoice.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',         new.status::text,
                                              'amount',         new.amount,
                                              'vi_number',      new.vi_number,
                                              'procurement_id', new.procurement_id));
  return new;
end; $$;

drop function if exists public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric);
drop function if exists public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text,numeric);
create or replace function public.create_procurement_invoice(
  p_procurement_id uuid, p_status procurement_invoice_status, p_invoice_date date,
  p_reference_number text default null, p_amount numeric default null,
  p_import_key text default null, p_import_batch_id uuid default null, p_imported_at timestamptz default null,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null)
  returns procurement_invoices language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_row public.procurement_invoices;
begin
  perform public.assert_is_active_member();
  select org_id into v_org from public.procurements where id = p_procurement_id;
  if v_org is null then raise exception 'procurement not found' using errcode = 'P0002'; end if;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then raise exception 'not authorized' using errcode = '42501'; end if;
  if public.domain_externally_owned(v_org, 'procurement') then
    raise exception 'procurement is externally-owned — vendor invoices route through the ERPNext adapter'
      using errcode = '42501';
  end if;
  if p_status is null or p_status::text not in ('Received','Scheduled') then
    raise exception
      'procurement_invoices.status "%" is not an origination status: a vendor invoice is recorded as Received or Scheduled, and Paid is reached only by paying it — the case transition that enforces that the approver does not pay their own request',
      p_status
      using errcode = 'P0001';
  end if;
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a vendor invoice must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the amount already include the tax?) and p_tax_amount must be given (0 when there is no tax). Neither can be inferred from the total afterwards'
      using errcode = 'P0001';
  end if;
  insert into public.procurement_invoices
    (procurement_id, status, invoice_date, vi_number, reference_number, amount,
     import_key, import_batch_id, imported_at,
     tax_treatment, tax_amount, tax_rate, tax_template, tax_base_numerator, tax_base_denominator, external_ref)
    values (p_procurement_id, p_status, p_invoice_date,
            next_procurement_doc_number(v_org, 'VI'), p_reference_number, p_amount,
            p_import_key, p_import_batch_id, p_imported_at,
            p_tax_treatment, p_tax_amount, p_tax_rate, p_tax_template, p_tax_base_numerator, p_tax_base_denominator, nullif(btrim(p_external_ref), ''))
    returning * into v_row;
  return v_row;
end; $$;
revoke all     on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) from public;
grant  execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) to   authenticated;
revoke execute on function public.create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamptz,text,numeric,numeric,text,integer,integer,text) from anon;

create or replace function public.capture_vendor_invoice(
  p_procurement_id uuid,
  p_status         procurement_invoice_status,
  p_invoice_date   date,
  p_reference_number text default null,
  p_amount         numeric default null,
  p_notes          text default null,
  p_tax_treatment  text default null,
  p_tax_amount     numeric default null,
  p_tax_rate       numeric default null,
  p_tax_template   text default null,
  p_tax_base_numerator integer default 1, p_tax_base_denominator integer default 1,
  p_external_ref text default null)
  returns procurement_invoices
  language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.procurement_invoices;
begin
  perform transition_procurement(p_procurement_id, 'Vendor Invoiced'::procurement_status, p_notes);

  v_invoice := create_procurement_invoice(
    p_procurement_id, p_status, p_invoice_date, p_reference_number, p_amount,
    p_tax_treatment  => p_tax_treatment,
    p_tax_amount     => p_tax_amount,
    p_tax_rate       => p_tax_rate,
    p_tax_template   => p_tax_template,
    p_tax_base_numerator => p_tax_base_numerator,
    p_tax_base_denominator => p_tax_base_denominator,
    p_external_ref   => p_external_ref);

  return v_invoice;
end; $$;
revoke all     on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) from public;
grant  execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) to   authenticated;
revoke execute on function public.capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text) from anon;

drop function if exists public.set_vendor_tax_defaults(uuid, numeric, text, numeric);
drop trigger if exists companies_tax_defaults_guard on public.companies;
drop function if exists public.companies_tax_defaults_guard();
alter table public.companies
  drop constraint if exists companies_default_vat_rate_range,
  drop constraint if exists companies_default_pph_type_domain,
  drop constraint if exists companies_default_pph_pair,
  drop constraint if exists companies_default_pph_rate_range,
  drop column if exists default_vat_rate,
  drop column if exists default_pph_type,
  drop column if exists default_pph_rate;

notify pgrst, 'reload schema';
```

**Verify** (rehearses inside a transaction, then rolls back so the local DB stays migrated):

```bash
cd "$WT" && scripts/with-db-lock.sh bash -c "supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -qAt <<'SQL'
begin;
\i supabase/migrations/rollback/0272_vendor_tax_defaults_down.sql
select count(*) from information_schema.columns where table_schema = 'public' and column_name in
  ('default_vat_rate','default_pph_type','default_pph_rate','input_vat_account','pph23_payable_account','pph4_2_payable_account');
select count(*) from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('set_vendor_tax_defaults','companies_tax_defaults_guard','audit_org_vendor_tax_accounts');
select pg_get_function_identity_arguments('public.create_procurement_invoice'::regproc) like '%p_withheld_amount%';
select position('withheld' in pg_get_functiondef('public.audit_procurement_invoice_insert'::regproc));
rollback;
SQL"
```
→ prints `0`, `0`, `f`, `0`.

## Task 5 — Types, allow-list, denominator, slice-1 test wording (~4 min)

1. Regenerate types:
   `cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`
   **Verify:** `grep -n "default_pph_type\|pph4_2_payable_account\|p_withheld_amount\|set_vendor_tax_defaults" "$WT/pmo-portal/src/lib/supabase/database.types.ts"`
   lists the company columns, the organization columns, `p_withheld_amount?: number` in both create functions' Args
   and the `set_vendor_tax_defaults` Args.
2. In `supabase/tests/0178_anon_executable_definers.test.sql`:
   - directly before the line `-- ⚑ MERGE HAZARD, learned the hard way here:` add:
     ```sql
     -- ⚑ AMENDED BY 0272 (#876 slice 2): `set_vendor_tax_defaults` joins the retained set (+1). A SECURITY DEFINER
     -- writer called through PostgREST under a member's JWT; its body re-asserts the active membership, the
     -- Admin/Finance role and the caller's org, paired in supabase/tests/0272_vendor_tax_defaults.test.sql
     -- (AC-VWH-021/022). `create_procurement_invoice` / `capture_vendor_invoice` changed signature only (proname
     -- unchanged). THE COUNT IS RE-DERIVED BY HAND from the list below.
     --
     ```
   - directly after the line `  ('set_sales_invoice_received_date'),` add `  ('set_vendor_tax_defaults'),`
   - re-count the `insert into client_callable_rpc_names` values list by hand; at the slice-1 base it is **60** (59 + 1).
     Replace both `59,` assertion values and both `all 59 retained` descriptions with the re-derived number. If the
     rebased file already shows another number, use (that list's hand count), never arithmetic on the old line.
3. In `scripts/isolation-probe-denominator.json`, `"definer_functions"`:
   - replace `"capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text)",`
     with `"capture_vendor_invoice(uuid,procurement_invoice_status,date,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric)",`
   - replace `"create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamp with time zone,text,numeric,numeric,text,integer,integer,text)",`
     with `"create_procurement_invoice(uuid,procurement_invoice_status,date,text,numeric,text,uuid,timestamp with time zone,text,numeric,numeric,text,integer,integer,text,numeric)",`
   - directly after `"set_sales_invoice_received_date(uuid,date)",` add `"set_vendor_tax_defaults(uuid,numeric,text,numeric)",`
   (the two trigger functions are excluded by the guard's `prorettype <> 'trigger'` filter; no table is added).
4. In `supabase/tests/0266_vendor_withholding.test.sql` replace
   `'AC-VWH-009 a PMO-native vendor invoice records zero withholding'` with
   `'AC-VWH-009 a PMO-native vendor invoice that states no withholding records zero (amended by DD-VWH-10: one may state it)'`.

**Verify:**
`cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase test db supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0266_vendor_withholding.test.sql' && node scripts/check-isolation-denominator.mjs && node scripts/check-isolation-denominator.mjs --self-test`
→ 0178 5/5 (AC-ACL-004 names no offender), 0266 unchanged count, `PASS isolation denominator`, self-test passes.

---

## Task 6 — Pure helpers + ledger basis, red (AC-VWH-025, AC-VWH-026; AC-VWH-010 amended) (~5 min)

Replace the whole of `pmo-portal/src/lib/vendorWithholding.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
  itemsNetTotal, netOf, parseErpTaxAmounts, parseNativeWithheld, parseVendorTaxDefaultsDraft,
  suggestVat, suggestWithheld, vendorTaxDefaultOf, withholdingFigures,
} from './vendorWithholding';

describe('withholdingFigures (#876, DD-VWH-6, DD-VWH-20)', () => {
  it('AC-VWH-010 net payable is the gross bill minus the tax withheld, in exact cents', () => {
    expect(withholdingFigures(1110000, 110000, 20000, 'inclusive')).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(1234567.89, 135802.47, 24691.36, 'inclusive')).toEqual({ vat: 135802.47, withheld: 24691.36, netPayable: 1209876.53 });
  });

  it('AC-VWH-010 no figures when nothing was withheld, a figure is unknown, or the basis is unknown', () => {
    expect(withholdingFigures(1110000, 110000, 0, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, null, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, undefined, 'inclusive')).toBeNull();
    expect(withholdingFigures(null, 110000, 20000, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, null, 20000, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, Number.NaN, 'inclusive')).toBeNull();
    expect(withholdingFigures(1110000, 110000, 20000, null)).toBeNull();
  });

  it('AC-VWH-010 a return (negative bill) keeps its sign', () => {
    expect(withholdingFigures(-1110000, -110000, -20000, 'inclusive')).toEqual({ vat: -110000, withheld: -20000, netPayable: -1090000 });
  });

  it('AC-VWH-026 a standalone bill recorded tax-exclusive: net payable = amount + VAT − withheld', () => {
    expect(withholdingFigures(1000000, 110000, 20000, 'exclusive')).toEqual({ vat: 110000, withheld: 20000, netPayable: 1090000 });
    expect(withholdingFigures(333333.33, 36666.67, 6666.67, 'exclusive')).toEqual({ vat: 36666.67, withheld: 6666.67, netPayable: 363333.33 });
  });
});

describe('vendor tax defaults and suggestions (#876 slice 2, DD-VWH-17)', () => {
  it('AC-VWH-025 the VAT suggested on a tax-exclusive amount is rate × amount, half-up to the cent', () => {
    expect(suggestVat(1000000, 'exclusive', 11)).toBe(110000);
    expect(suggestVat(333333.33, 'exclusive', 11)).toBe(36666.67);
  });

  it('AC-VWH-025 the VAT inside a tax-inclusive amount is amount × rate / (100 + rate)', () => {
    expect(suggestVat(1110000, 'inclusive', 11)).toBe(110000);
    expect(suggestVat(1000, 'inclusive', 12)).toBe(107.14);
  });

  it('AC-VWH-025 the PPh suggested is rate × the net (DPP), half-up to the cent', () => {
    expect(suggestWithheld(1000000, 2)).toBe(20000);
    expect(suggestWithheld(999999.99, 2)).toBe(20000);
    expect(suggestWithheld(333333.33, 1.75)).toBe(5833.33);
  });

  it('AC-VWH-025 the net is the amount when tax-exclusive and amount − VAT when tax-inclusive', () => {
    expect(netOf(1000000, 'exclusive', 110000)).toBe(1000000);
    expect(netOf(1110000, 'inclusive', 110000)).toBe(1000000);
  });

  it('AC-VWH-025 the items total before tax sums quantity × rate per line in cents; no lines is unknown', () => {
    expect(itemsNetTotal([{ quantity: 3, rate: 333333.33 }, { quantity: 1, rate: 0.01 }])).toBe(1000000);
    expect(itemsNetTotal([])).toBeNull();
  });

  it('AC-VWH-025 a company row is a default only when it states a VAT rate or a complete withholding', () => {
    expect(vendorTaxDefaultOf({ default_vat_rate: 11, default_pph_type: 'pph23', default_pph_rate: 2 })).toEqual({ vatRate: 11, pphType: 'pph23', pphRate: 2 });
    expect(vendorTaxDefaultOf({ default_vat_rate: 0, default_pph_type: null, default_pph_rate: null })).toEqual({ vatRate: 0, pphType: null, pphRate: null });
    expect(vendorTaxDefaultOf({ default_vat_rate: null, default_pph_type: null, default_pph_rate: null })).toBeNull();
    expect(vendorTaxDefaultOf({ default_vat_rate: null, default_pph_type: 'pph21', default_pph_rate: 2 })).toBeNull();
    expect(vendorTaxDefaultOf(null)).toBeNull();
  });

  it('AC-VWH-025 entered ERP amounts: VAT is required (0 allowed); a withholding needs its amount', () => {
    expect(parseErpTaxAmounts('110000', 'pph23', '20000')).toEqual({ vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' });
    expect(parseErpTaxAmounts('0', '', 'ignored')).toEqual({ vatAmount: 0, withheldAmount: 0, pphType: null });
    expect(parseErpTaxAmounts('', '', '')).toBeNull();
    expect(parseErpTaxAmounts('110000', 'pph23', '')).toBeNull();
    expect(parseErpTaxAmounts('-1', '', '')).toBeNull();
    expect(parseErpTaxAmounts('110000', 'pph21', '1')).toBeNull();
  });

  it('AC-VWH-025 a standalone PPh: blank is none; it needs a bill amount and cannot exceed it', () => {
    expect(parseNativeWithheld('', null)).toBe(0);
    expect(parseNativeWithheld('20000', 1000000)).toBe(20000);
    expect(parseNativeWithheld('20000', null)).toBeNull();
    expect(parseNativeWithheld('1000000.01', 1000000)).toBeNull();
    expect(parseNativeWithheld('-5', 1000000)).toBeNull();
  });

  it('AC-VWH-025 the default editor accepts 0–100% VAT and a PPh rate above 0 and below 100', () => {
    expect(parseVendorTaxDefaultsDraft('11', 'pph23', '2')).toEqual({ ok: true, value: { vatRate: 11, pphType: 'pph23', pphRate: 2 } });
    expect(parseVendorTaxDefaultsDraft('', '', '')).toEqual({ ok: true, value: { vatRate: null, pphType: null, pphRate: null } });
    expect(parseVendorTaxDefaultsDraft('101', '', '')).toEqual({ ok: false, field: 'vat' });
    expect(parseVendorTaxDefaultsDraft('11', 'pph23', '')).toEqual({ ok: false, field: 'pph' });
    expect(parseVendorTaxDefaultsDraft('11', 'pph4_2', '100')).toEqual({ ok: false, field: 'pph' });
  });
});
```

Append to `pmo-portal/pages/procurement/ProcurementLedger.test.tsx`:

```tsx
describe('AC-VWH-026: a standalone tax-exclusive bill shows net payable = amount + VAT − withheld (#876 slice 2)', () => {
  it('AC-VWH-026 the breakdown adds the VAT back for a tax-exclusive amount', () => {
    wrap(<ProcurementLedger {...BASE_PROPS} rows={[{
      ...SAMPLE_ROWS[1], id: 'vi-s2', recordId: 'vi-s2', amount: 1000000, currency: 'IDR',
      taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000,
    }]} />);
    expect(screen.getAllByTestId('vi-withholding-net')[0].textContent).toBe(formatCurrency(1090000, 'IDR'));
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/vendorWithholding.test.ts pages/procurement/ProcurementLedger.test.tsx`
→ fails (missing exports; the ledger renders 910,000).

## Task 7 — Pure helpers + ledger call-site, green (AC-VWH-025, AC-VWH-026) (~5 min)

Replace the whole of `pmo-portal/src/lib/vendorWithholding.ts` with:

```ts
/**
 * #876 — vendor withholding (PPh 23 / PPh 4(2)) helpers. Every money figure is computed in integer cents.
 *
 * Slice 1 (DD-VWH-6, FR-VWH-007): `withholdingFigures`, the three labelled figures a bill with tax withheld shows.
 * Slice 2 (OD-VWH-1, DD-VWH-17/20): the vendor's default tax treatment and the amounts a NEW bill is pre-filled with.
 * A suggestion is only a starting value — the bill records exactly what the user submits (DD-VWH-13/19).
 */
import { parseMoneyInputAtScale } from './format';

export type TaxBasis = 'inclusive' | 'exclusive';
export type PphType = 'pph23' | 'pph4_2';
export const isPphType = (value: unknown): value is PphType => value === 'pph23' || value === 'pph4_2';

export interface WithholdingFigures {
  vat: number;
  withheld: number;
  netPayable: number;
}

const cents = (n: number): number => Math.round(n * 100);

/**
 * Null when nothing was withheld or any figure — or the basis — is unknown: the caller then renders the bill as before.
 * Gross = `amount` for a tax-inclusive bill (every ERP-mirrored bill, DD-VWH-1) and `amount + VAT` for a standalone
 * bill recorded tax-exclusive (DD-VWH-20); net payable = gross − withheld.
 */
export function withholdingFigures(
  amount: number | null | undefined,
  taxAmount: number | null | undefined,
  withheldAmount: number | null | undefined,
  taxTreatment: string | null | undefined,
): WithholdingFigures | null {
  if (amount == null || taxAmount == null || withheldAmount == null) return null;
  if (![amount, taxAmount, withheldAmount].every(Number.isFinite) || withheldAmount === 0) return null;
  if (taxTreatment !== 'inclusive' && taxTreatment !== 'exclusive') return null;
  const gross = taxTreatment === 'exclusive' ? cents(amount) + cents(taxAmount) : cents(amount);
  return { vat: taxAmount, withheld: withheldAmount, netPayable: (gross - cents(withheldAmount)) / 100 };
}

// ── slice 2: vendor defaults and pre-fill suggestions ─────────────────────────────────────────────────────────────

/** The vendor's default tax treatment (companies.default_*, migration 0272). Rates are percentages. */
export interface VendorTaxDefault {
  vatRate: number | null;
  pphType: PphType | null;
  pphRate: number | null;
}

/** What the vendor-default editor saves (`set_vendor_tax_defaults`). */
export type VendorTaxDefaultsInput = VendorTaxDefault;

/** The VAT / PPh an ERP-bound bill was entered with — the dispatch record's `vatAmount` / `withheldAmount` / `pphType`. */
export interface ErpVendorTaxAmounts {
  vatAmount: number;
  withheldAmount: number;
  pphType: PphType | null;
}

interface CompanyTaxColumns {
  default_vat_rate?: number | null;
  default_pph_type?: string | null;
  default_pph_rate?: number | null;
}

/** A company row's default, or null when it states neither a VAT rate nor a complete withholding. */
export function vendorTaxDefaultOf(row: CompanyTaxColumns | null | undefined): VendorTaxDefault | null {
  if (!row) return null;
  const vatRate = typeof row.default_vat_rate === 'number' && Number.isFinite(row.default_vat_rate) ? row.default_vat_rate : null;
  const pphType = isPphType(row.default_pph_type) ? row.default_pph_type : null;
  const pphRate = pphType && typeof row.default_pph_rate === 'number' && Number.isFinite(row.default_pph_rate)
    ? row.default_pph_rate : null;
  if (vatRate === null && pphRate === null) return null;
  return { vatRate, pphType: pphRate === null ? null : pphType, pphRate };
}

const toCents = (n: number): bigint => BigInt(Math.round(n * 100));
const rateMilli = (rate: number): bigint => BigInt(Math.round(rate * 1000));
const fromCents = (c: bigint): number => Number(c) / 100;
/** num / den rounded half away from zero (den > 0). */
function divRound(num: bigint, den: bigint): bigint {
  const negative = num < 0n;
  const magnitude = negative ? -num : num;
  const q = (magnitude * 2n + den) / (2n * den);
  return negative ? -q : q;
}

/** The VAT on an amount: rate × amount when tax-exclusive; amount × rate / (100 + rate) inside a tax-inclusive one. */
export function suggestVat(amount: number, treatment: TaxBasis, vatRate: number): number {
  const a = toCents(amount);
  const r = rateMilli(vatRate);
  return fromCents(treatment === 'exclusive' ? divRound(a * r, 100000n) : divRound(a * r, 100000n + r));
}

/** The PPh on the net (DPP): rate × net. */
export function suggestWithheld(net: number, pphRate: number): number {
  return fromCents(divRound(toCents(net) * rateMilli(pphRate), 100000n));
}

/** The net (before VAT): the amount itself when tax-exclusive, amount − VAT when tax-inclusive. */
export function netOf(amount: number, treatment: TaxBasis, vat: number): number {
  return treatment === 'exclusive' ? amount : fromCents(toCents(amount) - toCents(vat));
}

/** The case's items total before tax — what an ERP-bound bill sends as its lines (Σ quantity × rate, per line in cents). */
export function itemsNetTotal(items: ReadonlyArray<{ quantity?: number | null; rate?: number | null }>): number | null {
  if (items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + Math.round(Number(item.quantity ?? 0) * Number(item.rate ?? 0) * 100), 0);
  return Number.isFinite(total) ? total / 100 : null;
}

/** An ERP-bound bill's entered amounts, or null while not submittable. */
export function parseErpTaxAmounts(vatRaw: string, pphTypeRaw: string, withheldRaw: string): ErpVendorTaxAmounts | null {
  const vat = vatRaw.trim() ? parseMoneyInputAtScale(vatRaw, 2) : null;
  if (vat === null || vat < 0) return null;
  if (pphTypeRaw === '') return { vatAmount: vat, withheldAmount: 0, pphType: null };
  if (!isPphType(pphTypeRaw)) return null;
  const withheld = withheldRaw.trim() ? parseMoneyInputAtScale(withheldRaw, 2) : null;
  if (withheld === null || withheld < 0) return null;
  return { vatAmount: vat, withheldAmount: withheld, pphType: pphTypeRaw };
}

/** A standalone bill's PPh: blank = none (0); otherwise needs a bill amount and may not exceed it. Null = invalid. */
export function parseNativeWithheld(raw: string, amount: number | null): number | null {
  if (raw.trim() === '') return 0;
  const value = parseMoneyInputAtScale(raw, 2);
  if (value === null || value < 0) return null;
  if (value > 0 && (amount === null || value > amount)) return null;
  return value;
}

export type VendorTaxDefaultsDraft =
  | { ok: true; value: VendorTaxDefaultsInput }
  | { ok: false; field: 'vat' | 'pph' };

/** The default editor's drafts: VAT blank or 0–100; a PPh type needs a rate above 0 and below 100 (3 decimals). */
export function parseVendorTaxDefaultsDraft(vatRaw: string, pphTypeRaw: string, pphRaw: string): VendorTaxDefaultsDraft {
  let vatRate: number | null = null;
  if (vatRaw.trim()) {
    const parsed = parseMoneyInputAtScale(vatRaw, 3);
    if (parsed === null || parsed < 0 || parsed > 100) return { ok: false, field: 'vat' };
    vatRate = parsed;
  }
  if (pphTypeRaw === '') return { ok: true, value: { vatRate, pphType: null, pphRate: null } };
  if (!isPphType(pphTypeRaw)) return { ok: false, field: 'pph' };
  const pphRate = pphRaw.trim() ? parseMoneyInputAtScale(pphRaw, 3) : null;
  if (pphRate === null || pphRate <= 0 || pphRate >= 100) return { ok: false, field: 'pph' };
  return { ok: true, value: { vatRate, pphType: pphTypeRaw, pphRate } };
}
```

In `pmo-portal/pages/procurement/ProcurementLedger.tsx` replace
`const figures = row.type === 'Invoice' ? withholdingFigures(row.amount, row.taxAmount, row.withheldAmount) : null;`
with
`const figures = row.type === 'Invoice' ? withholdingFigures(row.amount, row.taxAmount, row.withheldAmount, row.taxTreatment) : null;`

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/vendorWithholding.test.ts pages/procurement/ProcurementLedger.test.tsx && npm run typecheck`
→ all pass (AC-VWH-012's fixture row is `taxTreatment: 'inclusive'`, so it is unchanged).

## Task 8 — Policy: `vendorTaxDefault.manage`, red → green (AC-VWH-027) (~3 min)

Create `pmo-portal/src/auth/policy.vendorTax.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe('AC-VWH-027 vendor tax defaults policy (mirrors set_vendor_tax_defaults, migration 0272)', () => {
  it('AC-VWH-027 vendor tax defaults are managed by Admin and Finance only', () => {
    expect(ROLES.filter((r) => can('manage', 'vendorTaxDefault', { realRole: r }))).toEqual(['Admin', 'Finance']);
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/auth/policy.vendorTax.test.ts` → fails
(typecheck/runtime: unknown entity → empty list).

In `pmo-portal/src/auth/policy.ts`:
1. In `export type Entity`, directly after `  | 'orgAccounting'` add `  | 'vendorTaxDefault'`.
2. Directly after `const REVENUE_WRITE: Role[] = ['Admin', 'Finance'];` add:
   ```ts
   /** #876 slice 2 (DD-VWH-11): who may set a vendor's default tax treatment — mirrors set_vendor_tax_defaults (0272). */
   const TAX_SETUP: Role[] = ['Admin', 'Finance'];
   ```
3. Directly after the `orgAccounting: { manage: allow(ADMIN), },` entry add:
   ```ts
   // #876 slice 2: a vendor's default VAT / PPh treatment. UX ONLY — set_vendor_tax_defaults is the authority.
   vendorTaxDefault: { manage: allow(TAX_SETUP) },
   ```

**Verify green:** same command + `npx vitest run src/auth/policy.test.ts` → pass.

## Task 9 — DAL + repository seams, red (AC-VWH-032) (~5 min)

1. Create `pmo-portal/src/lib/db/companies.taxDefaults.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: vi.fn() } }));
import { setCompanyTaxDefaults } from './companies';

beforeEach(() => vi.clearAllMocks());

it('AC-VWH-032 (DAL): setCompanyTaxDefaults calls set_vendor_tax_defaults with the parsed defaults', async () => {
  h.rpc.mockResolvedValue({ data: { id: 'vendor-1' }, error: null });
  await setCompanyTaxDefaults('vendor-1', { vatRate: 11, pphType: 'pph23', pphRate: 2 });
  expect(h.rpc).toHaveBeenCalledWith('set_vendor_tax_defaults', { p_company_id: 'vendor-1', p_vat_rate: 11, p_pph_type: 'pph23', p_pph_rate: 2 });
});

it('AC-VWH-032 (DAL): a cleared default is not sent (the RPC default is null)', async () => {
  h.rpc.mockResolvedValue({ data: { id: 'vendor-1' }, error: null });
  await setCompanyTaxDefaults('vendor-1', { vatRate: null, pphType: null, pphRate: null });
  const args = h.rpc.mock.calls[0][1] as Record<string, unknown>;
  expect(args).toEqual({ p_company_id: 'vendor-1', p_vat_rate: undefined, p_pph_type: undefined, p_pph_rate: undefined });
  expect(JSON.parse(JSON.stringify(args))).toEqual({ p_company_id: 'vendor-1' });
});

it('AC-VWH-032 (DAL): a refused save keeps its Postgres code', async () => {
  h.rpc.mockResolvedValue({ data: null, error: { message: "only Admin or Finance can set a vendor's tax defaults", code: '42501' } });
  await expect(setCompanyTaxDefaults('vendor-1', { vatRate: 11, pphType: null, pphRate: null })).rejects.toMatchObject({ code: '42501' });
});
```

2. Create `pmo-portal/src/lib/db/orgs.vendorTax.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn(), eq: vi.fn(), from: vi.fn(),
  result: { data: [{ id: 'org-1', input_vat_account: 'Input VAT - DEMO', pph23_payable_account: null, pph4_2_payable_account: 'PPh 4(2) Payable - DEMO' }],
    error: null as null | { message: string } } }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { getOrgVendorTaxAccounts, setOrgVendorTaxAccounts } from './orgs';
beforeEach(() => {
  vi.clearAllMocks();
  h.result.error = null;
  const builder = { select: h.select, update: h.update, eq: h.eq, limit: () => builder,
    then: (resolve: (value: typeof h.result) => unknown) => resolve(h.result) };
  h.from.mockReturnValue(builder); h.select.mockReturnValue(builder);
  h.update.mockReturnValue(builder); h.eq.mockReturnValue(builder);
});
it('AC-VWH-032 (DAL): reads the RLS-scoped org tax accounts without a client org filter', async () => {
  expect(await getOrgVendorTaxAccounts()).toEqual({ inputVatAccount: 'Input VAT - DEMO', pph23PayableAccount: null, pph42PayableAccount: 'PPh 4(2) Payable - DEMO' });
  expect(h.select).toHaveBeenCalledWith('input_vat_account,pph23_payable_account,pph4_2_payable_account');
  expect(h.eq).not.toHaveBeenCalled();
});
it('AC-VWH-032 (DAL): saving writes exactly the three trimmed columns (blank → none) to the RLS-resolved org', async () => {
  await setOrgVendorTaxAccounts({ inputVatAccount: ' Input VAT - DEMO ', pph23PayableAccount: '', pph42PayableAccount: 'PPh 4(2) Payable - DEMO' });
  expect(h.update).toHaveBeenCalledWith({ input_vat_account: 'Input VAT - DEMO', pph23_payable_account: null, pph4_2_payable_account: 'PPh 4(2) Payable - DEMO' });
  expect(h.eq).toHaveBeenCalledWith('id', 'org-1');
});
it('AC-VWH-032 (DAL): a name longer than the ERPNext link limit makes no write', async () => {
  await expect(setOrgVendorTaxAccounts({ inputVatAccount: 'x'.repeat(141), pph23PayableAccount: null, pph42PayableAccount: null })).rejects.toThrow(/140/);
  expect(h.update).not.toHaveBeenCalled();
});
```

3. In `pmo-portal/src/lib/db/procurementLifecycle.test.ts`:
   - inside `describe('createInvoice', …)`, directly after the test `'AC-816 (DAL): createInvoice throws on RPC error'`, add:
     ```ts
     it('AC-VWH-032 (DAL): createInvoice forwards a stated withholding as p_withheld_amount; none and ERP amounts never reach the RPC', async () => {
       makeRpcBuilder({ data: { id: 'invoice-4' }, error: null });
       await createInvoice({ procurementId: 'proc-1', status: 'Received', invoiceDate: '2026-10-07', amount: 1000000,
         taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000 });
       expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_withheld_amount).toBe(20000);

       mockRpc.mockClear();
       makeRpcBuilder({ data: { id: 'invoice-5' }, error: null });
       await createInvoice({ procurementId: 'proc-1', status: 'Received', invoiceDate: '2026-10-07', amount: 1000000,
         taxTreatment: 'exclusive', taxAmount: 110000, erpTaxAmounts: { vatAmount: 1, withheldAmount: 1, pphType: 'pph23' } });
       const args = mockRpc.mock.calls[0][1] as Record<string, unknown>;
       expect('p_withheld_amount' in args).toBe(false);
       expect(Object.keys(args).some((key) => /vat|pph|erp/i.test(key))).toBe(false);
     });
     ```
   - inside `describe('captureVendorInvoice', …)`, as its last test, add:
     ```ts
     it('AC-VWH-032 (DAL): captureVendorInvoice forwards a stated withholding as p_withheld_amount', async () => {
       makeRpcBuilder({ data: { id: 'invoice-vi-2' }, error: null });
       await captureVendorInvoice({ procurementId: 'proc-1', status: 'Received', invoiceDate: '2026-10-07', amount: 2000000,
         taxTreatment: 'exclusive', taxAmount: 220000, withheldAmount: 40000 });
       expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_withheld_amount).toBe(40000);
     });
     ```

4. In `pmo-portal/src/lib/repositories/procurement.external.test.ts`, directly after the test
   `'AC-520-8 forwards the chosen ERPNext purchase tax template — and still no other tax fact'` (same describe), add:
   ```ts
   it('AC-VWH-032 forwards the entered VAT and PPh as amounts — never the native tax facts, never rows', async () => {
     dispatchSpy.mockResolvedValue({ externalRecordId: 'SYNTHETIC-PI-876', canonical: { id: 'pmo-1' } });
     await repositories.procurement.createInvoice({
       procurementId: 'proc-1', status: 'Received', invoiceDate: '2026-10-07',
       taxTreatment: 'inclusive', taxAmount: 0,
       erpTaxAmounts: { vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' },
     });
     const record = dispatchSpy.mock.calls[0][2] as Record<string, unknown>;
     expect(record).toMatchObject({ vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23', erp_doc_kind: 'purchase-invoice' });
     expect(record).not.toHaveProperty('taxAmount');
     expect(record).not.toHaveProperty('taxTemplate');
     expect(record).not.toHaveProperty('taxes');
     expect(record).not.toHaveProperty('erpTaxAmounts');
   });
   ```

5. In `pmo-portal/src/lib/repositories/index.test.ts` change the `repositories.company` key list to
   `['archive', 'create', 'delete', 'get', 'list', 'listClients', 'setProjectNumberSegment', 'setTaxDefaults', 'update']`
   and add `'getVendorTaxAccounts'` and `'setVendorTaxAccounts'` to the `repositories.orgSettings` key list.

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/db/companies.taxDefaults.test.ts src/lib/db/orgs.vendorTax.test.ts src/lib/db/procurementLifecycle.test.ts src/lib/repositories/procurement.external.test.ts src/lib/repositories/index.test.ts`
→ the new tests fail (missing exports / keys / forwarding); every pre-existing test passes.

## Task 10 — DAL + repository seams, green (AC-VWH-032) (~5 min)

1. Append to `pmo-portal/src/lib/db/companies.ts`:

```ts
/**
 * #876 slice 2 (DD-VWH-11): set a vendor's default tax treatment through `set_vendor_tax_defaults` (0272) — the only
 * client path past the companies guard trigger. A null value is not sent, so the RPC's own `default null` clears it.
 */
export async function setCompanyTaxDefaults(id: string, input: VendorTaxDefaultsInput): Promise<void> {
  const { error } = await supabase.rpc('set_vendor_tax_defaults', {
    p_company_id: id,
    p_vat_rate: input.vatRate ?? undefined,
    p_pph_type: input.pphType ?? undefined,
    p_pph_rate: input.pphRate ?? undefined,
  });
  if (error) throwWrite(error);
}
```
   and add `import type { VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';` below the existing imports.

2. Append to `pmo-portal/src/lib/db/orgs.ts`:

```ts
/** #876 slice 2 (DD-VWH-12): the ERPNext accounts a vendor bill's entered VAT and PPh post to (organizations, 0272). */
export interface OrgVendorTaxAccounts {
  inputVatAccount: string | null;
  pph23PayableAccount: string | null;
  pph42PayableAccount: string | null;
}

export async function getOrgVendorTaxAccounts(): Promise<OrgVendorTaxAccounts> {
  const { data, error } = await supabase.from('organizations')
    .select('input_vat_account,pph23_payable_account,pph4_2_payable_account').limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  return {
    inputVatAccount: row?.input_vat_account ?? null,
    pph23PayableAccount: row?.pph23_payable_account ?? null,
    pph42PayableAccount: row?.pph4_2_payable_account ?? null,
  };
}

/** Admin-only by RLS (the organizations UPDATE policy) + column grants (0272); a non-Admin write reaches no row. */
export async function setOrgVendorTaxAccounts(input: OrgVendorTaxAccounts): Promise<void> {
  const clean = (value: string | null) => value?.trim() || null;
  const patch = {
    input_vat_account: clean(input.inputVatAccount),
    pph23_payable_account: clean(input.pph23PayableAccount),
    pph4_2_payable_account: clean(input.pph42PayableAccount),
  };
  if (Object.values(patch).some((value) => value !== null && value.length > 140)) {
    throw new Error('A tax account name must be at most 140 characters.');
  }
  const { data, error } = await supabase.from('organizations').select('id');
  if (error) throw new Error(error.message);
  if (data?.length !== 1) throw new Error('Exactly one organization must be readable before changing its tax accounts.');
  const { data: updated, error: updateError } = await supabase.from('organizations').update(patch).eq('id', data[0].id).select('id');
  if (updateError) throw new Error(updateError.message);
  assertWriteLanded(updated, 'Only an Admin can change the tax accounts.');
}
```

3. In `pmo-portal/src/lib/db/procurementLifecycle.ts`:
   - add `import type { ErpVendorTaxAmounts } from '@/src/lib/vendorWithholding';` below the existing imports;
   - in `interface VendorInvoiceTaxInput`, directly after `taxTemplate?: string | null;` add:
     ```ts
     /** #876 slice 2 (DD-VWH-10): income tax withheld from the vendor on a standalone bill. Absent / 0 = none. */
     withheldAmount?: number;
     ```
   - in `interface CreateInvoiceInput`, directly after `externalRef?: string | null;` add:
     ```ts
     /**
      * #876 slice 2 (DD-VWH-13/14): the VAT / PPh entered on an ERP-bound bill. Consumed ONLY by the repository's
      * external branch (forwarded to the dispatch, which builds the ERPNext rows); the native RPC has no such parameter.
      */
     erpTaxAmounts?: ErpVendorTaxAmounts;
     ```
   - in `createInvoice` and in `captureVendorInvoice`, directly after the line
     `...(input.externalRef ? { p_external_ref: input.externalRef } : {}),` add
     `...(input.withheldAmount ? { p_withheld_amount: input.withheldAmount } : {}),`

4. In `pmo-portal/src/lib/repositories/types.ts`:
   - in `CompanyRepository`, directly after `setProjectNumberSegment(id: string, segment: string | null): Promise<void>;` add:
     ```ts
     /** #876 slice 2: set the vendor's default tax treatment (Admin/Finance; `set_vendor_tax_defaults`). */
     setTaxDefaults(id: string, input: VendorTaxDefaultsInput): Promise<void>;
     ```
   - in `OrgSettingsRepository`, directly after `setWithholdingAccount(account: string | null): Promise<void>;` add:
     ```ts
     /** #876 slice 2: the ERPNext accounts a vendor bill's entered VAT / PPh post to (Admin writes). */
     getVendorTaxAccounts(): Promise<OrgVendorTaxAccounts>;
     setVendorTaxAccounts(input: OrgVendorTaxAccounts): Promise<void>;
     ```
   - add `import type { VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';` and
     `import type { OrgVendorTaxAccounts } from '@/src/lib/db/orgs';` with the other type imports.

5. In `pmo-portal/src/lib/repositories/index.ts`:
   - add `setCompanyTaxDefaults` to the existing named import from `@/src/lib/db/companies`, and
     `getOrgVendorTaxAccounts, setOrgVendorTaxAccounts` to the existing named import from `@/src/lib/db/orgs`;
   - in the `company` repository object, directly after
     `setProjectNumberSegment: (id, segment) => wrap(() => setCompanyProjectNumberSegment(id, segment)),` add
     `setTaxDefaults: (id, input) => wrap(() => setCompanyTaxDefaults(id, input)),`
   - in `orgSettings`, directly after `setWithholdingAccount: (account) => wrap(() => setOrgWithholdingAccount(account)),` add:
     ```ts
     getVendorTaxAccounts: () => wrap(() => getOrgVendorTaxAccounts()),
     setVendorTaxAccounts: (input) => wrap(() => setOrgVendorTaxAccounts(input)),
     ```
   - in `procurement.createInvoice`'s external branch, directly after
     `...(input.taxTemplate?.trim() ? { taxTemplate: input.taxTemplate.trim() } : {}),` add:
     ```ts
     // #876 slice 2 (DD-VWH-13/14) — or the VAT / PPh AMOUNTS the user entered. The dispatch turns them into fixed
     // ERPNext rows on the org's tax accounts and refuses a command carrying both a template and amounts. The native
     // tax facts above stay unforwarded: on this path the treatment is a fact the mirror writes.
     ...(input.erpTaxAmounts
       ? { vatAmount: input.erpTaxAmounts.vatAmount, withheldAmount: input.erpTaxAmounts.withheldAmount, pphType: input.erpTaxAmounts.pphType }
       : {}),
     ```

**Verify green:** Task 9's command → all pass; then `cd "$WT/pmo-portal" && npm run typecheck`.

---

## Task 11 — Served handler test, red (AC-VWH-035) (~5 min)

Create `supabase/functions/adapter-dispatch/vendorTaxAmounts.test.ts`:

```ts
/**
 * #876 slice 2 (DD-VWH-13, AC-VWH-035) — a vendor bill with ENTERED VAT / PPh, through the SHIPPED served
 * `adapter-dispatch` handler (index.ts via the Deno.serve stub) with `globalThis.fetch` mocked (Supabase's documented
 * edge-function test shape; no dependency injection in production code).
 *   1. A command naming a template AND amounts is refused (422) before ANY ERPNext call.
 *   2. Client-supplied rows and the server-only marker never reach ERPNext: the one Purchase Invoice POST carries
 *      exactly the two rows the server built from the entered amounts and the org's tax accounts.
 * Every route below is a FACT about the world the handler reads; the `unexpected` catch-all names any read not mocked
 * (add a route answering it as a fact — never loosen an assertion).
 */
import { describe, it } from '@std/testing/bdd';
import { assert, assertEquals } from '@std/assert';
import {
  createJwtAuthority,
  createTestJwksResolver,
  installEdgeEnv,
  jsonResponse,
  supabaseRpc,
  supabaseSelect,
  withFetchMock,
  type FetchCall,
  type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';
import { installErpCredentials, ERP_HOST, ERP_SITE_URL, SECRET_REF, COMPANY } from './bfyServedFixture.ts';

const env = installEdgeEnv();
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const restoreCreds = installErpCredentials();
const auth = await createJwtAuthority(env.SUPABASE_URL);

let servedHandler: ((req: Request) => Promise<Response>) | null = null;
(Deno as unknown as { serve: (h: unknown) => unknown }).serve = (h: unknown) => {
  servedHandler = h as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve() };
};
const { setTestJwks } = await import('./index.ts');
setTestJwks(createTestJwksResolver(auth));

addEventListener('unload', () => {
  restoreCreds();
  env.restore();
});

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const PROC_ID = '33333333-3333-4333-8333-333333333333';
const VENDOR_ID = '44444444-4444-4444-8444-444444444444';
const PI_ID = '55555555-5555-4555-8555-555555555555';
const VAT_ACCOUNT = 'Input VAT - DEMO';
const PPH23_ACCOUNT = 'PPh 23 Payable - DEMO';
const ERP_PI = 'ACC-PINV-2026-00876';

function objectResponse(body: unknown): Response {
  return jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
}
function nullObjectResponse(): Response {
  return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });
}
function eqParam(call: FetchCall, key: string): string | null {
  const raw = call.url.searchParams.get(key);
  return raw?.startsWith('eq.') ? decodeURIComponent(raw.slice(3)) : raw;
}

const PI_HEADER = { name: ERP_PI, docstatus: 1, grand_total: 1090000, total_taxes_and_charges: 90000,
  taxes_and_charges_deducted: 20000, outstanding_amount: 1090000, taxes_and_charges: '' };

function routes(unexpected: FetchCall[]): MockRoute[] {
  const outbox = new Map<string, Record<string, unknown>>();
  return [
    supabaseSelect('profiles', (call) =>
      call.url.searchParams.has('role') ? jsonResponse([{ id: USER_ID }]) : objectResponse({ org_id: ORG_ID })),
    supabaseRpc('domain_owned_by_tier', () => jsonResponse(true)),
    supabaseRpc('org_has_active_erpnext_binding', () => jsonResponse(true)),
    supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Finance', active: true })),
    supabaseRpc('read_vault_secret', () => jsonResponse(null)),
    supabaseSelect('external_org_bindings', () => objectResponse({
      site_url: ERP_SITE_URL, secret_ref: SECRET_REF, activated_at: '2026-01-01T00:00:00+00:00', version_major: 15,
      config: { company: COMPANY },
    })),
    supabaseSelect('organizations', () => objectResponse({
      input_vat_account: VAT_ACCOUNT, pph23_payable_account: PPH23_ACCOUNT, pph4_2_payable_account: null,
    })),
    supabaseSelect('procurements', () => objectResponse({ id: PROC_ID, org_id: ORG_ID, vendor_id: VENDOR_ID, project_id: null })),
    supabaseSelect('companies', () => objectResponse({ id: VENDOR_ID, org_id: ORG_ID })),
    supabaseSelect('external_refs', (call) =>
      eqParam(call, 'pmo_record_id') === VENDOR_ID
        ? objectResponse({ external_record_id: 'Supplier:Demo Supplier' })
        : nullObjectResponse()),
    supabaseSelect('procurement_items', () => jsonResponse([])),
    {
      label: 'outbox read', method: 'GET', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const row = outbox.get(`${eqParam(call, 'pmo_record_id')}|${eqParam(call, 'idempotency_key')}`);
        return row ? objectResponse(row) : nullObjectResponse();
      },
    },
    {
      label: 'outbox insert', method: 'POST', pathname: '/rest/v1/external_command_outbox',
      response: (call) => {
        const body = call.bodyJson as Record<string, unknown>;
        const row = { id: 'outbox-1', domain: body.domain, pmo_record_id: body.pmo_record_id,
          idempotency_key: body.idempotency_key, state: 'pending', external_record_id: null, canonical: null,
          claim_generation: 0, payload_digest: body.payload_digest ?? null, payload: body.payload ?? null };
        outbox.set(`${String(body.pmo_record_id)}|${String(body.idempotency_key)}`, row);
        return objectResponse(row);
      },
    },
    { label: 'outbox update', method: 'PATCH', pathname: '/rest/v1/external_command_outbox',
      response: () => jsonResponse([{ id: 'outbox-1' }]) },
    supabaseRpc('claim_outbox_for_commit', () => {
      const row = [...outbox.values()][0];
      return jsonResponse(row ? { ...row, state: 'committing', claim_generation: 1 } : null);
    }),
    supabaseRpc('record_outbox_ref', () => jsonResponse(1)),
    supabaseRpc('confirm_outbox', () => jsonResponse(1)),
    supabaseRpc('surface_action_required', () => jsonResponse(null)),
    { label: 'procurement_invoices mirror', pathname: '/rest/v1/procurement_invoices', response: () => jsonResponse([]) },
    { label: 'notifications', pathname: '/rest/v1/notifications', response: () => jsonResponse([]) },
    {
      label: 'ERP Item catalog', host: ERP_HOST, pathname: '/api/resource/Item',
      response: () => jsonResponse({ data: [{ name: 'DEMO-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] }),
    },
    {
      label: 'ERP Account read', host: ERP_HOST, pathname: /^\/api\/resource\/Account\/.+$/,
      response: (call) => {
        const name = decodeURIComponent(call.url.pathname.split('/').pop() ?? '');
        return jsonResponse({ data: { name, company: COMPANY, is_group: 0, root_type: name === PPH23_ACCOUNT ? 'Liability' : 'Asset' } });
      },
    },
    {
      label: 'ERP Purchase Invoice list / create', host: ERP_HOST, pathname: '/api/resource/Purchase%20Invoice',
      response: (call) => call.method === 'POST'
        ? jsonResponse({ data: { ...(call.bodyJson as Record<string, unknown>), ...PI_HEADER, docstatus: 0 } })
        : jsonResponse({ data: [] }),
    },
    {
      label: 'ERP Purchase Invoice submit / read', host: ERP_HOST, pathname: /^\/api\/resource\/Purchase%20Invoice\/.+$/,
      response: () => jsonResponse({ data: PI_HEADER }),
    },
    { label: 'unexpected', response: (call) => { unexpected.push(call); return jsonResponse({ message: 'unmocked' }, { status: 404 }); } },
  ];
}

const BILL = { id: PI_ID, procurementId: PROC_ID, vendorId: VENDOR_ID, erp_doc_kind: 'purchase-invoice',
  items: [{ item_code: 'DEMO-ITEM', qty: 1, rate: 1000000 }] };

async function dispatch(record: Record<string, unknown>, idempotencyKey: string) {
  const unexpected: FetchCall[] = [];
  const result = await withFetchMock(routes(unexpected), async ({ calls }) => {
    const jwt = await auth.mintJwt({ sub: USER_ID });
    const res = await servedHandler!(new Request('http://edge.test/adapter-dispatch', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'procurement', operation: 'create', idempotencyKey, record }),
    }));
    return { status: res.status, body: await res.text(), calls };
  });
  return { ...result, unexpected };
}

describe('#876 slice 2 — entered vendor tax through the served adapter-dispatch', () => {
  it('AC-VWH-035 a bill naming a template AND entered amounts is refused (422) before any ERPNext call', async () => {
    const r = await dispatch({ ...BILL, taxTemplate: 'Input VAT 11 - DEMO', vatAmount: 110000, withheldAmount: 0, pphType: null },
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000876');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    assertEquals(r.status, 422, r.body);
    assert(r.body.includes('not both'), r.body);
    assertEquals(r.calls.filter((c) => c.url.host === ERP_HOST).length, 0, 'refused before any ERPNext call');
  });

  it('AC-VWH-035 forged client rows never reach ERPNext — the POST carries only the server-built Actual rows', async () => {
    const r = await dispatch({
      ...BILL, vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23',
      taxes: [{ charge_type: 'Actual', account_head: 'EVIL - DEMO', tax_amount: 999999, category: 'Total', add_deduct_tax: 'Deduct' }],
      taxesFromAmounts: true,
    }, 'bbbbbbbb-bbbb-4bbb-8bbb-000000000876');
    assertEquals(r.unexpected.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`), [], 'every read is mocked');
    const posts = r.calls.filter((c) => c.url.host === ERP_HOST && c.method === 'POST' && c.url.pathname === '/api/resource/Purchase%20Invoice');
    assertEquals(posts.length, 1, r.body);
    const body = posts[0].bodyJson as Record<string, unknown>;
    assertEquals(body.taxes_and_charges, '');
    assertEquals(body.taxes, [
      { charge_type: 'Actual', account_head: VAT_ACCOUNT, description: 'VAT', tax_amount: 110000, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 },
      { charge_type: 'Actual', account_head: PPH23_ACCOUNT, description: 'PPh 23', tax_amount: 20000, category: 'Total', add_deduct_tax: 'Deduct', included_in_print_rate: 0 },
    ]);
  });
});
```

**Verify red:** `cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-all vendorTaxAmounts.test.ts`
→ test 1 fails (the template path runs: not 422 / an ERP template read happens); test 2 fails (no `taxes` sent). If
either fails on a non-empty `unexpected` list instead, add the route the list names (as a fact) and re-run — the red
must come from the assertions, not from an unmocked read.

## Task 12 — Dispatch factory tests, red (AC-VWH-033) (~5 min)

Create `pmo-portal/src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts`:

```ts
/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13/22) — a vendor bill on an ERP-connected org carries the VAT and PPh the user
 * ENTERED; the dispatch turns them into fixed ERPNext `Actual` rows on the org's tax accounts. Drives the shipped
 * dispatch factory + adapter commit with PostgREST and ERPNext fakes (the #520 harness shape).
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveErpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { piToBody, piFromDoc } from './bodies/purchaseInvoice.ts';
import type { AdapterCommand } from '../contract.ts';
import { canonicalCommandDigest } from '../../../../../supabase/functions/adapter-dispatch/moneyOutboxDeps.ts';

type Row = Record<string, unknown>;
const ORG = 'org-1';
const COMPANY = 'Synthetic Co';
const ITEMS = [{ item_code: 'SYNTHETIC-ITEM', qty: 2, rate: 100 }];
const BINDING = {
  org_id: ORG, external_tier: 'erpnext', site_url: 'https://erp.example.test', version_major: 15,
  activated_at: '2026-10-01', config: { company: COMPANY },
};
const SETTINGS: Row = {
  input_vat_account: 'Input VAT - SC', pph23_payable_account: 'PPh 23 Payable - SC', pph4_2_payable_account: 'PPh 4(2) Payable - SC',
};
const ERP_ACCOUNTS: Record<string, Row> = {
  'Input VAT - SC': { company: COMPANY, is_group: 0, root_type: 'Asset' },
  'PPh 23 Payable - SC': { company: COMPANY, is_group: 0, root_type: 'Liability' },
  'PPh 4(2) Payable - SC': { company: COMPANY, is_group: 0, root_type: 'Liability' },
  'Foreign PPh - OC': { company: 'Other Co', is_group: 0, root_type: 'Liability' },
  'Duties and Taxes - SC': { company: COMPANY, is_group: 1, root_type: 'Liability' },
  'Discount - SC': { company: COMPANY, is_group: 0, root_type: 'Income' },
};

/** PostgREST boundary fake: honours eq filters and the selected columns (a missing column throws). */
function serviceClient(settings: Row = SETTINGS): DispatchServiceClient {
  const rows: Record<string, Row[]> = {
    external_org_bindings: [BINDING],
    organizations: [{ id: ORG, ...settings }],
    procurements: [{ id: 'proc-1', org_id: ORG, vendor_id: 'vendor-1', project_id: null }],
    companies: [{ id: 'vendor-1', org_id: ORG }],
    external_refs: [{ org_id: ORG, domain: 'companies', pmo_record_id: 'vendor-1', external_record_id: 'Supplier:Synthetic Supplier' }],
    procurement_items: [],
  };
  return { from(table: string) {
    return { select(columns: string) {
      const filters: Record<string, string> = {};
      const matches = () => (rows[table] ?? []).filter((row) => Object.entries(filters).every(([col, value]) => row[col] === value));
      const pick = (row: Row): Row => Object.fromEntries(columns.split(',').map((col) => col.trim()).map((col) => {
        if (!(col in row)) throw new Error(`fixture lacks selected column ${table}.${col}`);
        return [col, row[col]];
      }));
      const chain = {
        eq(col: string, value: string) { filters[col] = value; return chain; },
        order() { return chain; },
        limit() { return chain; },
        async maybeSingle() { const row = matches()[0]; return { data: row ? pick(row) : null, error: null }; },
        then(resolve: (value: { data: Row[]; error: null }) => void) { resolve({ data: matches().map(pick), error: null }); },
      };
      return chain;
    } };
  } } as unknown as DispatchServiceClient;
}

function erpFetch() {
  const writes: Row[] = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(url)).pathname);
    if (path === '/api/resource/Item') {
      return Response.json({ data: [{ name: 'SYNTHETIC-ITEM', disabled: 0, is_sales_item: 0, is_purchase_item: 1 }] });
    }
    if (path.startsWith('/api/resource/Account/')) {
      const name = path.slice('/api/resource/Account/'.length);
      return name in ERP_ACCOUNTS
        ? Response.json({ data: { name, ...ERP_ACCOUNTS[name] } })
        : new Response('{"exc_type":"DoesNotExistError"}', { status: 404 });
    }
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Row;
      writes.push(body);
      return Response.json({ data: { ...body, name: 'SYNTHETIC-PI-876', docstatus: 0, grand_total: 222, outstanding_amount: 222 } });
    }
    return Response.json({ data: { name: 'SYNTHETIC-PI-876', docstatus: 1, grand_total: 222, outstanding_amount: 222 } });
  });
  return { writes, fetchImpl };
}

function command(record: Row = {}, operation: AdapterCommand['operation'] = 'create'): AdapterCommand {
  return {
    domain: 'procurement', operation, idempotencyKey: 'pi-tax-876-key',
    record: { id: 'vi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice', items: ITEMS, ...record },
  };
}

async function resolve(cmd: AdapterCommand, erp: ReturnType<typeof erpFetch>, settings: Row = SETTINGS, replay = false) {
  return resolveErpDispatchAdapter({
    serviceClient: serviceClient(settings), orgId: ORG, command: cmd, replay,
    fetchImpl: erp.fetchImpl as typeof fetch, apiKey: 'synthetic-key', apiSecret: 'synthetic-secret',
    doctypeBodies: { 'purchase-invoice': { toBody: piToBody, fromDoc: piFromDoc } },
  });
}

async function push(record: Row, settings: Row = SETTINGS) {
  const cmd = command(record);
  const erp = erpFetch();
  await (await resolve(cmd, erp, settings)).commit(cmd);
  return { body: erp.writes[0] ?? {}, command: cmd, ...erp };
}

const VAT_ROW = { charge_type: 'Actual', account_head: 'Input VAT - SC', description: 'VAT', tax_amount: 22, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 };
const PPH23_ROW = { charge_type: 'Actual', account_head: 'PPh 23 Payable - SC', description: 'PPh 23', tax_amount: 4, category: 'Total', add_deduct_tax: 'Deduct', included_in_print_rate: 0 };
const BAD = (label: string, liability: boolean) =>
  `The ${label} in Administration → Accounting is not a usable ${liability ? 'tax-payable (liability) ' : ''}account of this organization's ERPNext company. Correct it, then record the invoice again.`;

describe('vendor invoice tax entered as amounts (#876 slice 2)', () => {
  it('AC-VWH-033 entered VAT and PPh 23 become two Actual rows on the org accounts, with an empty template', async () => {
    const { body, command: cmd } = await push({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' });
    expect(body.taxes_and_charges).toBe('');
    expect(body.taxes).toEqual([VAT_ROW, PPH23_ROW]);
    expect(cmd.record.taxesFromAmounts).toBe(true);
  });

  it('AC-VWH-033 PPh 4(2) posts to the PPh 4(2) payable account', async () => {
    const { body } = await push({ vatAmount: 0, withheldAmount: 4, pphType: 'pph4_2' });
    expect(body.taxes).toEqual([{ ...PPH23_ROW, account_head: 'PPh 4(2) Payable - SC', description: 'PPh 4(2)' }]);
  });

  it('AC-VWH-033 a zero VAT and no withholding sends an explicit empty tax table (no ERPNext default applies)', async () => {
    const { body } = await push({ vatAmount: 0, withheldAmount: 0, pphType: null });
    expect(body.taxes_and_charges).toBe('');
    expect(body.taxes).toEqual([]);
  });

  it('AC-VWH-033 caller-supplied rows and the server-only marker are dropped, with or without amounts', async () => {
    const forged = [{ charge_type: 'Actual', account_head: 'EVIL - SC', tax_amount: 999, add_deduct_tax: 'Deduct', category: 'Total' }];
    expect((await push({ taxes: forged, taxesFromAmounts: true, vatAmount: 22, withheldAmount: 0, pphType: null })).body.taxes).toEqual([VAT_ROW]);
    const plain = (await push({ taxes: forged, taxesFromAmounts: true })).body;
    expect(plain).not.toHaveProperty('taxes');
    expect(plain).not.toHaveProperty('taxes_and_charges');
  });

  it('AC-VWH-033 a template and amounts together are refused before any ERPNext read', async () => {
    const erp = erpFetch();
    await expect(resolve(command({ taxTemplate: 'Synthetic Input VAT', vatAmount: 22 }), erp))
      .rejects.toMatchObject({ code: 'commit-rejected', message: 'Choose an ERPNext tax template or enter the tax amounts — not both.' });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['a negative VAT', { vatAmount: -1, withheldAmount: 0, pphType: null }, "The vendor invoice's VAT amount must be zero or a positive amount with at most two decimals."],
    ['a VAT with three decimals', { vatAmount: 1.005, withheldAmount: 0, pphType: null }, "The vendor invoice's VAT amount must be zero or a positive amount with at most two decimals."],
    ['a withholding given as text', { vatAmount: 0, withheldAmount: '4', pphType: 'pph23' }, "The vendor invoice's tax withheld must be zero or a positive amount with at most two decimals."],
    ['a withholding without its type', { vatAmount: 0, withheldAmount: 4, pphType: null }, 'Say whether the tax withheld is PPh 23 or PPh 4(2).'],
    ['an unknown withholding type', { vatAmount: 0, withheldAmount: 4, pphType: 'pph21' }, 'The withholding type must be PPh 23 or PPh 4(2).'],
    ['a withholding above the items total', { vatAmount: 0, withheldAmount: 200.01, pphType: 'pph23' }, "The tax withheld is larger than the invoice's items total before tax. Check the PPh amount on the vendor's invoice."],
  ] as Array<[string, Row, string]>)('AC-VWH-033 %s is refused (commit-rejected) before any ERPNext read or write', async (_label, record, message) => {
    const erp = erpFetch();
    await expect(resolve(command(record), erp)).rejects.toMatchObject({ code: 'commit-rejected', message });
    expect(erp.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['the PPh 23 setting is empty', { ...SETTINGS, pph23_payable_account: null }, 'Set the PPh 23 payable account in Administration → Accounting before recording this tax on a vendor invoice.'],
    ['the input VAT setting is empty', { ...SETTINGS, input_vat_account: null }, 'Set the Input VAT account in Administration → Accounting before recording this tax on a vendor invoice.'],
    ['ERPNext has no such account', { ...SETTINGS, pph23_payable_account: 'Missing - SC' }, BAD('PPh 23 payable account', true)],
    ['the account belongs to another company', { ...SETTINGS, pph23_payable_account: 'Foreign PPh - OC' }, BAD('PPh 23 payable account', true)],
    ['the account is a group', { ...SETTINGS, pph23_payable_account: 'Duties and Taxes - SC' }, BAD('PPh 23 payable account', true)],
    ['the PPh account is not a liability', { ...SETTINGS, pph23_payable_account: 'Discount - SC' }, BAD('PPh 23 payable account', true)],
    ['the VAT account belongs to another company', { ...SETTINGS, input_vat_account: 'Foreign PPh - OC' }, BAD('Input VAT account', false)],
  ] as Array<[string, Row, string]>)('AC-VWH-033 %s is refused (config-rejected) naming the setting, before any ERPNext write', async (_label, settings, message) => {
    const erp = erpFetch();
    const err = await resolve(command({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' }), erp, settings)
      .then(() => null, (e: Error & { code?: string }) => e);
    expect(err).toMatchObject({ code: 'config-rejected', message });
    // ADR-0072: the refusal names the setting, never the account or the ERP company.
    expect(err!.message).not.toMatch(/ - (SC|OC)/);
    expect(err!.message).not.toContain(COMPANY);
    expect(erp.writes).toEqual([]);
  });

  it('AC-VWH-033 a replayed create keeps its persisted rows: no ERPNext read, same digest after the settings changed', async () => {
    const first = await push({ vatAmount: 22, withheldAmount: 4, pphType: 'pph23' });
    const replay = command();
    replay.record = structuredClone(first.command.record) as AdapterCommand['record'];
    const erp = erpFetch();
    await resolve(replay, erp, { ...SETTINGS, input_vat_account: 'Changed VAT - SC' }, true);
    expect(erp.fetchImpl).not.toHaveBeenCalled();
    expect(await canonicalCommandDigest({ domain: replay.domain, operation: replay.operation, record: replay.record }))
      .toBe(await canonicalCommandDigest({ domain: first.command.domain, operation: first.command.operation, record: first.command.record }));
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts`
→ fails (no rows built, no refusals).

## Task 13 — Server: entered-amount rows + `resolvePurchaseInvoiceTaxes`, green (AC-VWH-033, AC-VWH-035) (~5 min)

1. Append to `pmo-portal/src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts`:

```ts
// ── #876 slice 2 (OD-VWH-1, DD-VWH-13/22, ADR-0084): tax AMOUNTS entered in PMO, sent as fixed `Actual` rows ──────

/** The vendor-bill tax accounts an Admin set in Administration → Accounting (organizations, migration 0272). */
export interface VendorTaxAccounts {
  inputVat: string | null;
  pph23: string | null;
  pph4_2: string | null;
}

/** The tax entered on the bill. `pphType` is null exactly when nothing is withheld. */
export interface EnteredPurchaseTax {
  vatAmount: number;
  withheldAmount: number;
  pphType: 'pph23' | 'pph4_2' | null;
}

export interface ErpActualTaxRow {
  charge_type: 'Actual';
  account_head: string;
  description: string;
  tax_amount: number;
  category: 'Total';
  add_deduct_tax: 'Add' | 'Deduct';
  included_in_print_rate: 0;
}

export const ENTERED_TAX_AND_TEMPLATE = 'Choose an ERPNext tax template or enter the tax amounts — not both.';
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const PPH_LABEL = { pph23: 'PPh 23', pph4_2: 'PPh 4(2)' } as const;
const SETTING_LABEL = { inputVat: 'Input VAT account', pph23: 'PPh 23 payable account', pph4_2: 'PPh 4(2) payable account' } as const;

/**
 * The command's entered amounts, shape-checked with NO reads, so a malformed one is refused before any ERP call.
 * Null when the command carries none of `vatAmount` / `withheldAmount` / `pphType` (template or ERPNext-default path).
 */
export function parseEnteredPurchaseTax(record: Record<string, unknown>): EnteredPurchaseTax | null {
  if (!('vatAmount' in record) && !('withheldAmount' in record) && !('pphType' in record)) return null;
  const money = (value: unknown, label: string): number => {
    if (typeof value !== 'number' || !MONEY.test(String(value))) {
      throw new AdapterError('commit-rejected', `The vendor invoice's ${label} must be zero or a positive amount with at most two decimals.`);
    }
    return value;
  };
  const vatAmount = money(record.vatAmount ?? 0, 'VAT amount');
  const withheldAmount = money(record.withheldAmount ?? 0, 'tax withheld');
  const type = record.pphType ?? null;
  if (type !== null && type !== 'pph23' && type !== 'pph4_2') {
    throw new AdapterError('commit-rejected', 'The withholding type must be PPh 23 or PPh 4(2).');
  }
  if (withheldAmount > 0 && type === null) {
    throw new AdapterError('commit-rejected', 'Say whether the tax withheld is PPh 23 or PPh 4(2).');
  }
  return { vatAmount, withheldAmount, pphType: withheldAmount > 0 ? type : null };
}

/** The setting's account, when it is a non-group account of the binding's company (a PPh account: a Liability). */
async function usableAccount(
  deps: ErpClientDeps, company: string, name: string | null, setting: keyof typeof SETTING_LABEL, liability: boolean,
): Promise<string> {
  const label = SETTING_LABEL[setting];
  const account = name?.trim() ?? '';
  if (!account) {
    throw new AppError(`Set the ${label} in Administration → Accounting before recording this tax on a vendor invoice.`, 'config-rejected');
  }
  let doc: { company?: unknown; is_group?: unknown; root_type?: unknown } | null;
  try {
    doc = (await getDoc(deps, 'Account', account)) as typeof doc;
  } catch (err) {
    // ERPNext answers an unknown account 404 → commit-rejected (client.ts). Anything else (unreachable) propagates.
    if ((err as { code?: unknown } | null)?.code !== 'commit-rejected') throw err;
    doc = null;
  }
  if (!doc || doc.company !== company || Number(doc.is_group) !== 0 || (liability && doc.root_type !== 'Liability')) {
    throw new AppError(
      `The ${label} in Administration → Accounting is not a usable ${liability ? 'tax-payable (liability) ' : ''}account of this organization's ERPNext company. Correct it, then record the invoice again.`,
      'config-rejected',
    );
  }
  return account;
}

/**
 * The fixed rows for the entered amounts: VAT `Add` on the input-VAT account, PPh `Deduct` on the type's payable
 * account; a zero amount sends no row. Withholding above the items total is refused before any read — ERPNext would
 * accept it and the mirror's `withheld ≤ amount` bound would then refuse every replay (DD-VWH-22).
 */
export async function buildEnteredPurchaseTaxRows(
  deps: ErpClientDeps, company: string, entered: EnteredPurchaseTax, accounts: VendorTaxAccounts, itemsTotal: number | null,
): Promise<ErpActualTaxRow[]> {
  if (itemsTotal !== null && Math.round(entered.withheldAmount * 100) > Math.round(itemsTotal * 100)) {
    throw new AdapterError('commit-rejected', "The tax withheld is larger than the invoice's items total before tax. Check the PPh amount on the vendor's invoice.");
  }
  const rows: ErpActualTaxRow[] = [];
  if (entered.vatAmount > 0) {
    rows.push({
      charge_type: 'Actual', account_head: await usableAccount(deps, company, accounts.inputVat, 'inputVat', false),
      description: 'VAT', tax_amount: entered.vatAmount, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0,
    });
  }
  if (entered.withheldAmount > 0 && entered.pphType) {
    rows.push({
      charge_type: 'Actual', account_head: await usableAccount(deps, company, accounts[entered.pphType], entered.pphType, true),
      description: PPH_LABEL[entered.pphType], tax_amount: entered.withheldAmount, category: 'Total', add_deduct_tax: 'Deduct',
      included_in_print_rate: 0,
    });
  }
  return rows;
}
```

   The withheld-above-items check must run before any Account read: move nothing — it is the first statement. The
   shape checks run in `parseEnteredPurchaseTax`, which `resolvePurchaseInvoiceTaxes` calls before the company check.

2. In `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts`:
   - replace `import { resolvePurchaseTaxRows } from './erpPurchaseTaxRows.ts';` with
     `import { buildEnteredPurchaseTaxRows, ENTERED_TAX_AND_TEMPLATE, parseEnteredPurchaseTax, resolvePurchaseTaxRows } from './erpPurchaseTaxRows.ts';`
   - directly after `import type { Adapter, AdapterCommand } from '../contract.ts';` add `import { AdapterError } from '../contract.ts';`
   - replace the whole `resolvePurchaseInvoiceTaxes` function (its doc comment included) with:

```ts
/**
 * #520 + #876 slice 2 — the tax a vendor invoice create on a flipped org sends. Exactly one of:
 *   • a user-chosen ERPNext Purchase Taxes and Charges Template (#520): resolved, validated against the binding's
 *     company and expanded into its rows here;
 *   • the VAT / PPh AMOUNTS the user entered (DD-VWH-13): fixed `Actual` rows on the org's tax accounts, marked
 *     `taxesFromAmounts` so `piToBody` sends them with an empty template;
 *   • neither: nothing is sent and ERPNext applies its own default (AC-520-2).
 * Both is refused before any ERP call. Rows and the marker are written onto the record BEFORE the outbox snapshot, so
 * the payload and digest cover them and a sweep replay re-sends them with no ERPNext read. A caller's `taxes` and
 * `taxesFromAmounts` are always dropped; edits and amends send none.
 */
async function resolvePurchaseInvoiceTaxes(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, resolvedItems: ResolvedLineItem[] | undefined,
): Promise<void> {
  const record = deps.command.record as Record<string, unknown>;
  if (record.erp_doc_kind !== 'purchase-invoice') return;
  if (deps.replay && deps.command.operation === 'create') return;
  delete record.taxes;
  delete record.taxesFromAmounts;
  const chosen = typeof record.taxTemplate === 'string' ? record.taxTemplate.trim() : '';
  const entered = deps.command.operation === 'create' ? parseEnteredPurchaseTax(record) : null;
  if (deps.command.operation !== 'create' || (!chosen && !entered)) {
    for (const key of ['taxTemplate', 'vatAmount', 'withheldAmount', 'pphType']) delete record[key];
    return;
  }
  if (chosen && entered) throw new AdapterError('commit-rejected', ENTERED_TAX_AND_TEMPLATE);
  const company = binding.config?.company;
  if (typeof company !== 'string' || !company) {
    throw new AppError(chosen
      ? 'ERPNext has no company set for this organization, so the chosen purchase tax template cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.'
      : 'ERPNext has no company set for this organization, so the vendor invoice tax cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.',
    'config-rejected');
  }
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  if (chosen) {
    record.taxTemplate = chosen;
    record.taxes = await resolvePurchaseTaxRows(client, company, chosen);
    return;
  }
  if (!entered) return;
  delete record.taxTemplate;
  const { data, error } = await deps.serviceClient.from('organizations')
    .select('input_vat_account,pph23_payable_account,pph4_2_payable_account').eq('id', deps.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const settings = (data ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const lines = (Array.isArray(record.items) && record.items.length > 0 ? record.items : resolvedItems ?? []) as Array<{ qty?: unknown; rate?: unknown }>;
  const total = lines.reduce((sum, line) => sum + Math.round(Number(line.qty) * Number(line.rate ?? 0) * 100), 0) / 100;
  const itemsTotal = lines.length > 0 && Number.isFinite(total) ? total : null;
  record.taxes = await buildEnteredPurchaseTaxRows(client, company, entered, {
    inputVat: text(settings.input_vat_account), pph23: text(settings.pph23_payable_account), pph4_2: text(settings.pph4_2_payable_account),
  }, itemsTotal);
  record.taxesFromAmounts = true;
  record.vatAmount = entered.vatAmount;
  record.withheldAmount = entered.withheldAmount;
  record.pphType = entered.pphType;
}
```

   - replace the call `await resolvePurchaseInvoiceTaxes(deps, binding);` with `await resolvePurchaseInvoiceTaxes(deps, binding, resolvedItems);`

3. In `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts`, in `piToBody`, directly after the `#520`
   spread (`...(Array.isArray(rec.taxes) && rec.taxes.length > 0 && typeof rec.taxTemplate === 'string' ? {…} : {}),`) add:

```ts
    // #876 slice 2 (DD-VWH-13): the fixed `Actual` rows the dispatch built from the ENTERED amounts. The empty template
    // is explicit so ERPNext applies no template (and no default) on top; an empty table is a deliberate "no tax".
    ...(rec.taxesFromAmounts === true && Array.isArray(rec.taxes) && typeof rec.taxTemplate !== 'string'
      ? { taxes_and_charges: '', taxes: rec.taxes } : {}),
```

**Verify green:**
`cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts src/lib/adapterSeam/erpnext/purchaseInvoiceTaxTemplate.test.ts src/lib/adapterSeam/erpnext/purchaseProjectReferences.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.poGrRefs.test.ts && npm run typecheck && npm run typecheck:edge`
then `cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-all vendorTaxAmounts.test.ts receiptWithholdingRecovery.test.ts readModelWriters.money.test.ts`
→ all pass (every AC-520-* and AC-VWH-001..003 unchanged).

## Task 14 — Body mapper: amounts mode + empty template, red → green (AC-VWH-034) (~4 min)

In `pmo-portal/src/lib/adapterSeam/erpnext/bodies/bodies.test.ts`, directly after the test
`'R9 §1 purchaseInvoice.ts: {supplier, items:[{item_code,qty,rate}]}'`, add:

```ts
  it('AC-VWH-034 amounts mode sends the server-built rows with an EMPTY template (an empty table is "no tax")', () => {
    const rows = [{ charge_type: 'Actual', account_head: 'Input VAT - SC', description: 'VAT', tax_amount: 110000, category: 'Total', add_deduct_tax: 'Add', included_in_print_rate: 0 }];
    expect(piToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }], taxes: rows, taxesFromAmounts: true }), CTX))
      .toMatchObject({ taxes_and_charges: '', taxes: rows });
    expect(piToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }], taxes: [], taxesFromAmounts: true }), CTX))
      .toMatchObject({ taxes_and_charges: '', taxes: [] });
  });

  it('AC-VWH-034 rows without the server marker or a template are never sent', () => {
    const body = piToBody(rec({ items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1 }], taxes: [{ charge_type: 'Actual' }] }), CTX) as Record<string, unknown>;
    expect(body).not.toHaveProperty('taxes');
    expect(body).not.toHaveProperty('taxes_and_charges');
  });

  it('AC-VWH-034 an ERPNext bill with no template mirrors tax_template null, never an empty string (DD-VWH-21)', () => {
    expect(piFromDoc({ name: 'ACC-PINV-2026-00900', grand_total: 1, taxes_and_charges: '' }).tax_template).toBeNull();
    expect(piFromDoc({ name: 'ACC-PINV-2026-00901', grand_total: 1, taxes_and_charges: 'PPN 11 - RIS' }).tax_template).toBe('PPN 11 - RIS');
  });
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts -t "AC-VWH-034"`
→ the third fails (`''` mirrored); the first two pass already (Task 13 added the mapper branch).

In `pmo-portal/src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts`, in `piFromDoc`, replace
`tax_template: (d.taxes_and_charges as string | null) ?? null,` with
`tax_template: typeof d.taxes_and_charges === 'string' && d.taxes_and_charges.trim() ? d.taxes_and_charges : null,`

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts src/lib/adapterSeam/erpnext/doctypeBodies.test.ts`
then `cd "$WT/supabase/functions/erpnext-sweep" && deno test --allow-all ../_shared/erpnextFeedDeps.test.ts` → all pass.

---

## Task 15 — `useSuggestedMoney`, red → green (AC-VWH-030 latch) (~4 min)

Create `pmo-portal/src/hooks/useSuggestedMoney.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { formatMoneyInputValue } from '@/src/lib/format';
import { useSuggestedMoney } from './useSuggestedMoney';

function useHarness(suggested: number | null, enabled: boolean) {
  const [raw, setRaw] = useState('');
  const { markTouched } = useSuggestedMoney(suggested, raw, setRaw, enabled);
  return { raw, setRaw, markTouched };
}

describe('useSuggestedMoney (#876 slice 2, DD-VWH-17)', () => {
  it('AC-VWH-030 follows the suggestion until the user edits, then never overwrites', () => {
    const { result, rerender } = renderHook(({ s }) => useHarness(s, true), { initialProps: { s: 110000 as number | null } });
    expect(result.current.raw).toBe(formatMoneyInputValue(110000));
    rerender({ s: 220000 });
    expect(result.current.raw).toBe(formatMoneyInputValue(220000));
    act(() => { result.current.markTouched(); result.current.setRaw('5'); });
    rerender({ s: 330000 });
    expect(result.current.raw).toBe('5');
  });

  it('AC-VWH-030 a null suggestion or a disabled field writes nothing', () => {
    const { result: none } = renderHook(() => useHarness(null, true));
    expect(none.current.raw).toBe('');
    const { result: off } = renderHook(() => useHarness(110000, false));
    expect(off.current.raw).toBe('');
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run src/hooks/useSuggestedMoney.test.ts` → fails (module missing).

Create `pmo-portal/src/hooks/useSuggestedMoney.ts`:

```ts
import { useEffect, useRef } from 'react';
import { formatMoneyInputValue } from '@/src/lib/format';

/**
 * #876 slice 2 (DD-VWH-17) — keeps a money draft equal to a SUGGESTED amount until the user edits that field, then
 * never writes it again: "never over a choice", the OD-TAX-1 rule (`useTaxTreatmentPreselect`). The field's own
 * onChange calls `markTouched`. A null suggestion or `enabled: false` writes nothing — unknown is never guessed.
 */
export function useSuggestedMoney(
  suggested: number | null,
  current: string,
  apply: (raw: string) => void,
  enabled = true,
): { markTouched: () => void } {
  const touched = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const next = enabled && suggested !== null ? formatMoneyInputValue(suggested) : null;
  useEffect(() => {
    if (touched.current || next === null || next === currentRef.current) return;
    applyRef.current(next);
  }, [next]);
  return { markTouched: () => { touched.current = true; } };
}
```

**Verify green:** same command → 2 pass.

## Task 16 — Bill form tests, red (AC-VWH-030, AC-VWH-031) (~5 min)

Create `pmo-portal/pages/procurement/RecordCaptureForm.vendorTax.test.tsx`:

```tsx
/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13..17) — the "Record vendor invoice" form starts from the vendor's default tax
 * treatment, keeps every amount editable, labels each pre-filled amount with its rate and base, and stages exactly what
 * the user submits: a standalone org stages `withheldAmount`; an ERP-connected org stages `erpTaxAmounts` (or a template).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const repo = vi.hoisted(() => ({
  getCompany: vi.fn(async () => ({ id: 'vendor-1', default_vat_rate: 11 as number | null, default_pph_type: 'pph23' as string | null, default_pph_rate: 2 as number | null })),
  listTemplates: vi.fn(async () => [{ name: 'Input VAT 11' }]),
}));
vi.mock('@/src/lib/repositories', async (orig) => {
  const actual = (await orig()) as { repositories: Record<string, unknown> };
  return {
    ...actual,
    repositories: {
      ...actual.repositories,
      company: { get: repo.getCompany },
      integrations: { listPurchaseTaxTemplates: repo.listTemplates },
    },
  };
});
vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm } from './RecordCaptureForm';
import { queryClient } from '@/src/lib/queryClient';
import { formatMoneyInputValue } from '@/src/lib/format';
import * as ownership from '@/src/lib/adapterSeam/ownershipCache';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

function renderVI(props: { vendorId?: string | null; itemsNet?: number | null } = {}, onStage = vi.fn()) {
  render(
    <FinanceI18nTestProvider>
      <ToastProvider>
        <RecordCaptureForm kind="vendor_invoice" onCreate={vi.fn()} onClose={vi.fn()} onStage={onStage} {...props} />
      </ToastProvider>
    </FinanceI18nTestProvider>,
  );
  return onStage;
}
const NO_DEFAULT = { id: 'vendor-1', default_vat_rate: null, default_pph_type: null, default_pph_rate: null };

beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  queryClient.clear();
  repo.getCompany.mockClear();
  await financeTestI18n.changeLanguage('en');
});
afterEach(() => vi.restoreAllMocks());

describe('standalone bill (PMO authors the tax) — AC-VWH-030', () => {
  beforeEach(() => { vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('pmo'); });

  it('AC-VWH-030 pre-fills VAT and PPh from the vendor default, labels their bases, and stages the withholding', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await waitFor(() => expect(screen.getByTestId('vi-tax-amount-input')).toHaveValue(formatMoneyInputValue(110000)));
    await waitFor(() => expect(screen.getByTestId('vi-withheld-input')).toHaveValue(formatMoneyInputValue(20000)));
    expect(screen.getAllByTestId('vi-tax-suggested-from').map((n) => n.textContent)).toEqual([
      `Vendor default 11% of ${formatMoneyInputValue(1000000)}`,
      `Vendor default 2% of ${formatMoneyInputValue(1000000)}`,
    ]);
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'createVI', amount: 1000000, taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000,
    }));
  });

  it('AC-VWH-030 an edited amount is kept: the VAT follows the bill amount, the edited PPh does not', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1' });
    const amount = screen.getByTestId('vi-amount-input');
    await userEvent.type(amount, '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    const withheld = await screen.findByTestId('vi-withheld-input');
    await waitFor(() => expect(withheld).toHaveValue(formatMoneyInputValue(20000)));
    await userEvent.clear(withheld);
    await userEvent.type(withheld, '19999');
    await userEvent.clear(amount);
    await userEvent.type(amount, '2000000');
    await waitFor(() => expect(screen.getByTestId('vi-tax-amount-input')).toHaveValue(formatMoneyInputValue(220000)));
    expect(withheld).toHaveValue(formatMoneyInputValue(19999));
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ taxAmount: 220000, withheldAmount: 19999 }));
  });

  it('AC-VWH-030 without a vendor default nothing is pre-filled and a blank PPh records none', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    const onStage = renderVI({ vendorId: 'vendor-1' });
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    expect(screen.getByTestId('vi-withheld-input')).toHaveValue('');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('withheldAmount');
  });

  it('AC-VWH-030 a PPh with no bill amount blocks the save', async () => {
    renderVI();
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '0');
    await userEvent.type(screen.getByTestId('vi-withheld-input'), '5000');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
  });
});

describe('ERP-connected bill (amounts sent as fixed rows) — AC-VWH-031', () => {
  beforeEach(() => { vi.spyOn(ownership, 'routeDomainWrite').mockReturnValue('external'); });

  it('AC-VWH-031 "Enter the tax amounts" is the default; VAT, PPh 23 and its amount are pre-filled on the items total', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    const select = (await screen.findByTestId('vi-tax-template-select')) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getByRole('option', { name: 'Enter the tax amounts' })).toBeInTheDocument();
    expect(within(select).queryByRole('option', { name: 'ERPNext default' })).toBeNull();
    await waitFor(() => expect(screen.getByTestId('vi-erp-vat-input')).toHaveValue(formatMoneyInputValue(110000)));
    expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('pph23');
    await waitFor(() => expect(screen.getByTestId('vi-erp-withheld-input')).toHaveValue(formatMoneyInputValue(20000)));
    expect(screen.getByTestId('vi-items-net')).toHaveTextContent(`Items total, before tax: ${formatMoneyInputValue(1000000)}`);
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'createVI', erpTaxAmounts: { vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' },
    }));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('taxTemplate');
  });

  it('AC-VWH-031 choosing a template hides the amounts and stages only the template', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    const select = await screen.findByTestId('vi-tax-template-select');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Input VAT 11' })).toBeInTheDocument());
    await userEvent.selectOptions(select, 'Input VAT 11');
    expect(screen.queryByTestId('vi-erp-vat-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ taxTemplate: 'Input VAT 11' }));
    expect(onStage.mock.calls[0][0]).not.toHaveProperty('erpTaxAmounts');
  });

  it('AC-VWH-031 choosing no withholding hides the PPh amount and stages none', async () => {
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    await waitFor(() => expect(screen.getByTestId('vi-pph-type-select')).toHaveValue('pph23'));
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), '');
    expect(screen.queryByTestId('vi-erp-withheld-input')).toBeNull();
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      erpTaxAmounts: { vatAmount: 110000, withheldAmount: 0, pphType: null },
    }));
  });

  it('AC-VWH-031 without a vendor default the save waits for a VAT amount (0 allowed)', async () => {
    repo.getCompany.mockResolvedValueOnce(NO_DEFAULT);
    const onStage = renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    await screen.findByTestId('vi-erp-vat-input');
    expect(screen.getByTestId('btn-save-vi')).toBeDisabled();
    await userEvent.type(screen.getByTestId('vi-erp-vat-input'), '0');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    expect(onStage).toHaveBeenCalledWith(expect.objectContaining({
      erpTaxAmounts: { vatAmount: 0, withheldAmount: 0, pphType: null },
    }));
  });

  it('AC-VWH-031 the amounts and their bases render in Bahasa Indonesia', async () => {
    await financeTestI18n.changeLanguage('id');
    renderVI({ vendorId: 'vendor-1', itemsNet: 1000000 });
    expect(await screen.findByLabelText('Jumlah PPN')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Masukkan jumlah pajak' })).toBeInTheDocument();
    expect(screen.getByTestId('vi-items-net').textContent).toMatch(/^Total item, sebelum pajak: /);
    await waitFor(() => expect(screen.getAllByTestId('vi-tax-suggested-from')[0].textContent).toMatch(/^Default vendor 11% dari /));
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/RecordCaptureForm.vendorTax.test.tsx`
→ every test fails (no pre-fill, no `vi-withheld-input`, no ERP amount fields).

## Task 17 — Hooks, components, test ids and locale keys (no behaviour wired yet) (~5 min)

1. Create `pmo-portal/src/hooks/useVendorTaxDefault.ts`:

```ts
import { useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { repositories } from '@/src/lib/repositories';
import { queryClient } from '@/src/lib/queryClient';
import { vendorTaxDefaultOf, type VendorTaxDefault } from '@/src/lib/vendorWithholding';

/**
 * #876 slice 2 (OD-VWH-1) — the procurement vendor's default tax treatment, for PRE-FILLING a new bill only
 * (DD-VWH-19: no write path reads it). Shares `useCompany`'s cache key, so saving the defaults on the company page
 * refreshes an open bill form. Null while unknown, on a read failure, or when the vendor states no default — the
 * form then pre-fills nothing (unknown is never guessed).
 */
export function useVendorTaxDefault(vendorId: string | null | undefined): VendorTaxDefault | null {
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  const query = useQuery(
    {
      queryKey: ['company', orgId, vendorId],
      queryFn: () => repositories.company.get(vendorId as string),
      enabled: Boolean(vendorId),
      staleTime: 30_000,
      retry: false,
    },
    queryClient,
  );
  return useMemo(() => vendorTaxDefaultOf(query.data), [query.data]);
}
```

2. Create `pmo-portal/src/hooks/useVendorBillTax.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import {
  netOf, parseErpTaxAmounts, parseNativeWithheld, suggestVat, suggestWithheld,
  type TaxBasis, type VendorTaxDefault,
} from '@/src/lib/vendorWithholding';
import { useSuggestedMoney } from './useSuggestedMoney';

/** The tax-basis label of a pre-filled amount: which rate, applied to which base (DD-VWH-17). */
export interface TaxSuggestion {
  rate: number;
  base: number;
}

/**
 * #876 slice 2 — a STANDALONE bill (PMO authors the tax). The VAT amount is the form's existing tax-amount draft: it is
 * pre-filled only while no nominal rate is typed (a typed rate makes it a calculated field, #513) and until the user
 * edits it. The PPh is a new draft, pre-filled on the net. Shared by both vendor-bill entry points.
 */
export function useNativeVendorTax(args: {
  vendor: VendorTaxDefault | null;
  enabled: boolean;
  amountRaw: string;
  treatmentRaw: string;
  vatRaw: string;
  setVatRaw: (raw: string) => void;
  vatIsCalculated: boolean;
}) {
  const { vendor, enabled } = args;
  const amount = args.amountRaw.trim() ? parseMoneyInputAtScale(args.amountRaw, 2) : null;
  const trimmed = args.treatmentRaw.trim();
  const treatment: TaxBasis | null = trimmed === 'inclusive' || trimmed === 'exclusive' ? trimmed : null;
  const vatRate = vendor?.vatRate ?? null;
  const vatSuggested = enabled && vatRate !== null && amount !== null && treatment ? suggestVat(amount, treatment, vatRate) : null;
  const vat = useSuggestedMoney(vatSuggested, args.vatRaw, args.setVatRaw, enabled && !args.vatIsCalculated);
  const currentVat = args.vatRaw.trim() ? parseMoneyInputAtScale(args.vatRaw, 2) : null;
  const net = amount !== null && treatment && currentVat !== null ? netOf(amount, treatment, currentVat) : null;
  const [withheldRaw, setWithheldRaw] = useState('');
  const pphRate = vendor?.pphRate ?? null;
  const withheldSuggested = enabled && pphRate !== null && net !== null ? suggestWithheld(net, pphRate) : null;
  const withheld = useSuggestedMoney(withheldSuggested, withheldRaw, setWithheldRaw, enabled);
  return {
    markVatTouched: vat.markTouched,
    vatSuggestion: enabled && vatSuggested !== null && vatRate !== null && amount !== null && treatment
      ? { rate: vatRate, base: netOf(amount, treatment, vatSuggested) } : null,
    withheld: {
      raw: withheldRaw,
      onChange: (next: string) => { withheld.markTouched(); setWithheldRaw(next); },
      value: parseNativeWithheld(withheldRaw, amount),
      suggestion: enabled && pphRate !== null && net !== null ? { rate: pphRate, base: net } : null,
    },
  };
}
export type NativeVendorTax = ReturnType<typeof useNativeVendorTax>;

/**
 * #876 slice 2 — an ERP-BOUND bill in "Enter the tax amounts" mode (DD-VWH-14/15). VAT, the withholding type and the
 * PPh amount are pre-filled from the vendor default on the items total (what the dispatch sends as lines); the type is
 * seeded once and never over the user's choice.
 */
export function useErpVendorTax(args: { vendor: VendorTaxDefault | null; enabled: boolean; itemsNet: number | null }) {
  const { vendor, enabled, itemsNet } = args;
  const [vatRaw, setVatRaw] = useState('');
  const [pphTypeRaw, setPphTypeRaw] = useState('');
  const [withheldRaw, setWithheldRaw] = useState('');
  const typeChosen = useRef(false);
  useEffect(() => {
    const seed = vendor?.pphType;
    if (!enabled || typeChosen.current || !seed) return;
    typeChosen.current = true;
    setPphTypeRaw((current) => (current === '' ? seed : current));
  }, [enabled, vendor]);
  const vatRate = vendor?.vatRate ?? null;
  const vat = useSuggestedMoney(
    enabled && vatRate !== null && itemsNet !== null ? suggestVat(itemsNet, 'exclusive', vatRate) : null,
    vatRaw, setVatRaw, enabled);
  const pphRate = vendor?.pphType && pphTypeRaw === vendor.pphType ? vendor.pphRate : null;
  const withheld = useSuggestedMoney(
    enabled && pphRate !== null && itemsNet !== null ? suggestWithheld(itemsNet, pphRate) : null,
    withheldRaw, setWithheldRaw, enabled && pphTypeRaw !== '');
  return {
    itemsNet,
    vat: {
      raw: vatRaw,
      onChange: (next: string) => { vat.markTouched(); setVatRaw(next); },
      suggestion: vatRate !== null && itemsNet !== null ? { rate: vatRate, base: itemsNet } : null,
    },
    pphType: { raw: pphTypeRaw, onChange: (next: string) => { typeChosen.current = true; setPphTypeRaw(next); } },
    withheld: {
      raw: withheldRaw,
      onChange: (next: string) => { withheld.markTouched(); setWithheldRaw(next); },
      suggestion: pphRate !== null && itemsNet !== null ? { rate: pphRate, base: itemsNet } : null,
    },
    amounts: parseErpTaxAmounts(vatRaw, pphTypeRaw, withheldRaw),
  };
}
export type ErpVendorTax = ReturnType<typeof useErpVendorTax>;
```

3. Append to `pmo-portal/pages/procurement/vendorInvoiceTestIds.ts`:

```ts
/** #876 slice 2 (OD-VWH-1): the vendor-bill tax inputs shared by both entry points (VendorBillTaxFields.tsx). */
export const VI_VENDOR_TAX_TEST_IDS = {
  nativeWithheld: 'vi-withheld-input',
  erpFields: 'vi-erp-tax-fields',
  erpVat: 'vi-erp-vat-input',
  pphType: 'vi-pph-type-select',
  erpWithheld: 'vi-erp-withheld-input',
  itemsNet: 'vi-items-net',
  suggestedFrom: 'vi-tax-suggested-from',
  erpRequiredHint: 'vi-erp-tax-required-hint',
} as const;
```

4. Create `pmo-portal/pages/procurement/VendorBillTaxFields.tsx`:

```tsx
/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-13..17) — the vendor-bill tax inputs shared by BOTH vendor-invoice entry points
 * (RecordCaptureForm, VIInlineCapture in ProcurementDecisionZone). Presentational only: state, pre-fill and parsing
 * live in `useVendorBillTax`; every money computation lives in `vendorWithholding.ts`.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FieldError, SelectField, useMoneyInputMask } from '@/src/components/ui';
import { formatMoneyInputValue } from '@/src/lib/format';
import type { ErpVendorTax, NativeVendorTax, TaxSuggestion } from '@/src/hooks/useVendorBillTax';
import { VI_VENDOR_TAX_TEST_IDS } from './vendorInvoiceTestIds';

const LABEL = 'text-[12px] font-semibold text-muted-foreground';
const INPUT = 'h-8 w-full rounded-md border border-input bg-background px-2.5 text-[13.5px] tabular-nums outline-none placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The tax-basis label under a pre-filled amount: which rate, applied to which base. */
export const TaxSuggestedFrom: React.FC<{ suggestion: TaxSuggestion | null }> = ({ suggestion }) => {
  const { t } = useTranslation();
  if (!suggestion) return null;
  return (
    <p data-testid={VI_VENDOR_TAX_TEST_IDS.suggestedFrom} className="text-[12px] text-muted-foreground">
      {t('procurementDetail.vendorTax.suggestedFrom', 'Vendor default {{rate}}% of {{base}}', {
        rate: formatMoneyInputValue(suggestion.rate),
        base: formatMoneyInputValue(suggestion.base),
      })}
    </p>
  );
};

interface MoneyFieldProps {
  id: string;
  label: React.ReactNode;
  raw: string;
  onChange: (next: string) => void;
  testId: string;
  suggestion: TaxSuggestion | null;
  error?: string;
}

const MoneyField: React.FC<MoneyFieldProps> = ({ id, label, raw, onChange, testId, suggestion, error }) => {
  const mask = useMoneyInputMask(raw, onChange);
  return (
    <div className="flex min-w-[140px] flex-1 flex-col gap-1">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        ref={mask.ref}
        value={raw}
        onChange={mask.onChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="0.00"
        data-testid={testId}
        className={INPUT}
      />
      <TaxSuggestedFrom suggestion={suggestion} />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
};

/** A standalone bill's tax withheld (PPh). Optional: blank records none. */
export const NativeWithholdingField: React.FC<{ formId: string; tax: NativeVendorTax }> = ({ formId, tax }) => {
  const { t } = useTranslation();
  return (
    <MoneyField
      id={`${formId}-withheld`}
      label={<>
        {t('procurementDetail.withholding.withheld', 'Tax withheld (PPh)')}{' '}
        <span className="font-normal">{t('procurementDetail.groupRef.optional', '(optional)')}</span>
      </>}
      raw={tax.withheld.raw}
      onChange={tax.withheld.onChange}
      testId={VI_VENDOR_TAX_TEST_IDS.nativeWithheld}
      suggestion={tax.withheld.suggestion}
      error={tax.withheld.value === null
        ? t('procurementDetail.vendorTax.withheldError', 'Enter the tax withheld as an amount no larger than the invoice amount (enter the amount first).')
        : undefined}
    />
  );
};

/** An ERP-bound bill in "Enter the tax amounts" mode: VAT, the withholding type and the PPh amount. */
export const ErpTaxAmountFields: React.FC<{ formId: string; tax: ErpVendorTax }> = ({ formId, tax }) => {
  const { t } = useTranslation();
  return (
    <div data-testid={VI_VENDOR_TAX_TEST_IDS.erpFields} className="flex flex-col gap-3">
      {tax.itemsNet !== null && (
        <p data-testid={VI_VENDOR_TAX_TEST_IDS.itemsNet} className="text-[12px] text-muted-foreground">
          {t('procurementDetail.vendorTax.itemsNet', 'Items total, before tax: {{amount}}', { amount: formatMoneyInputValue(tax.itemsNet) })}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <MoneyField
          id={`${formId}-erp-vat`}
          label={t('procurementDetail.vendorTax.vatAmount', 'VAT amount')}
          raw={tax.vat.raw}
          onChange={tax.vat.onChange}
          testId={VI_VENDOR_TAX_TEST_IDS.erpVat}
          suggestion={tax.vat.suggestion}
        />
        <div className="min-w-[160px] flex-1">
          <SelectField
            id={`${formId}-pph-type`}
            label={t('procurementDetail.vendorTax.withholding', 'Tax withheld')}
            value={tax.pphType.raw}
            onChange={tax.pphType.onChange}
            options={[
              { value: '', label: t('procurementDetail.vendorTax.none', 'None') },
              { value: 'pph23', label: t('procurementDetail.vendorTax.pph23', 'PPh 23') },
              { value: 'pph4_2', label: t('procurementDetail.vendorTax.pph4_2', 'PPh 4(2)') },
            ]}
            data-testid={VI_VENDOR_TAX_TEST_IDS.pphType}
          />
        </div>
        {tax.pphType.raw !== '' && (
          <MoneyField
            id={`${formId}-erp-withheld`}
            label={t('procurementDetail.vendorTax.withheldAmount', 'PPh amount')}
            raw={tax.withheld.raw}
            onChange={tax.withheld.onChange}
            testId={VI_VENDOR_TAX_TEST_IDS.erpWithheld}
            suggestion={tax.withheld.suggestion}
          />
        )}
      </div>
      {tax.amounts === null && (
        <p data-testid={VI_VENDOR_TAX_TEST_IDS.erpRequiredHint} className="text-[12px] text-muted-foreground">
          {t('procurementDetail.vendorTax.erpRequiredHint', "Enter the VAT amount from the vendor's invoice (0 if none) and, if tax is withheld, its type and amount.")}
        </p>
      )}
    </div>
  );
};
```

5. Locale keys. In `pmo-portal/public/locales/en/common.json`, inside `"procurementDetail"`:
   - replace the `"erpTaxTemplate"` object with
     `"erpTaxTemplate": { "label": "ERPNext tax template", "enterAmounts": "Enter the tax amounts", "loadError": "Could not load the ERPNext tax templates. Enter the tax amounts instead." },`
   - directly after the `"withholding"` object add:
     ```json
     "vendorTax": {
       "erpRequiredHint": "Enter the VAT amount from the vendor's invoice (0 if none) and, if tax is withheld, its type and amount.",
       "itemsNet": "Items total, before tax: {{amount}}",
       "none": "None",
       "pph23": "PPh 23",
       "pph4_2": "PPh 4(2)",
       "suggestedFrom": "Vendor default {{rate}}% of {{base}}",
       "vatAmount": "VAT amount",
       "withheldAmount": "PPh amount",
       "withheldError": "Enter the tax withheld as an amount no larger than the invoice amount (enter the amount first).",
       "withholding": "Tax withheld"
     }
     ```
   In `pmo-portal/public/locales/id/common.json`, same positions:
   - `"erpTaxTemplate": { "label": "Templat pajak ERPNext", "enterAmounts": "Masukkan jumlah pajak", "loadError": "Templat pajak ERPNext tidak dapat dimuat. Masukkan jumlah pajaknya." },`
   - ```json
     "vendorTax": {
       "erpRequiredHint": "Masukkan jumlah PPN dari faktur vendor (0 jika tidak ada) dan, jika ada pajak dipotong, jenis dan jumlahnya.",
       "itemsNet": "Total item, sebelum pajak: {{amount}}",
       "none": "Tidak ada",
       "pph23": "PPh 23",
       "pph4_2": "PPh 4(2)",
       "suggestedFrom": "Default vendor {{rate}}% dari {{base}}",
       "vatAmount": "Jumlah PPN",
       "withheldAmount": "Jumlah PPh",
       "withheldError": "Masukkan pajak dipotong sebagai jumlah yang tidak melebihi jumlah faktur (isi jumlah faktur terlebih dahulu).",
       "withholding": "Pajak dipotong"
     }
     ```
   (The `erpTaxTemplate.default` key is removed from both files — DD-VWH-15 retires the option.)

**Verify:** `cd "$WT/pmo-portal" && npm run typecheck && npm run check:i18n && ../scripts/with-test-lock.sh npx vitest run pages/procurement/vendorInvoiceTestIds.test.ts`
→ pass (Task 16's tests stay red until Task 18; `check:i18n` may report the new keys unused until then — it must not
report a missing key).

## Task 18 — Wire `RecordCaptureForm`, green; retire the "ERPNext default" case (AC-VWH-030, AC-VWH-031) (~5 min)

In `pmo-portal/pages/procurement/RecordCaptureForm.tsx`:

1. Add imports below `import { usePurchaseTaxTemplates } from '@/src/hooks/usePurchaseTaxTemplates';`:
   ```ts
   import { useVendorTaxDefault } from '@/src/hooks/useVendorTaxDefault';
   import { useErpVendorTax, useNativeVendorTax } from '@/src/hooks/useVendorBillTax';
   import { ErpTaxAmountFields, NativeWithholdingField, TaxSuggestedFrom } from './VendorBillTaxFields';
   import type { ErpVendorTaxAmounts } from '@/src/lib/vendorWithholding';
   ```
2. In `interface StagedVI`, directly after `taxTemplate?: string;` add:
   ```ts
   /** #876 slice 2: tax withheld on a standalone bill — present only when > 0. */
   withheldAmount?: number;
   /** #876 slice 2 (DD-VWH-13/14): the VAT / PPh entered for an ERP-bound bill ("Enter the tax amounts" mode). */
   erpTaxAmounts?: ErpVendorTaxAmounts;
   ```
3. In `interface RecordCaptureFormProps`, directly after the `onStage?` member add:
   ```ts
   /** #876 slice 2 (OD-VWH-1): the procurement's vendor — its default tax treatment pre-fills a vendor invoice. */
   vendorId?: string | null;
   /** #876 slice 2: the case's items total before tax — the base an ERP-bound bill's tax is pre-filled on. */
   itemsNet?: number | null;
   ```
   and in the component's parameter destructuring, directly after `onStage,` add `vendorId = null,` and `itemsNet = null,`.
4. Delete the line `const taxAmountMask = useMoneyInputMask(taxAmountStr, setTaxAmountStr);`.
5. Delete the line `const taxIncomplete = isVendorInvoice && parsedTax === null;`.
6. Directly after `const erpTaxTemplates = usePurchaseTaxTemplates(choosesErpTaxTemplate);` insert:
   ```ts
   // #876 slice 2 (OD-VWH-1, DD-VWH-17): the vendor's default pre-fills the AMOUNTS; every amount stays editable and
   // the bill records exactly what is submitted (DD-VWH-13/19).
   const vendorTax = useVendorTaxDefault(isVendorInvoice ? vendorId : null);
   const nativeTax = useNativeVendorTax({
     vendor: vendorTax, enabled: pmoAuthorsTax, amountRaw: amountStr, treatmentRaw: taxTreatmentStr,
     vatRaw: taxAmountStr, setVatRaw: setTaxAmountStr, vatIsCalculated: taxFields.hasRate,
   });
   const taxAmountMask = useMoneyInputMask(taxAmountStr, (next) => {
     nativeTax.markVatTouched();
     setTaxAmountStr(next);
   });
   // DD-VWH-14/15: an ERP-bound bill either enters the amounts ('' in the template select — the default) or names a template.
   const entersErpAmounts = choosesErpTaxTemplate && taxTemplate === '';
   const erpTax = useErpVendorTax({ vendor: vendorTax, enabled: entersErpAmounts, itemsNet });
   const taxIncomplete = isVendorInvoice && (
     parsedTax === null
     || (pmoAuthorsTax && nativeTax.withheld.value === null)
     || (entersErpAmounts && erpTax.amounts === null));
   ```
7. In `handleSubmit`'s VI branch replace `if (!parsedTax) return;` with `if (!parsedTax || taxIncomplete) return;`, and
   directly after `...(choosesErpTaxTemplate && taxTemplate ? { taxTemplate } : {}),` add:
   ```ts
   ...(pmoAuthorsTax && nativeTax.withheld.value ? { withheldAmount: nativeTax.withheld.value } : {}),
   ...(entersErpAmounts && erpTax.amounts ? { erpTaxAmounts: erpTax.amounts } : {}),
   ```
8. In the template `SelectField`: replace
   `helper={erpTaxTemplates.isError ? t('procurementDetail.erpTaxTemplate.loadError', 'Could not load the ERPNext tax templates. The ERPNext default will apply.') : undefined}`
   with
   `helper={erpTaxTemplates.isError ? t('procurementDetail.erpTaxTemplate.loadError', 'Could not load the ERPNext tax templates. Enter the tax amounts instead.') : undefined}`
   and replace `{ value: '', label: t('procurementDetail.erpTaxTemplate.default', 'ERPNext default') },` with
   `{ value: '', label: t('procurementDetail.erpTaxTemplate.enterAmounts', 'Enter the tax amounts') },`.
   Directly after that `SelectField`'s closing `)}` add:
   `{entersErpAmounts && <ErpTaxAmountFields formId={formId} tax={erpTax} />}`
9. In the native Tax amount block, directly after the tax-amount `<input … data-testid={VI_FIELD_TEST_IDS.taxAmount} … />`
   add `<TaxSuggestedFrom suggestion={nativeTax.vatSuggestion} />`; directly after the closing `)}` of that
   `{pmoAuthorsTax && ( <div className="flex flex-wrap gap-3"> … )}` block add
   `{pmoAuthorsTax && <NativeWithholdingField formId={formId} tax={nativeTax} />}`.
10. Replace `{taxIncomplete && (` (the `VI_TAX_REQUIRED_HINT` paragraph) with `{isVendorInvoice && parsedTax === null && (`
    so the native hint keeps its exact trigger (the ERP-bound and PPh cases show their own field-level hint/error).

In `pmo-portal/pages/procurement/RecordCaptureForm.taxTemplate.test.tsx` (deliberate UX change, DD-VWH-15):
- replace the header sentence `ERPNext default (no choice) is the pre-selected option.` with
  `"Enter the tax amounts" is the pre-selected option (#876 slice 2, DD-VWH-15) — RecordCaptureForm.vendorTax.test.tsx owns it.`
- in test 1 rename `'AC-520-9 a flipped org offers the ERP templates, defaults to ERPNext default, and stages the chosen one'`
  to `'AC-520-9 a flipped org offers the ERP templates and stages the chosen one'` (assertions unchanged);
- delete the test `'AC-520-9 leaving ERPNext default stages no template'` (its goal — no template staged without a
  choice — is now owned by AC-VWH-031 "Enter the tax amounts is the default …").

In `pmo-portal/pages/procurement/vendorInvoiceTax.ts`, append to the doc comment of `taxIsPmoAuthored` (before `*/`):
```
 *
 * #876 slice 2 (DD-VWH-14): on a flipped org the bill form now asks the VAT and PPh AMOUNTS (or a template) — the
 * dispatch sends them as fixed ERPNext rows. The native treatment / rate controls stay hidden there; this predicate
 * still decides that.
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/procurement/RecordCaptureForm.vendorTax.test.tsx pages/procurement/RecordCaptureForm.taxTemplate.test.tsx pages/procurement/RecordCaptureForm.grvi.test.tsx pages/procurement/RecordCaptureForm.groupRef.test.tsx && npm run typecheck && npm run check:i18n`
→ all pass.

## Task 19 — Page tests: inline capture + staged forwarding, red (AC-VWH-030, AC-VWH-032) (~4 min)

In `pmo-portal/pages/__tests__/ProcurementDetails.externalRef.test.tsx`:

1. At line start, directly after the `vi.mock('@/src/hooks/useOrgTaxDefault', …)` block, add:
   ```ts
   // #876 slice 2: the vendor's tax default read is pinned (null unless a test sets it).
   const vendorDefault = vi.hoisted(() => ({ value: null as null | { vatRate: number | null; pphType: 'pph23' | 'pph4_2' | null; pphRate: number | null } }));
   vi.mock('@/src/hooks/useVendorTaxDefault', () => ({ useVendorTaxDefault: () => vendorDefault.value }));
   ```
2. Add `import { formatMoneyInputValue } from '@/src/lib/format';` after `import { MemoryRouter, Route, Routes } from 'react-router';`.
3. Append:

```tsx
describe('AC-VWH-030 / AC-VWH-032 (#876 slice 2): vendor tax reaches the write', () => {
  beforeEach(() => {
    mockCaptureVendorInvoice.mockClear();
    mockCreateInvoice.mockClear();
    orgDefault.value = 'exclusive';
    vendorDefault.value = null;
  });
  afterEach(() => { vendorDefault.value = null; });

  it('AC-VWH-030 Mark Vendor Invoiced pre-fills VAT and PPh from the vendor default and forwards the withholding', async () => {
    vendorDefault.value = { vatRate: 11, pphType: 'pph23', pphRate: 2 };
    await openInlineCapture();
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await waitFor(() => expect(screen.getByTestId('vi-tax-amount-input')).toHaveValue(formatMoneyInputValue(110000)));
    await waitFor(() => expect(screen.getByTestId('vi-withheld-input')).toHaveValue(formatMoneyInputValue(20000)));
    await userEvent.click(screen.getByTestId('btn-submit-vi-capture'));
    await waitFor(() => expect(mockCaptureVendorInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000000, taxTreatment: 'exclusive', taxAmount: 110000, withheldAmount: 20000 })));
  });

  it('AC-VWH-032 the staged standalone bill carries its PPh through the confirm to createInvoice', async () => {
    mockEffectiveRole = 'Finance';
    detailState.data = { ...vendorInvoicedProcurement, invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1000000');
    await userEvent.selectOptions(screen.getByTestId('vi-tax-treatment-select'), 'exclusive');
    await userEvent.type(screen.getByTestId('vi-tax-amount-input'), '110000');
    await userEvent.type(screen.getByTestId('vi-withheld-input'), '20000');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /save vi/i }));
    await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ taxAmount: 110000, withheldAmount: 20000 })));
  });

  it('AC-VWH-032 an ERP-owned org forwards the entered VAT and PPh as erpTaxAmounts, and no template', async () => {
    setDomainOwnership([{ domain: 'procurement', externalTier: 'erpnext' }]);
    mockEffectiveRole = 'Finance';
    detailState.data = { ...vendorInvoicedProcurement, invoices: [] };
    renderPage();
    await userEvent.click(screen.getByTestId('btn-create-vi'));
    await userEvent.type(screen.getByTestId('vi-erp-vat-input'), '110000');
    await userEvent.selectOptions(screen.getByTestId('vi-pph-type-select'), 'pph23');
    await userEvent.type(screen.getByTestId('vi-erp-withheld-input'), '20000');
    await userEvent.click(screen.getByTestId('btn-save-vi'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /save vi/i }));
    await waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledWith(expect.objectContaining({
      erpTaxAmounts: { vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23' } })));
    expect(mockCreateInvoice.mock.calls[0][0]).not.toHaveProperty('taxTemplate');
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ProcurementDetails.externalRef.test.tsx`
→ the three new tests fail (inline capture has no PPh field; the confirm forwards neither field); the existing tests pass.

## Task 20 — Wire the inline capture, the decision zone and the confirm, green (AC-VWH-030, AC-VWH-032) (~5 min)

In `pmo-portal/pages/procurement/ProcurementDecisionZone.tsx`:

1. Add imports below `import { useOrgTaxDefault, useTaxTreatmentPreselect } from '@/src/hooks/useOrgTaxDefault';`:
   ```ts
   import { useVendorTaxDefault } from '@/src/hooks/useVendorTaxDefault';
   import { useNativeVendorTax } from '@/src/hooks/useVendorBillTax';
   import { NativeWithholdingField, TaxSuggestedFrom } from './VendorBillTaxFields';
   import { itemsNetTotal } from '@/src/lib/vendorWithholding';
   ```
2. In the `<VIInlineCapture` element add the prop `vendorId={p.vendor_id}`; in the `RecordCaptureForm kind="vendor_invoice"`
   element add `vendorId={p.vendor_id}` and `itemsNet={itemsNetTotal(p.items)}`.
3. In `interface VIInlineCaptureProps` add `/** #876 slice 2: the vendor whose default pre-fills the bill. */ vendorId?: string | null;`
   and change the component signature to `({ busy, onSubmit, onCancel, vendorId = null })`.
4. In `VIInlineCapture`: delete `const taxAmtMask = useMoneyInputMask(taxAmtStr, setTaxAmtStr);`; directly after
   `useTaxTreatmentPreselect(orgTaxDefault, taxTreatmentStr, setTaxTreatmentStr, pmoAuthorsTax);` insert:
   ```ts
   // #876 slice 2 (OD-VWH-1): same pre-fill as RecordCaptureForm — one hook, one field component, two entry points.
   const vendorTax = useVendorTaxDefault(vendorId);
   const nativeTax = useNativeVendorTax({
     vendor: vendorTax, enabled: pmoAuthorsTax, amountRaw: amtStr, treatmentRaw: taxTreatmentStr,
     vatRaw: taxAmtStr, setVatRaw: setTaxAmtStr, vatIsCalculated: taxFields.hasRate,
   });
   const taxAmtMask = useMoneyInputMask(taxAmtStr, (next) => {
     nativeTax.markVatTouched();
     setTaxAmtStr(next);
   });
   const withheldInvalid = pmoAuthorsTax && nativeTax.withheld.value === null;
   ```
5. In `handleSubmit` replace `if (!tax) return;` with `if (!tax || withheldInvalid) return;` and, in the `onSubmit({…})`
   object directly after the `...(pmoAuthorsTax && taxFields.facts ? {…} : {}),` line, add
   `...(pmoAuthorsTax && nativeTax.withheld.value ? { withheldAmount: nativeTax.withheld.value } : {}),`
6. In the JSX inside `{pmoAuthorsTax && (<> … </>)}`, directly after the closing `</label>` of the "Tax amount" label add:
   ```tsx
   <TaxSuggestedFrom suggestion={nativeTax.vatSuggestion} />
   <NativeWithholdingField formId="vi-inline" tax={nativeTax} />
   ```
7. Change the submit button's `disabled={!invoiceDate || !tax}` to `disabled={!invoiceDate || !tax || withheldInvalid}`.

In `pmo-portal/pages/ProcurementDetails.tsx`:

1. Add `import type { ErpVendorTaxAmounts } from '@/src/lib/vendorWithholding';` with the other type imports.
2. In the `kind: 'createVI'` member of the pending-confirm union, directly after `taxTemplate?: string;` add:
   ```ts
   /** #876 slice 2: standalone tax withheld (only when > 0) and the ERP-bound entered amounts. */
   withheldAmount?: number;
   erpTaxAmounts?: ErpVendorTaxAmounts;
   ```
3. In `commitConfirm`, directly after `...(pendingConfirm.taxTemplate ? { taxTemplate: pendingConfirm.taxTemplate } : {}),` add:
   ```ts
   ...(pendingConfirm.withheldAmount ? { withheldAmount: pendingConfirm.withheldAmount } : {}),
   ...(pendingConfirm.erpTaxAmounts ? { erpTaxAmounts: pendingConfirm.erpTaxAmounts } : {}),
   ```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/__tests__/ProcurementDetails.externalRef.test.tsx pages/__tests__/ProcurementDetails.wave3.test.tsx pages/ProcurementDetails.test.tsx pages/procurement/RecordCaptureForm.vendorTax.test.tsx && npm run typecheck`
→ all pass.

---

## Task 21 — Vendor tax defaults card, red (AC-VWH-028) (~4 min)

Create `pmo-portal/pages/company/VendorTaxDefaultsCard.test.tsx`:

```tsx
import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, setTaxDefaults: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { company: { setTaxDefaults: h.setTaxDefaults } } }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import { VendorTaxDefaultsCard } from './VendorTaxDefaultsCard';
import type { CompanyRow } from '@/src/lib/db/companies';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

const VENDOR = { id: 'vendor-1', org_id: 'org-1', name: 'Apex Supply', type: 'Vendor',
  default_vat_rate: null, default_pph_type: null, default_pph_rate: null } as unknown as CompanyRow;
const WITH_DEFAULTS = { ...VENDOR, default_vat_rate: 11, default_pph_type: 'pph23', default_pph_rate: 2 } as unknown as CompanyRow;

function renderCard(company: CompanyRow = VENDOR) {
  render(
    <FinanceI18nTestProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><VendorTaxDefaultsCard company={company} /></ToastProvider>
      </QueryClientProvider>
    </FinanceI18nTestProvider>,
  );
}

beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  vi.clearAllMocks();
  h.canManage = true;
  h.setTaxDefaults.mockResolvedValue(undefined);
  await financeTestI18n.changeLanguage('en');
});

describe('VendorTaxDefaultsCard (#876 slice 2, OD-VWH-1)', () => {
  it('AC-VWH-028 Finance sets VAT 11% and PPh 23 at 2%', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('VAT rate (%)'), '11');
    await user.selectOptions(screen.getByLabelText('Withholding'), 'pph23');
    await user.type(screen.getByLabelText('PPh rate (%)'), '2');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(h.setTaxDefaults).toHaveBeenCalledWith('vendor-1', { vatRate: 11, pphType: 'pph23', pphRate: 2 });
  });

  it('AC-VWH-028 choosing no withholding hides the PPh rate and saves none', async () => {
    renderCard(WITH_DEFAULTS);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Withholding'), '');
    expect(screen.queryByLabelText('PPh rate (%)')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(h.setTaxDefaults).toHaveBeenCalledWith('vendor-1', { vatRate: 11, pphType: null, pphRate: null });
  });

  it('AC-VWH-028 a VAT rate above 100% blocks the save with a message', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('VAT rate (%)'), '101');
    expect(screen.getByText('Enter a rate from 0 to 100 with no more than 3 decimal places, or leave it blank.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
    expect(h.setTaxDefaults).not.toHaveBeenCalled();
  });

  it('AC-VWH-028 a role without the right sees the defaults read-only', () => {
    h.canManage = false;
    renderCard(WITH_DEFAULTS);
    expect(screen.getByTestId('vendor-tax-defaults-summary')).toHaveTextContent('VAT 11% · PPh 23 at 2%');
    expect(screen.queryByRole('button', { name: 'Save defaults' })).toBeNull();
  });

  it('AC-VWH-028 the card renders in Bahasa Indonesia', async () => {
    await financeTestI18n.changeLanguage('id');
    renderCard();
    expect(screen.getByText('Default pajak vendor')).toBeInTheDocument();
    expect(screen.getByLabelText('Tarif PPN (%)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan default' })).toBeInTheDocument();
  });
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/company/VendorTaxDefaultsCard.test.tsx` → fails (module missing).

## Task 22 — Vendor tax defaults card + company page mount, green (AC-VWH-028) (~5 min)

Create `pmo-portal/pages/company/VendorTaxDefaultsCard.tsx`:

```tsx
/**
 * #876 slice 2 (OD-VWH-1, DD-VWH-11) — the vendor's default tax treatment on the company page: VAT rate, withholding
 * type and PPh rate. It PRE-FILLS new bills from this vendor; each bill's amounts stay editable and are what is
 * recorded (DD-VWH-19). Saved only through `set_vendor_tax_defaults` (Admin/Finance, audited);
 * `can('manage', 'vendorTaxDefault')` mirrors that gate and is UX only.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, CardHead, CardPad, FieldError, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue } from '@/src/lib/format';
import { parseVendorTaxDefaultsDraft, vendorTaxDefaultOf, type VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';
import type { CompanyRow } from '@/src/lib/db/companies';

const rateDraft = (rate: number | null | undefined): string => (rate == null ? '' : formatMoneyInputValue(rate));

export const VendorTaxDefaultsCard: React.FC<{ company: CompanyRow }> = ({ company }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'vendorTaxDefault');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [vatRaw, setVatRaw] = useState(rateDraft(company.default_vat_rate));
  const [pphType, setPphType] = useState(company.default_pph_type ?? '');
  const [pphRaw, setPphRaw] = useState(rateDraft(company.default_pph_rate));
  const [error, setError] = useState<string>();
  const draft = parseVendorTaxDefaultsDraft(vatRaw, pphType, pphRaw);
  const mutation = useMutation({
    mutationFn: (input: VendorTaxDefaultsInput) => repositories.company.setTaxDefaults(company.id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['company'] });
      toast(t('companyDetail.vendorTax.saved', 'Vendor tax defaults saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });

  const saved = vendorTaxDefaultOf(company);
  const parts = [
    saved?.vatRate != null
      ? t('companyDetail.vendorTax.summaryVat', 'VAT {{rate}}%', { rate: formatMoneyInputValue(saved.vatRate) }) : null,
    saved?.pphType && saved.pphRate != null
      ? t('companyDetail.vendorTax.summaryPph', '{{type}} at {{rate}}%', {
        type: saved.pphType === 'pph23' ? t('companyDetail.vendorTax.pph23', 'PPh 23') : t('companyDetail.vendorTax.pph4_2', 'PPh 4(2)'),
        rate: formatMoneyInputValue(saved.pphRate),
      }) : null,
  ].filter(Boolean);
  const summary = parts.length > 0 ? parts.join(' · ') : t('companyDetail.vendorTax.notSet', 'Not set');

  return (
    <div data-testid="vendor-tax-defaults">
      <Card variant="bare" className="mb-4">
        <CardHead>{t('companyDetail.vendorTax.title', 'Vendor tax defaults')}</CardHead>
        <CardPad>
          <p className="mb-3 text-[13px] text-muted-foreground">
            {t('companyDetail.vendorTax.hint', 'Pre-fills new bills from this vendor. The amounts stay editable on each bill.')}
          </p>
          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setError(undefined);
                if (draft.ok) mutation.mutate(draft.value);
              }}
              className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3"
            >
              <TextField
                label={t('companyDetail.vendorTax.vatRate', 'VAT rate (%)')}
                value={vatRaw}
                onChange={setVatRaw}
                inputMode="decimal"
                disabled={mutation.isPending}
                error={!draft.ok && draft.field === 'vat'
                  ? t('companyDetail.vendorTax.vatRateError', 'Enter a rate from 0 to 100 with no more than 3 decimal places, or leave it blank.')
                  : undefined}
              />
              <SelectField
                label={t('companyDetail.vendorTax.withholding', 'Withholding')}
                value={pphType}
                onChange={setPphType}
                disabled={mutation.isPending}
                options={[
                  { value: '', label: t('companyDetail.vendorTax.none', 'None') },
                  { value: 'pph23', label: t('companyDetail.vendorTax.pph23', 'PPh 23') },
                  { value: 'pph4_2', label: t('companyDetail.vendorTax.pph4_2', 'PPh 4(2)') },
                ]}
              />
              {pphType !== '' && (
                <TextField
                  label={t('companyDetail.vendorTax.pphRate', 'PPh rate (%)')}
                  value={pphRaw}
                  onChange={setPphRaw}
                  inputMode="decimal"
                  disabled={mutation.isPending}
                  error={!draft.ok && draft.field === 'pph'
                    ? t('companyDetail.vendorTax.pphRateError', 'Enter a rate above 0 and below 100 with no more than 3 decimal places.')
                    : undefined}
                />
              )}
              <div className="flex flex-col items-start gap-2 sm:col-span-3">
                <FieldError>{error}</FieldError>
                <Button type="submit" variant="outline" disabled={mutation.isPending || !draft.ok}>
                  {t('companyDetail.vendorTax.save', 'Save defaults')}
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-[13px]" data-testid="vendor-tax-defaults-summary">
              {summary}
              <span className="ml-2 text-muted-foreground">
                {t('companyDetail.vendorTax.onlyRoles', 'Only Admin or Finance can change these.')}
              </span>
            </p>
          )}
        </CardPad>
      </Card>
    </div>
  );
};
```

In `pmo-portal/pages/CompanyDetail.tsx`: add `import { VendorTaxDefaultsCard } from './company/VendorTaxDefaultsCard';`
with the other page imports, and directly after the closing `</Card>` of the "Company detail" card (before
`<RelatedProjects companyId={company.id} />`) add:
```tsx
      {/* #876 slice 2 (OD-VWH-1): the vendor's default tax treatment pre-fills its bills. */}
      {company.type === 'Vendor' && <VendorTaxDefaultsCard company={company} />}
```

Locale keys — `pmo-portal/public/locales/en/common.json`, inside `"companyDetail"`, add:
```json
"vendorTax": {
  "hint": "Pre-fills new bills from this vendor. The amounts stay editable on each bill.",
  "none": "None",
  "notSet": "Not set",
  "onlyRoles": "Only Admin or Finance can change these.",
  "pph23": "PPh 23",
  "pph4_2": "PPh 4(2)",
  "pphRate": "PPh rate (%)",
  "pphRateError": "Enter a rate above 0 and below 100 with no more than 3 decimal places.",
  "save": "Save defaults",
  "saved": "Vendor tax defaults saved",
  "summaryPph": "{{type}} at {{rate}}%",
  "summaryVat": "VAT {{rate}}%",
  "title": "Vendor tax defaults",
  "vatRate": "VAT rate (%)",
  "vatRateError": "Enter a rate from 0 to 100 with no more than 3 decimal places, or leave it blank.",
  "withholding": "Withholding"
}
```
`pmo-portal/public/locales/id/common.json`, same position:
```json
"vendorTax": {
  "hint": "Mengisi otomatis tagihan baru dari vendor ini. Jumlahnya tetap dapat diubah di setiap tagihan.",
  "none": "Tidak ada",
  "notSet": "Belum diatur",
  "onlyRoles": "Hanya Admin atau Finance yang dapat mengubahnya.",
  "pph23": "PPh 23",
  "pph4_2": "PPh 4(2)",
  "pphRate": "Tarif PPh (%)",
  "pphRateError": "Masukkan tarif di atas 0 dan di bawah 100 dengan paling banyak 3 angka desimal.",
  "save": "Simpan default",
  "saved": "Default pajak vendor disimpan",
  "summaryPph": "{{type}} sebesar {{rate}}%",
  "summaryVat": "PPN {{rate}}%",
  "title": "Default pajak vendor",
  "vatRate": "Tarif PPN (%)",
  "vatRateError": "Masukkan tarif 0 sampai 100 dengan paling banyak 3 angka desimal, atau kosongkan.",
  "withholding": "Pemotongan pajak"
}
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/company/VendorTaxDefaultsCard.test.tsx pages/CompanyDetail.test.tsx pages/CompanyDetail.crm.test.tsx pages/CompanyDetail.related.test.tsx pages/CompanyDetail.status-pill.test.tsx pages/CompanyDetail.entityContext.test.tsx && npm run check:i18n && npm run typecheck`
→ all pass.

## Task 23 — Org vendor-bill tax accounts setting, red (AC-VWH-029) (~4 min)

Create `pmo-portal/pages/admin/OrgVendorTaxAccounts.test.tsx`:

```tsx
import React from 'react';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
const h = vi.hoisted(() => ({ canManage: true, get: vi.fn(), set: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { orgSettings: {
  getVendorTaxAccounts: h.get, setVendorTaxAccounts: h.set,
} } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'fixture-admin', org_id: 'fixture-org' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
import OrgVendorTaxAccounts from './OrgVendorTaxAccounts';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';

const NONE = { inputVatAccount: null, pph23PayableAccount: null, pph42PayableAccount: null };
beforeAll(async () => { await financeTestI18nReady; });
beforeEach(async () => {
  vi.clearAllMocks();
  h.canManage = true;
  h.get.mockResolvedValue(NONE);
  h.set.mockResolvedValue(undefined);
  await financeTestI18n.changeLanguage('en');
});
function renderSetting() {
  render(<FinanceI18nTestProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgVendorTaxAccounts /></ToastProvider>
  </QueryClientProvider></FinanceI18nTestProvider>);
}

it('AC-VWH-029 an Admin sets the three vendor-bill tax accounts (trimmed; blank is none)', async () => {
  renderSetting();
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Input VAT account'), ' Input VAT - DEMO ');
  await user.type(screen.getByLabelText('PPh 23 payable account'), 'PPh 23 Payable - DEMO');
  await user.click(screen.getByRole('button', { name: 'Save accounts' }));
  expect(h.set).toHaveBeenCalledWith({ inputVatAccount: 'Input VAT - DEMO', pph23PayableAccount: 'PPh 23 Payable - DEMO', pph42PayableAccount: null });
});

it('AC-VWH-029 a non-Admin sees the accounts read-only', async () => {
  h.canManage = false;
  h.get.mockResolvedValue({ ...NONE, inputVatAccount: 'Input VAT - DEMO' });
  renderSetting();
  expect(await screen.findByText('Input VAT - DEMO')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
});

it('AC-VWH-029 a failed read offers a retry and no write', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporary read failure')).mockResolvedValue(NONE);
  renderSetting();
  const user = userEvent.setup();
  expect(await screen.findByText("Couldn't load the tax accounts")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save accounts' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /retry|try again/i }));
  expect(await screen.findByLabelText('Input VAT account')).toBeInTheDocument();
});

it('AC-VWH-029 the setting renders in Bahasa Indonesia', async () => {
  await financeTestI18n.changeLanguage('id');
  renderSetting();
  expect(await screen.findByText('Akun pajak tagihan vendor')).toBeInTheDocument();
  expect(screen.getByLabelText('Akun PPN Masukan')).toBeInTheDocument();
});
```

**Verify red:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/OrgVendorTaxAccounts.test.tsx` → fails (module missing).

## Task 24 — Org vendor-bill tax accounts setting + Administration mount, green (AC-VWH-029) (~5 min)

Create `pmo-portal/pages/admin/OrgVendorTaxAccounts.tsx`:

```tsx
/**
 * #876 slice 2 (DD-VWH-12) — the ERPNext accounts a vendor bill's entered VAT and PPh post to. Admin-only (the
 * organizations UPDATE policy + column grants, 0272; `can('manage','orgAccounting')` mirrors it, UX only). The dispatch
 * checks each in ERPNext on send and refuses naming the setting (ADR-0084 §4).
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import type { OrgVendorTaxAccounts as Accounts } from '@/src/lib/db/orgs';

const QUERY_KEY = 'org-vendor-tax-accounts';

export default function OrgVendorTaxAccounts() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inputVat, setInputVat] = useState('');
  const [pph23, setPph23] = useState('');
  const [pph42, setPph42] = useState('');
  const [error, setError] = useState<string>();
  const queryKey = [QUERY_KEY, currentUser?.org_id];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getVendorTaxAccounts(), enabled: !!currentUser });
  useEffect(() => {
    if (!query.isSuccess) return;
    setInputVat(query.data.inputVatAccount ?? '');
    setPph23(query.data.pph23PayableAccount ?? '');
    setPph42(query.data.pph42PayableAccount ?? '');
  }, [query.data, query.isSuccess]);
  const mutation = useMutation({
    mutationFn: (value: Accounts) => repositories.orgSettings.setVendorTaxAccounts(value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      toast(t('admin.vendorTaxAccounts.saved', 'Tax accounts saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });
  const current = query.data;
  const dirty = !current
    || inputVat.trim() !== (current.inputVatAccount ?? '')
    || pph23.trim() !== (current.pph23PayableAccount ?? '')
    || pph42.trim() !== (current.pph42PayableAccount ?? '');
  const helper = t('admin.vendorTaxAccounts.helper', 'Enter the exact ERPNext account name. Leave blank if not used.');
  const notConfigured = t('admin.vendorTaxAccounts.notConfigured', 'Not configured');

  return (
    <section aria-labelledby="vendor-tax-accounts-heading">
      <h2 id="vendor-tax-accounts-heading" className="text-[15px] font-semibold">
        {t('admin.vendorTaxAccounts.heading', 'Vendor bill tax accounts')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('admin.vendorTaxAccounts.intro', "The ERPNext accounts PMO posts a vendor bill's VAT and tax withheld to. Required before a bill with these amounts can be sent to ERPNext.")}
      </p>
      <div className="mt-3 max-w-md">
        {query.isError ? (
          <ListState variant="error" title={t('admin.vendorTaxAccounts.loadError', "Couldn't load the tax accounts")} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              mutation.mutate({ inputVatAccount: inputVat.trim() || null, pph23PayableAccount: pph23.trim() || null, pph42PayableAccount: pph42.trim() || null });
            }}
            className="space-y-3"
          >
            <TextField label={t('admin.vendorTaxAccounts.inputVat', 'Input VAT account')} value={inputVat} onChange={setInputVat}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <TextField label={t('admin.vendorTaxAccounts.pph23', 'PPh 23 payable account')} value={pph23} onChange={setPph23}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <TextField label={t('admin.vendorTaxAccounts.pph42', 'PPh 4(2) payable account')} value={pph42} onChange={setPph42}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <FieldError>{error}</FieldError>
            <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty}>
              {t('admin.vendorTaxAccounts.save', 'Save accounts')}
            </Button>
          </form>
        ) : (
          <dl className="space-y-1 text-[13px]">
            <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.inputVat', 'Input VAT account')}: </dt><dd className="inline">{current?.inputVatAccount ?? notConfigured}</dd></div>
            <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.pph23', 'PPh 23 payable account')}: </dt><dd className="inline">{current?.pph23PayableAccount ?? notConfigured}</dd></div>
            <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.pph42', 'PPh 4(2) payable account')}: </dt><dd className="inline">{current?.pph42PayableAccount ?? notConfigured}</dd></div>
            <p className="text-muted-foreground">{t('admin.vendorTaxAccounts.onlyAdmin', 'Only an Admin can change these.')}</p>
          </dl>
        )}
      </div>
    </section>
  );
}
```

In `pmo-portal/pages/Administration.tsx`: add `import OrgVendorTaxAccounts from './admin/OrgVendorTaxAccounts';` after
`import OrgWithholdingAccount from './admin/OrgWithholdingAccount';`, and directly after `<OrgWithholdingAccount />` in the
`accounting` panel add `<OrgVendorTaxAccounts />`.

Locale keys — `pmo-portal/public/locales/en/common.json`, inside `"admin"` (after `"spendApprovers"`):
```json
"vendorTaxAccounts": {
  "heading": "Vendor bill tax accounts",
  "helper": "Enter the exact ERPNext account name. Leave blank if not used.",
  "inputVat": "Input VAT account",
  "intro": "The ERPNext accounts PMO posts a vendor bill's VAT and tax withheld to. Required before a bill with these amounts can be sent to ERPNext.",
  "loadError": "Couldn't load the tax accounts",
  "notConfigured": "Not configured",
  "onlyAdmin": "Only an Admin can change these.",
  "pph23": "PPh 23 payable account",
  "pph42": "PPh 4(2) payable account",
  "save": "Save accounts",
  "saved": "Tax accounts saved"
}
```
`pmo-portal/public/locales/id/common.json`, same position:
```json
"vendorTaxAccounts": {
  "heading": "Akun pajak tagihan vendor",
  "helper": "Masukkan nama akun ERPNext yang persis. Kosongkan jika tidak digunakan.",
  "inputVat": "Akun PPN Masukan",
  "intro": "Akun ERPNext tempat PMO membukukan PPN dan pajak dipotong pada tagihan vendor. Wajib diisi sebelum tagihan dengan jumlah tersebut dapat dikirim ke ERPNext.",
  "loadError": "Tidak dapat memuat akun pajak",
  "notConfigured": "Belum dikonfigurasi",
  "onlyAdmin": "Hanya Admin yang dapat mengubahnya.",
  "pph23": "Akun Utang PPh 23",
  "pph42": "Akun Utang PPh 4(2)",
  "save": "Simpan akun",
  "saved": "Akun pajak disimpan"
}
```

**Verify green:** `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run pages/admin/OrgVendorTaxAccounts.test.tsx pages/admin/OrgWithholdingAccount.test.tsx pages/Administration.test.tsx && npm run check:i18n && npm run typecheck`
→ all pass (if `pages/Administration.test.tsx` does not exist, run `npx vitest run pages/Administration` instead).

---

## Task 25 — Served e2e on the bench, a throwaway IDR organization (AC-VWH-036) (~5 min to write; run per command)

Create `pmo-portal/e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts`:

```ts
// @e2e-isolation: serial — creates and removes its OWN organization (member, vendor, binding, procurement flip) against the shared bench; the seed organization is never written.
/**
 * AC-VWH-036 — a vendor bill with VAT and PPh ENTERED in PMO (#876 slice 2, OD-VWH-1, DD-VWH-13) through the REAL
 * served `adapter-dispatch` against the local ERPNext bench. Never `page.route` (money-command rule).
 *
 * Stated money facts, so the oracle is not an accident of fixtures:
 *  - currency: a throwaway organization is created with default currency SAR_CURRENCY (IDR, the shared bench helper);
 *    the bench company "PMO Smoke Co" bills in IDR (asserted), so the mirrored bill is IDR without touching the seed org;
 *  - lines: one SPIKE-ITEM-1 at 1,000,000 (the net); VAT entered 110,000; PPh 23 entered 20,000;
 *  - accounts: the organization's Input VAT and PPh 23 payable settings name the bench's slice-1 fixture accounts.
 *
 * Goal: ERPNext holds exactly the entered amounts as fixed rows with no template — net 1,000,000, net payable
 * 1,090,000, the PPh credited to its payable account — and PMO mirrors gross 1,110,000 / VAT 110,000 / withheld 20,000 /
 * outstanding 1,090,000 in IDR; the seed organization's currency and tax settings are unchanged.
 *
 * Run: cd pmo-portal && ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh ../scripts/serve-functions.sh -- \
 *        npx playwright test --project=serial e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts
 * Env: the same served-lane + bench set as AC-VWH-005 (exported in the shell; never committed).
 */
import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SAR_CURRENCY } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const SITE_URL = process.env.ERPNEXT_SITE_URL ?? 'http://host.docker.internal:8080';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const SEED_ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const PASSWORD = 'Passw0rd!dev';

const COMPANY = 'PMO Smoke Co';
const TAX_PARENT = 'Duties and Taxes - PSC';
const VAT_ACCOUNT = 'Spike PPN Masukan - PSC';
const PPH_ACCOUNT = 'Spike PPh 23 Payable - PSC';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) throw new Error('AC-VWH-036: the served lane is up but its bench dependencies are incomplete — never a silent skip.');
test.skip(!READY, 'AC-VWH-036 requires the local served-functions lane and the throwaway ERPNext bench.');
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

/** Bench fixtures are created once and reused across runs (slice 1's accounts). */
async function ensureDoc(doctype: string, name: string, body: Doc): Promise<Doc> {
  const existing = await erp('GET', resource(doctype, name));
  if (existing.status === 200) return existing.data as Doc;
  const created = await erp('POST', resource(doctype), body);
  expect(created.status, `${doctype} ${name} must be creatable on the bench`).toBe(200);
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

interface Tenant { orgId: string; userId: string; email: string; companyId: string; procurementId: string; piRecordId: string }

/** A genuinely separate organization in IDR with its own Finance member, vendor, procurement, binding and flip. */
async function createTenant(admin: SupabaseClient, suffix: string): Promise<Tenant> {
  const orgId = crypto.randomUUID();
  const companyId = crypto.randomUUID();
  const email = `vwh036-${suffix}@acme.test`;
  const { error: orgErr } = await admin.from('organizations').insert({
    id: orgId, name: `VWH-036 Org ${suffix}`, default_currency: SAR_CURRENCY,
    input_vat_account: VAT_ACCOUNT, pph23_payable_account: PPH_ACCOUNT,
  });
  if (orgErr) throw new Error(`seed organization failed: ${orgErr.message}`);
  const { data: created, error: userErr } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (userErr || !created.user) throw new Error(`create member failed: ${userErr?.message}`);
  const userId = created.user.id;
  const { error: profileErr } = await admin.from('profiles')
    .upsert({ id: userId, org_id: orgId, email, full_name: 'VWH-036 Finance', role: 'Finance', status: 'active' }, { onConflict: 'id' });
  if (profileErr) throw new Error(`seed profile failed: ${profileErr.message}`);
  const { error: companyErr } = await admin.from('companies').insert({ id: companyId, org_id: orgId, name: `Spike Supplier ${suffix}`, type: 'Vendor' });
  if (companyErr) throw new Error(`seed vendor failed: ${companyErr.message}`);
  const { error: refErr } = await admin.from('external_refs').insert({
    org_id: orgId, domain: 'companies', pmo_record_id: companyId, external_tier: 'erpnext', external_record_id: 'Supplier:Spike Supplier',
  });
  if (refErr) throw new Error(`seed supplier ref failed: ${refErr.message}`);
  const { data: proc, error: procErr } = await admin.from('procurements')
    .insert({ org_id: orgId, title: `AC-VWH-036 case ${suffix}`, vendor_id: companyId, status: 'Ordered' }).select('id').single();
  if (procErr || !proc) throw new Error(`seed procurement failed: ${procErr?.message}`);
  const { error: bindingErr } = await admin.from('external_org_bindings').insert({
    org_id: orgId, external_tier: 'erpnext', site_url: SITE_URL, secret_ref: 'local-bench',
    webhook_secret_ref: 'DEMO_ERP_WEBHOOK_SECRET', version_major: 15,
    config: { company: COMPANY, default_cash_account: 'Cash - PSC', default_payable_account: 'Creditors - PSC' },
    activated_at: new Date().toISOString(),
  });
  if (bindingErr) throw new Error(`seed binding failed: ${bindingErr.message}`);
  const { error: flipErr } = await admin.from('external_domain_ownership').insert({ org_id: orgId, external_tier: 'erpnext', domain: 'procurement' });
  if (flipErr) throw new Error(`seed ownership failed: ${flipErr.message}`);
  return { orgId, userId, email, companyId, procurementId: (proc as { id: string }).id, piRecordId: crypto.randomUUID() };
}

/** Best effort, as AC-TSP-031: append-only history (audit events) may keep the organization row referenced locally. */
async function removeTenant(admin: SupabaseClient, t: Tenant): Promise<void> {
  for (const table of ['procurement_invoices', 'external_command_outbox', 'external_ref_lineage', 'external_refs',
    'procurements', 'companies', 'external_domain_ownership', 'external_org_bindings']) {
    await admin.from(table).delete().eq('org_id', t.orgId);
  }
  await admin.from('profiles').delete().eq('id', t.userId);
  await admin.auth.admin.deleteUser(t.userId).catch(() => undefined);
  await admin.from('organizations').delete().eq('id', t.orgId);
}

async function seedOrgFacts(admin: SupabaseClient) {
  const { data, error } = await admin.from('organizations')
    .select('default_currency,input_vat_account,pph23_payable_account,pph4_2_payable_account').eq('id', SEED_ORG_ID).single();
  if (error) throw new Error(`read seed org failed: ${error.message}`);
  return data;
}

test('AC-VWH-036 a bill with VAT and PPh entered in PMO lands in ERPNext as fixed rows and mirrors back gross, VAT and withheld exactly', async () => {
  const admin = createClient(AUTH_URL, SERVICE_KEY);

  // Bench facts this journey states rather than assumes.
  expect((await readDoc('Company', COMPANY)).default_currency, 'the bench company bills in IDR').toBe(SAR_CURRENCY);
  expect(await readDoc('Account', TAX_PARENT)).toMatchObject({ is_group: 1, root_type: 'Liability' });
  await ensureDoc('Account', VAT_ACCOUNT, { account_name: 'Spike PPN Masukan', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });
  await ensureDoc('Account', PPH_ACCOUNT, { account_name: 'Spike PPh 23 Payable', parent_account: TAX_PARENT, company: COMPANY, account_type: 'Tax', is_group: 0 });

  const seedBefore = await seedOrgFacts(admin);
  const t = await createTenant(admin, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    const authClient = createClient(AUTH_URL, ANON_KEY);
    const { data: signIn, error: signInErr } = await authClient.auth.signInWithPassword({ email: t.email, password: PASSWORD });
    if (signInErr || !signIn.session) throw new Error(`sign-in failed: ${signInErr?.message}`);

    // 1. Record the bill with the amounts the vendor's invoice states.
    const res = await fetch(`${FUNCTIONS_URL}/functions/v1/adapter-dispatch`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${signIn.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'procurement', operation: 'create', idempotencyKey: crypto.randomUUID(),
        record: {
          id: t.piRecordId, procurementId: t.procurementId, vendorId: t.companyId, erp_doc_kind: 'purchase-invoice',
          items: [{ item_code: 'SPIKE-ITEM-1', qty: 1, rate: 1000000 }],
          vatAmount: 110000, withheldAmount: 20000, pphType: 'pph23',
        },
      }),
    });
    const body = (await res.json()) as { externalRecordId?: string; message?: string };
    expect(res.status, `PI dispatch failed: ${body.message}`).toBe(200);
    const piName = body.externalRecordId!;

    // 2. ERPNext holds exactly the entered amounts as fixed rows, no template.
    const doc = await readDoc('Purchase Invoice', piName);
    expect(doc).toMatchObject({
      docstatus: 1, currency: SAR_CURRENCY, net_total: 1000000, taxes_and_charges_added: 110000,
      taxes_and_charges_deducted: 20000, grand_total: 1090000, outstanding_amount: 1090000,
    });
    expect(doc.taxes_and_charges ?? '').toBe('');
    expect((doc.taxes as Doc[]).map((r) => [r.charge_type, r.account_head, r.add_deduct_tax, Number(r.tax_amount)])).toEqual([
      ['Actual', VAT_ACCOUNT, 'Add', 110000],
      ['Actual', PPH_ACCOUNT, 'Deduct', 20000],
    ]);

    // 3. The ledger: VAT debited, PPh credited to its payable account, the vendor owed the net payable.
    const gl = await glFor(piName);
    expect(total(gl.filter((r) => r.account === VAT_ACCOUNT), 'debit'), 'input VAT').toBe(110000);
    expect(total(gl.filter((r) => r.account === PPH_ACCOUNT), 'credit'), 'PPh withheld is a liability credit').toBe(20000);
    expect(total(gl.filter((r) => r.account === 'Creditors - PSC'), 'credit'), 'the vendor is owed the net').toBe(1090000);

    // 4. PMO's mirror: gross, VAT, withheld and outstanding — in IDR — with no template.
    const { data: bill, error: billErr } = await admin.from('procurement_invoices')
      .select('amount,tax_amount,withheld_amount,erp_outstanding_amount,status,currency,tax_template')
      .eq('id', t.piRecordId).single();
    expect(billErr).toBeNull();
    expect(bill).toMatchObject({
      amount: 1110000, tax_amount: 110000, withheld_amount: 20000, erp_outstanding_amount: 1090000,
      status: 'Received', currency: SAR_CURRENCY, tax_template: null,
    });
  } finally {
    await removeTenant(admin, t);
  }

  // 5. The seed organization was never written.
  expect(await seedOrgFacts(admin)).toEqual(seedBefore);
});
```

In `scripts/check-e2e-skips.mjs`, directly after the `serial/AC-VWH-005-vendor-withholding.spec.ts` entry, add:

```js
  {
    file: 'serial/AC-VWH-036-vendor-tax-amounts.spec.ts',
    reason: 'Entered vendor-tax amounts proof requires the local served-functions lane and throwaway ERPNext bench.',
    restore: 'Run with scripts/serve-functions.sh against the local ERPNext bench.',
    verified: '2026-10-07',
  },
```

**Verify:**
1. `cd "$WT/pmo-portal" && npm run check:e2e-isolation && node ../scripts/check-e2e-skips.mjs --self-test`
2. With the served-lane and bench env exported:
   `cd "$WT/pmo-portal" && ../scripts/with-erpnext-lock.sh ../scripts/with-db-lock.sh ../scripts/serve-functions.sh -- npx playwright test --project=serial e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts`
   → 1 passed. Then re-run `AC-VWH-005` and `AC-ENA-053` the same way (same dispatch path, same mirror) → both pass.
   If the dispatch refuses for a reason outside this AC (an organization-level prerequisite the throwaway org lacks),
   report the refusal text to the Director — do not seed the seed org instead.

## Task 26 — Mutation checks (~5 min; revert each before the next)

Each mutation must turn the named test RED; record (file, mutation, red test) in the PR body.

| # | Mutate | Expect red | Command |
|---|---|---|---|
| M1 | 0272 §2: change both `raise exception 'vendor tax defaults …'` guard branches' conditions to `false` | AC-VWH-022 direct UPDATE + INSERT | `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0272_vendor_tax_defaults.test.sql'` |
| M2 | 0272 §3: delete `perform set_config('pmo.vendor_tax_defaults_write', '', true);` | AC-VWH-022 "even after set_vendor_tax_defaults ran" | same |
| M3 | 0272 §3: `('Admin', 'Finance')` → `('Admin', 'Finance', 'Project Manager')` | AC-VWH-021 PM refused | same |
| M4 | 0272 §3: delete `and org_id = auth_org_id()` | AC-VWH-021 other org not found | same |
| M5 | 0272 §4: delete `perform public.log_audit('org.vendor_tax_accounts.change' …);` | AC-VWH-023 audited | `… supabase test db supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql` |
| M6 | 0272 §5: `coalesce(p_withheld_amount, 0)` → `0` | AC-VWH-024 stored | same as M5 |
| M7 | 0272 §5: delete `p_withheld_amount => p_withheld_amount` in capture | AC-VWH-024 capture | same as M5 |
| M8 | 0272 §7: add `grant update (input_vat_account) on public.organizations to anon;` before the DO block | `supabase db reset` aborts with `0272: organizations.input_vat_account would be writable` | `scripts/with-db-lock.sh supabase db reset` |
| M9 | `dispatchFactory.ts`: delete `if (chosen && entered) throw …` | AC-VWH-033 not both + AC-VWH-035 test 1 | `npx vitest run src/lib/adapterSeam/erpnext/purchaseInvoiceTaxAmounts.test.ts`; `deno test --allow-all vendorTaxAmounts.test.ts` |
| M10 | `dispatchFactory.ts`: delete `delete record.taxesFromAmounts;` | AC-VWH-033 marker dropped (plain case) | Vitest as M9 |
| M11 | `erpPurchaseTaxRows.ts`: `usableAccount(…, entered.pphType, true)` → `false` | AC-VWH-033 non-liability | Vitest as M9 |
| M12 | `erpPurchaseTaxRows.ts`: delete the `itemsTotal` refusal | AC-VWH-033 above the items total | Vitest as M9 |
| M13 | `purchaseInvoice.ts`: `taxes_and_charges: ''` → omit it in the amounts branch | AC-VWH-034 + AC-VWH-033 empty template | `npx vitest run src/lib/adapterSeam/erpnext/bodies/bodies.test.ts` |
| M14 | `vendorWithholding.ts`: exclusive gross `cents(amount) + cents(taxAmount)` → `cents(amount)` | AC-VWH-026 (both files) | `npx vitest run src/lib/vendorWithholding.test.ts pages/procurement/ProcurementLedger.test.tsx` |
| M15 | `vendorWithholding.ts`: inclusive divisor `100000n + r` → `100000n` | AC-VWH-025 inclusive VAT | `npx vitest run src/lib/vendorWithholding.test.ts` |
| M16 | `useSuggestedMoney.ts`: delete `touched.current \|\|` | AC-VWH-030 latch (hook + "edited amount is kept") | `npx vitest run src/hooks/useSuggestedMoney.test.ts pages/procurement/RecordCaptureForm.vendorTax.test.tsx` |
| M17 | `RecordCaptureForm.tsx`: delete the `erpTaxAmounts` spread in `onStage` | AC-VWH-031 staged amounts | `npx vitest run pages/procurement/RecordCaptureForm.vendorTax.test.tsx` |
| M18 | `policy.ts`: `vendorTaxDefault: { manage: allow(TAX_SETUP) }` → `allow(MASTER_DATA)` | AC-VWH-027 | `npx vitest run src/auth/policy.vendorTax.test.ts` |

Vitest commands run from `$WT/pmo-portal` under `../scripts/with-test-lock.sh`; Deno from
`$WT/supabase/functions/adapter-dispatch`. After M1–M8 run `supabase db reset` once more on the restored migration.

## Task 27 — Docs (Director, docs-only, direct to `dev`) (~3 min)

1. Append to `docs/decisions.md` (after DD-VWH-10..14), once ratified:
   ```markdown
   **DD-VWH-15..22 (Director, 2026-10-07, #876 slice 2, under OD-VWH-1)** — ratified as written in
   `docs/specs/vendor-withholding.spec.md` §7.2 and ADR-0084: the ERP-bound bill form offers "Enter the tax amounts"
   (default) or a named template, not "ERPNext default"; the server still accepts neither (DD-VWH-15) · the vendor
   defaults are guarded by a trigger + transaction-local flag, not column grants (DD-VWH-16) · the pre-fill fills
   amounts, follows its base until edited, never overwrites, rounds half-up to the cent, and shows its rate and base
   (DD-VWH-17) · the PPh type is asked only on ERP-bound bills; standalone bills store the amount (DD-VWH-18) · no server
   path reads a vendor default (DD-VWH-19) · tax-exclusive standalone net payable = amount + VAT − withheld (DD-VWH-20)
   · an untemplated ERPNext bill mirrors tax_template null (DD-VWH-21) · withholding above the items total is refused
   before any ERP write (DD-VWH-22). Plan: `docs/plans/2026-10-07-vendor-withholding-slice2.md`.
   ```
2. Change ADR-0084's status line to `Accepted (Director, <date>)`.
3. In `docs/plans/2026-10-06-purchase-tax-template.md`, directly under AC-520-9, add
   `- **Amended 2026-10-07 (#876 slice 2, DD-VWH-15):** the "ERPNext default" option is retired from the form; "Enter the tax amounts" is the default.`

**Verify:** `grep -n "DD-VWH-15..22" docs/decisions.md` → 1 hit; `grep -n "Amended 2026-10-07 (#876 slice 2" docs/plans/2026-10-06-purchase-tax-template.md` → 1 hit.

## Task 28 — Local final gate (~5 min)

```bash
cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npm run typecheck \
  && npm run typecheck:edge \
  && npx eslint --max-warnings=0 src/lib/vendorWithholding.ts src/hooks/useSuggestedMoney.ts src/hooks/useVendorTaxDefault.ts \
       src/hooks/useVendorBillTax.ts src/auth/policy.ts src/lib/db/companies.ts src/lib/db/orgs.ts src/lib/db/procurementLifecycle.ts \
       src/lib/repositories/index.ts src/lib/repositories/types.ts src/lib/adapterSeam/erpnext/erpPurchaseTaxRows.ts \
       src/lib/adapterSeam/erpnext/dispatchFactory.ts src/lib/adapterSeam/erpnext/bodies/purchaseInvoice.ts \
       pages/procurement/VendorBillTaxFields.tsx pages/procurement/RecordCaptureForm.tsx pages/procurement/ProcurementDecisionZone.tsx \
       pages/procurement/ProcurementLedger.tsx pages/procurement/vendorInvoiceTestIds.ts pages/procurement/vendorInvoiceTax.ts \
       pages/ProcurementDetails.tsx pages/company/VendorTaxDefaultsCard.tsx pages/CompanyDetail.tsx \
       pages/admin/OrgVendorTaxAccounts.tsx pages/Administration.tsx e2e/serial/AC-VWH-036-vendor-tax-amounts.spec.ts \
  && npm run check:guards && npm run check:i18n \
  && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
cd "$WT/supabase/functions/adapter-dispatch" && deno test --allow-all vendorTaxAmounts.test.ts receiptWithholdingRecovery.test.ts readModelWriters.money.test.ts
cd "$WT/supabase/functions/erpnext-sweep" && deno test --allow-all ../_shared/erpnextFeedDeps.test.ts
cd "$WT" && scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0272_vendor_tax_defaults.test.sql supabase/tests/0272_vendor_tax_accounts_native_withholding.test.sql supabase/tests/0266_vendor_withholding.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0107_capture_vendor_invoice_atomic.test.sql supabase/tests/vendor_invoice_tax_treatment.test.sql supabase/tests/erpnext_money_flip_rls.test.sql' \
  && node scripts/check-isolation-denominator.mjs && node scripts/check-edge-fn-test-binding.mjs
```
Plus Task 25's e2e runs (AC-VWH-036, AC-VWH-005, AC-ENA-053). All green, outputs pasted in the PR body.

Then: the 3-reviewer pass (spec, code-quality, security — security on 0272's guard trigger + flag, the definer
function's gates, the org column grants and §7 asserts, and the dispatch's row building / template-XOR-amounts /
naming rules) and the rendered Discover pass on rich seed (desktop + 390 px): the company page's Vendor tax defaults
card (Admin, Finance, PM), Administration → Accounting, and both vendor-bill entry points on a standalone org and on a
flipped org (pre-filled, edited, template chosen, Bahasa). Every Discover finding graduates to a test.

---

## 4. Deploy (owner-gated per instance; back to front)

1. **Preconditions (operator):** RIS's input-VAT, PPh 23 payable and PPh 4(2) payable account names from the
   accountant (OQ-VWH-5); none of them mapped into a budget category (DD-VWH-8); Task 0 re-run against the v16 test
   instance if the bench was v15 (DD-PBL-12 precedent).
2. **DB:** 0272 (the §7 asserts fail loudly if a grant on the target differs from intent).
3. **Edge functions:** `adapter-dispatch` (rows, refusals), `erpnext-sweep` and `erpnext-webhook` (both import
   `piFromDoc`, whose empty-template mapping changed). DB first is mandatory: the new dispatch reads 0272's columns.
4. **FE.** Then, as an Admin in RIS: Administration → Accounting → Vendor bill tax accounts; and Finance sets each
   withholding vendor's defaults on its company page.
5. **After-push probe:** `scripts/isolation-probe.sh` against the hosted project (the denominator changed) and the
   anon-key definer sweep (the 0185 lesson) — `set_vendor_tax_defaults` must not answer the anon key.

## 5. Open questions for the Director / owner

- **Ratify DD-VWH-15..22** (spec §7.2) before Task 3 — they shape the migration, the form and the dispatch.
- OQ-VWH-4..8 — spec §7.6, each parked with a default: rounding (owner/accountant), RIS account names (operator),
  storing the PPh type on standalone bills (Director — recommend deciding before the first no-ERP org withholds), the
  PPN 12% × 11/12 rate (owner/accountant), and hiding the ERP-bound form's unused "Amount" field (Director — recommend
  yes, small).
- ADR number 0083: renumber if another branch claims it first.
