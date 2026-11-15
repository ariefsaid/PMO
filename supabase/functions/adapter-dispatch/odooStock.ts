/**
 * The dispatch parts for a connected stock document (#1508): adapter selection, the outbox deps, the held-mirror hook.
 * The adapter is `odoo/stock/stockAdapter.ts`, the one Odoo writer `odoo/stock/picking.ts`, the probe `odoo/stock/recovery.ts`.
 *
 * The command names only the document and the revision the keeper viewed; the org, the actor (JWT), the company (the active
 * binding) and the key (`stock:<uuid>`) are the server's. A refusal (capability, mapping) leaves no outbox row and no Odoo write.
 * An absent anchor on a quarantined row is HELD, never reissued: a picking is moved stock.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandHeldOutboxMarker } from '../../../pmo-portal/src/lib/appError.ts';
import type { Adapter } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps, OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { bindCall, type OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { REQUEST_DEADLINE_MS } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/constants.ts';
import { checkStockCapability, checkTransferOperationType } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/capability.ts';
import { createOdooStockAdapter, type StockIntentResult } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/stockAdapter.ts';
import {
  INVENTORY_DOMAIN, STOCK_DOC_KIND, STOCK_OPERATION_TYPE_KEY, STOCK_TRANSFER_OPERATION_TYPE_KEY,
} from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/constants.ts';
import { recoverStockPicking } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/recovery.ts';
import { isHoldCause, plainHoldReason, type HoldCause } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/holdReason.ts';
import { refusalEvidence } from '../../../pmo-portal/src/lib/adapterSeam/odoo/stock/refusal.ts';
import { odooClientForOrg, type OdooClientForOrgResult } from '../_shared/odooClientForOrg.ts';
import { withOdooCallBudget, countOdooCalls } from '../_shared/odooCallBudget.ts';
import { resolveOdooStockMappings } from '../_shared/odooStockMappings.ts';
import { writeOdooStockMirror, type StockMirrorEvidence } from '../_shared/odooStockMirror.ts';
import type { AdapterSelectContext } from './dispatchAdapters.ts';
import { createDbMoneyOutboxDeps } from './moneyOutboxDeps.ts';
import { stockRefusal } from './readModel/inventory.ts';

export { INVENTORY_DOMAIN, STOCK_DOC_KIND };

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

/** One binding and vault read per request: the adapter and the outbox deps share it. */
const clients = new WeakMap<AdapterSelectContext, Promise<Resolved>>();
function resolveClient(ctx: AdapterSelectContext): Promise<Resolved> {
  let pending = clients.get(ctx);
  if (!pending) {
    pending = odooClientForOrg(ctx.serviceClient as SupabaseClient, ctx.orgId).then((resolved) => {
      if ('refusal' in resolved) throw new AppError(`The Odoo connection is not usable (${resolved.refusal})`, 'config-rejected');
      return resolved;
    });
    clients.set(ctx, pending);
  }
  return pending;
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

  const typeId = Number(resolved.config[doc.kind === 'issue' ? STOCK_OPERATION_TYPE_KEY : STOCK_TRANSFER_OPERATION_TYPE_KEY]);
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
  if (!mapped.ok) return { ...refuse(mapped.reason, mapped.message), ...(mapped.subjectId ? { subjectId: mapped.subjectId } : {}) };
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
 * The outbox deps: the shared outbox, claim, fence and finalize. A `STK_*` raise from the 0879 guard (insert or claim) is classified;
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
      } }, probe?.deadlineAtMs);
    },
  });

  const classified = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if ((err as { code?: string } | null)?.code !== '23505' && /STK_/.test(message)) throw stockRefusal(message);
      throw err;
    }
  };
  /** A person pressing Post again on a failed command: this WRITES (revision and actor only; the 0879 trigger decides), so it is named, not hidden in a read. */
  const refreshFailedCommand = async (row: OutboxRow): Promise<boolean> => {
    const { data, error } = await sc.from('external_command_outbox').select('payload,actor_user_id').eq('id', row.id).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const stored = data as { payload?: Record<string, unknown>; actor_user_id?: string } | null;
    if (stored?.payload?.documentRevision === record.revision && stored?.actor_user_id === ctx.userId) return false;
    await classified(async () => {
      const { error: refreshError } = await sc.from('external_command_outbox')
        .update({ payload: { ...stored?.payload, documentRevision: record.revision }, actor_user_id: ctx.userId }).eq('id', row.id);
      if (refreshError) throw new Error(refreshError.message);
    });
    return true;
  };
  return {
    ...deps,
    // The one write beside the read: a failed row is refreshed to the revision and the person posting, never by the sweep (`ctx.replay`).
    async readOutbox(domain, pmoRecordId, idempotencyKey) {
      const row = await deps.readOutbox(domain, pmoRecordId, idempotencyKey);
      // Recovery never retries what a person has to decide: a row that turned failed or held between its candidate check and this read stays.
      if (row && ctx.replay && (row.state === 'failed' || row.state === 'held')) throw new AppError('A failed or held stock command is retried only by a person posting again', 'commit-rejected');
      if (!row || row.state !== 'failed') return row;
      return (await refreshFailedCommand(row)) ? await deps.readOutbox(domain, pmoRecordId, idempotencyKey) : row;
    },
    insertOutboxPending: (domain, id, key) => classified(() => deps.insertOutboxPending(domain, id, key)),
    claimOutboxForCommit: (id) => classified(() => deps.claimOutboxForCommit(id)),
  };
}

