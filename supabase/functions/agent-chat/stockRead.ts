/**
 * stockRead.ts (#1721) — query_stock, the ONE new read tool for warehouse stock.
 *
 * Why a tool exists at all: stock_balances and stock_ledger carry NO client SELECT grant (0413 D5 —
 * cost is read only through the rank-gated read RPCs, AC-STK-020), so the generic query_entity table
 * path cannot express "on hand by item name and warehouse name". This tool resolves item/warehouse
 * NAME fragments through the caller-JWT client (RLS decides visibility; looseClient ilike, the
 * draft_invoice precedent) and reads through the SHIPPED read RPCs get_stock_on_hand /
 * get_stock_ledger (0415) via asRpc(ctx.supabase) — the remind_overdue precedent. The RPCs are
 * SECURITY DEFINER but internally enforce org scoping (auth_org_id) + the active-member gate, and
 * they omit cost fields below Project Manager rank themselves — this module adds no privilege and
 * NEVER touches a service-role client.
 *
 * Pure like the rest of agent-chat actions: all I/O via DeputyContext (the deputy client), no Deno
 * globals, structured errors (never throws to the handler).
 */
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { QUERY_STOCK_SCHEMA } from './schema.ts';
import { asLoose, asRpc, toLikeTerm, UUID_RE, withTimeout } from './looseClient.ts';
import { isToolAllowed, notOnPlanError } from './featureSwitches.ts';

/** Wall-clock cap per name-resolution read / RPC call (mirrors actions.ts READ_TIMEOUT_MS). */
export const STOCK_READ_TIMEOUT_MS = 5000;

/** Resolution read cap: up to 10 candidate rows; 11 means "too ambiguous — refine". */
const RESOLVE_CAP = 11;
const MAX_CANDIDATES = 8;
const NAME_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StockTopic = 'on_hand' | 'movements';

