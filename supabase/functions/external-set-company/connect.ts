/**
 * ECA setup verbs (FR-ECA-001/002/012/015), tier-agnostic: the adapter comes from the registry, never a branch on tier.
 * The census runs on the service client with the org the caller's profile names (NFR-ECA-003). Every write a person decides
 * (accept, decide, unlink) runs as the CALLER, so the database re-asserts org, membership and role and audits the real actor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { takeCensus } from '../../../pmo-portal/src/lib/adapterSeam/connect/census.ts';
import type { MasterKind, NormalisedMaster } from '../../../pmo-portal/src/lib/adapterSeam/connect/types.ts';
import { proposeMatches } from '../../../pmo-portal/src/lib/adapterSeam/connect/match.ts';
import { connectAdapterForOrg, hasConnectAdapterForTier } from '../_shared/connectAdapterForOrg.ts';
import { allRows, pmoMasterCounts, pmoMasters } from '../_shared/connectPmoMasters.ts';
import { toRow } from '../_shared/connectRun.ts';
import { stockMatchingCapabilities } from '../../../pmo-portal/src/lib/adapterSeam/capabilityMap.ts';
import { erpSyncFeatureDecision } from './featureGate.ts';
import { companyDefaultOptions, setCompanyDefaults } from './companyDefaults.ts';

export const CONNECT_ACTIONS = new Set(['census', 'connect-status', 'list-proposals', 'search-connect-staged', 'accept-proposals', 'decide-review', 'unlink-match', 'retry-send', 'stock-propose', 'stock-list', 'account-groups', 'send-account', 'company-defaults-options', 'set-company-defaults']);

const KINDS = ['party', 'item', 'project', 'employee', 'account', 'stock_item', 'stock_warehouse'];
const STOCK_KINDS: MasterKind[] = ['stock_item', 'stock_warehouse'];
const STATES = ['open', 'sending', 'applied', 'dismissed'];
const LIST_PAGE = 200;
/** Each accept call applies ≤ 500 rows inside the user statement timeout; a request makes at most this many, and says what is left. */
const ACCEPT_CALLS_PER_REQUEST = 20;
/** ... and stops once this much time has passed, so one request ends before the platform's request limit. */
const ACCEPT_BUDGET_MS = 60_000;
/** Tiers whose sweep pass advances a setup run. A census starts a run, so a tier without a pass would leave it open forever. */
const CENSUS_TIERS = new Set(['erpnext', 'odoo']);
const ERP_SYNC_GATED_ACTIONS = new Set(['census', 'accept-proposals', 'stock-propose', 'send-account', 'set-company-defaults']);
/** #1599 ECX-3: accounting configuration, Admin or Finance (the database re-asserts it). */
const COMPANY_DEFAULTS_ACTIONS = new Set(['company-defaults-options', 'set-company-defaults']);

export interface ConnectCtx {
  serviceClient: SupabaseClient;
  callerClient: SupabaseClient;
  orgId: string;
  userId: string;
  role: string;
  body: Record<string, unknown>;
}

function rpcFailure(e: { code?: string; message?: string }): AppError {
  if (e.code === '42501') return new AppError('Not allowed for your role', 'FORBIDDEN');
  if (e.code === 'P0002') return new AppError(e.message ?? 'Not found', 'NOT_FOUND');
  // The raisers in migration 0480 and 0880 speak plain words; anything else is not ours to explain.
  if (e.code === 'P0001' || e.code === '22023' || (e.message && /^Stock\s/i.test(e.message))) return new AppError(e.message ?? 'The request was refused', 'BAD_REQUEST');
  return new AppError('The request could not be completed', 'INTERNAL');
}

async function rpc<T>(c: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw rpcFailure(error);
  return data as T;
}

type Counts = Record<string, Record<string, number>>;
function addCounts(into: Counts, from: Counts): void {
  for (const [kind, fields] of Object.entries(from ?? {})) {
    into[kind] ??= {};
    for (const [f, n] of Object.entries(fields)) into[kind][f] = (into[kind][f] ?? 0) + n;
  }
}
const applied = (c: Counts) => Object.values(c).reduce((a, f) => a + Object.values(f).reduce((x, y) => x + y, 0), 0);

function allowed(action: string, role: string, kind: unknown): boolean {
  if (role === 'Admin') return true;
  if (role !== 'Finance') return false;
  if (action === 'connect-status' || COMPANY_DEFAULTS_ACTIONS.has(action)) return true;
  if (action === 'decide-review') return kind === 'account';
  // #1599 ECX-4 (OQ-ECX-1): Finance creates direct-cost accounts; the database re-asserts the role
  if (action === 'account-groups' || action === 'send-account') return true;
  return (action === 'list-proposals' || action === 'search-connect-staged' || action === 'accept-proposals') && kind === 'account';
}

