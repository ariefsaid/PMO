/**
 * The dispatch parts for a connected stock document (#1508): adapter selection, the outbox deps, the held-mirror hook.
 * The adapter is `odoo/stock/stockAdapter.ts`, the one Odoo writer `odoo/stock/picking.ts`, the probe `odoo/stock/recovery.ts`.
 *
 * The command names only the document and the revision the keeper viewed; the org, the actor (JWT), the company (the active
 * binding) and the key (`stock:<uuid>`) are the server's. A refusal (capability, mapping) leaves no outbox row and no Odoo write.
 * An absent anchor on a quarantined row is HELD, never reissued: a picking is moved stock.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { checkStockCapability, checkTransferOperationType } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/capability.ts';
import { INVENTORY_DOMAIN, createOdooStockAdapter, type StockIntentResult } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockAdapter.ts';
import { recoverStockPicking } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/recovery.ts';
import { plainHoldReason } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/holdReason.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { withOdooCallBudget, countOdooCalls } from '../_shared/odooCallBudget.ts';
import { resolveOdooStockMappings } from '../_shared/odooStockMappings.ts';
import { writeOdooStockMirror } from '../_shared/odooStockMirror.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import { stockRefusal } from './readModel/inventory.ts';

export { INVENTORY_DOMAIN };
export const STOCK_DOC_KIND = 'stock-document';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One PMO stock document is one Odoo picking, ever: the key follows the document, never the client's per-click key. */
export function stockKey(record: Record<string, unknown>): string {
  const id = String(record.id);
  if (!UUID.test(id)) throw new AppError('record-id-invalid', 'commit-rejected');
  return `stock:${id}`;
}

/** A command carries only the document id and the integer revision the keeper viewed; anything else is a 422 before any write. */
export function stockCommandShapeError(command: { operation: unknown; record: Record<string, unknown> }): string | null {
  const { record } = command;
  if (command.operation !== 'create') return 'stock-operation-invalid';
  if (record.erp_doc_kind !== STOCK_DOC_KIND) return 'stock-kind-invalid';
  if (!UUID.test(String(record.id))) return 'record-id-invalid';
  if (!Number.isInteger(record.revision) || (record.revision as number) < 0) return 'document-revision-invalid';
  return null;
}

type Resolved = Exclude<OdooClientForOrgResult, { refusal: unknown }>;

async function resolveClient(ctx: AdapterSelectContext): Promise<Resolved> {
  const resolved = await odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId);
  if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
  return resolved;
}

interface DocumentRow {
  id: string; org_id: string; kind: string; number: string; warehouse_id: string; to_warehouse_id: string | null; project_id: string | null;
  stock_document_lines: Array<{ item_id: string; line_no: number; quantity: number | string | null }>;
}

