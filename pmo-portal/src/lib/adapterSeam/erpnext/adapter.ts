/**
 * The `erpnext` tier engine (FR-ENA-010, task 2.12): a `tier:'erpnext'`, `capabilityMap:{companies,
 * procurement,revenue}` implementation of the P0 `Adapter` contract. `commit()` dispatches by
 * `record.erp_doc_kind` through `DOCTYPE_REGISTRY` — a `submittable` kind gets the R9 two-step
 * create->submit->re-fetch (FR-ENA-044, separating the create-commit idempotency window from the
 * submit window and always trusting the RE-FETCHED `status`, never the stale POST/PUT response body);
 * a non-submittable kind (a party) is a single create. The idempotency key is stamped into `remarks`
 * (ADR-0058 §3) on every create so the recovery probe can find an orphaned commit.
 *
 * `DOCTYPE_BODIES` (the per-kind `toBody`/`fromDoc` pair) is INJECTED, not global mutable state — it
 * starts empty this slice (no flip yet) and slices 3-6 pass a populated map from their dispatch
 * factories. An un-wired kind fails loud (`commit-rejected`), mirroring the `notWired` read-model
 * writer pattern (task 1.6) — never a silent no-op that could swallow a real write.
 */
import type { Adapter, AdapterCommand, ChangesSinceWatermark, CommandResult, PmoDomain, PmoRecord } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { cancelDoc, createDoc, ErpError, getDoc, submitDoc, updateDoc, type ErpClientDeps } from './client.ts';
import { DOCTYPE_REGISTRY, type ErpCtx, type ErpDocKind } from './doctypeRegistry.ts';
import { routeEdit } from './transitionPolicy.ts';

export const ERPNEXT_TIER = 'erpnext';
export const ERPNEXT_COMPANIES_DOMAIN: PmoDomain = 'companies';
export const ERPNEXT_PROCUREMENT_DOMAIN: PmoDomain = 'procurement';
export const ERPNEXT_REVENUE_DOMAIN: PmoDomain = 'revenue';

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

/** Stamps the idempotency key into the doctype's per-doctype ANCHOR field (ADR-0058 §3 — the
 *  recovery-probe anchor: `GET .../<DocType>?filters=[[<anchorField>,"like","%<key>%"]]`),
 *  once, on every create. The anchor field is `entry.anchorField` (doctypeRegistry — 'remarks' for
 *  PI/Purchase Receipt, 'reference_no' for Payment Entry per the DIRECTOR RULING). A `null` anchor
 *  (non-money kinds) skips the stamp entirely — those kinds have no recovery-probe anchor. */
