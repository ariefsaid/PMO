# Plan #766 — part 5: management pack (migration 0251), ERP journey, pre-enable checklist

> Part of [`2026-10-06-progress-billing.md`](2026-10-06-progress-billing.md). Tasks D1–D3, E1–E3. Requires part 2
> (the view `sales_invoice_work_billed` from 0250 §8). D can run in parallel with parts 3–4.

## Slice D — the management pack reads the shared billed-work view (migration 0251)

### Task D1 — pgTAP: the pack counts billed work, not down payments (RED) · AC-PB-010

Create `supabase/tests/0251_management_pack_billed_work.test.sql`:

```sql
-- 0251_management_pack_billed_work.test.sql — #766 AC-PB-010 (DD-PBL-9): the management pack's invoiced figure is
-- billed WORK from the shared view — a down-payment invoice is an advance, not work; a claim invoice counts at its
-- net plus the recovery its negative line removed. Migration under test: 0251_management_pack_billed_work.sql.
begin;
create extension if not exists pgtap;
select plan(3);

insert into organizations (id, name) values ('07660000-0000-0000-0000-000000000001', 'PB Org');
update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001';
insert into auth.users (id, email) values ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin
  perform set_config('pb.dp', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'down_payment', p_down_payment_amount => 200000, p_recovery_pct => 20)::text, true);
  perform set_config('pb.dp2', public.create_progress_claim('07660000-0000-0000-0000-0000000000c2', 'down_payment', p_down_payment_amount => 50000, p_recovery_pct => 10)::text, true);
end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  ('07660000-0000-0000-0000-00000000cc01', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-03-05', 100000, 'exclusive', 0, 'USD', 'Paid'),
  (current_setting('pb.dp')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-03-10', 200000, 'exclusive', 0, 'USD', 'Paid'),
  (current_setting('pb.dp2')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-0000000000f1', null, 50000, 'exclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pc', public.create_progress_claim('07660000-0000-0000-0000-0000000000c1', 'progress', p_lines => '[{"boq_item_id":"07660000-0000-0000-0000-0000000000e1","quantity":4}]'::jsonb)::text, true); end $$;
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, invoice_date, amount, tax_treatment, tax_amount, currency, status) values
  (current_setting('pb.pc')::uuid, '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000f1', '2026-04-10', 160000, 'exclusive', 0, 'USD', 'Unpaid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
do $$ begin perform set_config('pb.pack', public.get_management_pack('2026-03-01', '2026-04-01')::text, true); end $$;
reset role;

select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(current_setting('pb.pack')::jsonb -> 'invoiced') x
            where x ->> 'project_id' = '07660000-0000-0000-0000-0000000000c1' and x ->> 'month' = '2026-03-01'), 100000::numeric,
  'AC-PB-010 March counts the plain 100,000 invoice and not the 200,000 down payment');
select is((select sum((x ->> 'net')::numeric) from jsonb_array_elements(current_setting('pb.pack')::jsonb -> 'invoiced') x
            where x ->> 'project_id' = '07660000-0000-0000-0000-0000000000c1' and x ->> 'month' = '2026-04-01'), 200000::numeric,
  'AC-PB-010 April counts the claim invoice at its net 160,000 plus the 40,000 recovered');
select is((current_setting('pb.pack')::jsonb ->> 'undated_invoice_count')::int, 0,
  'AC-PB-010 an undated down-payment invoice is not an undated invoice of work');

select * from finish();
rollback;
```

Verify RED: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0251_management_pack_billed_work.test.sql'`
Expect: 0/3 (300,000 / 160,000 / 1 — the pack still reads `sales_invoices` directly).

### Task D2 — migration 0251 (GREEN) · AC-PB-010

First confirm the pack on `dev` is still the one this plan was written against:
`sed -n '/create or replace function public.get_management_pack/,/^end; \$\$;/p' supabase/migrations/0245_management_pack.sql`.
If a later migration redefined `get_management_pack`, start from THAT body instead and change only the two places
marked `0251` below.

