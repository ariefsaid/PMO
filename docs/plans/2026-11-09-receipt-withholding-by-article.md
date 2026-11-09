# Receipt withholding by tax article (#1275) — implementation plan

**Issue:** #1275 — one tax-prepaid account cannot keep PPh 23 apart from PPh 4(2) withheld by clients.
**Builds on:** #762 (receipt withholding, 0232, DD-RCPT-1), #876 slice 2 (vendor-side per-article accounts, 0273,
DD-VWH-12/19), #1415 (payment allocation, 0731), #1506 C5 (Odoo receipts, 0512).
**Migration:** `0811_receipt_withholding_article.sql` + `rollback/0811_receipt_withholding_article_down.sql`.
**AC prefix:** `AC-WHA-###` (unused today; `grep -r AC-WHA- docs pmo-portal supabase` is empty).

## 1. What breaks today (the defect)

An accountant at an ERPNext-connected org whose clients withhold under both PPh 23 (services, creditable) and
PPh 4(2) (construction, final) records a receipt with tax withheld. The Payment Entry's deduction row always
posts to the one org-level tax-prepaid account, so every PPh 4(2) withholding lands in the PPh 23 prepaid account
(or vice versa) and must be reclassed by hand in the ERP before the year-end credit. The first client uses both.

## 2. Current state (grounded)

| Fact | Where |
|---|---|
| One org account: `organizations.tax_prepaid_account text` (1–140 chars), Admin-only via column grant + the org UPDATE policy | `supabase/migrations/0232_receipt_withholding.sql:3-6` |
| Changing it is audited as `org.withholding_account.change` with `{from,to}` | `0232_receipt_withholding.sql:18-29` |
| Receipt facts: `incoming_payments.received_amount`, `withheld_amount`, `withholding_slip_number`; balance + slip CHECKs | `0232_receipt_withholding.sql:7-16` |
| Receipt create audit records cash, withheld, slip (latest body) | `0232_receipt_withholding.sql:66-77` |
| Clients hold no INSERT/UPDATE on `incoming_payments` (only `insert(currency)`); ERP receipts are written by the service role | `0178_sod_class_completeness.sql:396,400`, `0187_money_currency_seam.sql:183` |
| ERPNext dispatch: a receipt with `withheld_amount > 0` reads `organizations.tax_prepaid_account` from the server org row (never the command/binding), fail-closed `config-rejected` | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts:187-209` |
| ERPNext body: the resolved account becomes the single marked deduction row (`Withholding slip: …`) | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts:34-61` |
| Read-back maps the marked deduction to `withheld_amount` + slip; it does not read the account | `bodies/incomingPayment.ts:110-140` |
| Mirror create writes the receipt row from canonical + `command.record` (customer, invoice, date) | `supabase/functions/adapter-dispatch/readModel/revenue.ts:232-260`; feed path `supabase/functions/_shared/erpFeedMirrorWrites.ts:190-205`, `_shared/erpFeedRevenue.ts:100-106` |
| Repository builds the receipt command record (`withheld_amount`, `withholding_slip_number`) | `pmo-portal/src/lib/repositories/revenue.ts:78-97` |
| Odoo: one `tax_prepaid_account_id` in the Odoo binding config, set by `set_odoo_tax_prepaid_account` | `0512_odoo_receipt_defaults.sql:16-58`; read in `supabase/functions/_shared/odooRevenueRefs.ts:427-438` |
| Native (no-ERP) receipts take withholding via `record_native_receipt` / `record_native_on_account_receipt`; no GL posting | `0731_payment_allocation.sql:191-300` |
| Admin UI: one account picker, "Receipt withholding" | `pmo-portal/pages/admin/OrgWithholdingAccount.tsx`; DAL `pmo-portal/src/lib/db/orgs.ts:7-27` |
| Receipt form: withheld amount + slip, no article | `pmo-portal/pages/incoming-payments/IncomingPaymentFormModal.tsx:26-90,215-290` |
| Vendor-side precedent: article domain `('pph23','pph4_2')`, per-article org accounts `pph23_payable_account`, `pph4_2_payable_account`; a default on the party is a **pre-fill only**, never read by a write path | `0273_vendor_tax_defaults.sql:1-60`; `pmo-portal/src/lib/vendorWithholding.ts:14-15` |
| Sales invoice list already embeds its project (`project:projects!…(subject_to_vat)`) | `pmo-portal/src/lib/db/revenue.ts:189,200` |
| Project header edit uses column grants (0234 precedent: `grant insert(...), update(...)`) | `0234_project_classification.sql:22`; DAL `pmo-portal/src/lib/db/projects.ts:380-402` |

