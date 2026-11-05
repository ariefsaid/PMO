/** FR-EPR-004/006/007, FR-PFE-020/031/032/041 — the client read hides cancelled and PMO-pushed documents, scopes to a project,
 *  maps rows (incl. link state); link/unlink go only through the RPCs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'contains', 'order', 'gt', 'limit']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, args]); return chain; };
  }
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  /**
   * AC-D32-02 switch: when set, `from` returns a TABLE-backed builder (filters/cursor/limit applied
   * before resolving) instead of the fixed-result chain above — the only way to prove a COMPLETE read,
   * because a fixed-result fake answers every page identically and can never expose a truncated one.
   */
  let tableFactory: ((table: string) => unknown) | null = null;
  return {
    calls,
    from: vi.fn((table: string) => { calls.push(['from', [table]]); return tableFactory ? tableFactory(table) : chain; }),
    set: (r: typeof result) => { result = r; },
    useTable: (factory: ((table: string) => unknown) | null) => { tableFactory = factory; },
    rpc: vi.fn(),
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  erpPurchasesRepository, hasErpPurchases, linkErpPurchaseDocuments, listErpOrphans, listErpPurchases, listLinkedErpDocuments, unlinkErpPurchaseDocument,
} from './erpPurchases';

const db = (over: Record<string, unknown>) => ({
  id: 'a', erp_doctype: 'Purchase Invoice', erp_name: 'PINV-A', supplier: 'SUP-1', supplier_name: null, doc_date: '2026-01-01',
  due_date: null, bill_no: null, currency: 'IDR', grand_total: '100.00', outstanding_amount: '0.00', erp_status: 'Paid',
  is_return: false, project_ids: ['p1'], net_total: '90.00', procurement_id: null, link_id: null, ...over,
});

beforeEach(() => { h.calls.length = 0; h.useTable(null); h.set({ data: [], error: null }); h.rpc.mockReset(); });

describe('erpPurchases repository — AC-OPP-072 Odoo-native documents (#1505 P7)', () => {
  it('lists an Odoo-native bill like any ERP document: tier-blind, only issued and not PMO-pushed, tombstoned (docstatus 2) and PMO-owned rows are never requested', async () => {
    h.set({ data: [db({ id: 'o1', erp_name: 'BILL/2026/0021', erp_doctype: 'Purchase Invoice', supplier: '41', supplier_name: 'Vendor V', bill_no: 'INV-21', grand_total: '300.00', outstanding_amount: '0.00', erp_status: 'Paid' })], error: null });
    const rows = await listErpPurchases('p1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'BILL/2026/0021', supplier: 'Vendor V', billNo: 'INV-21', grandTotal: 300, outstanding: 0, erpStatus: 'Paid', procurementId: null });
    expect(h.calls).toContainEqual(['eq', ['erp_docstatus', 1]]);
    expect(h.calls).toContainEqual(['eq', ['pmo_owned', false]]);
    const selected = (h.calls.find(([m]) => m === 'select')![1] as string[])[0];
    expect(selected).not.toMatch(/external_ref|erp_state|adoption/);   // the seam above the adapter never sees Odoo's identity
  });

  it('a bill linked to a purchase is returned once, with the purchase it counts toward', async () => {
    h.set({ data: [db({ id: 'o1', erp_name: 'BILL/2026/0021', procurement_id: 'pur-9', link_id: 'l-9' })], error: null });
    const rows = await listLinkedErpDocuments('pur-9');
    expect(h.calls).toContainEqual(['eq', ['procurement_id', 'pur-9']]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ procurementId: 'pur-9', linkId: 'l-9' });
  });
});