Create `supabase/migrations/0251_management_pack_billed_work.sql`:

```sql
-- 0251_management_pack_billed_work.sql — #766 DD-PBL-9: the management pack (#765, 0245) counts billed WORK from
-- the one shared definition, the view sales_invoice_work_billed (0250 §8), instead of its own copy of the
-- net-of-tax rule. A down-payment invoice is an advance, not work; a claim invoice counts at net plus the recovery
-- its negative line removed. Nothing else in the function changes. Reversal:
-- supabase/migrations/rollback/0251_management_pack_billed_work_down.sql.
create or replace function public.get_management_pack(p_from date default null, p_to date default null)
  returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_org    uuid := public.auth_org_id();
  v_tz     text;
  v_cur    text;
  v_to     date;
  v_from   date;
  v_result jsonb;
begin
  if v_org is null or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(o.default_timezone, 'UTC'), o.default_currency
    into v_tz, v_cur
    from public.organizations o where o.id = v_org;

  v_to   := coalesce(date_trunc('month', p_to)::date, public.org_current_month(v_tz, now()));
  v_from := coalesce(date_trunc('month', p_from)::date, date_trunc('year', v_to)::date);

  if v_from > v_to or v_from < (v_to - interval '23 months')::date then
    raise exception 'the management pack covers 1 to 24 months: the start month must be on or before the as-at month and at most 23 months before it'
      using errcode = '22023';
  end if;

  with counted as (
    -- ⚑ 0251: billed work from the shared view (was a direct read of sales_invoices with its own net-of-tax CASE).
    select w.project_id, w.currency,
           date_trunc('month', w.invoice_date)::date as month,
           w.net + w.recovery as net
      from public.sales_invoice_work_billed w
     where w.org_id = v_org
       and w.status in ('Submitted', 'Unpaid', 'Paid')
       and w.net is not null
       and w.invoice_date is not null
       and w.invoice_date < (v_to + interval '1 month')::date
       and not w.is_down_payment
  ),
  in_window as (
    select project_id, currency, month, sum(net) as net, count(*)::int as invoice_count
      from counted where month >= v_from
     group by project_id, currency, month
  ),
  before_window as (
    select project_id, currency, sum(net) as net
      from counted where month < v_from
     group by project_id, currency
  ),
  proj as (
    select p.id, p.name, p.pmo_project_number, p.code, p.status::text as status, p.currency,
           case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                else p.contract_value end as contract_net,
           p.start_date, p.end_date, p.project_manager_id, c.name as client_name
      from public.projects p
      left join public.companies c on c.id = p.client_id
     where p.org_id = v_org
       and (   (p.status in ('Won, Pending KoM', 'Ongoing Project', 'On Hold', 'Close Out') and p.archived_at is null)
            or exists (select 1 from in_window w where w.project_id = p.id))
  ),
  progress as (
    select e.project_id, e.month, e.pct_complete, e.entered_at, pr.full_name as entered_by_name
      from public.project_progress_entries e
      join proj on proj.id = e.project_id
      left join public.profiles pr on pr.id = e.entered_by
     where e.month <= v_to
       and (   e.month >= v_from
            or e.month = (select max(e2.month) from public.project_progress_entries e2
                           where e2.project_id = e.project_id and e2.month < v_from))
  )
  select jsonb_build_object(
    'from', v_from,
    'to', v_to,
    'timezone', v_tz,
    'org_currency', v_cur,
    -- ⚑ 0251: an undated down-payment invoice is not undated WORK.
    'undated_invoice_count', (select count(*)::int from public.sales_invoice_work_billed w
                               where w.org_id = v_org and w.status in ('Submitted', 'Unpaid', 'Paid')
                                 and w.net is not null and w.invoice_date is null and not w.is_down_payment),
    'projects', coalesce((select jsonb_agg(to_jsonb(x) order by x.name, x.id) from proj x), '[]'::jsonb),
    'invoiced', coalesce((select jsonb_agg(to_jsonb(w) order by w.month, w.project_id, w.currency)
                            from in_window w
                           where w.project_id is null or w.project_id in (select id from proj)), '[]'::jsonb),
    'invoiced_before', coalesce((select jsonb_agg(to_jsonb(b) order by b.project_id, b.currency)
                                   from before_window b
                                  where b.project_id is null or b.project_id in (select id from proj)), '[]'::jsonb),
    'progress', coalesce((select jsonb_agg(to_jsonb(g) order by g.project_id, g.month) from progress g), '[]'::jsonb)
  ) into v_result;

  return v_result;
end; $$;
revoke all     on function public.get_management_pack(date, date) from public, anon;
grant  execute on function public.get_management_pack(date, date) to authenticated;
```

