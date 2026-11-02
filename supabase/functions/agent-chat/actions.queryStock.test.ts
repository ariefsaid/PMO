// #1721 — the assistant can read warehouse stock. Proves three things:
//   1. The stock entities are registered in the agent read catalogue (query_entity / entityCatalog)
//      — items, warehouses, documents, document lines, reorder levels — with curated column
//      allowlists that never expose org_id (tenancy seam) and never expose unit_cost on
//      stock_document_lines (deliberately outside the client column grant, 0413).
//   2. stock_balances / stock_ledger are NOT client-granted (0413 revokes SELECT from authenticated),
//      so the generic table path cannot express "on hand by item name and warehouse name". The ONE
//      new read tool (query_stock) resolves names through the caller-JWT client (RLS decides) and
//      reads through the shipped get_stock_on_hand / get_stock_ledger RPCs — the same seam
//      remind_overdue uses (looseClient asRpc). It answers the demo question with the stock-on-hand
//      figure, never procurement ordered/received quantities.
//   3. A caller the RPCs refuse (inactive member) gets a structured error; an RLS-empty org gets
//      rowCount 0 — and the trace never falls back to procurement tables.
//
// Deno-native test (plain if/throw assertions, no network). Verify:
// deno test --config supabase/functions/agent-chat/deno.json supabase/functions/agent-chat/actions.queryStock.test.ts