describe('erpPurchases repository', () => {
  it('reads only submitted, ERP-native documents of the project, newest first, with numeric money', async () => {
    h.set({ data: [db({}), db({ id: 'b', erp_name: 'PINV-B', doc_date: '2026-03-01', supplier_name: 'Beta' })], error: null });
    const rows = await listErpPurchases('p1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents_linked']]);
    expect(h.calls).toContainEqual(['eq', ['erp_docstatus', 1]]);
    expect(h.calls).toContainEqual(['eq', ['pmo_owned', false]]);
    expect(h.calls).toContainEqual(['contains', ['project_ids', ['p1']]]);
    expect(rows.map((r) => r.name)).toEqual(['PINV-B', 'PINV-A']);
    expect(rows[0].supplier).toBe('Beta');
    expect(rows[1]).toMatchObject({ supplier: 'SUP-1', grandTotal: 100, outstanding: 0 });
  });

  it('org-wide read has no project filter; errors surface', async () => {
    await listErpPurchases();
    expect(h.calls.some(([m]) => m === 'contains')).toBe(false);
    h.set({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listErpPurchases()).rejects.toThrow('denied');
  });

  it('AC-PFE-006: list reads the linked view and exposes procurementId, linkId and netTotal', async () => {
    h.set({ data: [db({ procurement_id: 'pur-1', link_id: 'l-1' }), db({ id: 'b', erp_name: 'PINV-B', net_total: null })], error: null });
    const rows = await listErpPurchases('p1');
    expect(rows.find((r) => r.name === 'PINV-A')).toMatchObject({ procurementId: 'pur-1', linkId: 'l-1', netTotal: 90 });
    expect(rows.find((r) => r.name === 'PINV-B')).toMatchObject({ procurementId: null, linkId: null, netTotal: null });
  });

  it('maps the two new ERP document types (receipt, payment) unchanged', async () => {
    h.set({ data: [db({ erp_doctype: 'Purchase Receipt' }), db({ id: 'b', erp_name: 'ACC-PAY-1', erp_doctype: 'Payment Entry' })], error: null });
    const rows = await listErpPurchases();
    expect(rows.map((r) => r.doctype).sort()).toEqual(['Payment Entry', 'Purchase Receipt']);
  });

  it('FR-PFE-032: listLinkedErpDocuments reads one purchase\'s documents; errors surface', async () => {
    h.set({ data: [db({ procurement_id: 'pur-1', link_id: 'l-1' })], error: null });
    const rows = await listLinkedErpDocuments('pur-1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents_linked']]);
    expect(h.calls).toContainEqual(['eq', ['procurement_id', 'pur-1']]);
    expect(rows[0]).toMatchObject({ name: 'PINV-A', linkId: 'l-1' });
    h.set({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listLinkedErpDocuments('pur-1')).rejects.toThrow('denied');
  });

  it('AC-PFE-004: linkErpPurchaseDocuments calls the RPC with rows and the dry-run flag', async () => {
    h.rpc.mockResolvedValueOnce({ data: { dry_run: true, counts: { link: 1, skip: 0, refused: 0 }, results: [] }, error: null });
    const res = await linkErpPurchaseDocuments([{ erp_name: 'PINV-1', project_id: 'p1' }], true);
    expect(h.rpc).toHaveBeenCalledWith('link_erp_purchase_documents', { p_rows: [{ erp_name: 'PINV-1', project_id: 'p1' }], p_dry_run: true });
    expect(res.counts.link).toBe(1);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not allowed', code: '42501' } });
    await expect(linkErpPurchaseDocuments([{ erp_name: 'PINV-1' }])).rejects.toThrow('not allowed');
  });

  it('FR-PFE-031: unlinkErpPurchaseDocument calls the RPC; errors surface', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await unlinkErpPurchaseDocument('l-1');
    expect(h.rpc).toHaveBeenCalledWith('unlink_erp_purchase_document', { p_link_id: 'l-1' });
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Only Admin or Finance', code: '42501' } });
    await expect(unlinkErpPurchaseDocument('l-1')).rejects.toThrow('Only Admin or Finance');
  });

  it('hasErpPurchases reads the orphans view and is true only when an orphan exists', async () => {
    expect(await hasErpPurchases()).toBe(false);
    expect(h.calls).toContainEqual(['from', ['erp_purchase_orphans']]);
    h.set({ data: [{ id: 'x' }], error: null });
    expect(await hasErpPurchases()).toBe(true);
  });

  it('listErpOrphans reads the default orphan view (set-aside left out), scoped to a project, with money as numbers', async () => {
    h.set({ data: [db({ procurement_id: undefined, link_id: undefined })], error: null });
    const rows = await listErpOrphans('p1');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_orphans']]);
    expect(h.calls).not.toContainEqual(['from', ['erp_purchase_documents_linked']]);
    expect(h.calls).toContainEqual(['contains', ['project_ids', ['p1']]]);
    expect(rows[0]).toMatchObject({ name: 'PINV-A', procurementId: null, linkId: null, grandTotal: 100 });
  });
});