`net` stays null exactly when `amount` is null (the view's CASE), so `w.net is not null` is the old
`si.amount is not null`. The management pack's FE (`managementPack.ts`) is unchanged: it still receives
`invoiced`, `invoiced_before` and `undated_invoice_count` in the same shape.

Verify GREEN: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0251_management_pack_billed_work.test.sql supabase/tests/0245_management_pack.test.sql'`
Expect: 3/3, and #765's suite unchanged (it has no claims, so the view returns exactly what the old CTE did).

### Task D3 — rollback + round trip · NFR-PB-004

Create `supabase/migrations/rollback/0251_management_pack_billed_work_down.sql` containing a header comment
`-- Reverses 0251: restores 0245's get_management_pack verbatim. Run before 0250's rollback.` followed by the
`create or replace function public.get_management_pack …` statement and its `revoke`/`grant` lines copied
verbatim from `supabase/migrations/0245_management_pack.sql` (§8 of that file — the same body as D2 with the two
`⚑ 0251` places restored: `counted` reads `public.sales_invoices si` with the net-of-tax CASE and
`si.amount is not null`, and `undated_invoice_count` reads `public.sales_invoices si` with `si.amount is not null`).
Copy it with:

```bash
{ echo "-- Reverses 0251: restores 0245's get_management_pack verbatim. Run before 0250's rollback."; \
  sed -n '/^create or replace function public.get_management_pack/,/^grant  execute on function public.get_management_pack/p' supabase/migrations/0245_management_pack.sql; } \
  > supabase/migrations/rollback/0251_management_pack_billed_work_down.sql
```

Verify the round trip of both migrations:

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0251_management_pack_billed_work_down.sql \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/migrations/rollback/0250_progress_billing_down.sql \
  && psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -tAc "select to_regclass('\''public.sales_invoice_work_billed'\'') is null and to_regclass('\''public.boq_items'\'') is null" \
  && supabase db reset && supabase test db supabase/tests/0245_management_pack.test.sql supabase/tests/0251_management_pack_billed_work.test.sql'
```
Expect: `t`, then both suites pass after the final reset.

## Slice E — the ERP journey (AC-PB-003)

### Task E1 — skip allow-list entry

In `scripts/check-e2e-skips.mjs`, in `ALLOWED_SKIPS`, directly after the
`serial/AC-SETUP-001-project-erp-link.spec.ts` entry add:

```js
  {
    file: 'serial/AC-PB-003-progress-billing-erp.spec.ts',
    reason: 'Progress-billing ledger proof needs the served functions lane and the throwaway ERPNext bench (its goal oracle is the ERP GL).',
    restore: 'Run with scripts/serve-functions.sh against the local ERPNext bench, with the bench API key exported.',
    verified: '2026-10-06',
  },
```

Verify: `node scripts/check-e2e-skips.mjs --self-test` — Expect: passes.

### Task E2 — the journey · AC-PB-003

Create `pmo-portal/e2e/serial/AC-PB-003-progress-billing-erp.spec.ts`:

```ts
// @e2e-isolation: serial — flips the shared org's revenue ownership + binding and sets its down payment item (org-global state).
/**
 * AC-PB-003-progress-billing-erp — #766 / ADR-0077 through the REAL served adapter-dispatch boundary and the local
 * ERPNext bench (never page.route; never a client's ERP). The goal oracle is the ERP LEDGER: the down payment
 * credits the customer-advance account, and the billing claim's recovery line debits it back while revenue is
 * credited with the full claimed value. Author (admin@acme.test) creates, evidences and raises; the approver
 * (finance@acme.test) submits — the SoD every claim invoice is under.
 *
 * Run: scripts/with-db-lock.sh scripts/serve-functions.sh -- npx playwright test AC-PB-003
 */
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { seedSAR, cleanupSAR, signInAdmin, signInApprover, dispatchCreateRevenue, dispatchTransitionRevenue } from './_sarHelpers';

const FUNCTIONS_URL = process.env.SUPABASE_FUNCTIONS_URL ?? '';
const AUTH_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? FUNCTIONS_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BENCH_URL = process.env.ERPNEXT_BENCH_URL ?? 'http://localhost:8080';
const BENCH_KEY = process.env.ERPNEXT_BENCH_API_KEY ?? '';
const BENCH_SECRET = process.env.ERPNEXT_BENCH_API_SECRET ?? '';
const ORG_ID = process.env.E2E_ORG_ID ?? '00000000-0000-0000-0000-000000000001';
const DP_ITEM = 'PB-DOWN-PAYMENT';
const ADVANCE_ACCOUNT = 'Customer Advances - PSC';

const READY = Boolean(FUNCTIONS_URL && AUTH_URL && ANON_KEY && SERVICE_KEY && BENCH_KEY && BENCH_SECRET);
if (FUNCTIONS_URL && !READY) {
  throw new Error('AC-PB-003: SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY + ERPNEXT_BENCH_API_KEY/SECRET are required once the served lane is up (SUPABASE_FUNCTIONS_URL set) — never a silent skip');
}
test.skip(!READY, 'AC-PB-003: needs the served functions lane and the ERPNext bench API key — run via scripts/serve-functions.sh against the bench');
test.setTimeout(180_000);

const benchHeaders = { Authorization: `token ${BENCH_KEY}:${BENCH_SECRET}`, 'Content-Type': 'application/json' };

/** Idempotent bench fixture: a duplicate-name refusal means Task 0 (or a previous run) already created it. */
async function benchEnsure(doctype: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${BENCH_URL}/api/resource/${encodeURIComponent(doctype)}`, { method: 'POST', headers: benchHeaders, body: JSON.stringify(body) });
}

async function glEntries(voucher: string): Promise<Array<{ account: string; debit: number; credit: number }>> {
  const params = new URLSearchParams({
    filters: JSON.stringify([['voucher_no', '=', voucher], ['is_cancelled', '=', 0]]),
    fields: JSON.stringify(['account', 'debit', 'credit']),
  });
  const res = await fetch(`${BENCH_URL}/api/resource/GL%20Entry?${params}`, { headers: benchHeaders });
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Array<{ account: string; debit: number; credit: number }> }).data;
}

/** Raise a claim's invoice (author) then submit it (approver), retrying a 502 with the SAME key (ADR-0058). */
async function raiseAndSubmit(claimId: string, customerId: string, projectId: string, authorToken: string, approverToken: string): Promise<string> {
  const record = { id: claimId, customerId, projectId, erp_doc_kind: 'sales-invoice' };
  const key = crypto.randomUUID();
  let res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, record, 'sales-invoice', key);
  for (let attempt = 0; res.status === 502 && attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    res = await dispatchCreateRevenue(FUNCTIONS_URL, ANON_KEY, authorToken, record, 'sales-invoice', key);
  }
  const body = (await res.json()) as { externalRecordId?: string };
  expect(res.status, `raise failed: ${JSON.stringify(body)}`).toBe(200);
  const name = body.externalRecordId as string;
  const submit = await dispatchTransitionRevenue(FUNCTIONS_URL, ANON_KEY, approverToken,
    { ...record, externalRecordId: name, verb: 'submit' }, 'sales-invoice', 'submit', crypto.randomUUID());
  const submitBody = await submit.json();
  expect(submit.status, `submit failed: ${JSON.stringify(submitBody)}`).toBe(200);
  return name;
}

test.describe('AC-PB-003: a down payment and a billing claim post through the customer-advance account', () => {
  test('AC-PB-003 the down payment credits the advance account and the claim recovers 40,000 from it', async () => {
    const admin = createClient(AUTH_URL, SERVICE_KEY);
    const authorToken = await signInAdmin(AUTH_URL, ANON_KEY);
    const approverToken = await signInApprover(AUTH_URL, ANON_KEY);
    const author = createClient(AUTH_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${authorToken}` } } });
    const suffix = `pb003-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seeded = await seedSAR(admin, suffix);
    const previousItem = (await admin.from('organizations').select('down_payment_item').eq('id', ORG_ID).single()).data?.down_payment_item ?? null;
    const claimIds: string[] = [];
    let boqId: string | null = null;
    let documentId: string | null = null;

    try {
      await benchEnsure('Account', { account_name: 'Customer Advances', parent_account: 'Current Liabilities - PSC', company: 'PMO Smoke Co', is_group: 0 });
      await benchEnsure('Item', { item_code: DP_ITEM, item_name: 'Down payment', item_group: 'Services', stock_uom: 'Nos', is_stock_item: 0, is_sales_item: 1,
        item_defaults: [{ company: 'PMO Smoke Co', income_account: ADVANCE_ACCOUNT }] });
      expect((await admin.from('organizations').update({ down_payment_item: DP_ITEM }).eq('id', ORG_ID)).error).toBeNull();
      expect((await admin.from('projects').update({ client_id: seeded.companyId, contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0 })
        .eq('id', seeded.projectId)).error).toBeNull();
      const boq = await admin.from('boq_items').insert({ org_id: ORG_ID, project_id: seeded.projectId, item_code: 'SPIKE-ITEM-1',
        description: 'Route survey', unit: 'km', quantity: 10, rate: 50000 }).select('id').single();
      expect(boq.error).toBeNull();
      boqId = boq.data!.id as string;
      const evidence = await admin.from('project_documents').insert({ org_id: ORG_ID, project_id: seeded.projectId, category: 'Report',
        title: `Progress report ${suffix}`, status: 'Issued', revision: 'A', file_path: `e2e/${suffix}.pdf` }).select('id').single();
      expect(evidence.error).toBeNull();
      documentId = evidence.data!.id as string;

      // 1. The down payment: 200,000 recovered at 20%, evidenced, raised by the author, submitted by the approver.
      const dp = await author.rpc('create_progress_claim', { p_project_id: seeded.projectId, p_kind: 'down_payment', p_down_payment_amount: 200000, p_recovery_pct: 20 });
      expect(dp.error).toBeNull();
      claimIds.push(dp.data as string);
      expect((await author.rpc('attach_claim_evidence', { p_claim_id: dp.data, p_document_id: documentId })).error).toBeNull();
      const dpInvoice = await raiseAndSubmit(dp.data as string, seeded.companyId, seeded.projectId, authorToken, approverToken);

      // 2. A billing claim for 4 km at 50,000: gross 200,000, recovery 20% = 40,000.
      const pc = await author.rpc('create_progress_claim', { p_project_id: seeded.projectId, p_kind: 'progress', p_lines: [{ boq_item_id: boqId, quantity: 4 }] });
      expect(pc.error).toBeNull();
      claimIds.push(pc.data as string);
      expect((await author.rpc('attach_claim_evidence', { p_claim_id: pc.data, p_document_id: documentId })).error).toBeNull();
      const claimInvoice = await raiseAndSubmit(pc.data as string, seeded.companyId, seeded.projectId, authorToken, approverToken);

      // 3. The goal: the ledger.
      const dpGl = await glEntries(dpInvoice);
      expect(dpGl.filter((e) => e.account === ADVANCE_ACCOUNT).reduce((sum, e) => sum + e.credit - e.debit, 0)).toBe(200000);
      const si = (await (await fetch(`${BENCH_URL}/api/resource/Sales%20Invoice/${encodeURIComponent(claimInvoice)}`, { headers: benchHeaders })).json()) as
        { data: { grand_total: number; items: Array<{ item_code: string; qty: number; rate: number }> } };
      expect(si.data.grand_total).toBe(160000);
      expect(si.data.items.map((i) => [i.item_code, i.qty, i.rate])).toEqual([['SPIKE-ITEM-1', 4, 50000], [DP_ITEM, 1, -40000]]);
      const claimGl = await glEntries(claimInvoice);
      const netDebit = (match: (account: string) => boolean) => claimGl.filter((e) => match(e.account)).reduce((sum, e) => sum + e.debit - e.credit, 0);
      expect(netDebit((account) => account === ADVANCE_ACCOUNT)).toBe(40000);
      expect(netDebit((account) => account.startsWith('Debtors'))).toBe(160000);
      expect(claimGl.filter((e) => e.account !== ADVANCE_ACCOUNT).reduce((sum, e) => sum + e.credit, 0)).toBe(200000);

      // 4. PMO's own figures agree.
      const summary = await author.rpc('get_project_billing', { p_project_id: seeded.projectId });
      expect(summary.error).toBeNull();
      expect(summary.data).toMatchObject({ work_billed: 200000, dp_billed: 200000, dp_recovered: 40000 });
    } finally {
      if (claimIds.length > 0) {
        await admin.from('sales_invoice_authors').delete().in('sales_invoice_id', claimIds);
        await admin.from('sales_invoices').delete().in('id', claimIds);
        await admin.from('external_command_outbox').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('external_ref_lineage').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('external_refs').delete().eq('org_id', ORG_ID).eq('domain', 'revenue').in('pmo_record_id', claimIds);
        await admin.from('progress_claim_evidence').delete().in('claim_id', claimIds);
        await admin.from('progress_claim_lines').delete().in('claim_id', claimIds);
        await admin.from('progress_claims').delete().in('id', claimIds);
      }
      if (documentId) await admin.from('project_documents').delete().eq('id', documentId);
      if (boqId) await admin.from('boq_items').delete().eq('id', boqId);
      await admin.from('organizations').update({ down_payment_item: previousItem }).eq('id', ORG_ID);
      await cleanupSAR(admin, seeded);
    }
  });
});
```