export interface QueryStockInput {
  topic: StockTopic;
  item?: string;
  warehouse?: string;
  includeZero?: boolean;
  projectId?: string;
  documentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

type Validated = { ok: true; value: QueryStockInput } | { ok: false; error: string };

/** Pure input validation — no I/O. Movements-only keys are refused on topic on_hand (and vice versa). */
export function validateQueryStockInput(input: unknown): Validated {
  const i = (input ?? {}) as Record<string, unknown>;
  const allowed = ['topic', 'item', 'warehouse', 'includeZero', 'projectId', 'documentId', 'from', 'to', 'limit'];
  const unknownKey = Object.keys(i).find((k) => !allowed.includes(k));
  if (unknownKey !== undefined) return { ok: false, error: `unknown key: ${unknownKey}` };
  if (i.topic !== 'on_hand' && i.topic !== 'movements') return { ok: false, error: 'topic must be "on_hand" or "movements"' };
  const onHandOnly = ['includeZero'];
  const movementsOnly = ['projectId', 'documentId', 'from', 'to', 'limit'];
  const wrongTopic = i.topic === 'on_hand'
    ? movementsOnly.filter((k) => i[k] !== undefined)
    : onHandOnly.filter((k) => i[k] !== undefined);
  if (wrongTopic.length) return { ok: false, error: `${wrongTopic.join(', ')} ${wrongTopic.length === 1 ? 'applies' : 'apply'} only to topic "${i.topic === 'on_hand' ? 'movements' : 'on_hand'}"` };
  const out: QueryStockInput = { topic: i.topic };
  for (const key of ['item', 'warehouse'] as const) {
    const v = i[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !v.trim() || v.length > 200) return { ok: false, error: `${key} must be a short name or id` };
    out[key] = v.trim();
  }
  if (i.includeZero !== undefined) {
    if (typeof i.includeZero !== 'boolean') return { ok: false, error: 'includeZero must be a boolean' };
    out.includeZero = i.includeZero;
  }
  for (const key of ['projectId', 'documentId'] as const) {
    const v = i[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !UUID_RE.test(v)) return { ok: false, error: `${key} must be a UUID` };
    out[key] = v;
  }
  for (const key of ['from', 'to'] as const) {
    const v = i[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !NAME_RE.test(v)) return { ok: false, error: `${key} must be a YYYY-MM-DD date` };
    out[key] = v;
  }
  if (i.limit !== undefined) {
    if (typeof i.limit !== 'number' || !Number.isInteger(i.limit) || i.limit < 1 || i.limit > 200) {
      return { ok: false, error: 'limit must be an integer between 1 and 200' };
    }
    out.limit = i.limit;
  }
  return { ok: true, value: out };
}

interface ResolvedRow { id: string; code: string; name: string }
export type StockResolution =
  | { ok: true; id?: string }
  | { ok: false; error: string; candidates?: Array<{ id: string; label: string }> };

/**
 * Resolve a name fragment (or a raw UUID) to ONE id under the caller's RLS. An exact (case-
 * insensitive) name match wins; a single fuzzy match is taken; otherwise a candidates list asks the
 * model to disambiguate. A foreign-org term matches no rows (RLS) → structured error, fails closed.
 */
export async function resolveStockTerm(
  client: DeputyContext['supabase'],
  table: 'stock_items' | 'stock_warehouses',
  term: string,
  noun: string,
): Promise<StockResolution> {
  if (UUID_RE.test(term)) return { ok: true, id: term }; // the RPC scopes by org itself; a foreign id reads as no rows
  const rows = await withTimeout(
    asLoose(client).from(table).select('id, code, name').ilike('name', `%${toLikeTerm(term)}%`).limit(RESOLVE_CAP),
    STOCK_READ_TIMEOUT_MS,
  );
  const error = rows.error as { code?: string; message?: string } | null;
  if (error) return { ok: false, error: 'query_stock db error', candidates: [] };
  const matches = (Array.isArray(rows.data) ? rows.data : []) as ResolvedRow[];
  const exact = matches.find((m) => m.name.toLowerCase() === term.toLowerCase());
  if (exact) return { ok: true, id: exact.id };
  if (matches.length === 1) return { ok: true, id: matches[0].id };
  if (matches.length === 0) return { ok: false, error: `no ${noun} matches "${term}"` };
  if (matches.length >= RESOLVE_CAP) {
    return {
      ok: false,
      error: `more than ${RESOLVE_CAP - 1} ${noun}s match "${term}" — be more specific or use an id from candidates`,
      candidates: matches.slice(0, MAX_CANDIDATES).map((m) => ({ id: m.id, label: `${m.name} (${m.code})` })),
    };
  }
  return {
    ok: false,
    error: `${matches.length} ${noun}s match "${term}" — call again with the id of the right one`,
    candidates: matches.slice(0, MAX_CANDIDATES).map((m) => ({ id: m.id, label: `${m.name} (${m.code})` })),
  };
}

type QueryStockResult =
  | { rowCount: number; rows: unknown[]; next_before_seq?: number }
  | { error: string; code?: string; detail?: string; candidates?: Array<{ id: string; label: string }> };

/**
 * Execute a validated query_stock input: resolve names, call the shipped read RPC under the caller
 * JWT, return a structured result (never throws to the handler).
 */
export async function runQueryStock(input: unknown, ctx: DeputyContext): Promise<QueryStockResult> {
  // S4 (FR-PLN-008): defence in depth behind the handler's offering filter — a stock read must never
  // run for an org whose `stock` key is off, even if the model calls the tool it was not offered.
  if (!isToolAllowed('query_stock', ctx.featureSwitches)) return notOnPlanError('stock');
  const v = validateQueryStockInput(input);
  if (!v.ok) return { error: v.error };
  const inp = v.value;

  const resolve = async (key: 'item' | 'warehouse'): Promise<StockResolution> => {
    const term = inp[key];
    if (term === undefined) return { ok: true };
    return resolveStockTerm(ctx.supabase, key === 'item' ? 'stock_items' : 'stock_warehouses', term, key === 'item' ? 'stock item' : 'warehouse');
  };
  const itemRes = await resolve('item');
  if (!itemRes.ok) return { error: itemRes.error, ...(itemRes.candidates?.length ? { candidates: itemRes.candidates } : {}) };
  const whRes = await resolve('warehouse');
  if (!whRes.ok) return { error: whRes.error, ...(whRes.candidates?.length ? { candidates: whRes.candidates } : {}) };

  const rpc = asRpc(ctx.supabase);
  if (!rpc) return { error: 'query_stock is not available right now' };

  let data: unknown;
  let error: { code?: string; message?: string } | null;
  try {
    if (inp.topic === 'on_hand') {
      const res = await withTimeout(
        rpc.rpc('get_stock_on_hand', {
          p_item_id: itemRes.id,
          p_warehouse_id: whRes.id,
          p_include_zero: inp.includeZero === true,
        }),
        STOCK_READ_TIMEOUT_MS,
      );
      data = res.data;
      error = res.error as { code?: string; message?: string } | null;
    } else {
      const res = await withTimeout(
        rpc.rpc('get_stock_ledger', {
          p_item_id: itemRes.id,
          p_warehouse_id: whRes.id,
          p_project_id: inp.projectId,
          p_document_id: inp.documentId,
          p_from: inp.from,
          p_to: inp.to,
          p_limit: inp.limit,
        }),
        STOCK_READ_TIMEOUT_MS,
      );
      data = res.data;
      error = res.error as { code?: string; message?: string } | null;
    }
  } catch {
    return { error: 'query_stock read timeout' };
  }
  if (error) {
    return {
      error: 'query_stock db error',
      ...(error.code ? { code: error.code } : {}),
      ...(error.message ? { detail: error.message } : {}),
    };
  }

  if (inp.topic === 'on_hand') {
    const rows = Array.isArray(data) ? data : [];
    return { rowCount: rows.length, rows };
  }
  const ledger = (data ?? {}) as { rows?: unknown[]; next_before_seq?: number };
  const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
  return {
    rowCount: rows.length,
    rows,
    ...(typeof ledger.next_before_seq === 'number' ? { next_before_seq: ledger.next_before_seq } : {}),
  };
}

export const queryStockAction: AgentAction = {
  name: 'query_stock',
  description:
    'Read warehouse stock: on-hand quantities per item and warehouse ("what is in stock?"), or the movement ledger (what moved in/out). Pure read, RLS-scoped; item and warehouse names are resolved for you.',
  inputSchema: QUERY_STOCK_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: (input: unknown, ctx: DeputyContext) => runQueryStock(input, ctx),
};
