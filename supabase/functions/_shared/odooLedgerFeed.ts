/** One Odoo ledger feed pass for a verified org binding (#1507 S3, FR-ODA-001..009, 053): lines in, attribution rows out, then the tier-neutral actuals refresh. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import type { DirectoryRow } from '../../../pmo-portal/src/lib/adapterSeam/odoo/kinds.ts';
import { fiscalYearOf, type FiscalYearEnd } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/fiscalYear.ts';
import { LEDGER_FEED_SPEC, ledgerFeedReaders } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/feed.ts';
import { fanOutLine, type LedgerLine, type ProjectAccounts } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/ledgerLineRows.ts';
import { refreshActuals } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts';
import { ODOO_WORKFLOWS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/workflowDeclarations.ts';
import { fetchAllRowsByKeyset } from '../../../pmo-portal/src/lib/pagedRead.ts';
import { overlapStart, parseCursor, runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';
import { compareTotals, type OdooTotals, type PmoLine } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/ledgerReconcile.ts';
import { formatCents, nanoToCents, toNano } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/cents.ts';
import { OdooError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import {
  JOURNAL_ENTRY_OF_MOVE, readPickings, STOCK_COST_FEED_SPEC, stockCostDomain, stockCostFeedReaders, type StockCostAttrs,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostFeed.ts';
import { resolveStockCostAccounts, StockCostAccountHold } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/stockCostAccount.ts';
import { compareStockCost, findDoubleCounts, type StockCostLine } from '../../../pmo-portal/src/lib/adapterSeam/odoo/ledger/ledgerReconcile.ts';

type Budget = { spend: () => boolean; left: () => boolean };
export interface LedgerPassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }
/** Counts only. `stalled: 'account'` = the feed is held at a page with `held` lines on accounts the directory has not mirrored (never "caught up");
 *  `calendarYear` = the company year end was refused, so this pass stamped calendar years (OQ-ODA-3);
 *  `failed` = the pass hit an Odoo failure (error class only) and retries next tick. */
export interface LedgerPassResult {
  rows: number; caughtUp: boolean; skipped: number; stalled?: 'account'; held?: number; calendarYear?: true; failed?: string; check?: 'matches' | 'differs' | 'not-checked';
  /** #2282: the issued-material kind (only for an org whose inventory Odoo owns). `stockFailed`: it hit an error and retries next tick; the GL result stands. */
  stockRows?: number; stockCaughtUp?: boolean; heldProducts?: string[]; stockCheck?: 'matches' | 'differs' | 'not-checked'; stockFailed?: true;
}

// 500 lines a page keeps one apply call small; the bed reads 1,000 a page in p95 0.85 s (V-ODA7), so this has room to grow.
const LEDGER_PAGE_SIZE = 500;
// 5,000 ids a call is 90 ms on the bed (V-ODA7): a 130,000-line census is 26 calls, inside one tick.
const LEDGER_CENSUS_PAGE_SIZE = 5_000;
const DOMAIN = 'ledger:odoo';
// Which project↔analytic links the stored lines were attributed with; a change rewinds the feed (the upserts are idempotent).
const LINKS_DOMAIN = 'ledger-links:odoo';
// Whether the last finished pass left the feed caught up; its updated_at is that pass's time, so a quiet Odoo still reads fresh (get_odoo_ledger_health).
const CAUGHT_UP_DOMAIN = 'ledger-caught-up:odoo';
const PUBLISHED_DOMAIN = 'ledger-published:odoo';
// #2282: the issued-material cost kind's own cursor (apply_odoo_stock_cost_page writes it).
const STOCK_DOMAIN = 'ledger-stock-cost:odoo';
// The reconciliation against Odoo's grouped totals runs at most hourly (S4-T4); a result keeps its 50 largest-account differences.
const CHECK_EVERY_MS = 3_600_000;
const MAX_DIFFERENCES = 50;
// A refused or missing company year end is permanent (calendar year, OQ-ODA-3); a timeout, outage or server error is retried next tick.
const FY_UNREADABLE = new Set(['access-denied', 'missing-model', 'validation']);

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/**
 * The org's activated Odoo binding reads its ledger: the shipped `actuals.read` declaration, an activated binding and a capability
 * snapshot that found `account.move.line` readable. Until an Admin switches the org to ledger basis (OQ-ODA-2, `config.ledger_basis_at`, S6)
 * the feed only fills the mirror: it publishes no project actuals.
 * An unreadable binding is "not employed this tick", never a failed tick.
 */
