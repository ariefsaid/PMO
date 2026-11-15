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

type Budget = { spend: () => boolean; left: () => boolean };
export interface LedgerPassOpts { pageSize?: number; censusPageSize?: number; now?: () => Date }
/** Counts only. `stalled: 'account'` = the feed is held at a page with `held` lines on accounts the directory has not mirrored (never "caught up");
 *  `calendarYear` = the company year end was refused, so this pass stamped calendar years (OQ-ODA-3);
 *  `failed` = the pass hit an Odoo failure (error class only) and retries next tick. */
export interface LedgerPassResult { rows: number; caughtUp: boolean; skipped: number; stalled?: 'account'; held?: number; calendarYear?: true; failed?: string; check?: 'matches' | 'differs' | 'not-checked' }

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

  // The health read's caught-up flag; written after every pass that finished (a thrown pass leaves it, so the as-of time ages honestly).
  const now = (opts.now ?? (() => new Date()))();
  const flag = await sc.from('external_sync_watermarks').upsert(
    { org_id: orgId, external_tier: 'odoo', domain: CAUGHT_UP_DOMAIN, watermark_cursor: String(result.caughtUp), updated_at: now.toISOString() }, { onConflict: 'org_id,external_tier,domain' });
  if (flag.error) console.error('could not save the Odoo ledger caught-up flag');
  if (result.caughtUp) {
    const check = await runLedgerCheck(sc, orgId, call, companyId, codes, budget, now);
    if (check) result.check = check;
  }

  // Publish only for an org an Admin has switched to Odoo's ledger: when a page changed or removed a row (the RPC counts those), and once
  // on the first pass after the switch, so a caught-up, quiet ledger does not leave the money screens on an empty snapshot.
  if (changed > 0 || deleted > 0 || await firstPublishDue(sc, orgId)) {
    if (await ledgerBasisSwitchedAt(sc, orgId)) {
      await refreshActuals(sc as never, orgId, { projectMap });
      const marker = await sc.from('external_sync_watermarks').upsert(
        { org_id: orgId, external_tier: 'odoo', domain: PUBLISHED_DOMAIN, watermark_cursor: 'published', updated_at: now.toISOString() }, { onConflict: 'org_id,external_tier,domain' });
      if (marker.error) console.error('could not save the Odoo ledger publish marker');
    }
  }
  return result;
}
