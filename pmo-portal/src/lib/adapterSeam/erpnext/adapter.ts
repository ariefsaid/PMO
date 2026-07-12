/**
 * The `erpnext` tier engine (FR-ENA-010, task 2.12): a `tier:'erpnext'`, `capabilityMap:{companies,
 * procurement}` implementation of the P0 `Adapter` contract. `commit()` dispatches by
 * `record.erp_doc_kind` through `DOCTYPE_REGISTRY` — a `submittable` kind gets the R9 two-step
 * create->submit->re-fetch (FR-ENA-044, separating the create-commit idempotency window from the
 * submit window and always trusting the RE-FETCHED `status`, never the stale POST/PUT response body);
 * a non-submittable kind (a party) is a single create. The idempotency key is stamped into `remarks`
 * (ADR-0057 §3) on every create so the recovery probe can find an orphaned commit.
 *
 * `DOCTYPE_BODIES` (the per-kind `toBody`/`fromDoc` pair) is INJECTED, not global mutable state — it
 * starts empty this slice (no flip yet) and slices 3-6 pass a populated map from their dispatch
 * factories. An un-wired kind fails loud (`commit-rejected`), mirroring the `notWired` read-model
 * writer pattern (task 1.6) — never a silent no-op that could swallow a real write.
 */
import type { Adapter, AdapterCommand, ChangesSinceWatermark, CommandResult, PmoDomain, PmoRecord } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { createDoc, ErpError, getDoc, submitDoc, type ErpClientDeps } from './client.ts';
import { DOCTYPE_REGISTRY, type ErpCtx, type ErpDocKind } from './doctypeRegistry.ts';

export const ERPNEXT_TIER = 'erpnext';
export const ERPNEXT_COMPANIES_DOMAIN: PmoDomain = 'companies';
export const ERPNEXT_PROCUREMENT_DOMAIN: PmoDomain = 'procurement';

export interface DoctypeBodyFns {
  toBody: (record: PmoRecord, ctx: ErpCtx) => unknown;
  fromDoc: (doc: unknown) => PmoRecord;
}

export interface ErpAdapterDeps {
  client: ErpClientDeps;
  /** The (kind)->{toBody,fromDoc} side table (FR-ENA-014); accumulates per slice 3-6 wiring. */
  doctypeBodies: Partial<Record<ErpDocKind, DoctypeBodyFns>>;
  /** Resolved refs (supplier/po/...) + the org binding's config defaults — built by the dispatch
   *  factory (2.13) for the ONE command it resolves an adapter instance for. */
  ctx: ErpCtx;
  /** Fires immediately after the submit PUT succeeds, before the post-submit re-fetch (FR-ENA-003 —
   *  the `after-submit-before-mirror` fault seam, wired by the edge fn, task 2.14). Optional — a
   *  production caller that never arms the fault gate can omit it (a true no-op). */
  afterSubmitHook?: () => Promise<void>;
}

function requireKind(record: PmoRecord): ErpDocKind {
  const kind = record.erp_doc_kind;
  if (typeof kind !== 'string' || !(kind in DOCTYPE_REGISTRY)) {
    throw new AdapterError('commit-rejected', 'missing or unknown erp_doc_kind on record');
  }
  return kind as ErpDocKind;
}

function requireBodyFns(deps: ErpAdapterDeps, kind: ErpDocKind): DoctypeBodyFns {
  const fns = deps.doctypeBodies[kind];
  if (!fns) throw new AdapterError('commit-rejected', `erpnext doctype body for '${kind}' is not yet wired`);
  return fns;
}

/** Stamps the idempotency key into the doctype's `remarks` field (ADR-0057 §3 — the recovery-probe
 *  anchor: `GET .../<DocType>?filters=[["remarks","like","%<key>%"]]`), once, on every create. */
function stampRemarks(body: unknown, idempotencyKey: string | undefined): unknown {
  if (!idempotencyKey || typeof body !== 'object' || body === null) return body;
  return { ...(body as Record<string, unknown>), remarks: idempotencyKey };
}

/** Slice 5 addition (FR-ENA-103): substitute `ctx.resolvedItems` for `record.items` ONLY when the
 *  command carried none — the server-resolved case item list (e.g. `procurement_items`) fills in for
 *  a PO/GR command whose `record.items` the repository layer never sends. `ctx.resolvedItems`
 *  undefined (every kind besides slice 5's, and every pre-slice-5 caller) ⇒ `record` returned as-is,
 *  byte-for-byte. */
function recordWithResolvedItemsFallback(record: PmoRecord, ctx: ErpCtx): PmoRecord {
  const hasOwnItems = Array.isArray(record.items) && record.items.length > 0;
  if (hasOwnItems || !ctx.resolvedItems) return record;
  return { ...record, items: ctx.resolvedItems };
}

async function commitCreate(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  const record = recordWithResolvedItemsFallback(command.record, deps.ctx);
  const body = stampRemarks(bodyFns.toBody(record, deps.ctx), command.idempotencyKey);
  const created = (await createDoc(deps.client, entry.doctype, body)) as { name: string };

  if (!entry.submittable) {
    const canonical: PmoRecord = { ...bodyFns.fromDoc(created), id: command.record.id };
    return { externalRecordId: created.name, canonical };
  }

  // R9 two-step (FR-ENA-044): the create-commit window is separate from the submit window.
  await submitDoc(deps.client, entry.doctype, created.name);
  await deps.afterSubmitHook?.();
  // The POST/PUT response body carries a stale `status`/`outstanding_amount` (R9 §5 trap) — the
  // TRUE derived status is only ever visible on a fresh GET after submit.
  const refetched = await getDoc(deps.client, entry.doctype, created.name);
  const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
  return { externalRecordId: created.name, canonical };
}