export async function ledgerFeedEmployed(sc: SupabaseClient, orgId: string): Promise<boolean> {
  if (ODOO_WORKFLOWS['actuals.read']?.status !== 'supported') return false;
  const { data, error } = await sc.from('external_org_bindings').select('status,activated_at,config')
    .eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error) { console.error('could not read the Odoo binding for the ledger feed'); return false; }
  const b = data as { status?: string; activated_at?: string | null; config?: { capabilities?: { later?: Record<string, boolean> } } } | undefined;
  return b?.status === 'active' && !!b.activated_at && b.config?.capabilities?.later?.['account.move.line'] === true;
}

/** The Admin's explicit switch to ledger basis (S6 writes `config.ledger_basis_at`). Until then the feed fills the mirror and publishes nothing. */
async function ledgerBasisSwitchedAt(sc: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await sc.from('external_org_bindings').select('config').eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error) throw new Error('could not read the Odoo binding for the ledger feed');
  return (data as { config?: { ledger_basis_at?: string | null } } | null)?.config?.ledger_basis_at || null;
}

/** When the actuals snapshot was last published for the ledger basis (a marker, so an empty snapshot still counts as published). */
async function publishedAt(sc: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await sc.from('external_sync_watermarks').select('updated_at')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', PUBLISHED_DOMAIN).maybeSingle();
  if (error) throw new Error('could not read the Odoo ledger publish marker');
  return (data as { updated_at?: string } | null)?.updated_at ?? null;
}

async function firstPublishDue(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const at = await ledgerBasisSwitchedAt(sc, orgId);
  if (!at) return false;
  const done = await publishedAt(sc, orgId);
  return !done || Date.parse(done) < Date.parse(at);
}

async function readCursor(sc: SupabaseClient, orgId: string, domain = DOMAIN): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', domain).maybeSingle();
  if (error) throw new Error('could not read the Odoo ledger cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

/** The stored link fingerprint's timestamp marks when the ledger cursor was rewound for a new attribution map. */
async function linkFingerprintUpdatedAt(sc: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await sc.from('external_sync_watermarks').select('updated_at')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', LINKS_DOMAIN).maybeSingle();
  if (error) throw new Error('could not read the Odoo ledger link fingerprint');
  return (data as { updated_at?: string } | null)?.updated_at ?? null;
}

/** The company's year end (`fiscalyear_last_month` is a string on v20, V-ODA4); refused, unset or malformed means the calendar year (OQ-ODA-3).
 *  A transient failure (timeout, outage) throws instead, so a hiccup never stamps a whole page with the wrong year. */
async function fiscalYearEnd(call: OdooCall, companyId: number): Promise<{ fy: FiscalYearEnd | null; calendarYear: boolean }> {
  let c: Record<string, unknown> | undefined;
  try {
    [c] = await call<Array<Record<string, unknown>>>('res.company', 'read', { ids: [companyId], fields: ['fiscalyear_last_month', 'fiscalyear_last_day'] });
  } catch (err) {
    if (err instanceof OdooError && FY_UNREADABLE.has(err.errorClass)) return { fy: null, calendarYear: true };
    throw err;
  }
  const month = Number(c?.fiscalyear_last_month), day = Number(c?.fiscalyear_last_day);
  return { fy: Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31 ? { month, day } : null, calendarYear: false };
}

/** Linked project accounts, read once per pass: analytic account id → the PMO projects that link it, and the refresh's `{ pmoProjectId: analyticId }`. */
async function projectLinks(sc: SupabaseClient, orgId: string): Promise<{ accounts: Map<string, string[]>; projectMap: Record<string, string> }> {
  const rows = await fetchAllRowsByKeyset<{ id: string; project_id: string; external_container_id: string }>((after, limit) => {
    const q = sc.from('external_project_bindings').select('id,project_id,external_container_id').eq('org_id', orgId).eq('external_tier', 'odoo').order('id');
    return (after === null ? q : q.gt('id', after)).limit(limit) as never;
  });
  const accounts = new Map<string, string[]>();
  const projectMap: Record<string, string> = {};
  for (const r of rows) {
    accounts.set(r.external_container_id, [...(accounts.get(r.external_container_id) ?? []), r.project_id]);
    projectMap[r.project_id] = r.external_container_id;
  }
  return { accounts, projectMap };
}

/** A late link (or relink) leaves lines already stored unattributed: when the link set differs from the one the stored lines were attributed with,
 *  rewind this org's cursor so the next reads re-fan every line. The fingerprint is saved after the rewind, so a failure between them just repeats it. */
async function rewindOnLinkChange(sc: SupabaseClient, orgId: string, accounts: Map<string, string[]>): Promise<void> {
  const canonical = [...accounts].map(([a, ps]) => `${a}:${[...ps].sort().join(',')}`).sort().join(';');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const fingerprint = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (await readCursor(sc, orgId, LINKS_DOMAIN) === fingerprint) return;
  const del = await sc.from('external_sync_watermarks').delete().eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', DOMAIN);
  if (del.error) throw new Error('could not rewind the Odoo ledger cursor');
  const { error } = await sc.from('external_sync_watermarks').upsert(
    { org_id: orgId, external_tier: 'odoo', domain: LINKS_DOMAIN, watermark_cursor: fingerprint, updated_at: new Date().toISOString() }, { onConflict: 'org_id,external_tier,domain' });
  if (error) throw new Error('could not save the Odoo ledger link fingerprint');
}

/** Odoo account id → account code, from the directory mirror (the account kind runs earlier in the tick). */
async function accountCodes(sc: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const rows = await fetchAllRowsByKeyset<{ id: string; external_id: string; code: string | null }>((after, limit) => {
    const q = sc.from('external_master_records').select('id,external_id,code').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'account').order('id');
    return (after === null ? q : q.gt('id', after)).limit(limit) as never;
  });
  return new Map(rows.flatMap((r) => (r.code ? [[r.external_id, r.code] as const] : [])));
}