/**
 * A hold writes its plain sentence to the document's evidence mirror, at the generation the hold was produced under, so the keeper and
 * the Admin read why: the cause and the Odoo transfer come from where the hold was raised, never from the message text. A replay of
 * a dispatch on a row that is already held never rewrites it. Best effort: it never masks the hold, and the database refuses a
 * downgrade of confirmed evidence or a change of the transfer a row names.
 */
export async function recordStockHold(sc: SupabaseClient, orgId: string, command: { domain: string; record: { id: string } }, failure: AppError): Promise<void> {
  if (command.domain !== INVENTORY_DOMAIN || failure.code !== 'command-held') return;
  const held = failure as AppError & CommandHeldOutboxMarker;
  if (typeof held.heldOutboxId !== 'string' || typeof held.heldClaimGeneration !== 'number' || held.heldCause === 'already-held') return;
  const cause: HoldCause = isHoldCause(held.heldCause) ? held.heldCause : 'not-checked';
  await writeStockEvidence(sc, orgId, String(command.record.id), held.heldOutboxId, held.heldClaimGeneration, {
    state: 'held', externalModel: held.heldPickingId ? 'stock.picking' : null, externalId: held.heldPickingId ? String(held.heldPickingId) : null,
    externalReference: held.heldPickingId ? held.heldReference ?? null : null,
    completedQuantity: null, completedValue: null, currency: null, sourceWrittenAt: null, exception: plainHoldReason(cause, held.heldReference),
  });
}

/** A refusal before anything reached Odoo: the document's mirror says which setup condition refused it (the reason code, then the id of the record it names when it knows one; the page words it). */
export async function recordStockRefusal(sc: SupabaseClient, orgId: string, command: { domain: string; record: { id: string } }, failure: AppError): Promise<void> {
  const { refusalReason: reason, refusalSubject: subject } = failure as AppError & { refusalReason?: unknown; refusalSubject?: unknown };
  if (command.domain !== INVENTORY_DOMAIN || failure.code !== 'commit-rejected' || typeof reason !== 'string') return;
  const documentId = String(command.record.id);
  try {
    const { data } = await sc.from('external_command_outbox').select('id,claim_generation,state').eq('org_id', orgId).eq('domain', INVENTORY_DOMAIN)
      .eq('external_tier', ODOO_TIER).eq('pmo_record_id', documentId).maybeSingle();
    const row = data as { id?: string; claim_generation?: number; state?: string } | null;
    if (typeof row?.id !== 'string' || typeof row.claim_generation !== 'number' || row.state !== 'failed') return;
    await writeStockEvidence(sc, orgId, documentId, row.id, row.claim_generation, {
      state: 'failed', externalModel: null, externalId: null, externalReference: null, completedQuantity: null, completedValue: null, currency: null,
      sourceWrittenAt: null, exception: refusalEvidence(reason, typeof subject === 'string' ? subject : undefined).slice(0, 500),
    });
  } catch (err) {
    console.error('[adapter-dispatch] the refused stock evidence was not recorded:', err instanceof Error ? err.message : String(err));
  }
}

async function writeStockEvidence(sc: SupabaseClient, orgId: string, documentId: string, outboxId: string, generation: number, verdict: StockMirrorEvidence): Promise<void> {
  try {
    const { data } = await sc.from('external_command_outbox').select('payload').eq('id', outboxId).maybeSingle();
    const companyId = (data as { payload?: { odooCompanyId?: unknown } } | null)?.payload?.odooCompanyId;
    if (typeof companyId !== 'number') return;
    const written = await writeOdooStockMirror(sc, { orgId, documentId, companyId, generation }, verdict);
    if (!written.ok) console.error('[adapter-dispatch] the stock evidence was not recorded:', written.refusal);
  } catch (err) {
    console.error('[adapter-dispatch] the stock evidence was not recorded:', err instanceof Error ? err.message : String(err));
  }
}
