/**
 * Client-shaped dashboard fixture (design pass §0.1, RD-S1 Discover A4): an IDR org whose figures
 * run to hundreds of billions, an IDR + USD on-hand book, no budgets, long Bahasa project names.
 * The seed's small USD figures fit any tile even unformatted, so the geometry gate needs this to
 * reproduce the bleed it guards. All names and values are invented.
 *
 * Read-only: every mock fulfils a GET/RPC read; nothing is written.
 */
import type { Page, Route } from '@playwright/test';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NAMES = [
  'Pembangunan Fasilitas Pengolahan Air Limbah Terpadu Kawasan Industri Tahap II',
  'Rehabilitasi Jaringan Pipa Distribusi Gas Wilayah Bagian Selatan',
  'Pengadaan dan Pemasangan Sistem Kelistrikan Gardu Induk 150kV Lot 3',
  'Jasa Konsultansi Pengawasan Proyek Jalan Tol Seksi 1B',
  'Perawatan Berkala Instalasi Mekanikal Elektrikal Gedung Perkantoran Terpadu',
  'Studi Kelayakan dan Desain Rinci Dermaga Curah Kering',
];
const CONTRACTS = [63_400_000_000, 48_215_000_000, 21_870_500_000, 15_300_000_000, 7_925_000_000, 4_180_000_000];
const SPENT = [24_812_225_000, 17_402_000_000, 9_115_750_000, 4_310_000_000, 2_120_800_000, 652_000_000];

// Deterministic additional facts for independently loaded Finance and report figures.
export const FINANCE_FIXTURE = { receivable: 58_412_775_000, payable: 24_812_225_000, contract: 160_890_500_000 } as const;


const top = NAMES.map((name, i) => ({
  id: uuid(i + 1), name, client_name: `PT Klien Sintetis ${i + 1}`,
  contract_value: CONTRACTS[i], currency: 'IDR', budget: null, spent: SPENT[i], actual_currency: 'IDR', actual_complete: false,
  budget_currency: null, actual_coverage_count: 144, actual_coverage_total: 150, realized_margin: null, status: 'Ongoing Project',
}));

const executive = {
  active_projects: 6,
  active_delivery_projects: 6,
  risk_unchecked_projects: 6,
  total_contract_value: 160_890_500_000,
  on_hand_value: null,
  on_hand_value_by_currency: [
    { currency: 'IDR', contract_value: 373_530_500_000, actual_known: 58_412_775_000, contract_remaining: 315_117_725_000, actual_coverage_count: 144, actual_coverage_total: 150, realized_margin_known: null, unknown_projects: 20 },
    { currency: 'USD', contract_value: 3_412_800, actual_known: null, contract_remaining: null, actual_coverage_count: null, actual_coverage_total: null, realized_margin_known: null, unknown_projects: 5 },
  ],
  on_hand_contract_remaining: null,
  on_hand_realized_margin: null,
  on_hand_realized_margin_by_currency: [{ currency: 'IDR', known_amount: null, unknown_projects: 20 }, { currency: 'USD', known_amount: null, unknown_projects: 5 }],
  on_hand_actual_known: 58_412_775_000,
  on_hand_actual_project_count: 6,
  on_hand_actual_project_total: 25,
  on_hand_actual_coverage_count: 144,
  on_hand_actual_coverage_total: 150,
  on_hand_margin: null,
  pipeline_total_value: 190_900_000_000,
  pipeline_total_value_by_currency: [{ currency: 'IDR', total_value: 190_900_000_000, weighted_value: 75_185_000_000, forecast_margin: null, no_active_budget: 19 }],
  pipeline_weighted_value: 75_185_000_000,
  pipeline_projected_margin: null,
  projects_at_risk: 0,
  projects_by_status: [
    { status: 'Leads', count: 7 }, { status: 'PQ Submitted', count: 4 }, { status: 'Quotation Submitted', count: 5 },
    { status: 'Tender Submitted', count: 3 }, { status: 'Ongoing Project', count: 6 }, { status: 'Close Out', count: 19 }, { status: 'Loss Tender', count: 1 },
  ],
  procurements_by_status: [{ status: 'Draft', count: 2 }, { status: 'Approved', count: 1 }],
  top_projects: top,
  attention_projects: top.map((row, i) => ({ ...row, attention_signals: i === 0 ? 1 : 0, overdue_items: i === 0 ? 2 : 0, overdue_tasks: i === 0 ? 2 : 0, overdue_milestones: 0, overdue_invoices: 0, waiting_approvals: 0, over_budget: false, budget_used_ratio: null })),
};