/** A page holding lines on accounts the directory has not mirrored: nothing of it is written and the cursor stays (a skipped line would never return). */
class AccountHold extends Error {
  constructor(readonly held: number) { super('ledger line on an account the directory has not mirrored'); }
}

/** Only called for a row whose account is mirrored (`apply` holds the page otherwise). */
function toLine(r: DirectoryRow, codes: Map<string, string>): LedgerLine {
  const a = r.attrs as Record<string, unknown>;
  return {
    id: Number(r.external_id), moveName: r.name ?? '', journal: (a.journal as string | null) ?? null, date: String(a.date), account: codes.get(String(a.account_id))!,
    partner: (a.partner as string | null) ?? null, debit: String(a.debit), credit: String(a.credit), parentState: String(a.parent_state),
    distribution: (a.analytic_distribution as LedgerLine['distribution']) ?? null, foreignCurrency: a.foreign_currency === true, writeDate: r.source_write_date ?? '',
  };
}

/** Odoo's per-account totals of posted lines written up to the cut-off (V-ODA5: `formatted_read_group`; `read_group` is refused). A failure is "not checked", never an error. */
async function odooTotals(call: OdooCall, companyId: number, cutoff: string, codes: Map<string, string>): Promise<OdooTotals> {
  try {
    const groups = await call<Array<Record<string, unknown>>>('account.move.line', 'formatted_read_group', {
      domain: [['company_id', '=', companyId], ['parent_state', '=', 'posted'], ['write_date', '<=', cutoff]], groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'],
    });
    const money = (v: unknown): string => {
      const n = typeof v === 'number' ? toNano(v) : null;
      if (n === null) throw new Error('malformed group');
      return formatCents(nanoToCents(n));
    };
    const totals: Record<string, { debit: string; credit: string }> = {};
    for (const g of groups) {
      const a = g.account_id;
      if (!Array.isArray(a) || typeof a[0] !== 'number') throw new Error('malformed group');
      const key = codes.get(String(a[0])) ?? `account:${a[0]}`;
      const t = totals[key] ?? { debit: '0.00', credit: '0.00' };
      // Two Odoo accounts with one code add up, as the mirror's per-code sum does.
      totals[key] = { debit: addMoney(t.debit, money(g['debit:sum'])), credit: addMoney(t.credit, money(g['credit:sum'])) };
    }
    return { ok: true, totals };
  } catch (err) {
    return { ok: false, reason: err instanceof OdooError ? err.errorClass : 'read-failed' };
  }
}
const addMoney = (a: string, b: string): string => formatCents(nanoToCents(toNano(a)!) + nanoToCents(toNano(b)!));