/** The document, its lines and Odoo's view of what it needs, resolved server-side from the document in the caller's org and the active binding. */
async function resolveIntent(ctx: AdapterSelectContext, resolved: Resolved, call: OdooCall): Promise<StockIntentResult> {
  const refuse = (reason: string, message: string): StockIntentResult => ({ ok: false, reason, message });
  const documentId = String(ctx.command.record.id);
  const { data, error } = await (ctx.serviceClient as SupabaseClient).from('stock_documents')
    .select('id,org_id,kind,number,warehouse_id,to_warehouse_id,project_id,stock_document_lines(item_id,line_no,quantity)')
    .eq('org_id', ctx.orgId).eq('id', documentId).maybeSingle();
  if (error) throw new AppError('The stock document could not be read', 'external-unreachable');
  const doc = data as DocumentRow | null;
  if (!doc) return refuse('document-not-found', 'The stock document is not in this organisation.');
  if (doc.kind !== 'transfer' && doc.kind !== 'issue') return refuse('kind-not-connected', `A ${doc.kind} is not posted through Odoo.`);
  const lines = [...doc.stock_document_lines].sort((a, b) => a.line_no - b.line_no);
  if (lines.length === 0 || lines.some((l) => !(Number(l.quantity) > 0))) return refuse('lines-invalid', 'Every line of the document needs a quantity above zero.');
  const companyId = resolved.companyId;
  if (companyId === null) return refuse('company-not-set', 'The Odoo company is not set.');

  const typeId = Number(resolved.config[doc.kind === 'issue' ? 'stock_operation_type_id' : 'stock_transfer_operation_type_id']);
  const hasType = Number.isInteger(typeId) && typeId > 0;
  if (doc.kind === 'issue' && !hasType) return refuse('operation-type-not-set', 'Set the stock operation type in Integration setup before posting issues.');
  const capability = doc.kind === 'issue'
    ? await checkStockCapability(call, companyId, typeId)
    : await checkTransferOperationType(call, companyId, hasType ? typeId : undefined);
  if (!capability.ok) return refuse(capability.reason, capability.message);

  const mapped = await resolveOdooStockMappings(ctx.serviceClient as SupabaseClient, call, {
    orgId: ctx.orgId, companyId, documentId, kind: doc.kind,
    lines: lines.map((l) => ({ stockItemId: l.item_id })),
    sourceWarehouseId: doc.warehouse_id,
    ...(doc.to_warehouse_id ? { destinationWarehouseId: doc.to_warehouse_id } : {}),
    ...(doc.kind === 'issue' ? { operationTypeId: typeId } : {}),
    ...(doc.project_id ? { projectId: doc.project_id } : {}),
  });
  if (!mapped.ok) return refuse(mapped.reason, mapped.message);
  if (mapped.lines.length !== lines.length || mapped.lines.some((l, i) => l.stockItemId !== lines[i].item_id)) {
    return refuse('read-failed', 'The mapped lines do not match the document.');
  }
  return {
    ok: true,
    intent: {
      documentId, kind: doc.kind, companyId,
      lines: mapped.lines.map((l, i) => ({ productId: l.productId, quantity: Number(lines[i].quantity) })),
      sourceLocationId: mapped.sourceLocationId, destinationLocationId: mapped.destinationLocationId,
      ...(mapped.projectId !== undefined ? { projectId: mapped.projectId } : {}),
      ...(mapped.analyticAccountId !== undefined ? { analyticAccountId: mapped.analyticAccountId } : {}),
      pickingTypeId: typeId, origin: doc.number,
    },
  };
}

/** One resolution per request: the adapter's preflight, its commit and the probe read the same intent. */
const intents = new WeakMap<AdapterSelectContext, Promise<StockIntentResult>>();
function intentLoader(ctx: AdapterSelectContext, resolved: Resolved, call: OdooCall): () => Promise<StockIntentResult> {
  return () => {
    let pending = intents.get(ctx);
    if (!pending) { pending = resolveIntent(ctx, resolved, call); intents.set(ctx, pending); }
    return pending;
  };
}

/**
 * Adapter selection for an org that employs inventory under Odoo. Capability and mapping refusals are the adapter's, inside the commit (zero
 * Odoo writes, the row fails and the keeper retries): nothing reaches Odoo before the outbox guard has decided who is posting.
 */