async function connectStatus(c: SupabaseClient, tier: string) {
  const [run, census, sending, proposalCounts] = await Promise.all([
    c.from('erp_connect_runs').select('id, state, finished_at, error_class').eq('external_tier', tier).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    c.from('erp_connect_census').select('kind, pmo_count, erp_count, linked_count, inactive_erp_count, scenario, accepted_at').eq('external_tier', tier),
    c.from('erp_connect_proposals').select('id', { count: 'exact', head: true }).eq('external_tier', tier).eq('state', 'sending'),
    rpc<Record<string, { link: number; bring_in: number; send: number; review: number; applied_link: number }>>(c, 'connect_proposal_counts', { p_tier: tier }),
  ]);
  if (run.error || census.error || sending.error) throw new AppError('The request could not be completed', 'INTERNAL');
  // Minor 10: sends park in `sending` until the ERP confirms them; the screen says "waiting for send", never "done".
  return { run: run.data ?? null, census: census.data ?? [], waitingForSend: sending.count ?? 0, proposalCounts };
}

type Proposal = Record<string, unknown> & {
  id: string; kind: string; outcome: string; pmo_ids: string[]; external_ids: string[];
  snapshot: Record<string, unknown>; state: string;
};

interface NameQuery extends PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }> {
  in(column: string, values: string[]): NameQuery;
}
interface NameTable {
  select(columns: string): { eq(column: string, value: string): NameQuery };
}

async function proposalNames(client: SupabaseClient, orgId: string, proposals: Proposal[]): Promise<Proposal[]> {
  const names = new Map<string, string>();
  const codes = new Map<string, string>();
  const kindTables: Record<string, { table: string; column: string; codeColumn?: string; ids: string[] }> = {};
  for (const proposal of proposals) {
    const config = proposal.kind === 'party' ? { table: 'companies', column: 'name' }
      : proposal.kind === 'project' ? { table: 'projects', column: 'name' }
      : proposal.kind === 'employee' ? { table: 'profiles', column: 'full_name' }
      : proposal.kind === 'stock_item' ? { table: 'stock_items', column: 'name', codeColumn: 'code' }
      : proposal.kind === 'stock_warehouse' ? { table: 'stock_warehouses', column: 'name', codeColumn: 'code' } : null;
    if (!config) {
      for (const id of proposal.pmo_ids ?? []) names.set(`${proposal.kind}:${id}`, id);
      continue;
    }
    const target = kindTables[proposal.kind] ??= { table: config.table, column: config.column, codeColumn: config.codeColumn, ids: [] };
    target.ids.push(...(proposal.pmo_ids ?? []));
  }
  const scopedClient = client as unknown as { from: (table: string) => NameTable };
  for (const [kind, target] of Object.entries(kindTables)) {
    const ids = [...new Set(target.ids)].filter((id) => id.length > 0);
    if (!ids.length) continue;
    const selectCols = target.codeColumn ? `id, ${target.column}, ${target.codeColumn}` : `id, ${target.column}`;
    const { data, error } = await scopedClient.from(target.table).select(selectCols).eq('org_id', orgId).in('id', ids);
    if (error) throw new AppError('The request could not be completed', 'INTERNAL');
    for (const row of data ?? []) {
      names.set(`${kind}:${String(row.id)}`, String(row[target.column] ?? row.id));
      if (target.codeColumn && row[target.codeColumn]) {
        codes.set(`${kind}:${String(row.id)}`, String(row[target.codeColumn]));
      }
    }
  }
  return proposals.map((proposal) => ({
    ...proposal,
    pmo_name: (proposal.pmo_ids ?? []).map((id) => names.get(`${proposal.kind}:${id}`) ?? id).join(', ') || null,
    pmo_code: (proposal.pmo_ids ?? []).map((id) => codes.get(`${proposal.kind}:${id}`)).filter(Boolean).join(', ') || null,
    erp_name: proposal.outcome === 'send' ? null
      : String(proposal.snapshot?.employeeName ?? proposal.snapshot?.accountName ?? proposal.snapshot?.itemName ?? proposal.snapshot?.item_name
        ?? proposal.snapshot?.name ?? proposal.snapshot?.code ?? proposal.external_ids?.[0] ?? '') || null,
    erp_code: proposal.snapshot?.code ? String(proposal.snapshot.code) : null,
    can_unlink: false,
  }));
}