/** After a caught-up pass and at least an hour since the last check, or when links changed after it: compare mirror sums with Odoo and record the result.
 *  Never throws. ponytail: the mirror side is paged through PostgREST (about 130 calls per check for 130,000 rows); link changes can trigger one early check, and SQL sum is the upgrade if that cost bites. */
async function runLedgerCheck(sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, codes: Map<string, string>, budget: Budget, now: Date): Promise<'matches' | 'differs' | 'not-checked' | undefined> {
  try {
    const last = await sc.from('odoo_ledger_checks').select('checked_at').eq('org_id', orgId).order('checked_at', { ascending: false }).limit(1);
    if (last.error) throw new Error('could not read the last ledger check');
    const lastAt = (last.data as Array<{ checked_at: string }> | null)?.[0]?.checked_at;
    if (lastAt && now.getTime() - Date.parse(lastAt) < CHECK_EVERY_MS) {
      const linksUpdatedAt = await linkFingerprintUpdatedAt(sc, orgId);
      if (!linksUpdatedAt || Date.parse(lastAt) >= Date.parse(linksUpdatedAt)) return undefined;
    }
    const rawCursor = await readCursor(sc, orgId);
    const cursor = parseCursor(rawCursor);
    if (!cursor.w || !budget.spend()) return undefined;
    const cutoff = overlapStart({ w: cursor.w, id: cursor.id }).w;
    let result;
    const odoo = await odooTotals(call, companyId, cutoff, codes);
    if (!odoo.ok) {
      result = compareTotals({ lines: [], odoo, cutoff });
    } else {
      const lines = (await fetchAllRowsByKeyset<{ id: string; account: string; debit: string | number | null; credit: string | number | null; erp_modified: string; is_cancelled: boolean }>((after, limit) => {
        const q = sc.from('erp_gl_entry_mirror').select('id,account,debit,credit,erp_modified,is_cancelled').eq('org_id', orgId).eq('voucher_type', 'account.move').order('id');
        return (after === null ? q : q.gt('id', after)).limit(limit) as never;
      })).map((r): PmoLine => ({ account: r.account, debit: String(r.debit ?? 0), credit: String(r.credit ?? 0), writeDate: r.erp_modified, isCancelled: r.is_cancelled }));
      result = compareTotals({ lines, odoo, cutoff });
    }
    // A page applied while the check ran moves both sides under it: drop the result, the next tick checks again.
    if (await readCursor(sc, orgId) !== rawCursor) return undefined;
    const { error } = await sc.rpc('record_odoo_ledger_check', {
      p_org_id: orgId, p_cutoff: `${cutoff.replace(' ', 'T')}.000Z`,
      p_accounts: result.state === 'differs' ? result.differing.slice(0, MAX_DIFFERENCES) : [], p_status: result.state,
      p_reason: result.state === 'not-checked' ? result.reason : null,
      p_accounts_checked: result.state === 'not-checked' ? 0 : result.accounts,
      p_feed_position: `${cursor.w}|${cursor.id}`,
    });
    if (error) throw new Error('could not record the ledger check');
    return result.state;
  } catch {
    console.error('odoo ledger check failed');
    return undefined;
  }
}

/** #2282: the stock-cost kind runs only for an org whose inventory Odoo owns (0879); otherwise no analytic line is ever read. */
async function inventoryOnOdoo(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await sc.from('external_domain_ownership').select('id').eq('org_id', orgId).eq('domain', 'inventory').eq('external_tier', 'odoo').limit(1);
  if (error) throw new Error('could not read the Odoo inventory ownership');
  return (data as unknown[] | null)?.length === 1;
}

interface StockKindRun { rows: number; changed: number; caughtUp: boolean }

