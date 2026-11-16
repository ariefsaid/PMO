/**
 * #895 — the dispatch parts for a manual journal on Odoo: the adapter and the outbox deps for domain `accounting`. The
 * adapter itself is `odoo/journal/adapter.ts`. The command reaching here was already rebuilt from server truth by
 * `journalGuard.ts` (the approved journal re-read under the caller's JWT), so nothing below reads the request payload.
 *
 * A probe that finds no anchored move is HELD, never reissued (OBS-ACD-002): the anchor is a second write after the
 * create, so a miss cannot prove the move was never made, and a second post would double the entry in the ledger.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { LedgerJournal } from '../../../pmo-portal/src/lib/adapterSeam/ledgerJournal.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER, toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import {
  ACCOUNTING_DOMAIN, createOdooJournalAdapter, jakartaToday, odooJournalReissueOnInconclusiveAbsence, recoverOdooJournal,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/journal/adapter.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { withOdooCallBudget } from '../_shared/odooCallBudget.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';

type Resolved = Exclude<OdooClientForOrgResult, { refusal: unknown }>;

function journalOf(ctx: AdapterSelectContext): LedgerJournal {
  if (ctx.command.domain !== ACCOUNTING_DOMAIN || ctx.command.operation !== 'create' || ctx.command.record.erp_doc_kind !== 'manual-journal') {
    throw new AppError('only a manual-journal create is sent to Odoo', 'config-rejected');
  }
  const journal = ctx.command.record.journal as LedgerJournal | undefined;
  if (!journal || typeof journal.key !== 'string' || journal.key !== ctx.command.idempotencyKey) {
    throw new AppError('the journal command was not rebuilt from the approved journal', 'commit-rejected');
  }
  return journal;
}

async function resolveClient(ctx: AdapterSelectContext): Promise<Resolved> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  return resolved;
}

const guarded = (raw: OdooCall): OdooCall => async <T>(model: string, method: string, body?: Record<string, unknown>) => {
  try { return await raw<T>(model, method, body); } catch (err) { return toAdapterError(err); }
};

/** The Odoo adapter for one approved manual journal (post, or reverse when it names the original). */
export async function resolveOdooJournalAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  journalOf(ctx);
  const resolved = await resolveClient(ctx);
  const call = bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS });
  return createOdooJournalAdapter({ call, bindingConfig: (resolved.config ?? null) as Record<string, unknown> | null });
}

/** The DB-backed outbox deps for one journal: the shared outbox, claim, fence and finalize; the anchor probe recovers. */
export async function resolveOdooJournalMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const journal = journalOf(ctx);
  const resolved = await resolveClient(ctx);
  const call = guarded(withOdooCallBudget(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget));
  return createDbMoneyOutboxDeps({
    serviceClient: ctx.serviceClient as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: 'create',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: odooJournalReissueOnInconclusiveAbsence(ACCOUNTING_DOMAIN),
    payload: ctx.command.record as Record<string, unknown>,
    // M-3: the key is bound to the server-read body, so a key reused with a different journal is refused.
    payloadDigest: await canonicalCommandDigest({ domain: ACCOUNTING_DOMAIN, operation: 'create', record: ctx.command.record as Record<string, unknown> }),
    probeByRemarksKey: async () => recoverOdooJournal(call, journal, jakartaToday()),
  });
}