async function listProposals(ctx: ConnectCtx, tier: string, body: Record<string, unknown>) {
  const c = ctx.callerClient;
  const state = typeof body.state === 'string' && STATES.includes(body.state) ? body.state : 'open';
  let q = c.from('erp_connect_proposals').select('*').eq('external_tier', tier).eq('state', state).order('id', { ascending: true }).limit(LIST_PAGE);
  if (typeof body.kind === 'string') q = q.eq('kind', body.kind);
  if (typeof body.outcome === 'string') q = q.eq('outcome', body.outcome);
  if (typeof body.afterId === 'string') q = q.gt('id', body.afterId);
  const { data, error } = await q;
  if (error) throw new AppError('The request could not be completed', 'INTERNAL');
  const proposals = await proposalNames(ctx.serviceClient, ctx.orgId, (data ?? []) as Proposal[]);
  // Older account reviews asserted a best-effort notification had succeeded. It may not have.
  for (const proposal of proposals) {
    if (proposal.kind === 'account' && typeof proposal.reason_text === 'string') {
      proposal.reason_text = proposal.reason_text.replace('; your administrator has been told.', '. Contact your administrator.');
    }
  }
  if (state === 'applied' && ctx.role === 'Admin' && proposals.length > 0) {
    const ids = proposals.filter((p) => p.outcome === 'link').map((p) => p.id);
    const unlinkable = new Set(await rpc<string[]>(ctx.callerClient, 'list_unlinkable_connect_matches', { p_ids: ids }));
    for (const proposal of proposals) proposal.can_unlink = unlinkable.has(proposal.id);
  }
  return { proposals, nextAfterId: proposals.length === LIST_PAGE ? String(proposals[proposals.length - 1].id) : null };
}

async function stockPropose(ctx: ConnectCtx, tier: string) {
  if (ctx.role !== 'Admin') throw new AppError('Not allowed for your role', 'FORBIDDEN');
  if (!stockMatchingCapabilities(tier).stockMatching) throw new AppError('Stock matching is only available for Odoo', 'BAD_REQUEST');

  const { data: binding, error: bindingError } = await ctx.serviceClient
    .from('external_org_bindings')
    .select('id, site_url, secret_ref, status, activated_at, config')
    .eq('org_id', ctx.orgId)
    .eq('external_tier', tier)
    .maybeSingle();

  if (bindingError || !binding || binding.status !== 'active' || !binding.activated_at) {
    throw new AppError('Stock links require an active Odoo connection', 'BAD_REQUEST');
  }
  const companyId = binding.config?.odoo_company_id;
  if (!companyId || !/^[1-9][0-9]*$/.test(String(companyId))) {
    throw new AppError('Choose an Odoo company before linking stock', 'BAD_REQUEST');
  }

  const adapter = await connectAdapterForOrg(ctx.serviceClient, ctx.orgId, tier);
  const runId = await rpc<string>(ctx.serviceClient, 'start_connect_run', {
    p_org_id: ctx.orgId,
    p_tier: tier,
    p_actor: ctx.userId,
  });

  const CHUNK = 1000;
  const stagedCounts: Record<string, number> = {};
  const proposedCounts: Record<string, { link: number; review: number }> = {};
  for (const kind of STOCK_KINDS) {
    let cursor: string | null = null;
    const allErpRows: NormalisedMaster[] = [];
    do {
      const page = await adapter.listMasters(kind, cursor);
      await rpc(ctx.serviceClient, 'stage_connect_master_page', {
        p_org_id: ctx.orgId,
        p_run_id: runId,
        p_kind: kind,
        p_rows: page.rows,
        p_next_cursor: page.nextCursor,
      });
      allErpRows.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor !== null);

    const domain = kind === 'stock_item' ? 'stock_items' : 'stock_warehouses';
    const linkedRefs = await allRows(ctx.serviceClient, 'external_refs', 'id, pmo_record_id, external_record_id', ctx.orgId,
      (q) => q.eq('external_tier', tier).eq('domain', domain));
    const alreadyLinked = {
      pmoIds: new Set(linkedRefs.map((r) => String(r.pmo_record_id))),
      externalIds: new Set(linkedRefs.map((r) => String(r.external_record_id))),
    };

    const pmo = await pmoMasters(ctx.serviceClient, ctx.orgId, kind);
    const outcomes = proposeMatches(kind, pmo, allErpRows, alreadyLinked);
    const erpById = new Map(allErpRows.map((e) => [e.externalId, e]));
    const pmoNames = new Map(pmo.map((m) => [m.id, m.name]));
    const rows = outcomes.map((o) => toRow(kind, o, (id) => erpById.get(id), (id) => pmoNames.get(id)));
    stagedCounts[kind] = allErpRows.length;
    proposedCounts[kind] = {
      link: rows.filter((r) => r.outcome === 'link').length,
      review: rows.filter((r) => r.outcome === 'review').length,
    };
    const chunks = Math.max(1, Math.ceil(rows.length / CHUNK));
    for (let i = 0; i < chunks; i += 1) {
      await rpc(ctx.serviceClient, 'replace_connect_proposals', {
        p_org_id: ctx.orgId,
        p_tier: tier,
        p_run_id: runId,
        p_kind: kind,
        p_rows: rows.slice(i * CHUNK, (i + 1) * CHUNK),
        p_last: i === chunks - 1,
      });
    }
  }

  const { error: readyError } = await ctx.serviceClient
    .from('erp_connect_runs')
    .update({ state: 'ready', finished_at: new Date().toISOString() })
    .eq('id', runId);
  if (readyError) throw new AppError('The request could not be completed', 'INTERNAL');

  return { ok: true, runId, stagedCounts, proposedCounts };
}