/** Pages the issued-material analytic lines (D1/D2) with their own cursor, then their daily census. Holds a page whose account cannot be placed (D6). */
async function runStockCostKind(
  sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, codes: Map<string, string>, fy: FiscalYearEnd | null,
  budget: Budget, opts: LedgerPassOpts,
): Promise<StockKindRun> {
  let seen = 0, changed = 0, rows = 0;
  const deps: KindRunDeps = {
    ...stockCostFeedReaders(call, companyId),
    apply: async (page, cursor) => {
      const accounts = page.length ? await resolveStockCostAccounts(call, page, codes) : new Map<string, string>();
      const pickings = await readPickings(call, companyId, page.map((r) => r.name));
      const out = page.map((r) => {
        const a = r.attrs as unknown as StockCostAttrs;
        const picking = pickings.get(r.name);
        return {
          analytic_line_id: Number(r.external_id), company_id: Number(a.company_id), analytic_account_id: a.analytic_account_id, picking_ref: r.name,
          odoo_picking_id: picking?.id ?? null, odoo_return_of: picking?.returnOf ?? null, odoo_product_id: Number(a.product_id),
          unit_amount: a.unit_amount, debit: a.debit, credit: a.credit, account: accounts.get(r.external_id)!, posting_date: a.date,
          fiscal_year: fiscalYearOf(a.date, fy), source_write_date: r.source_write_date,
        };
      });
      changed += Number(await rpc(sc, 'apply_odoo_stock_cost_page', { p_org_id: orgId, p_rows: out, p_cursor: cursor })) || 0;
      rows += page.length;
    },
    censusSeen: async (run, ids) => { seen += ids.length; await rpc(sc, 'mark_odoo_stock_cost_census_seen', { p_org_id: orgId, p_run: run, p_line_ids: ids }); },
    censusFinish: async (run, cursor) => {
      changed += Number(await rpc(sc, 'finish_odoo_stock_cost_census', { p_org_id: orgId, p_run: run, p_expected_lines: seen })) || 0;
      await rpc(sc, 'apply_odoo_stock_cost_page', { p_org_id: orgId, p_rows: [], p_cursor: cursor });
    },
    budget,
    now: opts.now ?? (() => new Date()),
    pageSize: opts.pageSize ?? LEDGER_PAGE_SIZE,
    censusPageSize: opts.censusPageSize ?? LEDGER_CENSUS_PAGE_SIZE,
  };
  const run = await runKind(STOCK_COST_FEED_SPEC, await readCursor(sc, orgId, STOCK_DOMAIN), deps);
  if (run.done) await runCensus(await readCursor(sc, orgId, STOCK_DOMAIN), deps);
  return { rows, changed, caughtUp: run.done };
}

interface StoredStockCost { analytic_line_id: number | string; analytic_account_id: string | null; debit: string | number; credit: string | number; source_write_date: string; is_cancelled: boolean; tie_state: string; odoo_picking_id: number | string | null; odoo_return_of: number | string | null }

/** Odoo's analytic totals over the D2 domain up to the cut-off, per analytic account. A failure is "not checked". */
async function odooStockCostTotals(call: OdooCall, companyId: number, cutoff: string): Promise<{ ok: true; totals: Record<string, string> } | { ok: false; reason: string }> {
  try {
    const groups = await call<Array<Record<string, unknown>>>('account.analytic.line', 'formatted_read_group', {
      domain: [...stockCostDomain(companyId), ['write_date', '<=', cutoff]], groupby: ['account_id'], aggregates: ['amount:sum'],
    });
    const totals: Record<string, string> = {};
    for (const g of groups) {
      const a = g.account_id, n = typeof g['amount:sum'] === 'number' ? toNano(g['amount:sum']) : null;
      if (n === null) throw new Error('malformed group');
      const key = Array.isArray(a) && typeof a[0] === 'number' ? String(a[0]) : 'none';
      totals[key] = formatCents(nanoToCents(toNano(totals[key] ?? '0')!) + nanoToCents(n));
    }
    return { ok: true, totals };
  } catch (err) {
    return { ok: false, reason: err instanceof OdooError ? err.errorClass : 'read-failed' };
  }
}

