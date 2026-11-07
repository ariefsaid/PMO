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
import { runCensus, runKind, type KindRunDeps } from '../../../pmo-portal/src/lib/adapterSeam/odoo/sweep.ts';

type Budget = { spend: () => boolean; left: () => boolean };
export interface LedgerPassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }
export interface LedgerPassResult { rows: number; caughtUp: boolean; skipped: number }

// 500 lines a page keeps one apply call small; the bed reads 1,000 a page in p95 0.85 s (V-ODA7), so this has room to grow.
const LEDGER_PAGE_SIZE = 500;
// 5,000 ids a call is 90 ms on the bed (V-ODA7): a 130,000-line census is 26 calls, inside one tick.
const LEDGER_CENSUS_PAGE_SIZE = 5_000;
const DOMAIN = 'ledger:odoo';

async function rpc(sc: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await sc.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data;
}

/**
 * The org's activated Odoo binding reads its ledger: the shipped `actuals.read` declaration, an activated binding and a capability
 * snapshot that found `account.move.line` readable. The owner-approved Admin switch to ledger basis (OQ-ODA-2) arrives with S6;
 * until then this feed only fills the mirror and the snapshot, and no screen reads them as the org's basis.
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

async function readCursor(sc: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', DOMAIN).maybeSingle();
  if (error) throw new Error('could not read the Odoo ledger cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
}

/** The company's year end (`fiscalyear_last_month` is a string on v20, V-ODA4); unreadable or unset means the calendar year (OQ-ODA-3). */
async function fiscalYearEnd(call: OdooCall, companyId: number): Promise<FiscalYearEnd | null> {
  const [c] = await call<Array<Record<string, unknown>>>('res.company', 'read', { ids: [companyId], fields: ['fiscalyear_last_month', 'fiscalyear_last_day'] });
  const month = Number(c?.fiscalyear_last_month), day = Number(c?.fiscalyear_last_day);
  return Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31 ? { month, day } : null;
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

/** Odoo account id → account code, from the directory mirror (the account kind runs earlier in the tick). */
async function accountCodes(sc: SupabaseClient, orgId: string): Promise<Map<string, string>> {
  const rows = await fetchAllRowsByKeyset<{ id: string; external_id: string; code: string | null }>((after, limit) => {
    const q = sc.from('external_master_records').select('id,external_id,code').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'account').order('id');
    return (after === null ? q : q.gt('id', after)).limit(limit) as never;
  });
  return new Map(rows.flatMap((r) => (r.code ? [[r.external_id, r.code] as const] : [])));
}

function toLine(r: DirectoryRow, codes: Map<string, string>): LedgerLine {
  const a = r.attrs as Record<string, unknown>;
  // Fail the page, not the money: a line on an account the directory has not mirrored yet is retried next tick from the same cursor.
  const account = codes.get(String(a.account_id));
  if (!account) throw new Error('ledger line on an account the directory has not mirrored');
  return {
    id: Number(r.external_id), moveName: r.name ?? '', journal: (a.journal as string | null) ?? null, date: String(a.date), account,
    partner: (a.partner as string | null) ?? null, debit: String(a.debit), credit: String(a.credit), parentState: String(a.parent_state),
    distribution: (a.analytic_distribution as LedgerLine['distribution']) ?? null, foreignCurrency: a.foreign_currency === true, writeDate: r.source_write_date ?? '',
  };
}

/** Pages the feed until caught up or the budget is spent, then the daily census, then rebuilds the actuals snapshot when anything changed. */
export async function runLedgerPass(
  sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, budget: Budget, opts: LedgerPassOpts = {},
): Promise<LedgerPassResult> {
  if (!budget.spend()) return { rows: 0, caughtUp: false, skipped: 0 };
  const fy = await fiscalYearEnd(call, companyId);
  const { accounts, projectMap } = await projectLinks(sc, orgId);
  const codes = await accountCodes(sc, orgId);
  const pageSize = opts.pageSize ?? LEDGER_PAGE_SIZE;

  let seen = 0, deleted = 0;
  const deps: KindRunDeps = {
    ...ledgerFeedReaders(call, companyId),
    apply: async (rows, cursor) => {
      const out = rows.flatMap((r) => fanOutLine(toLine(r, codes), accounts as ProjectAccounts).map((x) => ({ ...x, fiscal_year: fiscalYearOf(x.posting_date, fy) })));
      await rpc(sc, 'apply_odoo_ledger_page', { p_org_id: orgId, p_rows: out, p_cursor: cursor });
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
  const run = await runKind(LEDGER_FEED_SPEC, await readCursor(sc, orgId), deps);
  if (run.done) await runCensus(await readCursor(sc, orgId), deps);

  // ponytail: refresh whenever a page applied or the census deleted; the 10-minute overlap re-reads recent lines, so a busy ledger
  // refreshes most ticks. A page that changed nothing cannot be told from one that did without a changed-count from the RPC.
  if (run.applied.length > 0 || deleted > 0) await refreshActuals(sc as never, orgId, { projectMap });
  return { rows: run.applied.length, caughtUp: run.done, skipped: run.skipped };
}