/**
 * `operation:'transition'`, `verb:'submit'` (task 4.4, FR-ENA-044/117): submits an ALREADY-CREATED
 * draft doc — distinct from `commitCreate`'s combined create+submit two-step. `PUT {docstatus:1}` on
 * the caller-resolved `record.externalRecordId`, fires `afterSubmitHook` (the same FR-ENA-003 seam
 * `commitCreate` fires), then re-fetches (R9 §5: the PUT response's `status`/`outstanding_amount` is
 * stale — the re-fetch is the only trustworthy read of post-submit derived fields). `cancel`/`amend`
 * verbs are NOT wired this slice (transitionPolicy.ts's `routeEdit`/`cancelChain` land in commit() in
 * slices 5/6, where PO/PI/GR/PE first need them) — a loud throw, never a silent no-op.
 */
async function commitTransition(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const bodyFns = requireBodyFns(deps, kind);
  const verb = command.record.verb;
  if (verb !== 'submit') {
    throw new AdapterError('commit-rejected', `erpnext adapter transition verb '${String(verb)}' is wired in slices 5/6 (only 'submit' this slice)`);
  }
  const externalRecordId = command.record.externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    throw new AdapterError('commit-rejected', 'transition requires record.externalRecordId (nothing to submit)');
  }
  const entry = DOCTYPE_REGISTRY[kind];
  await submitDoc(deps.client, entry.doctype, externalRecordId);
  await deps.afterSubmitHook?.();
  const refetched = await getDoc(deps.client, entry.doctype, externalRecordId);
  const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
  return { externalRecordId, canonical };
}

async function commitErpCommand(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  if (command.operation === 'create') return commitCreate(command, deps);
  if (command.operation === 'transition') return commitTransition(command, deps);
  if (command.operation === 'delete') {
    // OQ-8 (empirically confirmed, R9 §5): stock REST enforces cancel-only, never delete, on a
    // once-submitted doc — the adapter never even attempts it.
    throw new AdapterError('commit-rejected', 'erpnext adapter does not support delete — cancel-only (OQ-8)');
  }
  // 'update': the real update-after-submit-routes-to-amend command surface is wired in slice 6
  // (transitionPolicy.ts, task 2.8/2.9, is the pure policy; its wiring into commit() lands with the
  // real doctypes that need amend). A loud throw here — never a silent no-op.
  throw new AdapterError('commit-rejected', `erpnext adapter operation '${command.operation}' is wired in slice 6`);
}

/** Parses the `"<Doctype>:<name>"` external-id encoding established by the companies-domain adopt
 *  path (task 3.2) and generalized here so `getByExternalId` works uniformly across every domain. */
function parseExternalId(externalRecordId: string): { doctype: string; name: string } {
  const separatorIndex = externalRecordId.indexOf(':');
  if (separatorIndex === -1) {
    throw new AdapterError('commit-rejected', `invalid external id format (expected "<Doctype>:<name>"): ${externalRecordId}`);
  }
  return { doctype: externalRecordId.slice(0, separatorIndex), name: externalRecordId.slice(separatorIndex + 1) };
}

function findKindByDoctype(doctype: string): ErpDocKind | undefined {
  return (Object.keys(DOCTYPE_REGISTRY) as ErpDocKind[]).find((kind) => DOCTYPE_REGISTRY[kind].doctype === doctype);
}

/** Construct the erpnext adapter (task 2.12): the only entry point above the contract that ever sees
 *  an ERPNext/Frappe-shaped dependency bag — every method it exposes speaks PMO domain language only. */
export function createErpAdapter(deps: ErpAdapterDeps): Adapter {
  return {
    tier: ERPNEXT_TIER,
    capabilityMap: new Set<PmoDomain>([ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN]),
    commit: (command: AdapterCommand) => commitErpCommand(command, deps),
    // The modified-poll sweep is the change-feed convergence authority (design decision #9) — its
    // real implementation lands in slice 8 (`applyEngine.ts` reuse). A loud throw here, never a
    // silent empty page (which would look like "no changes" and desync a caller).
    listChangesSinceWatermark(_domain: PmoDomain, _cursor: string | null): Promise<ChangesSinceWatermark> {
      return Promise.reject(new AdapterError('commit-rejected', 'erpnext listChangesSinceWatermark is wired in slice 8 (modified-poll sweep)'));
    },
    async getByExternalId(_domain: PmoDomain, externalRecordId: string): Promise<PmoRecord | null> {
      const { doctype, name } = parseExternalId(externalRecordId);
      const kind = findKindByDoctype(doctype);
      const bodyFns = kind ? deps.doctypeBodies[kind] : undefined;
      try {
        const doc = await getDoc(deps.client, doctype, name);
        return bodyFns ? { ...bodyFns.fromDoc(doc), id: externalRecordId } : { id: externalRecordId, ...(doc as Record<string, unknown>) };
      } catch (err) {
        if (err instanceof ErpError && err.status === 404) return null;
        throw err;
      }
    },
  };
}