const idOf = (v: unknown): number | null => (Array.isArray(v) && Number.isSafeInteger(v[0]) ? Number(v[0]) : null);

/**
 * D8(c): the tied lines whose picking has a stock valuation item tagged to the same project account. Odoo links the entry from the
 * move (`stock.move.account_move_id`; the journal item's own `stock_move_id` is never filled, bed 15 Nov), so: picking → its moves →
 * their entries → those entries' journal items. Fails closed: a read error or an answer of the wrong shape is null ("not checked").
 */
async function stockDoubleCounts(call: OdooCall, stored: readonly StoredStockCost[]): Promise<string[] | null> {
  const tied = stored.filter((r) => !r.is_cancelled && (r.tie_state === 'tied' || r.tie_state === 'return') && r.odoo_picking_id !== null);
  if (tied.length === 0) return [];
  try {
    const pickingIds = [...new Set(tied.map((r) => Number(r.odoo_picking_id)))];
    const moves = await call<Array<Record<string, unknown>>>('stock.move', 'search_read', { domain: [['picking_id', 'in', pickingIds]], fields: ['picking_id', JOURNAL_ENTRY_OF_MOVE], context: { active_test: false } });
    const movesOf = new Map<number, number[]>();
    const movesOfEntry = new Map<number, number[]>();
    for (const m of moves) {
      const picking = idOf(m.picking_id), entry = m[JOURNAL_ENTRY_OF_MOVE] === false ? null : idOf(m[JOURNAL_ENTRY_OF_MOVE]);
      if (typeof m.id !== 'number' || picking === null || (entry === null && m[JOURNAL_ENTRY_OF_MOVE] !== false)) throw new Error('malformed stock move');
      movesOf.set(picking, [...(movesOf.get(picking) ?? []), m.id]);
      if (entry !== null) movesOfEntry.set(entry, [...(movesOfEntry.get(entry) ?? []), m.id]);
    }
    const entryIds = [...movesOfEntry.keys()];
    const items = entryIds.length === 0 ? [] : await call<Array<Record<string, unknown>>>('account.move.line', 'search_read', {
      domain: [['move_id', 'in', entryIds], ['analytic_distribution', '!=', false]], fields: ['move_id', 'analytic_distribution'],
    });
    return findDoubleCounts(
      items.flatMap((j) => {
        const entry = idOf(j.move_id), dist = j.analytic_distribution;
        if (entry === null || !dist || typeof dist !== 'object' || Array.isArray(dist)) throw new Error('malformed journal item');
        const accounts = Object.keys(dist).flatMap((k) => k.split(','));
        return (movesOfEntry.get(entry) ?? []).map((stockMoveId) => ({ stockMoveId, analyticAccounts: accounts }));
      }),
      tied.map((r) => ({ analyticLineId: String(r.analytic_line_id), analyticAccount: r.analytic_account_id, stockMoveIds: movesOf.get(Number(r.odoo_picking_id)) ?? [] })),
    );
  } catch {
    return null;
  }
}

