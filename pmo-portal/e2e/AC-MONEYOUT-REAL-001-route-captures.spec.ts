// @e2e-isolation: read-only — money-out records, project names, ERP evidence, and unread notification count are returned by page.route fixtures; no database write occurs.
/**
 * AC-MONEYOUT-REAL-001 — render the recomposed money-out routes with synthetic client-shaped data.
 * The fixture intentionally stresses long identities, 13-digit IDR amounts, USD rows, 24-row
 * collections, and the shared shell's 87 unread notifications. Captures are local-only evidence
 * under docs/private/ux-shots/money-out-after and are named `*-real-*.png`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page, type Route } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

// The evidence matrix renders 104 large route states; per-action assertions retain their own deadlines.
test.setTimeout(1_800_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const PROJECT_ID = '40000000-0000-0000-0000-000000000013';
const REQUESTER_ID = '20000000-0000-0000-0000-000000000013';
const CLAIM_ID = '60000000-0000-0000-0000-000000000001';
const PROCUREMENT_ID = '50000000-0000-0000-0000-000000000001';
const PROJECT_NAME = 'Pembangunan Gedung Layanan Terpadu Tahap IV Baru';
const VENDOR_NAME = 'PT Sumber Daya Perkakas Terintegrasi Nusantara';
const IDR = 'IDR';

const uuid = (prefix: string, index: number) => `${prefix}-0000-0000-0000-${String(index + 1).padStart(12, '0')}`;

const projectRow = {
  id: PROJECT_ID,
  org_id: ORG_ID,
  name: PROJECT_NAME,
  short_name: null,
  code: 'PRJ-N48',
  pmo_project_number: 'PMO-N48-2026',
  status: 'Ongoing',
  currency: IDR,
  contract_value: 63_400_000_000,
  tax_treatment: 'exclusive',
  tax_amount: 0,
  tax_rate: null,
  tax_base_numerator: 1,
  tax_base_denominator: 1,
  tax_template: null,
  client_id: null,
  end_client_id: null,
  project_manager_id: null,
  archived_at: null,
  created_at: '2026-03-01T09:00:00.000Z',
  updated_at: '2026-10-26T09:00:00.000Z',
  client: null,
  end_client: null,
  pm: { full_name: 'Project Manager' },
};

const procurementStatuses = [
  'Requested', 'Approved', 'Vendor Quoted', 'Quote Selected', 'Ordered', 'Received',
  'Vendor Invoiced', 'Paid', 'Draft', 'Rejected', 'Cancelled',
] as const;

const procurements = Array.from({ length: 24 }, (_, index) => {
  const id = uuid('50000000', index);
  const currency = index % 5 === 4 ? 'USD' : IDR;
  const value = index === 0 ? 2_226_648_000 : index % 5 === 4 ? 1_275_000 + index * 17_500 : 385_000_000 + index * 28_450_000;
  const status = procurementStatuses[index % procurementStatuses.length];
  return {
    id,
    org_id: ORG_ID,
    project_id: PROJECT_ID,
    requested_by_id: REQUESTER_ID,
    approved_by_id: status === 'Approved' ? '20000000-0000-0000-0000-000000000014' : null,
    amount_approved_by_id: null,
    vendor_id: '30000000-0000-0000-0000-000000000013',
    title: index === 0 ? 'Equipment and installation for the integrated service building' : `Purchase request ${String(index + 1).padStart(2, '0')} · ${PROJECT_NAME}`,
    code: `PROC-2026-${String(index + 1).padStart(4, '0')}`,
    status,
    total_value: value,
    approved_total_value: status === 'Approved' ? value : null,
    currency,
    budget_category: 'Materials',
    pr_number: `PR-2610-${String(index + 1).padStart(4, '0')}`,
    po_number: ['Ordered', 'Received', 'Vendor Invoiced', 'Paid'].includes(status) ? `PO-2610-${String(index + 1).padStart(4, '0')}` : null,
    approval_notes: status === 'Approved' ? 'Within the approved project allocation.' : null,
    rejection_notes: status === 'Rejected' ? 'Please update the supporting specification.' : null,
    origin: null,
    import_batch_id: null,
    import_key: null,
    imported_at: null,
    vendor_invoiced_at: status === 'Vendor Invoiced' || status === 'Paid' ? '2026-10-20T09:00:00.000Z' : null,
    created_at: new Date(Date.UTC(2026, 9, 26 - index, 9, 0)).toISOString(),
    updated_at: '2026-10-26T09:00:00.000Z',
    project: { name: PROJECT_NAME, short_name: null, code: 'PRJ-N48', pmo_project_number: 'PMO-N48-2026' },
    vendor: { name: VENDOR_NAME },
    requested_by: { full_name: 'Project purchasing team' },
    approved_by: status === 'Approved' ? { full_name: 'Finance reviewer' } : null,
    open_commitment: ['Ordered', 'Received', 'Vendor Invoiced'].includes(status) ? value : 0,
    pr_refs: [{ external_ref: `PR/GLN/2026/${String(index + 1).padStart(4, '0')}` }],
    po_refs: status === 'Ordered' ? [{ external_ref: `PO/GLN/2026/${String(index + 1).padStart(4, '0')}-REV.03` }] : [],
    vi_refs: [],
  };
});

const procurementDetail = {
  ...procurements[0],
  status: 'Requested',
  items: [
    { id: '70000000-0000-0000-0000-000000000001', org_id: ORG_ID, procurement_id: PROCUREMENT_ID, name: 'Network and access control equipment', description: 'Supply and installation for the service building', quantity: 12, rate: 133_471_000, amount: 1_601_652_000 },
    { id: '70000000-0000-0000-0000-000000000002', org_id: ORG_ID, procurement_id: PROCUREMENT_ID, name: 'Commissioning and operator training', description: null, quantity: 1, rate: 144_996_000, amount: 144_996_000 },
    ...Array.from({ length: 20 }, (_, index) => ({ id: uuid('70000000', index + 2), org_id: ORG_ID, procurement_id: PROCUREMENT_ID, name: `Installation package ${index + 3} · ${PROJECT_NAME}`, description: 'Project commissioning equipment', quantity: 1, rate: 24_000_000, amount: 24_000_000 })),
  ],
  quotations: [
    { id: '71000000-0000-0000-0000-000000000001', org_id: ORG_ID, procurement_id: PROCUREMENT_ID, vendor_id: '30000000-0000-0000-0000-000000000013', total_amount: 2_226_648_000, currency: IDR, vq_number: 'VQ-2610-0001', is_selected: false, reference: 'VQ/GLN/2026/001', received_date: '2026-10-18', valid_until: '2026-11-18', files: [] },
    { id: '71000000-0000-0000-0000-000000000002', org_id: ORG_ID, procurement_id: PROCUREMENT_ID, vendor_id: '30000000-0000-0000-0000-000000000014', total_amount: 1_275_000, currency: 'USD', vq_number: 'VQ-2610-0002', is_selected: false, reference: 'VQ/GLN/2026/002', received_date: '2026-10-19', valid_until: '2026-11-19', files: [] },
    ...Array.from({ length: 22 }, (_, index) => ({ id: uuid('71000000', index + 2), org_id: ORG_ID, procurement_id: PROCUREMENT_ID, vendor_id: index % 5 === 0 ? '30000000-0000-0000-0000-000000000014' : '30000000-0000-0000-0000-000000000013', total_amount: index % 5 === 0 ? 1_295_000 + index * 15_000 : 2_230_000_000 + index * 18_500_000, currency: index % 5 === 0 ? 'USD' : IDR, vq_number: `VQ-2610-${String(index + 3).padStart(4, '0')}`, is_selected: false, reference: `VQ/GLN/2026/${String(index + 3).padStart(3, '0')}`, received_date: '2026-10-20', valid_until: '2026-11-20', files: [] })),
  ],
  receipts: [],
  invoices: [],
  purchase_requests: Array.from({ length: 20 }, (_, index) => ({ id: uuid('73000000', index), org_id: ORG_ID, procurement_id: PROCUREMENT_ID, pr_number: `PR-2610-REV-${String(index + 1).padStart(2, '0')}`, reference_number: `REQ/BUILDING/2026/${index + 1}`, date: '2026-10-26', amount: 2_226_648_000, currency: IDR, status: 'Requested', created_at: new Date(Date.UTC(2026, 9, 26, 9, index)).toISOString(), files: [] })),
  rfqs: [],
  purchase_orders: [],
  payments: [],
  updated_at: '2026-10-26T09:20:00.000Z',
  statusEvents: Array.from({ length: 20 }, (_, index) => {
    const sequence = ['Draft', ...Array.from({ length: 6 }, () => ['Requested', 'Rejected', 'Draft']).flat(), 'Requested'];
    return { id: uuid('72000000', index), org_id: ORG_ID, procurement_id: PROCUREMENT_ID, from_status: index === 0 ? null : sequence[index - 1], to_status: sequence[index], actor_id: REQUESTER_ID, created_at: new Date(Date.UTC(2026, 9, 26, 9, index)).toISOString(), actor: { full_name: 'Project purchasing team' } };
  }),
};

const claims = Array.from({ length: 24 }, (_, index) => {
  const id = uuid('60000000', index);
  const kind = index % 4 === 3 ? 'advance' : 'claim';
  const status = (['Submitted', 'Approved', 'Paid', 'Draft', 'Rejected'] as const)[index % 5];
  const currency = index % 6 === 5 ? 'USD' : IDR;
  const amount = index === 0 ? 2_226_648_000 : currency === 'USD' ? 12_500 + index * 450 : 365_000_000 + index * 23_840_000;
  return {
    id,
    org_id: ORG_ID,
    claimant_id: REQUESTER_ID,
    project_id: PROJECT_ID,
    advance_id: null,
    kind,
    title: index === 0 ? 'Site access equipment and transport' : `${kind === 'claim' ? 'Expense claim' : 'Cash advance'} ${String(index + 1).padStart(2, '0')} · ${PROJECT_NAME}`,
    purpose: 'Project site coordination and delivery support.',
    budget_category: 'Travel & accommodation',
    amount,
    currency,
    status,
    claim_number: `${kind === 'claim' ? 'EC' : 'EA'}-2610-${String(index + 1).padStart(4, '0')}`,
    advance_applied: status === 'Paid' && kind === 'claim' ? 325_000_000 : 0,
    returned_amount: 0,
    payment_reference: status === 'Paid' ? `BANK-TRANSFER-${String(index + 1).padStart(4, '0')}` : null,
    paid_on: status === 'Paid' ? '2026-10-26' : null,
    paid_at: status === 'Paid' ? '2026-10-26T09:00:00.000Z' : null,
    paid_by_id: status === 'Paid' ? '20000000-0000-0000-0000-000000000014' : null,
    approved_at: status === 'Approved' || status === 'Paid' ? '2026-10-25T10:00:00.000Z' : null,
    approved_by_id: status === 'Approved' || status === 'Paid' ? '20000000-0000-0000-0000-000000000014' : null,
    approval_notes: null,
    rejection_notes: status === 'Rejected' ? 'Please attach the original receipt.' : null,
    submitted_at: status === 'Submitted' ? new Date(Date.UTC(2026, 9, 26 - index, 9, 30)).toISOString() : null,
    cancelled_at: null,
    created_at: new Date(Date.UTC(2026, 9, 26 - index, 9, 0)).toISOString(),
    updated_at: '2026-10-26T09:00:00.000Z',
    claimant: { full_name: 'Project claimant' },
    project: { name: PROJECT_NAME, short_name: null },
  };
});

const erpOrphans = Array.from({ length: 24 }, (_, index) => ({
  id: `ERP-ROW-${String(index + 1).padStart(4, '0')}`,
  erp_doctype: ['Purchase Invoice', 'Purchase Order', 'Purchase Receipt', 'Payment Entry'][index % 4],
  erp_name: `ERP/${['INV', 'PO', 'GR', 'PAY'][index % 4]}/2026/${String(index + 1).padStart(4, '0')}`,
  supplier: VENDOR_NAME,
  supplier_name: VENDOR_NAME,
  doc_date: new Date(Date.UTC(2026, 9, 26 - index)).toISOString().slice(0, 10),
  due_date: '2026-11-25',
  bill_no: `BILL/GLN/2026/${String(index + 1).padStart(4, '0')}`,
  currency: index % 5 === 4 ? 'USD' : IDR,
  grand_total: index === 0 ? 2_226_648_000 : index % 5 === 4 ? 25_000 + index * 1_500 : 415_000_000 + index * 31_250_000,
  net_total: index === 0 ? 2_226_648_000 : index % 5 === 4 ? 25_000 + index * 1_500 : 415_000_000 + index * 31_250_000,
  outstanding_amount: index === 0 ? 2_226_648_000 : index % 5 === 4 ? 18_000 + index * 1_000 : 220_000_000 + index * 15_500_000,
  erp_status: 'Submitted',
  is_return: false,
  project_ids: [PROJECT_ID],
}));

const advanceAging = Array.from({ length: 24 }, (_, index) => ({
  advance_id: uuid('61000000', index),
  claim_number: `EA-2610-${String(index + 1).padStart(4, '0')}`,
  claimant_id: REQUESTER_ID,
  claimant_name: 'Project claimant',
  project_id: PROJECT_ID,
  project_name: PROJECT_NAME,
  currency: index % 5 === 4 ? 'USD' : IDR,
  amount: index === 0 ? 2_226_648_000 : 460_000_000 + index * 21_500_000,
  settled: 0,
  returned: 0,
  outstanding: index === 0 ? 2_226_648_000 : 460_000_000 + index * 21_500_000,
  paid_on: new Date(Date.UTC(2026, 9, 26 - (16 + index * 4))).toISOString().slice(0, 10),
  age_days: 16 + index * 4,
  bucket: 16 + index * 4 <= 30 ? '0-30' : 16 + index * 4 <= 60 ? '31-60' : 16 + index * 4 <= 90 ? '61-90' : '90+',
}));

const expenseLines = [
  { id: '62000000-0000-0000-0000-000000000001', org_id: ORG_ID, claim_id: CLAIM_ID, expense_date: '2026-10-20', expense_type: 'Travel', description: 'Inter-site equipment delivery', amount: 1_475_000_000, created_at: '2026-10-20T10:00:00.000Z' },
  { id: '62000000-0000-0000-0000-000000000002', org_id: ORG_ID, claim_id: CLAIM_ID, expense_date: '2026-10-21', expense_type: 'Other', description: 'Access control installation materials', amount: 271_648_000, created_at: '2026-10-21T10:00:00.000Z' },
  ...Array.from({ length: 20 }, (_, index) => ({ id: uuid('62000000', index + 2), org_id: ORG_ID, claim_id: CLAIM_ID, expense_date: '2026-10-22', expense_type: 'Travel', description: `Project logistics ${index + 3} · ${PROJECT_NAME}`, amount: 24_000_000, created_at: new Date(Date.UTC(2026, 9, 22, 10, index)).toISOString() })),
];

const notifications = Array.from({ length: 87 }, (_, index) => ({
  id: uuid('80000000', index),
  title: `Purchase update ${index + 1}`,
  body: `A procurement record has a new status for ${PROJECT_NAME}.`,
  severity: index % 7 === 0 ? 'warning' : 'info',
  metadata: { entity: { type: 'procurement_case', id: PROCUREMENT_ID, label: 'Current purchase request' } },
  read_at: null,
  created_at: new Date(Date.UTC(2026, 9, 26, 9, 0) - index * 60_000).toISOString(),
}));

async function fulfillJson(route: Route, data: unknown, responseStatus = 200) {
  await route.fulfill({ status: responseStatus, contentType: 'application/json', json: data });
}

async function installMoneyOutRouteMocks(page: Page, getLocale: () => 'en' | 'id') {
  await page.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() !== 'GET' || !/[?&]id=eq\./u.test(route.request().url())) return route.fallback();
    const snapshot = process.env.SHOT_PROFILE_SNAPSHOT
      ? JSON.parse(readFileSync(process.env.SHOT_PROFILE_SNAPSHOT, 'utf8')) as Record<string, unknown> | Record<string, unknown>[] : null;
    const requestedId = new URL(route.request().url()).searchParams.get('id')?.replace(/^eq\./u, '');
    const cachedProfile = Array.isArray(snapshot) ? snapshot.find((row) => row.id === requestedId) : snapshot;
    let body: unknown;
    if (cachedProfile?.id === requestedId) body = cachedProfile;
    else {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      body = await response.json();
    }
    const patch = (row: Record<string, unknown>) => ({
      ...row,
      full_name: `${row.role} reviewer`,
      locale: getLocale(),
      number_locale: getLocale() === 'id' ? 'id-ID' : 'en-US',
      timezone: 'Asia/Jakarta',
    });
    const localized = Array.isArray(body) ? body.map(patch) : body && typeof body === 'object' ? patch(body as Record<string, unknown>) : body;
    return fulfillJson(route, localized);
  });

  await page.route('**/rest/v1/procurements?*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const requestedId = url.searchParams.get('id')?.replace(/^eq\./u, '');
    const statusFilter = url.searchParams.get('status');
    const statuses = statusFilter?.startsWith('in.(') ? statusFilter.slice(4, -1).replaceAll('"', '').split(',') : null;
    const rows = requestedId ? [{ ...procurementDetail, id: requestedId, project_id: PROJECT_ID }]
      : statuses ? procurements.filter((row) => statuses.includes(row.status)) : procurements;
    return fulfillJson(route, route.request().headers().accept?.includes('vnd.pgrst.object') ? rows[0] : rows);
  });
  await page.route('**/rest/v1/projects?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, [projectRow]) : route.fallback());
  await page.route('**/rest/v1/organizations?*', async (route) => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).searchParams.get('select') === 'default_currency') {
      return fulfillJson(route, [{ default_currency: IDR }]);
    }
    return route.fallback();
  });
  await page.route('**/rest/v1/companies?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, [{ id: '30000000-0000-0000-0000-000000000013', org_id: ORG_ID, name: VENDOR_NAME, type: 'Vendor', archived_at: null }, { id: '30000000-0000-0000-0000-000000000014', org_id: ORG_ID, name: 'PT Penyedia Peralatan Infrastruktur Terpadu Utama', type: 'Vendor', archived_at: null }])
    : route.fallback());
  await page.route('**/rest/v1/erp_purchase_orphans?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, erpOrphans) : route.fallback());
  await page.route('**/rest/v1/erp_purchase_documents_linked?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, []) : route.fallback());
  await page.route('**/rest/v1/expense_claims?*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const url = new URL(route.request().url());
    const requestedId = url.searchParams.get('id')?.replace(/^eq\./u, '');
    const query = url.searchParams.get('title')?.replace(/^ilike\.%|%$/gu, '').toLowerCase();
    const rows = requestedId ? claims.filter((claim) => claim.id === requestedId).map((claim) => ({ ...claim, id: requestedId }))
      : query ? claims.filter((claim) => claim.title.toLowerCase().includes(query)) : claims;
    return fulfillJson(route, rows);
  });
  await page.route('**/rest/v1/expense_claim_lines?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, expenseLines) : route.fallback());
  await page.route('**/rest/v1/expense_claim_files?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, []) : route.fallback());
  await page.route('**/rest/v1/expense_posting_erp_mirror?*', async (route) => route.request().method() === 'GET'
    ? fulfillJson(route, []) : route.fallback());
  await page.route('**/rest/v1/notifications?*', async (route) => {
    if (route.request().method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { 'content-range': '0-0/87', 'access-control-expose-headers': 'content-range' }, body: '' });
    }
    if (route.request().method() === 'GET') return fulfillJson(route, notifications);
    return route.fallback();
  });
  await page.route('**/rest/v1/rpc/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const mock: Record<string, unknown> = {
      get_procurement_approval_routes: [],
      get_expense_claim_approval_routes: [],
      get_expense_advance_aging: advanceAging,
      expense_advance_outstanding: 1_226_648_000,
      procurement_payment_within_ceiling: [],
      get_procurement_gates: { approval_before_payment: false },
      get_project_budget: 4_800_000_000,
      project_committed_spend: [{ currency: IDR, amount: 1_125_000_000, is_project_currency: true }, { currency: 'USD', amount: 12_500, is_project_currency: false }],
    };
    if (name && Object.prototype.hasOwnProperty.call(mock, name)) return fulfillJson(route, mock[name]);
    return route.fallback();
  });
}