There is no separate contract table; the project is the contract unit (`sales_invoices.project_id`).

## 3. Design

1. **Article on the receipt.** `incoming_payments.withholding_article text` — `null` or `'pph23'` / `'pph4_2'`
   (the vendor domain, `vendorWithholding.ts`). `null` means "other / not stated". The receipt's own value is the
   authority for the posting; nothing re-reads a project default at posting time (DD-VWH-19 rule, receipt side).
2. **One prepaid account per article, in the org's accounting settings.** `organizations.pph23_prepaid_account`,
   `organizations.pph4_2_prepaid_account` (text, 1–140, Admin-only via column grant + existing org UPDATE policy,
   audited by the existing `org.withholding_account.change` trigger, which now records which column changed).
   `tax_prepaid_account` stays and is the **default** account ("Other / default" in the UI).
3. **Resolution (ERPNext dispatch, server-side, one place):** article account if the receipt states an article and
   that account is set; else `tax_prepaid_account`; else refuse `config-rejected` before any ERP call (unchanged
   failure). The body keeps reading `ctx.config.tax_prepaid_account` — `resolveReceiptConfig` merges the *resolved*
   account under that key, so `peReceiveToBody` does not change.
4. **Default from the project.** `projects.receipt_withholding_article text` (same domain, nullable), editable in
   the project header form. The receipt form pre-fills the article from the chosen invoice's project; it stays
   editable. Pre-fill only: no server path reads it.
5. **Back-compat.** Existing single-account orgs: both new accounts are null, every receipt resolves to
   `tax_prepaid_account` — identical posting to today. Existing receipts: `withholding_article` stays null (unknown,
   never back-filled — the article was never stated). ERP-originated receipts (read back, not created in PMO) keep
   null: the article lives on the ERP account.
6. **Mirror.** The receipt's article is stamped on the mirror row only on a PMO-originated **create**, from
   `command.record.withholding_article` (same discipline as `customer_id`/`date`). Update/feed paths never write
   it, so a later ERP amendment can't clear a stated fact. No pairing CHECK with `withheld_amount` (0273 §5a
   reason: an ERP amendment dropping the deduction must not make the mirror write fail).

## 4. Decisions taken (Director defaults, no owner input needed)