### Task E3 — run the journey · AC-PB-003

```bash
cd pmo-portal && ../scripts/with-db-lock.sh ../scripts/serve-functions.sh -- npx playwright test AC-PB-003
cd .. && bash scripts/check-e2e-isolation.sh && node scripts/check-e2e-skips.mjs --self-test
```
Expect: 1 passed (not skipped — if it reports skipped, the env is incomplete; export the stack env and the bench
key and re-run); both gates pass. Mutation check (do not commit): change the dispatch resolver's
`record.items = progressClaimItems(claim, lines);` to `record.items = progressClaimItems({ ...claim, dp_recovery_amount: 0 }, lines);`
→ the ledger assertions go red; revert.

## Pre-enable checklist (Director, before any client uses it)

1. Owner answers the three owner questions in the spec (the build uses their defaults until then).
2. Task 0 re-run on a v16 bench (the client's version) — same expectations.
3. ERP setup at the client (DD-OPS-3): a customer-advance liability account and a down-payment item whose Item
   Default income account is that account. Then an Admin enters the item in Administration → Accounting.
4. Deploy back to front, each production step only on the owner's explicit, per-instance yes: DB (0250, 0251 via
   `scripts/db-push-prod.sh`) → `adapter-dispatch` → FE.
5. After the DB push: probe the three definer RPCs with the anon key (must refuse) and confirm the 0178 sweep count
   on the hosted project — hosted grant defaults differ from local Docker (the 0185/0210 lesson).
6. Rendered Discover pass on the Billing tab (Finance, the project's PM, another PM, Engineer) with rich seed, per
   `docs/qa-portfolio.md`; every finding graduates to a test.