/** D8(b)+(c), hourly once the stock kind is caught up: compare with Odoo, mark the double counts, record. Never throws; returns how many rows the marking changed. */
async function runStockCostCheck(sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, budget: Budget, now: Date): Promise<{ state?: 'matches' | 'differs' | 'not-checked'; flagged: number }> {
  try {
    const last = await sc.from('odoo_stock_cost_checks').select('checked_at').eq('org_id', orgId).order('checked_at', { ascending: false }).limit(1);
    if (last.error) throw new Error('could not read the last stock cost check');
    const lastAt = (last.data as Array<{ checked_at: string }> | null)?.[0]?.checked_at;
    if (lastAt && now.getTime() - Date.parse(lastAt) < CHECK_EVERY_MS) return { flagged: 0 };
    const rawCursor = await readCursor(sc, orgId, STOCK_DOMAIN);
    const cursor = parseCursor(rawCursor);
    if (!cursor.w || !budget.spend()) return { flagged: 0 };
    const cutoff = overlapStart({ w: cursor.w, id: cursor.id }).w;
    const odoo = await odooStockCostTotals(call, companyId, cutoff);
    const stored = await fetchAllRowsByKeyset<StoredStockCost & { id: string }>((after, limit) => {
      const q = sc.from('odoo_stock_cost_lines').select('id,analytic_line_id,analytic_account_id,debit,credit,source_write_date,is_cancelled,tie_state,odoo_picking_id,odoo_return_of').eq('org_id', orgId).order('id');
      return (after === null ? q : q.gt('id', after)).limit(limit) as never;
    });
    const result = compareStockCost({
      lines: stored.map((r): StockCostLine => ({ analyticAccount: r.analytic_account_id, debit: String(r.debit), credit: String(r.credit), writeDate: r.source_write_date, isCancelled: r.is_cancelled })),
      odoo, cutoff,
    });
    const doubles = await stockDoubleCounts(call, stored);
    let flagged = 0;
    if (doubles !== null) flagged = Number(await rpc(sc, 'mark_odoo_stock_cost_double_counts', { p_org_id: orgId, p_analytic_line_ids: doubles.map(Number) })) || 0;
    // A page applied while the check ran moves both sides under it: keep the marking (it is the full answer), drop the comparison.
    if (await readCursor(sc, orgId, STOCK_DOMAIN) !== rawCursor) return { flagged };
    const state = result.state === 'not-checked' || doubles === null ? 'not-checked'
      : result.state === 'differs' || doubles.length > 0 ? 'differs' : 'matches';
    const { error } = await sc.rpc('record_odoo_stock_cost_check', {
      p_org_id: orgId, p_cutoff: `${cutoff.replace(' ', 'T')}.000Z`,
      p_accounts: result.state === 'differs' ? result.differing.slice(0, MAX_DIFFERENCES) : [], p_status: state,
      p_reason: state !== 'not-checked' ? null : result.state === 'not-checked' ? result.reason : 'double-count-unreadable',
      p_accounts_checked: result.state === 'not-checked' ? 0 : result.accounts, p_double_counts: doubles?.length ?? 0,
    });
    if (error) throw new Error('could not record the stock cost check');
    return { state, flagged };
  } catch {
    console.error('odoo stock cost check failed');
    return { flagged: 0 };
  }
}

