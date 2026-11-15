/**
 * #2286 — a seeded, deterministic ten-times-volume purchase-capture fixture for the served handler.
 *
 * It produces what the database RPCs return (source pages, ledger pages, feed health, the assignment report) for one
 * organization, so the golden test (AC-CAPV-002) and the bench drive the real handler through the fetch mock.
 * The ledger is served in both shapes of `purchase_capture_ledger_page`: `'all'` (every line) and `'capture'` (only the
 * capture-relevant lines, with `other_summary` on the first page). `capturePage` mirrors the SQL rule of migration 0904;
 * the pgTAP proof `2286_capture_ledger_scope.test.sql` owns that rule, this file only serves it.
 */

export const COMPANY = 'Example';
export const BINDING_ID = 'binding-10x';
export const REVISION = 'rev-10x';
export const PROJECTS = ['11111111-1111-4111-8111-000000000001', '11111111-1111-4111-8111-000000000002', '11111111-1111-4111-8111-000000000003'];
const ERP_PROJECTS = ['PRJ-A', 'PRJ-B', 'PRJ-C'];
const PURCHASE_KINDS = new Set(['order', 'receipt', 'supplier_invoice']);

export interface LedgerRow {
  id: string; erp_name: string; erp_modified: string; company: string; account: string; project: string | null; project_id: string | null;
  voucher_type: string; voucher_no: string; debit: string | null; credit: string | null; document_id: string | null;
  document_purchase_id: string | null; journal_purchase_id: string | null; classification: 'mapped' | 'unmapped' | 'capital_spending' | 'unknown'; kind: string | null;
}
export interface OtherSummary { kind: string; count: number; total: string | null }
export interface Fixture {
  binding: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  ledger: LedgerRow[];
  assignments: Array<Record<string, unknown>>;
  health: Record<string, unknown>;
}

/** mulberry32: a small seeded generator, so every run builds the same rows. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const kindOf = (type: string): string | null =>
  ({ 'Purchase Order': 'order', 'Purchase Invoice': 'supplier_invoice', 'Purchase Receipt': 'receipt', 'Payment Entry': 'supplier_payment', 'Journal Entry': 'journal' } as Record<string, string>)[type] ?? null;
/** A numeric(14,2) value as Postgres prints it. */
const money = (minor: number) => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

