#!/usr/bin/env node
/**
 * Guard: no NEW un-paged Supabase list read in `pmo-portal/src/lib/db/**` (#1770, FPR-12).
 *
 * PostgREST `max_rows = 1000` truncates SILENTLY (HTTP 200, short body, no error), so an un-paged
 * `.from(t).select()` is correct until `t` passes 1,000 org-visible rows, then quietly wrong
 * (see `pmo-portal/src/lib/pagedRead.ts`).
 *
 * Heuristic (deliberately simple): for every `.from(` in a non-test db file, the chain is its
 * statement (up to the `;` at paren depth 0). The bound markers are searched in the WINDOW: from
 * `.from(` to the next `.from(` or top-level `}` / `export`, so `let q = …select(); … q.limit(n)`
 * counts. If the chain has `.select(` and none of the markers below, it is an offender:
 *   bounded:   `.range(` `.limit(` `.single()` `.maybeSingle()` `head: true` `.eq('id', …)`
 *   wrapped:   `pagedRead` / `fetchAllPages` / `fetchAllRowsByKeyset` / `fetchAll…`
 *   not a read: chain contains `.insert(` `.update(` `.upsert(` `.delete(` (their `.select()` is a RETURNING)
 * Known ceilings: `.in('id', ids)` is NOT treated as bounded (flagged; use batchedByIds or allowlist);
 * a marker anywhere in the statement counts, so a multi-query statement can mask one read.
 *
 * Every offender that existed when the guard landed is in ALLOWLIST with a reason. A NEW offender
 * fails; a STALE entry (no longer an offender) fails too. Key = `file :: table #n` (n-th offender
 * on that table in that file, source order).
 *
 * Run: node scripts/check-unpaged-reads.mjs [--self-test]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_DIR = 'pmo-portal/src/lib/db';

const BOUNDED = [/\.range\(/, /\.limit\(/, /\.single\(\)/, /\.maybeSingle\(\)/, /head:\s*true/, /\.eq\(\s*['"]id['"]/];
const WRAPPED = /pagedRead|fetchAll\w*/;
const WRITE = /\.(insert|update|upsert|delete)\(/;

/** Statement text from `start` to the `;` at depth 0 (or EOF). Strings/templates are not parsed. */
function statementFrom(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { depth--; if (depth < 0) return src.slice(start, i); }
    else if (c === ';' && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

/** Offender keys for one source text. */
export function findOffenders(file, src) {
  const seen = {};
  const out = [];
  for (const m of src.matchAll(/\.from\(\s*(['"`])([^'"`]+)\1/g)) {
    const stmt = statementFrom(src, m.index);
    const rest = src.slice(m.index + 1);
    const win = stmt + rest.slice(stmt.length - 1).split(/\.from\(|\n\}|\nexport /)[0];
    if (!/\.select\(/.test(stmt) || WRITE.test(stmt) || WRAPPED.test(win) || BOUNDED.some((r) => r.test(win))) continue;
    const table = m[2];
    const k = `${file} :: ${table}`;
    seen[k] = (seen[k] ?? 0) + 1;
    out.push(`${k} #${seen[k]}`);
  }
  return out;
}

function listFiles(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = resolve(dir, n);
    if (statSync(p).isDirectory()) { if (n !== '__tests__') out.push(...listFiles(p)); }
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.|\.d\.ts$/.test(n)) out.push(p);
  }
  return out;
}

/** Returns { fresh, stale } given offender keys and the allowlist keys. */
export function compare(offenders, allowKeys) {
  const allow = new Set(allowKeys);
  const found = new Set(offenders);
  return { fresh: offenders.filter((k) => !allow.has(k)), stale: [...allow].filter((k) => !found.has(k)) };
}

/** key -> one-line reason. */
const ALLOWLIST = {
  'pmo-portal/src/lib/db/companies.ts :: companies #1': 'bounded: .in(id) chunked by BY_IDS_CHUNK',
  'pmo-portal/src/lib/db/expenseClaims.ts :: expense_claim_lines #1': 'bounded: lines of one claim',
  'pmo-portal/src/lib/db/expenseReceipts.ts :: expense_claim_files #1': 'bounded: files of one claim',
  'pmo-portal/src/lib/db/externalDomainOwnership.ts :: external_domain_ownership #1': 'bounded: one row per (tier, domain), fixed set',
  'pmo-portal/src/lib/db/fxRates.ts :: fx_rates #1': 'bounded: .in(rate_date, dates), one row per date, caller-bounded',
  'pmo-portal/src/lib/db/imprest.ts :: imprest_plan_lines #1': 'bounded: lines of one plan, one per budget category',
  'pmo-portal/src/lib/db/opportunity.ts :: projects #1': 'bounded: .in(id) chunked by BY_IDS_CHUNK',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #1': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #2': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #3': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #4': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #5': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/orgs.ts :: organizations #6': 'bounded: single-tenant, org count is 1 (RLS)',
  'pmo-portal/src/lib/db/procurementCrud.ts :: procurement_documents #1': 'bounded: documents of one procurement (one per type)',
  'pmo-portal/src/lib/db/procurementFiles.ts :: procurement_quotation_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: procurement_receipt_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: purchase_request_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: rfq_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: purchase_order_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: payment_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurementFiles.ts :: procurement_invoice_files #1': 'bounded: attachments of one parent record',
  'pmo-portal/src/lib/db/procurements.ts :: procurements #1': 'AT RISK: every procurement for one vendor, unpaged; grows with vendor history',
  'pmo-portal/src/lib/db/profiles.ts :: profiles #1': 'bounded: org members (users), well under 1000; revisit past ~1000 users',
  'pmo-portal/src/lib/db/profiles.ts :: profiles #2': 'bounded: org members (users), well under 1000; revisit past ~1000 users',
  'pmo-portal/src/lib/db/progressBilling.ts :: boq_items #1': 'AT RISK: all BOQ lines of one project, unpaged; a >1000-line BOQ truncates silently',
  'pmo-portal/src/lib/db/progressBilling.ts :: sales_invoices #1': 'bounded: .in(id) over claims capped at CLAIM_LIST_LIMIT (500)',
  'pmo-portal/src/lib/db/projectStageEntries.ts :: project_stage_entries #1': 'bounded: stage history of one project',
  'pmo-portal/src/lib/db/projectTransitions.ts :: pipeline_stage_config #1': 'bounded: one row per pipeline stage',
  'pmo-portal/src/lib/db/projects.ts :: projects #1': 'AT RISK: listProjects returns whole project table (status filter only), unpaged',
  'pmo-portal/src/lib/db/projects.ts :: projects #2': 'AT RISK: listProjectIdentity returns every project id+name, unpaged',
  'pmo-portal/src/lib/db/projects.ts :: projects #3': 'bounded: projects of one client',
  'pmo-portal/src/lib/db/revenue.ts :: projects #1': 'bounded: .in(id) name lookup over ids already in hand',
  'pmo-portal/src/lib/db/revenue.ts :: sales_invoices #1': 'bounded: .in(id) name lookup over ids already in hand',
  'pmo-portal/src/lib/db/spendApprovers.ts :: spend_approvers #1': 'bounded: handful of approver assignments per org',
  'pmo-portal/src/lib/db/stockAllowances.ts :: boq_material_allowances #1': 'bounded: material allowances of one project BOQ',
  'pmo-portal/src/lib/db/stockDocuments.ts :: boq_items #1': 'AT RISK: all BOQ lines of one project (picker), unpaged',
  'pmo-portal/src/lib/db/subcontracts.ts :: purchase_order_revisions #1': 'bounded: revisions/lines/variations of one PO',
  'pmo-portal/src/lib/db/subcontracts.ts :: purchase_order_lines #1': 'bounded: revisions/lines/variations of one PO',
  'pmo-portal/src/lib/db/subcontracts.ts :: po_variations #1': 'bounded: revisions/lines/variations of one PO',
  'pmo-portal/src/lib/db/timesheetPush.ts :: timesheet_erp_mirror #1': 'bounded: only failed/held pushes needing attention',
  'pmo-portal/src/lib/db/timesheetPush.ts :: timesheets #1': 'bounded: .in(id) over the attention set above',
  'pmo-portal/src/lib/db/timesheetPush.ts :: erp_employees #1': 'bounded: employees with a proposed link, one-off setup queue',
  'pmo-portal/src/lib/db/timesheetTransition.ts :: timesheets #1': 'bounded: Submitted-awaiting-approval queue for one approver',
  'pmo-portal/src/lib/db/timesheetTransition.ts :: external_command_outbox #1': 'bounded: non-terminal push commands for the sheets above',
  'pmo-portal/src/lib/db/timesheets.ts :: timesheets #1': 'bounded: one user, one row per week (~52/yr)',
  'pmo-portal/src/lib/db/userViews.ts :: user_views #1': 'bounded: caller saved views, tens',
  'pmo-portal/src/lib/db/vendorWithholdingSlips.ts :: procurements #1': 'bounded: .in(id) over one slip batch',
  'pmo-portal/src/lib/db/vendorWithholdingSlips.ts :: projects #1': 'bounded: .in(id) over one slip batch',
  'pmo-portal/src/lib/db/workOrderBilling.ts :: work_order_billing_lines #1': 'AT RISK: billing lines for all listed work orders, unpaged (diagnostic copy only, not a sum)',
  'pmo-portal/src/lib/db/workOrderBilling.ts :: sales_invoices #1': 'bounded: .in(id) over the listed work orders / invoices',
  'pmo-portal/src/lib/db/workOrderBilling.ts :: projects #1': 'bounded: .in(id) over the listed work orders / invoices',
  'pmo-portal/src/lib/db/workOrderBilling.ts :: work_orders #1': 'bounded: .in(id) over the listed work orders / invoices',
  'pmo-portal/src/lib/db/workOrders.ts :: work_orders #1': 'bounded: work orders of one project',
};

function selfTest() {
  const bad = `export const f = () => supabase.from('things').select('*').order('id');`;
  const paged = `export const f = () => fetchAllPages((a, b) => supabase.from('things').select('*').range(a, b));
  const g = () => supabase.from('things').select('*').eq('id', x).single();
  const h = () => supabase.from('things').select('id', { count: 'exact', head: true });
  const w = () => supabase.from('things').insert(r).select().single();
  const l = () => supabase.from('things').select('*').order('id').limit(50);`;
  const o = findOffenders('x.ts', bad);
  const fails = [];
  if (o.join() !== 'x.ts :: things #1') fails.push(`offender not caught: ${o}`);
  if (findOffenders('x.ts', paged).length) fails.push('paged/bounded read flagged');
  if (compare(o, []).fresh.length !== 1) fails.push('new offender not reported');
  if (compare([], ['gone #1']).stale.length !== 1) fails.push('stale entry not reported');
  if (compare(o, o).fresh.length + compare(o, o).stale.length) fails.push('matched allowlist flagged');
  if (fails.length) { console.error('check-unpaged-reads self-test FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('check-unpaged-reads self-test OK');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    const offenders = listFiles(resolve(REPO, DB_DIR)).sort()
      .flatMap((f) => findOffenders(relative(REPO, f), readFileSync(f, 'utf8')));
    const { fresh, stale } = compare(offenders, Object.keys(ALLOWLIST));
    if (fresh.length || stale.length) {
      for (const k of fresh) console.error(`UNPAGED READ: ${k}\n  add .range()/.limit()/pagedRead (or allowlist with a reason if provably bounded)`);
      for (const k of stale) console.error(`STALE ALLOWLIST ENTRY: ${k}\n  no longer an offender; remove it`);
      process.exit(1);
    }
    console.log(`check-unpaged-reads OK (${offenders.length} allowlisted, 0 new)`);
  }
}
