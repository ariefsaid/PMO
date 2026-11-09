/**
 * What PMO holds, for the connect census and matcher (ECA-2). Service-role reads, always scoped by the org the caller
 * resolved from the binding (NFR-ECA-003). Counts are head requests (no `max_rows` cap applies); distinct item names need
 * a row read, paged by keyset.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MasterKind, PmoMaster, CensusDomain, PmoProjectCodeField } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { Constants } from '../../../pmo-portal/src/lib/supabase/database.types.ts';

const PAGE = 1000;

/**
 * One definition of an "open" purchase (#1736): the database holds it (`connect_open_purchase_statuses`, 0703), the new-item send queue
 * calls it and this read carries the same answer to the census and to the drain. Never restate the list here — a second copy is exactly
 * the drift that put a Draft line in front of the Admin while the queue never sent it.
 */
export async function openPurchaseStatuses(sc: SupabaseClient): Promise<string[]> {
  const { data, error } = await sc.rpc('connect_open_purchase_statuses');
  if (error) throw new Error('could not read the open-purchase statuses');
  const statuses = (data ?? []) as string[];
  if (statuses.length === 0) throw new Error('the open-purchase statuses are empty');
  return statuses;
}

/** Distinct names of the items on procurements that are still open, as `{id, name}` keyset pages. */
async function* itemNamePages(sc: SupabaseClient, orgId: string, statuses: string[]): AsyncGenerator<Array<{ id: string; name: string }>> {
  let after: string | null = null;
  for (;;) {
    let q = sc.from('procurement_items').select('id, name, procurements!inner(status)').eq('org_id', orgId)
      .in('procurements.status', statuses).order('id', { ascending: true }).limit(PAGE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error('could not read the PMO items');
    const rows = (data ?? []) as Array<{ id: string; name: string }>;
    if (rows.length > 0) yield rows;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1].id;
  }
}

async function distinctItemNames(sc: SupabaseClient, orgId: string): Promise<string[]> {
  const names = new Set<string>();
  const statuses = await openPurchaseStatuses(sc);
  for await (const page of itemNamePages(sc, orgId, statuses)) for (const r of page) if (r.name) names.add(r.name);
  return [...names];
}

async function head(q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error('could not count the PMO records');
  return count ?? 0;
}
const countOf = (sc: SupabaseClient, table: string, orgId: string) => sc.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);

/** The budget categories that carry at least one line: the PMO side of the account census. */
async function categoriesInUse(sc: SupabaseClient, orgId: string): Promise<string[]> {
  const used = await Promise.all(Constants.public.Enums.budget_category.map(async (c) =>
    (await head(countOf(sc, 'budget_line_items', orgId).eq('category', c))) > 0 ? c : null));
  return used.filter((c): c is typeof Constants.public.Enums.budget_category[number] => c !== null);
}

/** FR-ECA-001: kinds and the six money domains. Domains are PMO's own documents only (an ERP-brought-in row is not PMO's). */
export async function pmoMasterCounts(sc: SupabaseClient, orgId: string): Promise<Partial<Record<MasterKind | CensusDomain, number>>> {
  const [party, project, employee, item, account, budget, purchase, invoice, receipt, payment, timesheet] = await Promise.all([
    head(countOf(sc, 'companies', orgId).in('type', ['Client', 'Vendor']).is('archived_at', null)),
    head(countOf(sc, 'projects', orgId).is('archived_at', null)),
    head(countOf(sc, 'profiles', orgId).eq('status', 'active')),
    distinctItemNames(sc, orgId).then((n) => n.length),
    categoriesInUse(sc, orgId).then((c) => c.length),
    head(countOf(sc, 'budget_versions', orgId).eq('status', 'Active')),
    head(countOf(sc, 'procurements', orgId).neq('status', 'Cancelled')),
    head(countOf(sc, 'sales_invoices', orgId).eq('pmo_native', true).neq('status', 'Cancelled')),
    head(countOf(sc, 'incoming_payments', orgId).eq('pmo_native', true)),
    head(countOf(sc, 'payments', orgId).is('erp_docstatus', null)),
    head(countOf(sc, 'timesheets', orgId).eq('status', 'Approved')),
  ]);
  return { party, project, employee, item, account, budget, purchase, invoice, receipt, payment, timesheet };
}

/** The few filter calls these reads use. supabase-js's own builder type is too deep to carry through a helper. */
interface Query extends PromiseLike<{ data: unknown; error: unknown }> {
  eq(col: string, v: unknown): Query; in(col: string, v: unknown[]): Query; is(col: string, v: null): Query;
  gt(col: string, v: string): Query; order(col: string, o: { ascending: boolean }): Query; limit(n: number): Query;
}

/** Every row of an org-scoped read, by keyset on `id`, a page under the platform row cap at a time. */
async function allRows(sc: SupabaseClient, table: string, cols: string, orgId: string, narrow: (q: Query) => Query): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let after: string | null = null;
  for (;;) {
    let q = narrow((sc.from(table).select(cols) as unknown as Query).eq('org_id', orgId)).order('id', { ascending: true }).limit(PAGE);
    if (after) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error('could not read the PMO records');
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    out.push(...page);
    if (page.length < PAGE) return out;
    after = String(page[page.length - 1].id);
  }
}

/** The PMO side of the matcher for one kind. A project is matched on the PMO column the ERP's connect adapter declares
 *  (#1692): an ERPNext project is named by the client project code, an Odoo cost account carries the PMO project number
 *  (FR-ODC-072) — so nothing here knows a tier. An adapter may declare a second column (#2052); its value rides as `altCodes`. The employee `code` is the lower-cased work email (people link on a key,
 *  never a name). */
export async function pmoMasters(
  sc: SupabaseClient,
  orgId: string,
  kind: MasterKind,
  projectCodeField: PmoProjectCodeField = 'code',
  projectAltCodeField?: PmoProjectCodeField,
): Promise<PmoMaster[]> {
  if (kind === 'party') {
    return (await allRows(sc, 'companies', 'id, name, type, erp_tax_id', orgId, (q) => q.in('type', ['Client', 'Vendor']).is('archived_at', null)))
      .map((r) => ({ id: String(r.id), name: String(r.name), role: r.type === 'Client' ? 'client' as const : 'vendor' as const, taxId: (r.erp_tax_id as string | null) ?? null }));
  }
  if (kind === 'project') {
    const alt = projectAltCodeField && projectAltCodeField !== projectCodeField ? projectAltCodeField : null;
    return (await allRows(sc, 'projects', `id, name, ${projectCodeField}${alt ? `, ${alt}` : ''}`, orgId, (q) => q.is('archived_at', null)))
      .map((r) => {
        const altCode = alt ? (r[alt] as string | null) : null;
        return { id: String(r.id), name: String(r.name), code: (r[projectCodeField] as string | null) ?? null, ...(altCode ? { altCodes: [altCode] } : {}) };
      });
  }
  if (kind === 'employee') {
    return (await allRows(sc, 'profiles', 'id, full_name, email', orgId, (q) => q.eq('status', 'active')))
      .map((r) => ({ id: String(r.id), name: String(r.full_name ?? ''), code: String(r.email ?? '').toLowerCase() || null }));
  }
  if (kind === 'item') return (await distinctItemNames(sc, orgId)).map((n) => ({ id: n, name: n, code: n }));
  if (kind === 'account') return (await categoriesInUse(sc, orgId)).map((c) => ({ id: c, name: c, code: c }));
  return [];
}