const winRate = {
  wins_count: 19, losses_count: 1, declined_count: 0, wins_value: null, losses_value: null, win_rate_count: 0.95, win_rate_value: null,
  value_by_currency: [
    { currency: 'IDR', wins_value: 212_640_000_000, losses_value: 9_750_000_000, win_rate_value: 0.9561 },
    { currency: 'USD', wins_value: 3_412_800, losses_value: 0, win_rate_value: 1 },
  ],
};

const STAGES: Array<[string, number, number, number]> = [
  ['Leads', 7, 38_200_000_000, 0.1], ['PQ Submitted', 4, 26_500_000_000, 0.25], ['Quotation Submitted', 5, 54_900_000_000, 0.4],
  ['Tender Submitted', 3, 71_300_000_000, 0.6], ['Negotiation', 0, 0, 0.8],
];
let n = 100;
const pipelineProjects = STAGES.flatMap(([status, count, total, p]) => Array.from({ length: count }, () => {
  n += 1;
  return {
    id: uuid(n), name: `${NAMES[n % 6]} — Paket ${n}`, pmo_project_number: `PMO-2025-${String(n).padStart(4, '0')}`,
    code: `PO/SYN/2025/0${n}-REV.03`, client_name: 'PT Klien Sintetis 1', end_client_name: null, status,
    contract_value: Math.round(total / count / 1000) * 1000, currency: 'IDR', tax_treatment: 'exclusive', tax_rate: 11,
    win_probability: p, last_update: '2026-09-02T03:00:00Z', pm_name: 'PM Sintetis',
  };
}));
const pipeline = {
  stages: STAGES.map(([status, count, total, p]) => ({ status, count, total_value: total, win_probability: p, weighted_value: Math.round(total * p) })),
  projects: pipelineProjects,
};
const pmProjects = top.map((t) => ({ ...t, contract_remaining: t.contract_value - t.spent, realized_margin_pct: null }));

/** Money keys scaled ×15,000 (USD → IDR magnitude) on the reads the report routes make. */
const MONEY_KEYS = new Set(['net', 'recovery', 'outstanding', 'outstanding_amount', 'grand_total', 'base_grand_total', 'amount',
  'contract_net', 'contract_value', 'invoiced', 'total_amount', 'open_ar', 'net_total', 'total', 'subtotal', 'paid_amount',
  'invoice_amount', 'vendor_invoice_amount']);
function toIdr(node: unknown, key?: string): unknown {
  if (Array.isArray(node)) return node.map((x) => toIdr(x, key));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, toIdr(v, k)]));
  }
  if (key && /currency$/.test(key) && node === 'USD') return 'IDR';
  if (key && MONEY_KEYS.has(key)) {
    if (typeof node === 'number') return Math.round(node * 15_000);
    if (typeof node === 'string' && /^-?\d+(\.\d+)?$/.test(node)) return Math.round(Number(node) * 15_000).toFixed(2);
  }
  return node;
}

const json = (body: unknown) => (route: Route) => route.fulfill({ json: body });

/**
 * #1889: a dashboard page can keep issuing reads while the test's browser context is torn
 * down (the assertions have already settled); a rewrite handler that then calls
 * route.fulfill holds an API response the teardown disposed, and the handler's rejection
 * gets attributed to an otherwise-green test. Terminal lifecycle errors are NOT test
 * faults — nobody is left to answer that request — so settle them quietly. Everything else
 * (network failures, non-OK responses, rewrite faults) still surfaces, keeping active-page
 * failures visible. All figure/overflow oracles are untouched.
 */
function isTerminalLifecycleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /target (page|context|browser) has been closed|target closed|has been disposed/i.test(message);
}

async function rewriteRead(route: Route, rewrite: (body: unknown) => unknown) {
  try {
    const response = await route.fetch({ maxRetries: 2 });
    if (!response.ok()) return await route.fulfill({ response });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return await route.fulfill({ response });
    }
    return await route.fulfill({ response, json: rewrite(body) });
  } catch (error) {
    if (isTerminalLifecycleError(error)) return;
    throw error;
  }
}