const routeCases = [
  { name: 'procurement', path: '/procurement', marker: 'Equipment and installation for the integrated service building' },
  { name: 'procurement-new', path: `/procurement/new?project=${PROJECT_ID}`, marker: PROJECT_NAME },
  { name: 'procurement-review', path: `/procurement/${PROCUREMENT_ID}`, marker: 'Equipment and installation for the integrated service building' },
  { name: 'procurement-items', path: `/procurement/${PROCUREMENT_ID}/items`, marker: 'Network and access control equipment' },
  { name: 'procurement-documents', path: `/procurement/${PROCUREMENT_ID}/documents`, marker: 'PROC-2026-0001' },
  { name: 'procurement-quotes', path: `/procurement/${PROCUREMENT_ID}/quotes`, marker: 'VQ/GLN/2026/001' },
  { name: 'procurement-activity', path: `/procurement/${PROCUREMENT_ID}/activity`, marker: 'Project purchasing team' },
  { name: 'erp-purchases', path: '/erp-purchases', marker: 'ERP/INV/2026/0001' },
  { name: 'expenses', path: '/expenses', marker: 'Site access equipment and transport' },
  { name: 'expenses-outstanding', path: '/expenses?view=outstanding', marker: 'EA-2610-0001' },
  { name: 'expenses-new', path: `/expenses/new?project=${PROJECT_ID}`, marker: PROJECT_NAME },
  { name: 'expense-record', path: `/expenses/${CLAIM_ID}`, marker: 'Site access equipment and transport' },
] as const;