export function buildFixture(options: { seed?: number; families?: number; journals?: number; unrelated?: number } = {}): Fixture {
  const rand = random(options.seed ?? 2286);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const families = options.families ?? 450, journals = options.journals ?? 3000, unrelated = options.unrelated ?? 5800;
  const projectMap = Object.fromEntries(PROJECTS.map((id, i) => [id, ERP_PROJECTS[i]]));
  const binding = { id: BINDING_ID, org_id: 'org-10x', external_tier: 'erpnext', config: { company: COMPANY, project_map: projectMap }, site_url: 'https://8.8.8.8', secret_ref: 'synthetic',
    status: 'active', activated_at: '2026-01-01T00:00:00Z', version_major: 15 };
  const sources: Array<Record<string, unknown>> = [];
  const ledger: LedgerRow[] = [];
  let docN = 0, lineN = 0;
  // The third project is clean (one supplier, one currency, mapped accounts), so its report carries totals and a bridge.
  const clean = (projects: string[]) => projects[0] === PROJECTS[2];
  const party = (projects: string[]) => {
    const n = clean(projects) ? 1 : 1 + Math.floor(rand() * 3);
    return { supplier: `SUP-${n}`, supplier_name: 'Vendor', supplier_id: !clean(projects) && rand() < 0.05 ? null : `vendor-${n}`, currency: !clean(projects) && rand() < 0.03 ? 'USD' : 'IDR' };
  };
  const base = (doctype: string, name: string, projects: string[], who = party(projects)) => ({
    id: uuid('d0c00000', ++docN), erp_doctype: doctype, erp_name: name, erp_docstatus: !clean(projects) && rand() < 0.02 ? 2 : 1, erp_modified: `2026-02-${String(1 + (docN % 27)).padStart(2, '0')}`,
    ...who, project_ids: projects, procurement_id: null as string | null, purchase_origin: null as string | null, recorded_by_pmo: !clean(projects) && rand() < 0.02, doc_date: '2026-02-01',
    net_total: !clean(projects) && rand() < 0.01 ? '12.345' : money(100 + Math.floor(rand() * 900000)), is_return: !clean(projects) && rand() < 0.01,
    outstanding_amount: null, grand_total: null, kind: kindOf(doctype), family_incomplete: !clean(projects) && rand() < 0.02, needs_undo: [] as unknown[],
  });
  const line = (fields: Partial<LedgerRow> & { voucher_type: string; voucher_no: string }): LedgerRow => {
    const n = ++lineN;
    const debit = Math.floor(rand() * 500000);
    return { id: uuid('9e000000', n), erp_name: `GL-${n}`, erp_modified: '2026-02-01', company: COMPANY, account: `Cost-${1 + (n % 1470)}`, project: null, project_id: null,
      debit: money(debit), credit: rand() < 0.3 ? money(Math.floor(rand() * debit)) : '0.00', document_id: null, document_purchase_id: null, journal_purchase_id: null,
      classification: pick(['mapped', 'mapped', 'mapped', 'unmapped', 'capital_spending', 'unknown'] as const), kind: kindOf(fields.voucher_type), ...fields,
      ...(fields.project_id === PROJECTS[2] ? { classification: 'mapped' as const } : {}) };
  };
  const projectFields = (projects: string[]) => projects.length === 1 ? { project: ERP_PROJECTS[PROJECTS.indexOf(projects[0])], project_id: projects[0] } : { project: rand() < 0.5 ? 'PRJ-X' : null, project_id: null };
  for (let f = 0; f < families; f++) {
    const projects = rand() < 0.04 ? [] : [pick(PROJECTS)];
    const captured = rand() < 0.05;
    const who = party(projects);
    const order = { ...base('Purchase Order', `PO-${f}`, projects, who), erp_status: 'To Bill', purchase_orders: [] as string[] };
    const invoice = { ...base('Purchase Invoice', `PI-${f}`, projects, who), erp_status: pick(['Unpaid', 'Paid', 'Partly Paid', 'Overdue']), purchase_orders: [`PO-${f}`] };
    if (captured) for (const doc of [order, invoice]) { doc.procurement_id = uuid('9c000000', f); doc.purchase_origin = 'captured'; }
    else if (rand() < 0.03) { order.procurement_id = uuid('9c000000', f); order.purchase_origin = 'ordinary'; }
    if (f % 97 === 0) invoice.needs_undo = [{ supplier_id: 'vendor-1', project_id: PROJECTS[0], currency: 'IDR', purchase_id: uuid('9c000000', 100000 + f), undo_command: `node scripts/pmo.mjs purchases undo-record-only ${uuid('9c000000', 100000 + f)} --reason "Incorrect link"` }];
    sources.push(order, invoice);
    for (let k = 0; k < (rand() < 0.2 ? 2 : 1); k++) {
      ledger.push(line({ voucher_type: 'Purchase Invoice', voucher_no: invoice.erp_name, document_id: invoice.id, document_purchase_id: invoice.procurement_id, ...projectFields(projects) }));
    }
  }
  // Invoices without an order, orders without an invoice, and payment entries mirrored as purchase documents.
  for (let i = 0; i < 50; i++) {
    const projects = rand() < 0.1 ? [] : [pick(PROJECTS)];
    const invoice = { ...base('Purchase Invoice', `PI-SOLO-${i}`, projects), erp_status: 'Unpaid', purchase_orders: [] as string[] };
    sources.push(invoice);
    ledger.push(line({ voucher_type: 'Purchase Invoice', voucher_no: invoice.erp_name, document_id: invoice.id, ...projectFields(projects) }));
  }
  for (let i = 0; i < 30; i++) sources.push({ ...base('Purchase Order', `PO-SOLO-${i}`, [pick(PROJECTS)]), erp_status: 'To Bill', purchase_orders: [] });
  for (let i = 0; i < 20; i++) {
    const payment = { ...base('Payment Entry', `PE-${i}`, []), erp_status: 'Paid', purchase_orders: [] as string[] };
    sources.push(payment);
    // A payment document line with no project: listed for information, but its document makes it capture-relevant.
    ledger.push(line({ voucher_type: 'Payment Entry', voucher_no: payment.erp_name, document_id: payment.id }));
  }
  // Receipts on a project, journals on a project (some linked to a purchase), and a few lines of another company.
  for (let i = 0; i < 200; i++) {
    const project = pick(PROJECTS);
    ledger.push(line({ voucher_type: 'Purchase Receipt', voucher_no: `PR-${i}`, ...projectFields([project]) }));
  }
  for (let i = 0; i < journals; i++) {
    const project = pick(PROJECTS);
    ledger.push(line({ voucher_type: 'Journal Entry', voucher_no: `JV-${i}`, ...projectFields([project]), journal_purchase_id: rand() < 0.1 ? uuid('9c000000', 200000 + i) : null }));
  }
  for (let i = 0; i < 5; i++) ledger.push(line({ voucher_type: pick(['Journal Entry', 'Payment Entry']), voucher_no: `OTHER-${i}`, company: 'Other Co', project: 'PRJ-A' }));
  // Unrelated lines with no project: journals, payments, sales and bank entries; a few journals have no amount.
  for (let i = 0; i < unrelated; i++) {
    const type = i % 1000 === 7 ? 'Journal Entry' : pick(['Journal Entry', 'Journal Entry', 'Payment Entry', 'Payment Entry', 'Sales Invoice', 'Bank Entry']);
    const row = line({ voucher_type: type, voucher_no: `U-${i}`, project: rand() < 0.2 ? 'PRJ-X' : null });
    if (i % 1000 === 7) row.debit = null;
    ledger.push(row);
  }
  sources.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  ledger.sort((a, b) => a.id.localeCompare(b.id));
  const unplaced = sources.filter(source => (source.project_ids as string[]).length === 0 && source.kind === 'supplier_invoice').slice(0, 6);
  const assignments = unplaced.map((source, i) => ({ decision_id: uuid('dec00000', i), source_id: source.id, source: source.erp_name, decision: i % 3 === 1 ? 'set_aside' : 'project',
    project_id: i % 3 === 1 ? null : PROJECTS[i % 2 === 0 ? 2 : 0], procurement_id: null, assignment_origin: 'pmo_assignment', tagged_in_erp: false, erp_project_id: null, erp_tag_unmapped: false,
    placed: money(1000 + i * 250), excluded: i % 2 ? [{ account: 'Cost-9', amount: '12.50', kind: 'capital_spending' }] : [] }));
  return { binding, sources, ledger, assignments, health: { caught_up: true, ledger_currency: 'IDR', ledger_started_at: '2026-11-13T00:00:00Z', purchases_started_at: '2026-11-13T00:00:00Z' } };
}