// Bind these read models to one deterministic IDR fact, independent of mutable seed totals.
// These responses are read-only; the other dashboard stress inputs above are unchanged.
function financeInvoiceFixture(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return [{
    id: uuid(9001), project_id: uuid(9003), customer_id: null, currency: 'IDR',
    status: 'Unpaid', amount: FINANCE_FIXTURE.receivable,
    erp_outstanding_amount: FINANCE_FIXTURE.receivable, invoice_date: '2020-01-01',
    erp_due_date: '2020-01-31', received_date: null, created_at: '2020-01-01T00:00:00Z',
    author_user_id: null, sales_invoice_authors: [], companies: null,
  }];
}
function financeProcurementFixture(body: unknown): unknown {
  if (!Array.isArray(body)) return body;
  return [{
    id: uuid(9002), project_id: uuid(9003), vendor_id: null, currency: 'IDR',
    status: 'Vendor Invoiced', title: 'Synthetic supplier invoice',
    total_value: FINANCE_FIXTURE.payable, vendor_invoiced_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z', procurement_invoices: [{ amount: FINANCE_FIXTURE.payable }],
    payments: [], project: null, vendor: null, requested_by: null,
  }];
}
function reportFactsFixture(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const facts = body as Record<string, unknown>;
  if (typeof facts.from !== 'string' || typeof facts.to !== 'string' || typeof facts.timezone !== 'string'
      || typeof facts.org_currency !== 'string' || typeof facts.undated_invoice_count !== 'number'
      || !Array.isArray(facts.projects) || !Array.isArray(facts.invoiced)
      || !Array.isArray(facts.invoiced_before) || !Array.isArray(facts.progress)
      || !facts.invoiced_before.every((row: unknown) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
        const count = (row as Record<string, unknown>).invoice_count;
        return typeof count === 'number' && Number.isInteger(count) && count >= 0;
      })) return body;
  const month = facts.to;
  const id = uuid(9003);
  return { ...facts,
    projects: [{ id, name: NAMES[0], pmo_project_number: null, code: null,
      status: 'Ongoing Project', currency: 'IDR', contract_net: FINANCE_FIXTURE.contract,
      start_date: null, end_date: null, project_manager_id: null, client_name: null }],
    invoiced: [{ project_id: id, currency: 'IDR', month,
      net: FINANCE_FIXTURE.receivable, invoice_count: 1 }],
    invoiced_before: [],
    progress: [{ project_id: id, month, pct_complete: 100,
      entered_at: `${month}T00:00:00Z`, entered_by_name: null }],
  };
}

/** #1988: the hub's three figures as the narrow RPC returns them — the same unbilled figure the
 * pack fixture produced (recognised 100% of the contract minus the invoiced balance), no statements. */
function financeHubFiguresFixture(): unknown {
  return {
    pack: {
      as_at: '2026-11-01',
      unbilled: [{ currency: 'IDR', cents: (FINANCE_FIXTURE.contract - FINANCE_FIXTURE.receivable) * 100 }],
      contract_rows: 1,
      invoiced_basis_rows: 0,
    },
    statement: { unpublished: true, period_start: null, net_profit: null, currency: null },
  };
}

/** Route-mock the dashboard reads with the IDR-billions fixture (org default currency IDR). */
export async function installIdrDashboardFixture(page: Page) {
  await page.route('**/rest/v1/rpc/get_executive_dashboard*', json(executive));
  await page.route('**/rest/v1/rpc/get_finance_hub_figures*', json(financeHubFiguresFixture()));
  await page.route('**/rest/v1/rpc/get_win_rate*', json(winRate));
  await page.route('**/rest/v1/rpc/get_sales_pipeline*', json(pipeline));
  await page.route('**/rest/v1/rpc/get_pm_dashboard_projects*', json(pmProjects));
  await page.route('**/rest/v1/organizations?*', (route) => {
    if (route.request().method() !== 'GET' || !/default_currency/.test(route.request().url())) return route.fallback();
    return rewriteRead(route, (body) => Array.isArray(body)
      ? body.map((row) => ({ ...row, default_currency: 'IDR' }))
      : body && typeof body === 'object' ? { ...body, default_currency: 'IDR' } : body);
  });
  for (const pattern of ['**/rest/v1/sales_invoice_work_billed?*', '**/rest/v1/sales_invoices?*', '**/rest/v1/rpc/get_management_pack*', '**/rest/v1/procurements?*']) {
    await page.route(pattern, (route) => {
      if (route.request().method() !== 'GET' && !/rpc/.test(route.request().url())) return route.fallback();
      return rewriteRead(route, (body) => {
        const scaled = toIdr(body);
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/sales_invoices') && !url.searchParams.has('project_id')
            && !url.searchParams.has('status') && !url.searchParams.has('pmo_native')) return financeInvoiceFixture(scaled);
        if (url.pathname.endsWith('/procurements') && !url.searchParams.has('project_id')
            && !url.searchParams.has('vendor_id')) return financeProcurementFixture(scaled);
        if (url.pathname.endsWith('/rpc/get_management_pack')) return reportFactsFixture(scaled);
        return scaled;
      });
    });
  }
}