- **DD-WHA-1** Article domain is `pph23 | pph4_2 | null`; no `'other'` literal — `null` + the default account is
  "other". Matches the vendor domain, so the tax register (#898) reads one vocabulary.
- **DD-WHA-2** Fallback is per-receipt: an article whose account is unset posts to the default account (the
  issue's "keep the single account as the fallback"). No refusal for a missing article account.
- **DD-WHA-3** The article is optional even when tax is withheld. Requiring it would refuse receipts at every
  single-account org today.
- **DD-WHA-4** Native (no-ERP) receipts: **out of scope**. They post to no GL, so there is no wrong account; the
  article matters there only for the tax register (#898, open). Adding it means changing the signatures of
  `record_native_receipt` / `record_native_on_account_receipt`, which the 0731 rollback test re-creates by
  signature. #898 adds it with its own migration. The native form hides the article picker.
- **DD-WHA-5** Odoo: **fallback only** in this plan. Odoo receipts keep posting to `tax_prepaid_account_id`;
  the new `withholding_article` field rides in the command record and Odoo ignores it. Per-article Odoo accounts
  are a follow-up issue, filed the same day the plan merges. No Odoo client is live.
- **DD-WHA-6** The project default is edited by the four project write roles (header form, existing
  `projects_write` policy). It is a pre-fill; Finance/Admin still state the receipt's article.
- **DD-WHA-7** No read-back inference of the article from the ERP deduction account (YAGNI; ERP-originated
  receipts show "not stated").

**Owner decisions:** none.

## 5. Slices

| Slice | Contents | Money? | Ships |
|---|---|---|---|
| **S1** | 0811 + rollback + pgTAP; ERPNext account resolution; mirror create stamp; repository command field | **Yes** (changes which ERP account a receipt posts to) | **Alone**, its own PR |
| **S2** | Admin accounting settings: three receipt-withholding accounts | No | Batch with S3 |
| **S3** | Receipt form article picker + project pre-fill; project header field; receipt record shows the article | No | Batch with S2 |

S1 alone changes no behaviour at existing orgs (new accounts null → fallback). S2/S3 need S1's columns on dev.

Gate per worker rules: tests are written first and **not run locally**; allowed local checks are
`npx eslint --max-warnings=0 <touched files>` (in `pmo-portal/`), `npm run check:guards`, `deno check <touched edge
fn files>`. CI is the test gate.

---

### S1 — schema + posting (MONEY, ships alone)

**S1.1 — pgTAP red: new columns, grants, audit, domain.** Create
`supabase/tests/0811_receipt_withholding_article.test.sql` (namespaced UUIDs `08110000-…`, `begin`/`rollback`,
`finish()`; fixtures copied from `supabase/tests/0232_receipt_withholding.test.sql:1-12`). Tests:
- `AC-WHA-001 Admin sets the PPh 23 and PPh 4(2) prepaid accounts on the own org` — `lives_ok` update, `is` read.
- `AC-WHA-001 a Finance user's update of the article accounts reaches no row` — count 0.
- `AC-WHA-001 article accounts stay scoped to the caller organization` — other org count 0.
- `AC-WHA-001 changing an article account is audited with its column, before and after` — `audit_events` row
  `action='org.withholding_account.change'`, `detail=jsonb_build_object('column','pph23_prepaid_account','from',null,'to','PPh 23 Prepaid - DEMO')`.
- `AC-WHA-001 a blank or over-long article account is refused` — `throws_ok … '23514'` for `''` and 141 chars.
- `AC-WHA-002 a receipt accepts pph23, pph4_2 or no article` — service-role inserts (as `0232` test's receipt
  fixture) `lives_ok` ×3.
- `AC-WHA-002 a receipt refuses any other article` — `throws_ok … '23514'` for `'pph21'`.
- `AC-WHA-002 authenticated holds no insert or update privilege on incoming_payments.withholding_article` —
  `has_column_privilege('authenticated','public.incoming_payments','withholding_article','INSERT')` false, same
  for `UPDATE`.
- `AC-WHA-002 the receipt create audit records the article` — insert, then `audit_events.detail->>'withholding_article' = 'pph4_2'`.
- `AC-WHA-007 a project write role sets the project's default receipt article` — PM updates
  `projects.receipt_withholding_article='pph4_2'` `lives_ok`; `'pph21'` → `throws_ok '23514'`.
- `AC-WHA-008 existing receipts and org accounts are left unknown, not back-filled` — after migration a
  pre-inserted receipt keeps `withholding_article is null`; org keeps `tax_prepaid_account` unchanged.

**S1.2 — migration green.** `supabase/migrations/0811_receipt_withholding_article.sql`:
```sql
-- 0811 — #1275: receipt withholding by tax article (DD-WHA-1..7).
-- §1 organizations: one prepaid account per article, 0232's precedent (column UPDATE grant + Admin-only org UPDATE
--    policy, audited). tax_prepaid_account stays the default account.
-- §2 incoming_payments.withholding_article: the article the client withheld under; null = not stated. Not
--    client-writable (0178 revoked insert/update); written by the service-role mirror on a PMO-originated create.
--    No pairing CHECK with withheld_amount (0273 §5a).
-- §3 projects.receipt_withholding_article: the receipt form's pre-fill only; no write path reads it (DD-VWH-19).
-- §4 the org account audit names the changed column; the receipt create audit records the article.
-- Rollback: supabase/migrations/rollback/0811_receipt_withholding_article_down.sql (revert the S1 dispatch first).

alter table public.organizations
  add column pph23_prepaid_account text
    check (pph23_prepaid_account is null or length(btrim(pph23_prepaid_account)) between 1 and 140),
  add column pph4_2_prepaid_account text
    check (pph4_2_prepaid_account is null or length(btrim(pph4_2_prepaid_account)) between 1 and 140);
grant update(pph23_prepaid_account, pph4_2_prepaid_account) on public.organizations to authenticated;

alter table public.incoming_payments
  add column withholding_article text check (withholding_article is null or withholding_article in ('pph23','pph4_2'));

alter table public.projects
  add column receipt_withholding_article text
    check (receipt_withholding_article is null or receipt_withholding_article in ('pph23','pph4_2'));
grant insert(receipt_withholding_article), update(receipt_withholding_article) on public.projects to authenticated;

create or replace function public.audit_org_withholding_account() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.tax_prepaid_account is distinct from old.tax_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('from',old.tax_prepaid_account,'to',new.tax_prepaid_account));
  end if;
  if new.pph23_prepaid_account is distinct from old.pph23_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('column','pph23_prepaid_account','from',old.pph23_prepaid_account,'to',new.pph23_prepaid_account));
  end if;
  if new.pph4_2_prepaid_account is distinct from old.pph4_2_prepaid_account then
    perform public.log_audit('org.withholding_account.change',new.id,auth.uid(),new.id,
      jsonb_build_object('column','pph4_2_prepaid_account','from',old.pph4_2_prepaid_account,'to',new.pph4_2_prepaid_account));
  end if;
  return new;
end; $$;
revoke all on function public.audit_org_withholding_account() from public,anon,authenticated;

create or replace function public.audit_incoming_payment_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('incoming_payment.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('status',                  new.status,
                                              'amount',                  new.amount,
                                              'ip_number',               new.ip_number,
                                              'sales_invoice_id',        new.sales_invoice_id,
                                              'received_amount',         new.received_amount,
                                              'withheld_amount',         new.withheld_amount,
                                              'withholding_slip_number', new.withholding_slip_number,
                                              'withholding_article',     new.withholding_article));
  return new;
end; $$;

-- On-database asserts (hosted grant defaults differ from local Docker).
do $$ begin
  if has_column_privilege('authenticated','public.incoming_payments','withholding_article','UPDATE')
     or has_column_privilege('authenticated','public.incoming_payments','withholding_article','INSERT') then
    raise exception '0811: incoming_payments.withholding_article must not be client-writable';
  end if;
end $$;
```
Before writing, confirm the latest bodies of both functions are still 0232's (`grep -n "function public.audit_incoming_payment_insert\|function public.audit_org_withholding_account" supabase/migrations/*.sql` — today: 0178 + 0232, and 0232 only).

**S1.3 — rollback.** `supabase/migrations/rollback/0811_receipt_withholding_article_down.sql`: re-run 0232's
bodies of `audit_org_withholding_account` (`0232_receipt_withholding.sql:18-27`) and `audit_incoming_payment_insert`
(`0232_receipt_withholding.sql:66-77`) verbatim; `revoke update(pph23_prepaid_account, pph4_2_prepaid_account) on
public.organizations from authenticated`; `revoke insert(receipt_withholding_article), update(receipt_withholding_article) on public.projects from authenticated`;
`alter table … drop column` for the four columns. Header comment: "revert the S1 dispatch before running this".

**S1.4 — pgTAP sweep (no new function or table).** Grep `supabase/tests` for `tax_prepaid_account`,
`audit_org_withholding_account`, `audit_incoming_payment_insert`, `incoming_payment.create`, and for column
inventories of `incoming_payments`, `organizations`, `projects` (`grep -ln "information_schema.columns\|column_privileges" supabase/tests`).
Update any exact-detail assertion on `incoming_payment.create` (the detail gains `withholding_article`). 0137 /
0178 / isolation denominator: no new function or table, so no entry — state that in the PR body. Regenerate
`pmo-portal/src/lib/supabase/database.types.ts` rows for the three tables by hand-adding the four columns
(Row/Insert/Update) in the same alphabetical position the generator uses.

**S1.5 — vitest red: account resolution.** In `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.withholding.test.ts`
widen `serviceClient(account)` to `serviceClient(accounts: { tax_prepaid_account: string | null; pph23_prepaid_account?: string | null; pph4_2_prepaid_account?: string | null })`
(update the four existing calls) and add:
- `AC-WHA-003: a PPh 4(2) receipt posts its deduction to the org's PPh 4(2) prepaid account` — command
  `withholding_article: 'pph4_2'`, accounts all set → captured `config.tax_prepaid_account === 'PPh 4(2) Prepaid - DEMO'`.
- `AC-WHA-003: a PPh 23 receipt posts to the PPh 23 prepaid account`.
- `AC-WHA-004: an article whose account is not set falls back to the default tax-prepaid account` — article
  `pph4_2`, only default set → default.
- `AC-WHA-004: a receipt with no article posts to the default account even when article accounts exist`.
- `AC-WHA-005: an article account alone, without the default, still posts a receipt of that article and refuses a receipt with no article before any ERP call` — `fetchImpl` not called on the refusal.
- `AC-WHA-003: the article comes from the receipt command, never the binding config` — binding config carries
  `pph4_2_prepaid_account: 'Caller-supplied'`, server org row wins.
- `AC-WHA-003: an unknown article in the command is refused before any ERP call` — `withholding_article: 'pph21'` → `config-rejected`.

**S1.6 — green: `resolveReceiptConfig`.** `pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenue.ts:193-209`:
```ts
const ARTICLE_ACCOUNT = { pph23: 'pph23_prepaid_account', pph4_2: 'pph4_2_prepaid_account' } as const;
// …inside resolveReceiptConfig, after the guard:
const article = record.withholding_article ?? null;
if (article !== null && !Object.hasOwn(ARTICLE_ACCOUNT, article as string)) {
  throw new AppError('The withholding article must be PPh 23 or PPh 4(2).', 'config-rejected');
}
const { data: settings, error: settingError } = await deps.serviceClient.from('organizations')
  .select('tax_prepaid_account,pph23_prepaid_account,pph4_2_prepaid_account').eq('id', deps.orgId).maybeSingle();
const row = (settings ?? {}) as Record<string, unknown>;
const isAccount = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 140;
// DD-WHA-2: the article's own account when set, else the default account.
const articleAccount = article ? row[ARTICLE_ACCOUNT[article as keyof typeof ARTICLE_ACCOUNT]] : undefined;
const account = isAccount(articleAccount) ? articleAccount : row.tax_prepaid_account;
if (settingError || !isAccount(account)) { throw new AppError('Set the Tax-prepaid account in Administration → Accounting before recording withheld tax.', 'config-rejected'); }
```
Widen the `record` cast to include `withholding_article?: unknown`. Update the doc comment (AC-WHA-003/004).

**S1.7 — vitest red/green: command record.** `pmo-portal/src/lib/repositories/revenue.external.test.ts` add
`AC-WHA-006: the receipt command carries the stated withholding article in the durable intent` (next to the
AC-WHT-001 test, line 128). Green: `pmo-portal/src/lib/repositories/contracts/revenue.ts:29-30` add
`withholdingArticle?: 'pph23' | 'pph4_2' | null;`; `repositories/revenue.ts:93` add
`...(input.withholdingArticle ? { withholding_article: input.withholdingArticle } : {}),`. The native branch
(`createNativePayment`) ignores it (DD-WHA-4).

**S1.8 — deno red/green: mirror stamp on create.** `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts`
add two `Deno.test`s:
- `AC-WHA-006 READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, create) stamps withholding_article from the command record`.
- `AC-WHA-006 an incoming-payment update mirror never writes withholding_article` — the update patch has no key.
Green: `supabase/functions/adapter-dispatch/readModel/revenue.ts` create branch (after line 251): read
`(command.record as { withholding_article?: unknown }).withholding_article`; write it only when it is `'pph23'`
or `'pph4_2'`. The feed paths (`_shared/erpFeedMirrorWrites.ts`, `_shared/erpFeedRevenue.ts`) stay untouched
(ERP-originated → null, DD-WHA-7). Check the touched file with `deno check`.

**S1.9 — sibling mocks.** `supabase/functions/adapter-dispatch/receiptWithholdingRecovery.test.ts:90` mocks
`organizations` with `{ tax_prepaid_account }`: still valid (fallback); confirm its route matcher ignores the
select string. Grep `vi.mock` of `dispatchRevenue` and `repositories/revenue` and read each hit.

**S1 checks:** eslint on touched `pmo-portal` files, `npm run check:guards`, `deno check supabase/functions/adapter-dispatch/readModel/revenue.ts`.
Commit `fix(revenue): post receipt withholding to the prepaid account of its tax article (#1275)`.

---

### S2 — Admin accounting settings (three accounts)

**S2.1 — vitest red: DAL.** `pmo-portal/src/lib/db/orgs.withholding.test.ts` add:
- `AC-WHA-001: getOrgWithholdingAccounts reads the default, PPh 23 and PPh 4(2) accounts` — select is
  `'tax_prepaid_account,pph23_prepaid_account,pph4_2_prepaid_account'`.
- `AC-WHA-001: setOrgWithholdingAccounts trims, nulls blanks and writes all three to the one readable org`.
- `AC-WHA-001: a silent no-op update is surfaced as a permission refusal`.
Green: in `pmo-portal/src/lib/db/orgs.ts` replace `getOrgWithholdingAccount`/`setOrgWithholdingAccount` with
`getOrgWithholdingAccounts(): Promise<OrgWithholdingAccounts>` / `setOrgWithholdingAccounts(input)`
(`{ defaultAccount, pph23Account, pph42Account }`), shaped exactly like `getOrgVendorTaxAccounts` /
`setOrgVendorTaxAccounts` (`orgs.ts`, #876 block). Update the existing get/set tests in the same file to the new
names (behaviour kept: one readable org, `assertWriteLanded`).

**S2.2 — repository seam.** `pmo-portal/src/lib/repositories/admin.ts:48,53,126-127` and
`repositories/contracts/admin.ts`: `getWithholdingAccounts` / `setWithholdingAccounts`. Update mocks in
`repositories/admin.test.ts`, `composition.test.ts`, `hookSeam.test.ts` (each `vi.mock('@/src/lib/db/orgs')`).

**S2.3 — vitest red/green: page.** `pmo-portal/pages/admin/OrgWithholdingAccount.test.tsx` add:
- `AC-WHA-001: an Admin chooses a PPh 23 and a PPh 4(2) prepaid account from Asset accounts and saves them`.
- `AC-WHA-004: the page says receipts with no article, or an article without its own account, post to the default account`.
- `AC-WHA-001: a non-Admin sees the three accounts read-only`.
Keep the existing AC-WHT-004 / AC-S11-002 tests passing with the default row. Green: render three account rows
(Default / PPh 23 / PPh 4(2)) in `OrgWithholdingAccount.tsx`, each the existing Combobox over
`taxSetupChoices(…, 'receipt-withholding')`, one Save. Reuse labels `common:companies.vendorTax.pph23` /
`pph4_2`; new keys in **both** `public/locales/en/common.json` and `public/locales/id/common.json` under `uxs11`:
`withholdingDefaultLabel` ("Default account" / "Akun bawaan"), `withholdingPph23Label` ("PPh 23 prepaid account" /
"Akun PPh 23 dibayar di muka"), `withholdingPph42Label` ("PPh 4(2) prepaid account" / "Akun PPh 4(2) dibayar di muka"),
`withholdingFallbackHint` ("Receipts with no article, or an article without its own account, post to the default account." /
"Penerimaan tanpa pasal, atau pasal tanpa akun sendiri, dicatat ke akun bawaan."). `historyLabels.ts:193` label is
already plural ("Withholding accounts changed") — no change.

---

### S3 — receipt article, project default, receipt display

**S3.1 — vitest red/green: sales invoice embeds the project's default.** `pmo-portal/src/lib/db/revenue.test.ts`
(or the existing list test that asserts `project_subject_to_vat`; `grep -ln project_subject_to_vat pmo-portal/src`)
add `AC-WHA-007: a sales invoice row carries its project's default receipt article`. Green:
`pmo-portal/src/lib/db/revenue.ts:189` embed `project:projects!…(subject_to_vat,receipt_withholding_article)`;
`:40` add `project_receipt_withholding_article?: 'pph23' | 'pph4_2' | null;`; `:200` map it with `isPphType`.

**S3.2 — vitest red: receipt form.** `pmo-portal/pages/__tests__/IncomingPayments.createForm.test.tsx` add:
- `AC-WHA-006: an accountant records a receipt with PPh 4(2) withheld and the command carries the article` —
  enter withheld + slip, choose "PPh 4(2)", submit → `onCreate`/dispatch input has `withholdingArticle: 'pph4_2'`.
- `AC-WHA-007: choosing an invoice pre-fills the article from its project, and the accountant can change it`.
- `AC-WHA-006: with nothing withheld the receipt carries no article`.
`pmo-portal/pages/__tests__/IncomingPayments.native.test.tsx` add
`AC-WHA-006: a PMO-native receipt shows no withholding article choice` (DD-WHA-4).

**S3.3 — green: form.** `pmo-portal/pages/incoming-payments/IncomingPaymentFormModal.tsx`: `FormValues` gains
`withholdingArticle: '' | 'pph23' | 'pph4_2'`; inside the existing withholding panel (non-native only) add a
`SelectField` (None / PPh 23 / PPh 4(2), labels `common:companies.vendorTax.none|pph23|pph4_2`); when the
invoice changes and the field is untouched, set it from `invoice.project_receipt_withholding_article`; submit
`withholdingArticle` only when withheld > 0 and a value is chosen. `pages/IncomingPayments.tsx` passes it through
the `onCreate` input type. New key both locales, `finance.json` `financeCopy.withholdingArticle`
("Withholding article" / "Pasal pemotongan").

**S3.4 — vitest red/green: project header field.** `pmo-portal/src/lib/db/projects.test.ts` add
`AC-WHA-007: updateProjectHeader writes the default receipt withholding article only when given`.
`pmo-portal/components/ProjectFormModal.tsx` test (`grep -ln "ProjectFormModal" pmo-portal/components/*.test.tsx`)
add `AC-WHA-007: editing a project's header sets its default receipt withholding article`. Green:
`ProjectHeaderInput` gains `receipt_withholding_article?: 'pph23' | 'pph4_2' | null`; `updateProjectHeader`
spreads it when defined (`projects.ts:392-396` pattern); `ProjectFormModal` editHeader mode adds the select;
`pages/project-detail/ProjectDetail.tsx:246-260` passes `receipt_withholding_article: project.receipt_withholding_article`.
New key both locales, `project.json`: `receiptWithholdingArticle` ("Client withholding article" / "Pasal pemotongan klien"),
helper "Pre-fills new receipts. Each receipt can change it." / "Mengisi otomatis penerimaan baru. Setiap penerimaan dapat mengubahnya."

**S3.5 — vitest red/green: receipt record.** `pmo-portal/pages/incoming-payments/ReceiptRecord.test.tsx` add
`AC-WHA-006: a receipt with tax withheld names its withholding article, or says it was not stated`. Green:
`ReceiptRecord.tsx:38-45` adds a row next to "Tax withheld" when `withheldShown`: the article label, or
`financeCopy.withholdingArticleNotStated` ("Not stated" / "Tidak disebutkan", both locales). `revenue.ts`
`IncomingPayment` type gains `withholding_article?: string | null` (row select is `*`).

**S3.6 — e2e.** No new journey: the cross-stack proof is AC-WHA-003 (dispatch builds the ERP body) + AC-WHA-006
(mirror stamp). Run `node scripts/affected-e2e.mjs` in CI's release PR only (worker rules forbid local e2e); list
the receipt journeys it names in the PR body.

S2+S3 checks: eslint on touched files, `npm run check:guards`. Commit
`feat(revenue): choose the client withholding article on receipts and per project (#1275)`.

## 6. Traceability

| AC | Given / When / Then | Owning test |
|---|---|---|
| AC-WHA-001 | Given an Admin, when they set PPh 23 and PPh 4(2) prepaid accounts, then both persist on the own org, a Finance user cannot change them, and each change is audited with its column | pgTAP `0811_receipt_withholding_article.test.sql` |
| AC-WHA-002 | Given a receipt row, when its article is written, then only `pph23`, `pph4_2` or null are accepted and clients cannot write it | pgTAP `0811_…` |
| AC-WHA-003 | Given an ERPNext org with an account per article, when a receipt with PPh 4(2) withheld is pushed, then the deduction row posts to the PPh 4(2) prepaid account | vitest `dispatchFactory.withholding.test.ts` |
| AC-WHA-004 | Given an article with no account of its own, or no article, when the receipt is pushed, then it posts to the default tax-prepaid account | vitest `dispatchFactory.withholding.test.ts` |
| AC-WHA-005 | Given no account resolves, when the receipt is pushed, then it is refused before any ERP call | vitest `dispatchFactory.withholding.test.ts` |
| AC-WHA-006 | Given an accountant records a receipt with an article, when it lands, then the receipt row carries that article and later ERP updates do not clear it | deno `readModelWriters.money.test.ts` (+ form/record vitest) |
| AC-WHA-007 | Given a project with a default article, when a receipt is started for one of its invoices, then the article is pre-filled and editable | vitest `IncomingPayments.createForm.test.tsx` (+ pgTAP column domain) |
| AC-WHA-008 | Given existing receipts and a single-account org, when 0811 runs, then nothing is back-filled and postings are unchanged | pgTAP `0811_…` + AC-WHA-004 |

## 7. Follow-ups to file when this merges

- Per-article Odoo prepaid accounts (DD-WHA-5).
- Native receipt article, with the tax register (#898, DD-WHA-4).