/** Pages the feed until caught up or the budget is spent, then the daily census, then rebuilds the actuals snapshot when rows changed and the org's basis is Odoo. */
export async function runLedgerPass(
  sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, budget: Budget, opts: LedgerPassOpts = {},
): Promise<LedgerPassResult> {
  if (!budget.spend()) return { rows: 0, caughtUp: false, skipped: 0 };
  const { fy, calendarYear } = await fiscalYearEnd(call, companyId);
  // The statements read the same year end from the binding (one source); a refused read leaves what was stored.
  if (fy) await rpc(sc, 'set_odoo_fiscal_year_end', { p_org_id: orgId, p_month: fy.month, p_day: fy.day });
  const { accounts, projectMap } = await projectLinks(sc, orgId);
  await rewindOnLinkChange(sc, orgId, accounts);
  const codes = await accountCodes(sc, orgId);
  const pageSize = opts.pageSize ?? LEDGER_PAGE_SIZE;

  let seen = 0, deleted = 0, changed = 0, rows = 0;
  const deps: KindRunDeps = {
    ...ledgerFeedReaders(call, companyId),
    apply: async (page, cursor) => {
      const held = page.filter((r) => !codes.has(String((r.attrs as Record<string, unknown>).account_id))).length;
      if (held) throw new AccountHold(held);
      const out = page.flatMap((r) => fanOutLine(toLine(r, codes), accounts as ProjectAccounts).map((x) => ({ ...x, fiscal_year: fiscalYearOf(x.posting_date, fy) })));
      changed += Number(await rpc(sc, 'apply_odoo_ledger_page', { p_org_id: orgId, p_rows: out, p_cursor: cursor })) || 0;
      rows += page.length;
    },
    censusSeen: async (run, ids) => { seen += ids.length; await rpc(sc, 'mark_odoo_ledger_census_seen', { p_org_id: orgId, p_run: run, p_line_ids: ids }); },
    censusFinish: async (run, cursor) => {
      deleted = Number(await rpc(sc, 'finish_odoo_ledger_census', { p_org_id: orgId, p_run: run, p_expected_lines: seen })) || 0;
      // The census day lives in the cursor; an empty page at the same (w, id) stores it without moving the feed.
      await rpc(sc, 'apply_odoo_ledger_page', { p_org_id: orgId, p_rows: [], p_cursor: cursor });
    },
    budget,
    now: opts.now ?? (() => new Date()),
    pageSize,
    censusPageSize: opts.censusPageSize ?? LEDGER_CENSUS_PAGE_SIZE,
  };
  let result: LedgerPassResult;
  try {
    const run = await runKind(LEDGER_FEED_SPEC, await readCursor(sc, orgId), deps);
    if (run.done) await runCensus(await readCursor(sc, orgId), deps);
    result = { rows, caughtUp: run.done, skipped: run.skipped };
  } catch (err) {
    // The feed holds at the page and says so; pages applied before it still count and still refresh.
    if (!(err instanceof AccountHold)) throw err;
    result = { rows, caughtUp: false, skipped: 0, stalled: 'account', held: err.held };
  }
  if (calendarYear) result.calendarYear = true;

  // #2282: the issued-material kind, after the GL kind and independent of it: its hold or failure never changes the GL result.
  let stockChanged = 0;
  const stockEmployed = await inventoryOnOdoo(sc, orgId);
  if (stockEmployed) {
    try {
      const s = await runStockCostKind(sc, orgId, call, companyId, codes, fy, budget, opts);
      stockChanged = s.changed;
      result.stockRows = s.rows;
      result.stockCaughtUp = s.caughtUp;
    } catch (err) {
      if (err instanceof StockCostAccountHold) {
        result.stalled = 'account';
        result.held = (result.held ?? 0) + err.held;
        result.stockCaughtUp = false;
        // The hold is silent otherwise: one audit event per pass names the products so an Admin can fix them in Odoo. Never fails the pass.
        result.heldProducts = [...err.products];
        const { error } = await sc.rpc('log_audit', { p_action: 'integration.odoo.stock_cost_held', p_org_id: orgId, p_actor_id: null, p_entity_id: null,
          p_detail: { tier: 'odoo', held: err.held, products: err.products, remedy: 'give each product a category or an expense account in the accounting system' } });
        if (error) console.error('log_audit failed stock_cost_held');
      } else {
        console.error('odoo stock cost feed failed');
        result.stockFailed = true;
      }
    }
  }

  // The health read's caught-up flag; written after every pass that finished (a thrown pass leaves it, so the as-of time ages honestly).
  const now = (opts.now ?? (() => new Date()))();
  const flag = await sc.from('external_sync_watermarks').upsert(
    { org_id: orgId, external_tier: 'odoo', domain: CAUGHT_UP_DOMAIN, watermark_cursor: String(result.caughtUp), updated_at: now.toISOString() }, { onConflict: 'org_id,external_tier,domain' });
  if (flag.error) console.error('could not save the Odoo ledger caught-up flag');
  if (result.caughtUp) {
    const check = await runLedgerCheck(sc, orgId, call, companyId, codes, budget, now);
    if (check) result.check = check;
  }
  if (result.stockCaughtUp) {
    const stockCheck = await runStockCostCheck(sc, orgId, call, companyId, budget, now);
    if (stockCheck.state) result.stockCheck = stockCheck.state;
    stockChanged += stockCheck.flagged;
  }

  // Publish only for an org an Admin has switched to Odoo's ledger: when a page changed or removed a row (the RPC counts those), and once
  // on the first pass after the switch, so a caught-up, quiet ledger does not leave the money screens on an empty snapshot.
  if (changed > 0 || deleted > 0 || stockChanged > 0 || await firstPublishDue(sc, orgId)) {
    if (await ledgerBasisSwitchedAt(sc, orgId)) {
      await refreshActuals(sc as never, orgId, { projectMap, stockCost: stockEmployed });
      const marker = await sc.from('external_sync_watermarks').upsert(
        { org_id: orgId, external_tier: 'odoo', domain: PUBLISHED_DOMAIN, watermark_cursor: 'published', updated_at: now.toISOString() }, { onConflict: 'org_id,external_tier,domain' });
      if (marker.error) console.error('could not save the Odoo ledger publish marker');
    }
  }
  return result;
}
