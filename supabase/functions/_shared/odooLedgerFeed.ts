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
import { OdooError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';

type Budget = { spend: () => boolean; left: () => boolean };
export interface LedgerPassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }
/** Counts only. `stalled: 'account'` = the feed is held at a page with `held` lines on accounts the directory has not mirrored (never "caught up");
 *  `calendarYear` = the company year end was refused, so this pass stamped calendar years (OQ-ODA-3);
 *  `failed` = the pass hit an Odoo failure (error class only) and retries next tick. */
export interface LedgerPassResult { rows: number; caughtUp: boolean; skipped: number; stalled?: 'account'; held?: number; calendarYear?: true; failed?: string }

// 500 lines a page keeps one apply call small; the bed reads 1,000 a page in p95 0.85 s (V-ODA7), so this has room to grow.
const LEDGER_PAGE_SIZE = 500;
// 5,000 ids a call is 90 ms on the bed (V-ODA7): a 130,000-line census is 26 calls, inside one tick.
const LEDGER_CENSUS_PAGE_SIZE = 5_000;
const DOMAIN = 'ledger:odoo';
// Which project↔analytic links the stored lines were attributed with; a change rewinds the feed (the upserts are idempotent).
const LINKS_DOMAIN = 'ledger-links:odoo';
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
async function ledgerBasisSwitched(sc: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await sc.from('external_org_bindings').select('config').eq('org_id', orgId).eq('external_tier', 'odoo').maybeSingle();
  if (error) throw new Error('could not read the Odoo binding for the ledger feed');
  return !!(data as { config?: { ledger_basis_at?: string | null } } | null)?.config?.ledger_basis_at;
}

async function readCursor(sc: SupabaseClient, orgId: string, domain = DOMAIN): Promise<string> {
  const { data, error } = await sc.from('external_sync_watermarks').select('watermark_cursor')
    .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', domain).maybeSingle();
  if (error) throw new Error('could not read the Odoo ledger cursor');
  return (data?.watermark_cursor as string | undefined) ?? '';
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

/** Pages the feed until caught up or the budget is spent, then the daily census, then rebuilds the actuals snapshot when rows changed and the org's basis is Odoo. */
export async function runLedgerPass(
  sc: SupabaseClient, orgId: string, call: OdooCall, companyId: number, budget: Budget, opts: LedgerPassOpts = {},
): Promise<LedgerPassResult> {
  if (!budget.spend()) return { rows: 0, caughtUp: false, skipped: 0 };
  const { fy, calendarYear } = await fiscalYearEnd(call, companyId);
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

  // Publish only for an org an Admin has switched to Odoo's ledger, and only when a page changed or removed a row (the RPC counts those).
  if ((changed > 0 || deleted > 0) && await ledgerBasisSwitched(sc, orgId)) await refreshActuals(sc as never, orgId, { projectMap });
  return result;
}