export async function resolveOdooStockAdapter(ctx: AdapterSelectContext): Promise<Adapter> {
  const bad = stockCommandShapeError(ctx.command as never);
  if (bad) throw new AppError(bad, 'commit-rejected');
  const resolved = await resolveClient(ctx);
  // Reads count against the sweep's budget but never cut a commit midway: after `load` answers, every failure must stay recoverable.
  const call = countOdooCalls(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  return createOdooStockAdapter({ call, loadIntent: intentLoader(ctx, resolved, call) });
}

/**
 * The outbox deps: the shared outbox, claim, fence and finalize. A `STK_*` raise from the 0869 guard (insert or claim) is classified;
 * a failed row whose document was edited, or that another keeper re-posts, is refreshed (revision and actor only; the trigger decides).
 */
export async function resolveOdooStockMoneyOutboxDeps(ctx: AdapterSelectContext): Promise<DispatchMoneyOutboxDeps> {
  const bad = stockCommandShapeError(ctx.command as never);
  if (bad) throw new AppError(bad, 'commit-rejected');
  const record = ctx.command.record as Record<string, unknown>;
  const resolved = await resolveClient(ctx);
  const raw = withOdooCallBudget(bindCall({ ...resolved.client, deadlineMs: REQUEST_DEADLINE_MS }), ctx.odooCallBudget);
  const loadIntent = intentLoader(ctx, resolved, raw);
  const sc = ctx.serviceClient as SupabaseClient;
  const payload = { stockDocumentId: String(record.id), documentRevision: record.revision, odooCompanyId: resolved.companyId, erp_doc_kind: STOCK_DOC_KIND };

  const deps = createDbMoneyOutboxDeps({
    serviceClient: sc as never,
    orgId: ctx.orgId,
    externalTier: ODOO_TIER,
    operation: 'create',
    actorUserId: ctx.userId,
    reissueOnInconclusiveAbsence: false,
    payload,
    probeByRemarksKey: async (_domain, _key, probe) => {
      if (probe?.recovery === false) return null;   // a first claim has made nothing yet
      return await recoverStockPicking(raw, { documentId: String(record.id), load: async () => {
        const loaded = await loadIntent();
        if (!loaded.ok) throw new AppError(loaded.message, 'commit-rejected');   // cannot judge a recovered picking: hold it
        return loaded.intent;
      } });
    },
  });

  const classified = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if ((err as { code?: string } | null)?.code !== '23505' && /STK_/.test(message)) throw stockRefusal(message);
      throw err;
    }
  };
  return {
    ...deps,
    async readOutbox(domain, pmoRecordId, idempotencyKey) {
      const row = await deps.readOutbox(domain, pmoRecordId, idempotencyKey);
      if (!row || row.state !== 'failed' || ctx.replay) return row;
      // A person pressing Post again on a failed command: bring the row to the revision they viewed and to them.
      const { data, error } = await sc.from('external_command_outbox').select('payload,actor_user_id').eq('id', row.id).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      const stored = data as { payload?: Record<string, unknown>; actor_user_id?: string } | null;
      if (stored?.payload?.documentRevision === record.revision && stored?.actor_user_id === ctx.userId) return row;
      await classified(async () => {
        const { error: refreshError } = await sc.from('external_command_outbox')
          .update({ payload: { ...stored?.payload, documentRevision: record.revision }, actor_user_id: ctx.userId }).eq('id', row.id);
        if (refreshError) throw new Error(refreshError.message);
      });
      return await deps.readOutbox(domain, pmoRecordId, idempotencyKey);
    },
    insertOutboxPending: (domain, id, key) => classified(() => deps.insertOutboxPending(domain, id, key)),
    claimOutboxForCommit: (id) => classified(() => deps.claimOutboxForCommit(id)),
  };
}

/**
 * A hold writes the exception to the document's evidence mirror, at the generation the hold was produced under, so the keeper
 * and the Admin read why. Best effort: it never masks the hold, and a confirmed mirror is never downgraded (the RPC refuses).
 */
export async function recordStockHold(sc: SupabaseClient, orgId: string, command: { domain: string; record: { id: string } }, failure: AppError): Promise<void> {
  if (command.domain !== INVENTORY_DOMAIN || failure.code !== 'command-held') return;
  const held = failure as AppError & { heldOutboxId?: string; heldClaimGeneration?: number };
  if (typeof held.heldOutboxId !== 'string' || typeof held.heldClaimGeneration !== 'number') return;
  try {
    const { data } = await sc.from('external_command_outbox').select('payload,last_error').eq('id', held.heldOutboxId).maybeSingle();
    const row = data as { payload?: { odooCompanyId?: unknown }; last_error?: unknown } | null;
    const companyId = row?.payload?.odooCompanyId;
    if (typeof companyId !== 'number') return;
    const written = await writeOdooStockMirror(sc, { orgId, documentId: String(command.record.id), companyId, generation: held.heldClaimGeneration }, {
      state: 'held', externalModel: null, externalId: null, completedQuantity: null, completedValue: null, currency: null, sourceWrittenAt: null,
      exception: heldExceptionInWords(failure.message, row?.last_error, (failure as { transferReference?: string | null }).transferReference).slice(0, 500),
    });
    if (!written.ok) console.error('[adapter-dispatch] the held stock evidence was not recorded:', written.refusal);
  } catch (err) {
    console.error('[adapter-dispatch] the held stock evidence was not recorded:', err instanceof Error ? err.message : String(err));
  }
}

/** What the document shows for a hold: one plain sentence naming the transfer. The raw cause stays in the outbox row (`last_error`) and is logged here. */
export function heldExceptionInWords(message: string, lastError: unknown, reference?: string | null): string {
  const detail = typeof lastError === 'string' ? lastError.replace(/^recovery-probe-failed:\s*/, '').trim() : '';
  console.error('[adapter-dispatch] stock command held:', message, detail);
  if (message.startsWith('payment command held')) return 'Odoo shows no transfer for this document, so it cannot be told whether one was sent. Check it in Odoo.';
  if (message.startsWith('money command held')) return 'The transfer Odoo holds for this document could not be checked. Check it in Odoo.';
  return plainHoldReason(message, reference);
}