function stampAnchor(body: unknown, idempotencyKey: string | undefined, anchorField: string | null): unknown {
  if (!idempotencyKey || !anchorField || typeof body !== 'object' || body === null) return body;
  return { ...(body as Record<string, unknown>), [anchorField]: idempotencyKey };
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
  const body = stampAnchor(bodyFns.toBody(record, deps.ctx), command.idempotencyKey, entry.anchorField);
  const created = (await createDoc(deps.client, entry.doctype, body)) as { name: string };

  // OD-SAR-DRAFT-SUBMIT: a `submitOnCreate:false` kind (revenue Sales Invoice) is created as an ERP
  // DRAFT (docstatus 0) — the create does NOT submit. The separate SoD-gated `verb:'submit'` transition
  // (a different approver) is the real commit. `fromDoc` on the just-created draft yields docstatus 0,
  // so the mirror status derives to 'Draft'. Every other submittable kind keeps the R9 create+submit.
  if (!entry.submittable || entry.submitOnCreate === false) {
    // The wire-level `externalRecordId` is always the BARE ERP `name` (AC-ENA-040: `body.
    // externalRecordId` must equal the real ERP `name`, e.g. Supplier autonames by
    // `field:supplier_name`) — the "<Doctype>:<name>" collision-safe encoding (task 3.2's
    // `partyAdopt.ts` externalIdFor) is a STORAGE-layer concern applied only when writing
    // `external_refs` (index.ts's `recordExternalRef` wrapper, task 6.4 fix-round), never here.
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
 * `operation:'transition'` — the three docstatus verbs on an ALREADY-CREATED doc (task 4.4 submit +
 * Slice-6 task 6.3 cancel/amend, FR-ENA-044/050/117, OQ-7). `verb:'submit'` PUTs `{docstatus:1}`;
 * `verb:'cancel'` PUTs `{docstatus:2}` (OQ-8 cancel-only — stock REST enforces it); `verb:'amend'`
 * delegates to `commitAmend` (cancel + create-with-`amended_from`, FR-ENA-053). Every verb re-fetches
 * after the transition (R9 §5: the PUT response's derived fields are stale — the re-fetch is the only
 * trustworthy read), maps the canonical via the kind's `fromDoc`, and (for submit) fires
 * `afterSubmitHook` (the FR-ENA-003 seam, parity with `commitCreate`). An unknown verb is a loud
 * `commit-rejected`, never a silent no-op.
 */
async function commitTransition(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const bodyFns = requireBodyFns(deps, kind);
  const entry = DOCTYPE_REGISTRY[kind];
  const verb = command.record.verb;
  const externalRecordId = command.record.externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    throw new AdapterError('commit-rejected', `transition requires record.externalRecordId (nothing to ${String(verb)})`);
  }

  if (verb === 'submit') {
    await submitDoc(deps.client, entry.doctype, externalRecordId);
    await deps.afterSubmitHook?.();
    const refetched = await getDoc(deps.client, entry.doctype, externalRecordId);
    const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
    return { externalRecordId, canonical };
  }

  if (verb === 'cancel') {
    // OQ-8 (R9 §5): cancel is `{docstatus:2}` — stock REST enforces cancel-only, never delete, on a
    // once-submitted doc. Chain-reverse ordering (PR-then-PO, PE-then-PI) is a caller/chain concern
    // (transitionPolicy.ts `cancelChain`); this is the single-doc cancel primitive.
    await cancelDoc(deps.client, entry.doctype, externalRecordId);
    const refetched = await getDoc(deps.client, entry.doctype, externalRecordId);
    const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
    return { externalRecordId, canonical };
  }

  if (verb === 'amend') {
    return commitAmend(command, deps, externalRecordId);
  }

  throw new AdapterError('commit-rejected', `erpnext adapter transition verb '${String(verb)}' is not supported (supported: submit|cancel|amend)`);
}

/**
 * `verb:'amend'` (Slice-6 task 6.3, FR-ENA-050/053): the ERPNext amend workflow via stock REST —
 * cancel the old doc (`PUT {docstatus:2}`), then create a NEW doc carrying `amended_from` = the old
 * name (the lineage seam: the mirror + `external_refs` repoint to the new name; a lineage row records
 * the supersession), stamp the idempotency key into the anchor field (so the outbox recovery probe can
 * adopt an orphaned amend create), and run the R9 two-step submit + re-fetch on the new doc. Returns
 * the NEW ERP `name` + the amended canonical (carrying `erp_amended_from` via `fromDoc`). Shared by
 * `commitTransition(verb:'amend')` and `commitUpdateSubmittable`'s routeEdit(1)=amend branch.
 */
async function commitAmend(command: AdapterCommand, deps: ErpAdapterDeps, oldExternalRecordId: string): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  // 1. cancel the old doc (an amend always cancels-then-recreates; the old name becomes a tombstone).
  await cancelDoc(deps.client, entry.doctype, oldExternalRecordId);
  // 2. create the new doc with amended_from + the anchor stamp (the recovery-probe key, ADR-0058 §3).
  const record = recordWithResolvedItemsFallback(command.record, deps.ctx);
  const newBody = stampAnchor(
    { ...(bodyFns.toBody(record, deps.ctx) as Record<string, unknown>), amended_from: oldExternalRecordId },
    command.idempotencyKey,
    entry.anchorField,
  );
  const created = (await createDoc(deps.client, entry.doctype, newBody)) as { name: string };
  // 3. R9 two-step: submit the new doc + re-fetch (the amend produces a submittable doc — the stale-
  // status trap applies, same as commitCreate). Fires afterSubmitHook for FR-ENA-003 seam parity.
  await submitDoc(deps.client, entry.doctype, created.name);
  await deps.afterSubmitHook?.();
  const refetched = await getDoc(deps.client, entry.doctype, created.name);
  const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
  return { externalRecordId: created.name, canonical };
}