async function stockList(ctx: ConnectCtx, tier: string, body: Record<string, unknown>) {
  if (ctx.role !== 'Admin') throw new AppError('Not allowed for your role', 'FORBIDDEN');
  if (!stockMatchingCapabilities(tier).stockMatching) throw new AppError('Stock matching is only available for Odoo', 'BAD_REQUEST');
  const c = ctx.callerClient;
  const state = typeof body.state === 'string' && STATES.includes(body.state) ? body.state : 'open';
  let q = c.from('erp_connect_proposals').select('*')
    .eq('external_tier', tier)
    .eq('state', state)
    .in('kind', STOCK_KINDS)
    .order('id', { ascending: true })
    .limit(LIST_PAGE);
  if (typeof body.kind === 'string') q = q.eq('kind', body.kind);
  if (typeof body.outcome === 'string') q = q.eq('outcome', body.outcome);
  if (typeof body.afterId === 'string') q = q.gt('id', body.afterId);
  const { data, error } = await q;
  if (error) throw new AppError('The request could not be completed', 'INTERNAL');
  const proposals = await proposalNames(ctx.serviceClient, ctx.orgId, (data ?? []) as Proposal[]);

  if (state === 'applied' && proposals.length > 0) {
    const ids = proposals.filter((p) => p.outcome === 'link').map((p) => p.id);
    const unlinkable = new Set(await rpc<string[]>(ctx.callerClient, 'list_unlinkable_connect_matches', { p_ids: ids }));
    for (const proposal of proposals) proposal.can_unlink = unlinkable.has(proposal.id);
  }

  // The whole run, not this page: open link and review rows per stock kind.
  const all = await rpc<Record<string, { link?: number; review?: number }>>(ctx.callerClient, 'connect_proposal_counts', { p_tier: tier });
  const counts = Object.fromEntries(STOCK_KINDS.map((k) => [k, { link: all?.[k]?.link ?? 0, review: all?.[k]?.review ?? 0 }]));

  return {
    proposals,
    counts,
    nextAfterId: proposals.length === LIST_PAGE ? String(proposals[proposals.length - 1].id) : null,
  };
}

