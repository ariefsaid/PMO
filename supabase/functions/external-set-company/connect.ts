/**
 * ECA setup verbs (FR-ECA-001/002/012/015), tier-agnostic: the adapter comes from the registry, never a branch on tier.
 * The census runs on the service client with the org the caller's profile names (NFR-ECA-003). Every write a person decides
 * (accept, decide, unlink) runs as the CALLER, so the database re-asserts org, membership and role and audits the real actor.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { takeCensus } from '../../../pmo-portal/src/lib/adapterSeam/connect/census.ts';
import { connectAdapterForOrg } from '../_shared/connectAdapterForOrg.ts';
import { pmoMasterCounts } from '../_shared/connectPmoMasters.ts';

export const CONNECT_ACTIONS = new Set(['census', 'connect-status', 'list-proposals', 'accept-proposals', 'decide-review', 'unlink-match', 'retry-send']);

const KINDS = ['party', 'item', 'project', 'employee', 'account'];
const STATES = ['open', 'sending', 'applied', 'dismissed'];
const LIST_PAGE = 200;
/** Each accept call applies ≤ 500 rows inside the user statement timeout; a request makes at most this many, and says what is left. */
const ACCEPT_CALLS_PER_REQUEST = 20;
/** ... and stops once this much time has passed, so one request ends before the platform's request limit. */
const ACCEPT_BUDGET_MS = 60_000;
/** Tiers whose sweep pass advances a setup run. A census starts a run, so a tier without a pass would leave it open forever. */
const CENSUS_TIERS = new Set(['erpnext']);

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
  // The raisers in migration 0480 speak plain words; anything else is not ours to explain.
  if (e.code === 'P0001' || e.code === '22023') return new AppError(e.message ?? 'The request was refused', 'BAD_REQUEST');
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
  if (action === 'connect-status' || action === 'decide-review') return true;   // the database limits a Finance decision to account rows
  return (action === 'list-proposals' || action === 'accept-proposals') && kind === 'account';
}

async function connectStatus(c: SupabaseClient, tier: string) {
  const [run, census, sending] = await Promise.all([
    c.from('erp_connect_runs').select('id, state, finished_at, error_class').eq('external_tier', tier).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    c.from('erp_connect_census').select('kind, pmo_count, erp_count, linked_count, inactive_erp_count, scenario, accepted_at').eq('external_tier', tier),
    c.from('erp_connect_proposals').select('id', { count: 'exact', head: true }).eq('external_tier', tier).eq('state', 'sending'),
  ]);
  if (run.error || census.error || sending.error) throw new AppError('The request could not be completed', 'INTERNAL');
  // Minor 10: sends park in `sending` until the ERP confirms them; the screen says "waiting for send", never "done".
  return { run: run.data ?? null, census: census.data ?? [], waitingForSend: sending.count ?? 0 };
}

async function listProposals(c: SupabaseClient, tier: string, body: Record<string, unknown>) {
  const state = typeof body.state === 'string' && STATES.includes(body.state) ? body.state : 'open';
  let q = c.from('erp_connect_proposals').select('*').eq('external_tier', tier).eq('state', state).order('id', { ascending: true }).limit(LIST_PAGE);
  if (typeof body.kind === 'string') q = q.eq('kind', body.kind);
  if (typeof body.outcome === 'string') q = q.eq('outcome', body.outcome);
  if (typeof body.afterId === 'string') q = q.gt('id', body.afterId);
  const { data, error } = await q;
  if (error) throw new AppError('The request could not be completed', 'INTERNAL');
  const proposals = data ?? [];
  return { proposals, nextAfterId: proposals.length === LIST_PAGE ? String((proposals[proposals.length - 1] as { id: string }).id) : null };
}

export async function handleConnectAction(ctx: ConnectCtx): Promise<unknown> {
  const { body } = ctx;
  const tier = typeof body.tier === 'string' ? body.tier : '';
  const action = String(body.setupAction);
  if (!CONNECT_ACTIONS.has(action)) throw new AppError('Unknown action', 'BAD_REQUEST');
  if (body.kind !== undefined && body.kind !== null && !KINDS.includes(String(body.kind))) throw new AppError('Unknown kind', 'BAD_REQUEST');
  if (!allowed(action, ctx.role, body.kind)) throw new AppError('Not allowed for your role', 'FORBIDDEN');
  if ((action === 'unlink-match' || action === 'retry-send') && ctx.role !== 'Admin') throw new AppError('Not allowed for your role', 'FORBIDDEN');

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
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : null;
    const counts: Counts = {};
    let remaining = 0;
    const startedAt = Date.now();
    for (let i = 0; i < ACCEPT_CALLS_PER_REQUEST; i += 1) {
      const r = await rpc<{ counts: Counts; remaining: number }>(ctx.callerClient, 'accept_connect_proposals', { p_tier: tier, p_kind: body.kind ?? null, p_ids: ids });
      addCounts(counts, r.counts);
      remaining = r.remaining;
      if (remaining === 0 || applied(r.counts) === 0 || Date.now() - startedAt >= ACCEPT_BUDGET_MS) break;
    }
    return { counts, remaining };
  }
  if (action === 'decide-review') return await rpc(ctx.callerClient, 'decide_connect_review', { p_id: body.id, p_choice: body.choice });
  if (action === 'unlink-match') return await rpc(ctx.callerClient, 'unlink_connect_match', { p_id: body.id });
  if (action === 'retry-send') return await rpc(ctx.callerClient, 'retry_connect_send', { p_id: body.id });
  if (action === 'list-proposals') return await listProposals(ctx.callerClient, tier, body);
  return await connectStatus(ctx.callerClient, tier);
}