/** Whether `purchase_capture_ledger_page(..., 'capture')` pages a line (FR-CAPV-001). */
export function captureRelevant(row: LedgerRow, company = COMPANY): boolean {
  return row.company !== company || row.project_id !== null || row.document_id !== null || PURCHASE_KINDS.has(row.kind ?? '');
}

/** The first page's `other_summary`: each left-out kind with its count and exact net total (null when any amount is missing). */
export function otherSummary(rows: readonly LedgerRow[]): OtherSummary[] {
  const groups = new Map<string, { count: number; minor: bigint; unknown: boolean }>();
  for (const row of rows) {
    if (captureRelevant(row)) continue;
    const key = row.kind ?? 'other';
    const group = groups.get(key) ?? { count: 0, minor: 0n, unknown: false };
    group.count++;
    if (row.debit === null || row.credit === null) group.unknown = true;
    else group.minor += BigInt(row.debit.replace('.', '')) - BigInt(row.credit.replace('.', ''));
    groups.set(key, group);
  }
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([kind, group]) => ({ kind, count: group.count,
    total: group.unknown ? null : money(Number(group.minor)) }));
}

/** One page of a sorted row list after a cursor, as the SQL pages return it (next_cursor is the page's last id when more rows follow). */
export function page<T extends { id: string }>(rows: readonly T[], cursor: string | null, limit: number): { items: T[]; next: string | null } {
  const start = cursor === null ? 0 : rows.findIndex(row => row.id > cursor);
  const from = start < 0 ? rows.length : start;
  const items = rows.slice(from, from + limit);
  return { items, next: from + limit < rows.length ? items[items.length - 1].id : null };
}