export async function handleConnectAction(ctx: ConnectCtx): Promise<unknown> {
  const { body } = ctx;
  const tier = typeof body.tier === 'string' ? body.tier : '';
  const action = String(body.setupAction);
  if (!CONNECT_ACTIONS.has(action)) throw new AppError('Unknown action', 'BAD_REQUEST');
  if (body.kind !== undefined && body.kind !== null && !KINDS.includes(String(body.kind))) throw new AppError('Unknown kind', 'BAD_REQUEST');
  if (!allowed(action, ctx.role, body.kind)) throw new AppError('Not allowed for your role', 'FORBIDDEN');
  if ((action === 'unlink-match' || action === 'retry-send') && ctx.role !== 'Admin') throw new AppError('Not allowed for your role', 'FORBIDDEN');

  // A census starts new integration work, and accepting proposals can mint new ERP writes. Existing
  // decisions, unlink cleanup and retry recovery remain available while the module is off.
  if (ERP_SYNC_GATED_ACTIONS.has(action) && hasConnectAdapterForTier(tier)) {
    const decision = await erpSyncFeatureDecision(ctx.serviceClient, ctx.orgId);
    if (decision === 'unavailable') throw new AppError('Could not resolve the plan switch', 'INTERNAL');
    if (decision === 'off') throw new AppError('ERP integration is not enabled for this organization', 'feature_off');
  }

  if (action === 'company-defaults-options') return await companyDefaultOptions(ctx, tier);
  if (action === 'set-company-defaults') return await setCompanyDefaults(ctx, tier, rpcFailure);

  if (action === 'census') {
    if (ctx.role !== 'Admin') throw new AppError('Not allowed for your role', 'FORBIDDEN');
    if (!CENSUS_TIERS.has(tier)) throw new AppError('Setting up this ERP is not available yet', 'BAD_REQUEST');
    try {
      const adapter = await connectAdapterForOrg(ctx.serviceClient, ctx.orgId, tier);
      // Count first: an unreachable ERP leaves no half-started run behind.
      const census = await takeCensus(adapter, await pmoMasterCounts(ctx.serviceClient, ctx.orgId));
      const runId = await rpc<string>(ctx.serviceClient, 'start_connect_run', { p_org_id: ctx.orgId, p_tier: tier, p_actor: ctx.userId });
      await rpc(ctx.serviceClient, 'write_connect_census', { p_org_id: ctx.orgId, p_tier: tier, p_rows: census });
      return { runId, census };
    } catch (err) {
      if (err instanceof AdapterError) {
        throw err.code === 'external-unreachable' ? new AppError('The ERP could not be reached', 'external-unreachable')
          : new AppError('The ERP refused the request', 'config-rejected');
      }
      throw err;
    }
  }
  if (action === 'accept-proposals') {
    // There is no preview here: a preview is the list. A body that asks for one must not be answered by applying.
    if (body.dryRun !== undefined) throw new AppError('Accepting has no dry run; list the proposals instead', 'BAD_REQUEST');
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
    const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds.map(String) : null;
    const counts: Counts = {};
    let remaining = 0;
    const startedAt = Date.now();
    for (let i = 0; i < ACCEPT_CALLS_PER_REQUEST; i += 1) {
      const r = await rpc<{ counts: Counts; remaining: number }>(ctx.callerClient, 'accept_connect_proposals', {
        p_tier: tier, p_kind: body.kind ?? null, p_ids: ids, p_exclude: excludeIds,
      });
      addCounts(counts, r.counts);
      remaining = r.remaining;
      if (remaining === 0 || applied(r.counts) === 0 || Date.now() - startedAt >= ACCEPT_BUDGET_MS) break;
    }
    return { counts, remaining };
  }
  if (action === 'search-connect-staged') {
    const query = typeof body.query === 'string' ? body.query.slice(0, 120) : '';
    const records = await rpc<Array<{ external_id: string; name: string; code: string }>>(ctx.callerClient, 'search_connect_staged', {
      p_tier: tier, p_kind: body.kind, p_query: query, p_limit: 20,
    });
    return { records };
  }
  if (action === 'stock-propose') return await stockPropose(ctx, tier);
  if (action === 'stock-list') return await stockList(ctx, tier, body);
  if (action === 'decide-review') {
    if (ctx.role !== 'Admin' && body.kind && body.kind !== 'account') throw new AppError('Not allowed for your role', 'FORBIDDEN');
    return await rpc(ctx.callerClient, 'decide_connect_review', { p_id: body.id, p_choice: body.choice });
  }
  if (action === 'unlink-match') return await rpc(ctx.callerClient, 'unlink_connect_match', { p_id: body.id });
  if (action === 'retry-send') return await rpc(ctx.callerClient, 'retry_connect_send', { p_id: body.id });
  if (action === 'account-groups') {
    const rows = await rpc<Array<{ erp_name: string; account_name: string; parent_account: string | null }>>(ctx.callerClient, 'account_send_groups', { p_tier: tier });
    return { groups: (rows ?? []).map((r) => ({ erpName: r.erp_name, accountName: r.account_name, parentAccount: r.parent_account })) };
  }
  if (action === 'send-account') {
    // a blank name never reaches the database or the ERP (the ERP answers a missing name with a server error)
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const accountName = typeof body.accountName === 'string' ? body.accountName.trim() : '';
    if (!accountName) throw new AppError('Give the account a name', 'BAD_REQUEST');
    const id = await rpc<string>(ctx.callerClient, 'request_account_send', {
      p_tier: tier, p_category: text(body.category, 80), p_parent_account: text(body.parentAccount, 200), p_account_name: accountName,
    });
    return { id };
  }
  if (action === 'list-proposals') return await listProposals(ctx, tier, body);
  return await connectStatus(ctx.callerClient, tier);
}