describe('erpPurchasesRepository (ADR-0017 seam)', () => {
  it('list / listOrphans / listLinked scope the underlying reads and map rows', async () => {
    h.set({ data: [db({})], error: null });
    expect((await erpPurchasesRepository.list('p1'))[0].name).toBe('PINV-A');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_documents_linked']]);
    h.calls.length = 0;
    expect((await erpPurchasesRepository.listOrphans('p1'))[0].name).toBe('PINV-A');
    expect(h.calls).toContainEqual(['from', ['erp_purchase_orphans']]);
    h.calls.length = 0;
    expect((await erpPurchasesRepository.listLinked('pur-1'))[0].name).toBe('PINV-A');
    expect(h.calls).toContainEqual(['eq', ['procurement_id', 'pur-1']]);
  });

  it('hasAny is true only when an orphan exists', async () => {
    h.set({ data: [{ id: 'a' }], error: null });
    expect(await erpPurchasesRepository.hasAny()).toBe(true);
    h.set({ data: [], error: null });
    expect(await erpPurchasesRepository.hasAny()).toBe(false);
  });

  it('link defaults dryRun to false and passes an explicit true; unlink sends the link id', async () => {
    h.rpc.mockResolvedValue({ data: { dry_run: false, counts: { link: 1, skip: 0, refused: 0 }, results: [] }, error: null });
    await erpPurchasesRepository.link([{ erp_name: 'PINV-A' }]);
    expect(h.rpc).toHaveBeenLastCalledWith('link_erp_purchase_documents', { p_rows: [{ erp_name: 'PINV-A' }], p_dry_run: false });
    await erpPurchasesRepository.link([{ erp_name: 'PINV-A' }], true);
    expect(h.rpc).toHaveBeenLastCalledWith('link_erp_purchase_documents', { p_rows: [{ erp_name: 'PINV-A' }], p_dry_run: true });
    h.rpc.mockResolvedValue({ error: null });
    await erpPurchasesRepository.unlink('l-1');
    expect(h.rpc).toHaveBeenLastCalledWith('unlink_erp_purchase_document', { p_link_id: 'l-1' });
  });

  it('a read error surfaces as an AppError keeping the code', async () => {
    h.set({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(erpPurchasesRepository.hasAny()).rejects.toMatchObject({ message: 'denied', code: '42501' });
  });
});

/**
 * ⚑ AC-D32-02 (DATA32) — A TABLE-BACKED, POSTGREST-FAITHFUL FAKE FOR THE LINKED-DOCUMENT LIST.
 *
 * The shared chain above answers every page with the SAME fixed result, so it can never show that a
 * read truncates: the real server caps a response at `max_rows` (1,000 here) and signals nothing. This
 * fake keeps the rows as a table and applies `.eq` filters, `.order('id')`, the keyset cursor `.gt` and
 * `.limit(n)` BEFORE resolving — so a one-shot read sees one capped page and only a paged read sees all.
 */
const LINKED_TABLE = 'erp_purchase_documents_linked';
const LINKED_MAX_ROWS = 1000; // supabase/config.toml `max_rows` — pinned by src/lib/pagedRead.config.test.ts
const LINKED_PURCHASE = 'pur-target';
const OTHER_PURCHASE = 'pur-other';
type LinkedDbRow = Record<string, unknown> & { id: string };

function makeLinkedTableFake(
  rows: LinkedDbRow[],
  opts: { failAtCursor?: string; error?: { message: string; code?: string } } = {},
) {
  /** One entry per request actually issued — what proves the loop ran, the filter held, where it resumed. */
  const requests: Array<{
    table: string; columns: string | null; filters: Record<string, unknown>;
    orderBy: string | null; afterId: string | null; limit: number | null;
  }> = [];
  h.useTable((table: string) => {
    let columns: string | null = null;
    let orderBy: string | null = null;
    let afterId: string | null = null;
    let requested: number | null = null; // an unpaged read asks for "everything" and is capped
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};
    builder.select = (cols: string) => { columns = cols; return builder; };
    builder.eq = (column: string, value: unknown) => { filters[column] = value; return builder; };
    builder.contains = () => builder;
    builder.order = (column: string) => { orderBy = column; return builder; };
    builder.gt = (_column: string, value: string) => { afterId = value; return builder; };
    builder.limit = (n: number) => { requested = n; return builder; };
    builder.then = (resolve: (v: { data: unknown; error: unknown }) => void, reject?: (e: unknown) => void) => {
      requests.push({ table, columns, filters: { ...filters }, orderBy, afterId, limit: requested });
      if (opts.error && afterId !== null && afterId === opts.failAtCursor) {
        return Promise.resolve({ data: null, error: opts.error }).then(resolve, reject);
      }
      const matching = rows
        .filter((row) => Object.entries(filters).every(([column, value]) => row[column] === value))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // `.order('id', { ascending: true })`
      const start = afterId === null ? 0 : matching.findIndex((row) => row.id === afterId) + 1;
      const size = Math.min(requested ?? LINKED_MAX_ROWS, LINKED_MAX_ROWS);
      return Promise.resolve({ data: matching.slice(start, start + size), error: null }).then(resolve, reject);
    };
    return builder;
  });
  return requests;
}

const linkedUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dayIso = (offset: number) => new Date(Date.UTC(2026, 5, 30) - offset * 86_400_000).toISOString().slice(0, 10);
/** Within one document date: names ascending, and the FIRST name deliberately twice (the id tie-break). */
const NAME_RUN = ['A-BILL', 'A-BILL', 'B-BILL', 'C-BILL', 'D-BILL', 'E-BILL', 'Z-BILL'];

/**
 * `targetCount` documents of `LINKED_PURCHASE`, generated in the EXPECTED presentation order — doc date
 * descending, then name ascending, then the tie pair by id — plus documents of ANOTHER purchase
 * interleaved into the id space so an ignored `.eq('procurement_id', …)` is visible. Ids are handed out
 * in the OPPOSITE group order, so echoing key order cannot pass by accident.
 */
function linkedFixture(targetCount: number) {
  const groups: LinkedDbRow[][] = [];
  const fullDates = Math.floor(targetCount / NAME_RUN.length);
  const remainder = targetCount % NAME_RUN.length;
  const targetGroup = (date: string, names: string[]) => names.map((name, i) => db({
    id: '',
    erp_name: name,
    doc_date: date,
    due_date: i % 2 === 0 ? null : date,
    bill_no: i === 0 ? null : `BILL-${date}-${i}`,
    supplier: `SUP-${i}`,
    supplier_name: i === 0 ? null : `Vendor ${i}`,
    grand_total: `${(i + 1) * 10}.50`,
    net_total: `${(i + 1) * 10}.00`,
    outstanding_amount: i % 2 === 0 ? null : '0.00',
    procurement_id: LINKED_PURCHASE,
    link_id: `link-${date}-${i}`,
  }));
  for (let d = 0; d < fullDates; d++) groups.push(targetGroup(dayIso(d), NAME_RUN));
  if (remainder > 0) groups.push(targetGroup(dayIso(fullDates), NAME_RUN.slice(0, remainder)));

  const otherGroups: LinkedDbRow[][] = [0, 1, 2, 3, 4].map((i) => [db({
    id: '', erp_name: `OTHER-${i}`, doc_date: dayIso(i), procurement_id: OTHER_PURCHASE, link_id: `other-${i}`,
  })]);
  const interleaved: Array<{ rows: LinkedDbRow[]; target: boolean }> = [];
  groups.forEach((group, index) => {
    interleaved.push({ rows: group, target: true });
    if (index % 29 === 0) {
      const other = otherGroups.shift();
      if (other) interleaved.push({ rows: other, target: false });
    }
  });

  const table: LinkedDbRow[] = [];
  const expected: LinkedDbRow[] = [];
  let next = 0;
  for (let g = interleaved.length - 1; g >= 0; g--) {
    const { rows: group, target } = interleaved[g]!;
    const withIds = group.map((row) => ({ ...row, id: linkedUuid(next++) }));
    table.push(...withIds);
    if (target) expected.unshift(...withIds);
  }
  return { table, expected };
}

const sortedIds = (rows: LinkedDbRow[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((r) => r.id);

describe('listLinkedErpDocuments complete read (AC-D32-02, DATA32)', () => {
  /**
   * The shipped one-shot `.eq('procurement_id', …)` read is silently capped: past 1,000 visible linked
   * documents the purchase detail showed a SHORT list with no error. The oracle is the set, its order
   * and its mapping — not the loop.
   */
  it('reads every document of the purchase exactly once past the 1,000-row cap, other purchases excluded', async () => {
    const { table, expected } = linkedFixture(1001);
    const requests = makeLinkedTableFake(table);
    expect(expected).toHaveLength(1001);

    const rows = await listLinkedErpDocuments(LINKED_PURCHASE);

    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(rows).toHaveLength(1001);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1001);
    expect(rows.every((r) => r.procurementId === LINKED_PURCHASE)).toBe(true);
    expect(rows.some((r) => r.name.startsWith('OTHER-'))).toBe(false);

    // Every mapped field, on the newest document: absent supplier_name falls back to supplier, numeric
    // strings become numbers (a NULL outstanding stays null), and the link refs are preserved.
    expect(rows[0]).toMatchObject({
      id: expected[0]!.id,
      doctype: 'Purchase Invoice',
      name: 'A-BILL',
      supplier: 'SUP-0',
      docDate: dayIso(0),
      dueDate: null,
      billNo: null,
      currency: 'IDR',
      grandTotal: 10.5,
      netTotal: 10,
      outstanding: null,
      erpStatus: 'Paid',
      isReturn: false,
      projectIds: ['p1'],
      procurementId: LINKED_PURCHASE,
      linkId: `link-${dayIso(0)}-0`,
    });
    expect(rows[1]).toMatchObject({
      supplier: 'Vendor 1',
      grandTotal: 20.5,
      netTotal: 20,
      outstanding: 0,
      billNo: `BILL-${dayIso(0)}-1`,
      linkId: `link-${dayIso(0)}-1`,
    });
    // Equal date AND equal name is decided by id ascending — never left to whatever order arrived.
    expect(rows[0]!.name).toBe(rows[1]!.name);
    expect(rows[0]!.docDate).toBe(rows[1]!.docDate);
    expect(rows[0]!.id < rows[1]!.id).toBe(true);
    // Two pages, keyset: the second resumes AFTER the last row of the first, filter intact.
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ table: LINKED_TABLE, filters: { procurement_id: LINKED_PURCHASE }, orderBy: 'id', afterId: null, limit: 1000 });
    expect(requests[0]!.columns).toContain('id, erp_doctype, erp_name');
    expect(requests[0]!.columns).toContain('procurement_id, link_id');
    expect(requests[1]).toMatchObject({ filters: { procurement_id: LINKED_PURCHASE }, afterId: sortedIds(expected)[999] });
  });

  it('resolves [] for a purchase with no linked document', async () => {
    makeLinkedTableFake([]);
    await expect(listLinkedErpDocuments(LINKED_PURCHASE)).resolves.toEqual([]);
  });

  it('reads exactly 1,000 linked rows in full, then confirms completeness with one extra empty page', async () => {
    const { table, expected } = linkedFixture(1000);
    const requests = makeLinkedTableFake(table);
    expect(expected).toHaveLength(1000);

    const rows = await listLinkedErpDocuments(LINKED_PURCHASE);

    expect(rows.map((r) => r.id)).toEqual(expected.map((r) => r.id));
    expect(requests).toHaveLength(2);
    expect(requests[1]!.afterId).toBe(sortedIds(expected)[999]);
  });

  it('a later page failing rejects with the server code — never a partial list', async () => {
    const { table, expected } = linkedFixture(1001);
    makeLinkedTableFake(table, {
      failAtCursor: sortedIds(expected)[999],
      error: { message: 'upstream request timeout', code: '57014' },
    });

    await expect(listLinkedErpDocuments(LINKED_PURCHASE)).rejects.toMatchObject({
      message: 'upstream request timeout',
      code: '57014',
    });
  });
});