/**
 * `operation:'update'` on a SUBMITTABLE kind (Slice-6 task 6.3 update-draft, FR-ENA-050): composes
 * `transitionPolicy.routeEdit` — GET the current docstatus, then route: a DRAFT (docstatus 0) takes a
 * direct field PUT (the safe update path); a SUBMITTED doc (docstatus 1) routes to amend (cancel +
 * create-with-`amended_from` — a direct PUT on a submitted doc raises `UpdateAfterSubmitError`, R9 §5);
 * a CANCELLED doc (docstatus 2) is rejected by routeEdit (cannot edit a cancelled doc). The draft
 * update's field PUT does NOT stamp the anchor (the doc was created with its key; the update preserves
 * it — `toBody` never emits the anchor field for PI/PE).
 */
async function commitUpdateSubmittable(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  const externalRecordId = command.record.externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    throw new AdapterError('commit-rejected', 'update requires record.externalRecordId (nothing to edit)');
  }
  const current = await getDoc(deps.client, entry.doctype, externalRecordId);
  const docstatus = (current as { docstatus?: number | null }).docstatus ?? 0;
  const route = routeEdit(docstatus); // 'update' | 'amend' (routeEdit throws on docstatus 2)
  if (route === 'amend') return commitAmend(command, deps, externalRecordId);
  const body = bodyFns.toBody(command.record, deps.ctx);
  const updated = (await updateDoc(deps.client, entry.doctype, externalRecordId, body)) as { name: string };
  const canonical: PmoRecord = { ...bodyFns.fromDoc(updated), id: command.record.id };
  return { externalRecordId, canonical };
}

/** task 3.3 (FR-ENA-092): a non-submittable kind (a party) has no docstatus lifecycle, so its update
 *  is a direct field PUT — no submit/re-fetch step. The target ERP doc name is resolved by the
 *  dispatch factory (2.13/3.x) into `ctx.refs.self` before the adapter is constructed (the adapter
 *  itself never guesses at a PMO-id-to-ERP-name mapping); a missing resolution is a loud
 *  `commit-rejected`, never a silent no-op. */
async function commitUpdateNonSubmittable(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  const targetName = deps.ctx.refs.self;
  if (!targetName) {
    throw new AdapterError('commit-rejected', `cannot update '${kind}' — no resolved ERP doc name (ctx.refs.self)`);
  }
  const body = bodyFns.toBody(command.record, deps.ctx);
  const updated = (await updateDoc(deps.client, entry.doctype, targetName, body)) as { name: string };
  const canonical: PmoRecord = { ...bodyFns.fromDoc(updated), id: command.record.id };
  // Bare ERP name on the wire (see commitCreate's non-submittable branch for the full rationale).
  return { externalRecordId: updated.name, canonical };
}

async function commitErpCommand(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  if (command.operation === 'create') return commitCreate(command, deps);
  if (command.operation === 'transition') return commitTransition(command, deps);
  if (command.operation === 'delete') {
    // OQ-8 (empirically confirmed, R9 §5): stock REST enforces cancel-only, never delete, on a
    // once-submitted doc — the adapter never even attempts it.
    throw new AdapterError('commit-rejected', 'erpnext adapter does not support delete — cancel-only (OQ-8)');
  }
  if (command.operation === 'update') {
    const kind = requireKind(command.record);
    if (!DOCTYPE_REGISTRY[kind].submittable) return commitUpdateNonSubmittable(command, deps);
    // Slice-6 task 6.3 (FR-ENA-050): a submittable kind's update composes routeEdit — draft -> direct
    // field PUT; submitted -> amend (cancel + create-with-amended_from). See commitUpdateSubmittable.
    return commitUpdateSubmittable(command, deps);
  }
  // Every other operation is exhausted above ('create'/'transition'/'delete'/'update') — unreachable
  // for the `AdapterCommand['operation']` union, but a loud throw here rather than a silent no-op.
  throw new AdapterError('commit-rejected', `erpnext adapter operation '${command.operation}' is not supported`);
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
    capabilityMap: new Set<PmoDomain>([ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN]),
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