test('AC-MONEYOUT-REAL-001: route-mocked money-out evidence at both widths, locales and themes', async ({ page }) => {
  let locale: 'en' | 'id' = 'en';
  await installMoneyOutRouteMocks(page, () => locale);
  await signIn(page, 'finance@acme.test');
  const output = path.resolve(process.cwd(), `../docs/private/ux-shots/${process.env.AREA || 'money-out-after'}`);
  mkdirSync(output, { recursive: true });
  const captures: object[] = [];
  const manifestPath = path.join(output, 'real-capture-manifest.json');
  const previousCaptures = process.env.SHOT_REUSE_CAPTURES === '1' && existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Array<{ file: string; route: string; geometry?: { h1Count: number } }> : [];

  for (const language of ['en', 'id'] as const) {
    locale = language;
    for (const width of [390, 1440] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const theme of ['light', 'dark'] as const) {
        for (const route of routeCases) {
          await page.goto(route.path);
          await expect(page.locator('main h1').first(), `${route.name} title renders`).toBeVisible({ timeout: 60_000 });
          if (language === 'id') await expect(page.locator('html')).toHaveAttribute('lang', 'id', { timeout: 60_000 });
          if (route.name === 'expenses-new') {
            await expect(page.getByRole('combobox', { name: /^(Project|Proyek)$/ })).toHaveValue(PROJECT_ID);
          } else {
            await expect(page.locator('main').getByText(route.marker, { exact: false }).filter({ visible: true }).first(), `${route.name} uses the synthetic route fixture`).toBeVisible({ timeout: 60_000 });
          }
          if (route.path.startsWith(`/procurement/${PROCUREMENT_ID}`)) {
            const section = route.path.split('/')[3] || 'overview';
            await expect(page.locator('#procurement-section-select')).toHaveValue(section);
          }
          await page.evaluate((isDark) => document.documentElement.classList.toggle('dark', isDark), theme === 'dark');
          await waitForFonts(page);
          await expect(page.getByRole('button', { name: 'Notifications, 87 unread' })).toBeVisible();
          await page.locator('.main-scroll').evaluate((element) => element.scrollTo(0, 0));
          const filename = `${route.name}-${width}-${language}-${theme}-real-default.png`;
          const reuseCapture = previousCaptures.some((capture) => capture.file === filename && capture.route === route.path && capture.geometry?.h1Count === 1) && existsSync(path.join(output, filename));
          if (!reuseCapture) await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
          const png = readFileSync(path.join(output, filename));
          const geometry = await page.evaluate(() => ({ h1Count: document.querySelectorAll('main h1').length, heading: document.querySelector('main h1')?.textContent, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
          expect(geometry.h1Count).toBe(1);
          expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
          captures.push({ file: filename, route: route.path, url: page.url(), role: 'Finance', scope: 'team', state: 'default', locale: language, theme,
            viewport: { width, height: width === 390 ? 844 : 900 }, pixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, geometry });
          writeFileSync(path.join(output, 'real-capture-manifest.json'), JSON.stringify(captures, null, 2));
        }
      }
    }
  }

  // Named collection states exercise the toolbar result recovery and alternate board composition.
  locale = 'en';
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/procurement');
  await expect(page.getByText('Equipment and installation for the integrated service building')).toBeVisible();
  await page.getByRole('tab', { name: 'Board' }).click();
  await expect(page.getByText('PROC-2026-0001', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, 'procurement-390-en-light-real-board.png'), animations: 'disabled' });
  await page.goto('/procurement');
  await page.getByRole('searchbox', { name: 'Filter requests' }).fill('no matching synthetic request');
  await expect(page.getByText('No requests match your filters')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'procurement-390-en-light-real-no-match.png'), animations: 'disabled' });
  await page.goto('/expenses');
  await page.getByRole('searchbox', { name: 'Search expenses' }).fill('no matching synthetic claim');
  await expect(page.getByText('No expenses match these filters')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'expenses-390-en-light-real-no-match.png'), animations: 'disabled' });
});