import { runQueryStock, validateQueryStockInput } from './stockRead.ts';
import { AGENT_READ_ENTITIES } from './readEntities.ts';
import { resolveAgentEntity } from './entityCatalog.ts';
import { buildAgentSystemPrompt } from './prompt.ts';
import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(msg ?? `expected ${e}, got ${a}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Narrowing assert — TS keeps the non-undefined type of the returned value. */
function must<T>(value: T | undefined | null, msg: string): T {
  if (value === undefined || value === null) throw new Error(msg);
  return value;
}

const ITEM_ID = '15121000-0000-0000-0000-00000000100c';
const WAREHOUSE_ID = '15121000-0000-0000-0000-000000002001';
const ON_HAND_ROW = {
  item_id: ITEM_ID,
  item_code: 'PANEL-PV',
  item_name: 'Solar panel mounting rail',
  unit_code: 'pcs',
  warehouse_id: WAREHOUSE_ID,
  warehouse_code: 'CENTRAL',
  warehouse_name: 'Central store',
  qty_on_hand: '80',
};

interface MockOptions {
  items?: unknown[];
  warehouses?: unknown[];
  rpc?: { fn: string; data?: unknown; error?: unknown } | { fn: string; data?: unknown; error?: unknown }[];
}

/** Recording fake of the caller-JWT (deputy) client: RLS table reads + RPCs, all traced in order. */
function mockStockCtx(opts: MockOptions = {}): { ctx: DeputyContext; trace: unknown[][] } {
  const trace: unknown[][] = [];
  const supabase = {
    from(table: string) {
      trace.push(['from', table]);
      return {
        select(columns: string) {
          trace.push(['select', table, columns]);
          const builder = {
            ilike(column: string, pattern: string) {
              trace.push(['ilike', table, column, pattern]);
              return builder;
            },
            limit(n: number) {
              trace.push(['limit', table, n]);
              const rows = table === 'stock_items' ? (opts.items ?? []) : table === 'stock_warehouses' ? (opts.warehouses ?? []) : [];
              return Promise.resolve({ data: rows, error: null });
            },
          };
          return builder;
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      trace.push(['rpc', fn, args]);
      const entries = Array.isArray(opts.rpc) ? opts.rpc : opts.rpc ? [opts.rpc] : [];
      const hit = entries.find((e) => e.fn === fn);
      return Promise.resolve({ data: hit?.data ?? null, error: hit?.error ?? null });
    },
  };
  const ctx = { jwt: 'j', userId: 'u', orgId: 'o', supabase } as unknown as DeputyContext;
  return { ctx, trace };
}

function fromCalls(trace: unknown[][], table: string): unknown[][] {
  return trace.filter((c) => c[0] === 'select' && c[1] === table);
}

// ── 1. Catalogue registration (query_entity / entityCatalog) ─────────────────

Deno.test('#1721 AGENT_READ_ENTITIES registers the stock entities', () => {
  const keys: string[] = [...AGENT_READ_ENTITIES];
  for (const required of ['stock_items', 'stock_warehouses', 'stock_documents', 'stock_document_lines', 'stock_reorder_levels']) {
    assert(keys.includes(required), `AGENT_READ_ENTITIES must expose ${required}`);
  }
});

Deno.test('#1721 stock entities resolve to their real tables with curated columns; org_id never exposed', () => {
  const items = must(resolveAgentEntity('stock_items'), 'stock_items must resolve');
  assertEquals(items.table, 'stock_items');
  assert(items.allowedColumns.has('name') && items.allowedColumns.has('code') && items.allowedColumns.has('unit_id'), 'stock_items must expose name/code/unit_id');
  const warehouses = must(resolveAgentEntity('stock_warehouses'), 'stock_warehouses must resolve');
  assertEquals(warehouses.table, 'stock_warehouses');
  assert(warehouses.allowedColumns.has('name') && warehouses.allowedColumns.has('kind'), 'stock_warehouses must expose name/kind');
  for (const key of ['stock_items', 'stock_warehouses', 'stock_documents', 'stock_document_lines', 'stock_reorder_levels']) {
    const entry = must(resolveAgentEntity(key), `${key} must resolve`);
    assert(!entry.allowedColumns.has('org_id'), `${key} must never expose org_id`);
  }
});

Deno.test('#1721 stock_document_lines never exposes unit_cost (outside the client column grant, 0413 D5)', () => {
  const lines = must(resolveAgentEntity('stock_document_lines'), 'stock_document_lines must resolve');
  assert(!lines.allowedColumns.has('unit_cost'), 'unit_cost is deliberately not client-granted');
  assert(lines.allowedColumns.has('quantity') && lines.allowedColumns.has('item_id') && lines.allowedColumns.has('document_id'), 'lines must expose the quantity fields a user asks about');
});

// ── 2. query_stock — the demo question: on hand by item name × warehouse name ─

Deno.test('#1721 demo question: query_stock(on_hand) resolves names via RLS-scoped reads and answers with the on-hand figure', async () => {
  const { ctx, trace } = mockStockCtx({
    items: [{ id: ITEM_ID, code: 'PANEL-PV', name: 'Solar panel mounting rail' }],
    warehouses: [{ id: WAREHOUSE_ID, code: 'CENTRAL', name: 'Central store' }],
    rpc: { fn: 'get_stock_on_hand', data: [ON_HAND_ROW] },
  });
  const res = (await runQueryStock({ topic: 'on_hand', item: 'solar panel', warehouse: 'central' }, ctx)) as {
    rowCount: number;
    rows: Array<Record<string, unknown>>;
  };
  assertEquals(res.rowCount, 1);
  assertEquals(res.rows[0]?.qty_on_hand, '80');
  assertEquals(res.rows[0]?.warehouse_name, 'Central store');

  // Name resolution runs through the caller-JWT client (the deputy client — the ONLY client the
  // action receives), RLS decides visibility; then the shipped RPC carries the resolved UUIDs.
  const itemReads = fromCalls(trace, 'stock_items');
  assertEquals(itemReads.length, 1);
  const ilike = trace.find((c) => c[0] === 'ilike' && c[1] === 'stock_items');
  assertEquals(ilike, ['ilike', 'stock_items', 'name', '%solar panel%']);
  const whReads = fromCalls(trace, 'stock_warehouses');
  assertEquals(whReads.length, 1);
  const rpc = trace.find((c) => c[0] === 'rpc');
  assertEquals(rpc, ['rpc', 'get_stock_on_hand', { p_item_id: ITEM_ID, p_warehouse_id: WAREHOUSE_ID, p_include_zero: false }]);
  // Never procurement quantities: the demo failure answered from procurement receipts.
  assert(trace.every((c) => !String(c[1]).startsWith('procurement')), 'query_stock must never read procurement tables');
  const rpcIdx = trace.findIndex((c) => c[0] === 'rpc');
  const itemIdx = trace.findIndex((c) => c[0] === 'select' && c[1] === 'stock_items');
  assert(rpcIdx > itemIdx, 'the RPC call must follow the name-resolution reads');
});

Deno.test('#1721 an exact item name wins over fuzzy matches', async () => {
  const { ctx, trace } = mockStockCtx({
    items: [
      { id: 'i1', code: 'CEM-50', name: 'Cement 50kg' },
      { id: 'i2', code: 'CEM-W', name: 'Cement 50kg white' },
    ],
    rpc: { fn: 'get_stock_on_hand', data: [] },
  });
  await runQueryStock({ topic: 'on_hand', item: 'Cement 50kg' }, ctx);
  const rpc = must(trace.find((c) => c[0] === 'rpc'), 'expected the RPC to run');
  assertEquals((rpc[2] as Record<string, unknown>).p_item_id, 'i1');
});

Deno.test('#1721 multiple fuzzy item matches return candidates and never call the RPC', async () => {
  const { ctx, trace } = mockStockCtx({
    items: [
      { id: 'i1', code: 'CABLE-4', name: 'Cable 4mm' },
      { id: 'i2', code: 'CABLE-10', name: 'Cable 10mm' },
    ],
  });
  const res = (await runQueryStock({ topic: 'on_hand', item: 'cable' }, ctx)) as { error: string; candidates: unknown[] };
  assert(typeof res.error === 'string' && res.error.includes('cable'), 'the error must name the ambiguous term');
  assertEquals(res.candidates.length, 2);
  assert(trace.find((c) => c[0] === 'rpc') === undefined, 'no RPC on ambiguity');
});

Deno.test('#1721 no item match is a structured error naming the term, no RPC', async () => {
  const { ctx, trace } = mockStockCtx({ items: [] });
  const res = (await runQueryStock({ topic: 'on_hand', item: 'unicorn' }, ctx)) as { error: string };
  assert(res.error.includes('unicorn'), 'the error must name the unmatched term');
  assert(trace.find((c) => c[0] === 'rpc') === undefined, 'no RPC on no match');
});

Deno.test('#1721 a raw UUID item/warehouse is used as-is without a resolution read', async () => {
  const { ctx, trace } = mockStockCtx({ rpc: { fn: 'get_stock_on_hand', data: [ON_HAND_ROW] } });
  const res = (await runQueryStock({ topic: 'on_hand', item: ITEM_ID, warehouse: WAREHOUSE_ID }, ctx)) as { rowCount: number };
  assertEquals(res.rowCount, 1);
  assertEquals(trace.find((c) => c[0] === 'select'), undefined, 'no resolution read when ids are given');
  const rpc = must(trace.find((c) => c[0] === 'rpc'), 'expected the RPC') as unknown[];
  assertEquals((rpc[2] as Record<string, unknown>).p_item_id, ITEM_ID);
});

Deno.test('#1721 includeZero reaches the on-hand RPC', async () => {
  const { ctx, trace } = mockStockCtx({
    warehouses: [{ id: 'w-site-a', code: 'SITE-A', name: 'Site A store' }],
    rpc: { fn: 'get_stock_on_hand', data: [] },
  });
  await runQueryStock({ topic: 'on_hand', warehouse: 'SITE-A', includeZero: true }, ctx);
  const rpc = must(trace.find((c) => c[0] === 'rpc'), 'expected the RPC') as unknown[];
  assertEquals((rpc[2] as Record<string, unknown>).p_include_zero, true);
});

// ── movements (the ledger RPC) ───────────────────────────────────────────────

Deno.test('#1721 movements resolve names and read the ledger RPC with passthrough rows', async () => {
  const ledger = { rows: [{ seq: 3, kind: 'receive', qty_delta: '120', qty_after: '120' }], next_before_seq: 3 };
  const { ctx, trace } = mockStockCtx({
    items: [{ id: ITEM_ID, code: 'PANEL-PV', name: 'Solar panel mounting rail' }],
    warehouses: [{ id: WAREHOUSE_ID, code: 'CENTRAL', name: 'Central store' }],
    rpc: { fn: 'get_stock_ledger', data: ledger },
  });
  const res = (await runQueryStock({ topic: 'movements', item: 'solar panel', warehouse: 'central' }, ctx)) as {
    rowCount: number;
    rows: unknown[];
    next_before_seq?: number;
  };
  assertEquals(res.rowCount, 1);
  assertEquals(res.rows.length, 1);
  assertEquals(res.next_before_seq, 3);
  const rpc = must(trace.find((c) => c[0] === 'rpc'), 'expected the ledger RPC') as unknown[];
  assertEquals(
    rpc[2],
    { p_item_id: ITEM_ID, p_warehouse_id: WAREHOUSE_ID, p_project_id: undefined, p_document_id: undefined, p_from: undefined, p_to: undefined, p_limit: undefined },
  );
});

Deno.test('#1721 movements-only params are refused on topic on_hand before any client call', async () => {
  const { ctx, trace } = mockStockCtx({});
  const res = (await runQueryStock({ topic: 'on_hand', projectId: '40000000-0000-0000-0000-000000000001' }, ctx)) as { error: string };
  assert(typeof res.error === 'string', 'expected a validation error');
  assertEquals(trace.length, 0, 'no client call on a validation error');
});

Deno.test('#1721 a non-UUID projectId is refused before any client call', async () => {
  const { ctx, trace } = mockStockCtx({});
  const res = (await runQueryStock({ topic: 'movements', projectId: 'not-a-uuid' }, ctx)) as { error: string };
  assert(typeof res.error === 'string', 'expected a validation error');
  assertEquals(trace.length, 0, 'no client call on a validation error');
});

Deno.test('#1721 validateQueryStockInput rejects unknown topics and unknown keys', () => {
  assert(!validateQueryStockInput({ topic: 'write' }).ok, 'unknown topic refused');
  assert(!validateQueryStockInput({ topic: 'on_hand', steal: true }).ok, 'unknown key refused');
  assert(!validateQueryStockInput({}).ok, 'missing topic refused');
  assert(validateQueryStockInput({ topic: 'on_hand' }).ok, 'bare on_hand is valid');
  assert(validateQueryStockInput({ topic: 'movements', limit: 200, from: '2026-01-01', to: '2026-01-31' }).ok, 'movements params valid');
});

// ── 3. RLS / role ceiling ────────────────────────────────────────────────────

Deno.test('#1721 a caller the RPC refuses (inactive member, 42501) gets a structured error, not fabricated data', async () => {
  const { ctx } = mockStockCtx({
    items: [{ id: ITEM_ID, code: 'PANEL-PV', name: 'Solar panel mounting rail' }],
    rpc: {
      fn: 'get_stock_on_hand',
      error: { code: '42501', message: 'your account is not an active member of this organisation' },
    },
  });
  const res = (await runQueryStock({ topic: 'on_hand', item: 'solar panel' }, ctx)) as { error: string; code?: string; detail?: string };
  assert(typeof res.error === 'string', 'expected a structured error');
  assertEquals(res.code, '42501');
  assert((res.detail ?? '').includes('not an active member'), 'the RPC refusal detail is surfaced');
});

Deno.test('#1721 an RLS-empty read answers rowCount 0 — never a procurement-quantity fallback', async () => {
  const { ctx, trace } = mockStockCtx({
    items: [{ id: ITEM_ID, code: 'PANEL-PV', name: 'Solar panel mounting rail' }],
    warehouses: [{ id: WAREHOUSE_ID, code: 'CENTRAL', name: 'Central store' }],
    rpc: { fn: 'get_stock_on_hand', data: [] },
  });
  const res = (await runQueryStock({ topic: 'on_hand', item: 'solar panel', warehouse: 'central' }, ctx)) as { rowCount: number };
  assertEquals(res.rowCount, 0);
  assert(trace.every((c) => !String(c[1]).startsWith('procurement')), 'no procurement fallback');
});

// ── prompt/charter (ADR-0050: one index line + one skill + map lines) ────────

Deno.test('#1721 the system prompt knows stock exists: tool index line, Use-when skill, map lines, entity bullets', () => {
  const p = buildAgentSystemPrompt(AGENT_READ_ENTITIES, 50);
  assert(p.includes('query_stock'), 'the tool index must register query_stock');
  assert(/stock[^]*?Use when[^]*?(on hand|gudang|warehouse)/i.test(p), 'a Use-when skill must trigger on stock/on hand/gudang/warehouse questions');
  assert(/never[^]*?(ordered|received)[^]*?on hand|on hand[^]*?never[^]*?(ordered|received)/i.test(p), 'the prompt must forbid answering on-hand from procurement quantities');
  assert(p.includes('  - stock_items\n    - table: stock_items'), 'stock_items must appear as a query_entity entity bullet');
  assert(p.includes('  - stock_warehouses\n    - table: stock_warehouses'), 'stock_warehouses must appear as a query_entity entity bullet');
});
