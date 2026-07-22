/**
 * The `erpnext` tier engine (FR-ENA-010, task 2.12): a `tier:'erpnext'`, `capabilityMap:{companies,
 * procurement,revenue,timesheets}` implementation of the P0 `Adapter` contract. `commit()` dispatches by
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
import type { Adapter, AdapterCommand, ChangesSinceWatermark, CommandResult, PmoDomain, PmoRecord, SupersededDocumentMarker } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { cancelDoc, createDoc, ErpError, getDoc, submitDoc, updateDoc, withCommitDeadline, type ErpClientDeps } from './client.ts';
import { DOCTYPE_REGISTRY, type ErpCtx, type ErpDocKind } from './doctypeRegistry.ts';
import { routeEdit } from './transitionPolicy.ts';

export const ERPNEXT_TIER = 'erpnext';
export const ERPNEXT_COMPANIES_DOMAIN: PmoDomain = 'companies';
export const ERPNEXT_PROCUREMENT_DOMAIN: PmoDomain = 'procurement';
export const ERPNEXT_REVENUE_DOMAIN: PmoDomain = 'revenue';
/** P3b (ADR-0059 Posture B): PMO is SoT for timesheet entry + approval; ERP receives the APPROVED
 *  result as a costing document. The domain is listed here so the shipped router/dispatch machinery
 *  routes it generically — nothing about the engine is timesheet-specific. */
export const ERPNEXT_TIMESHEETS_DOMAIN: PmoDomain = 'timesheets';
/** P3c (ADR-0055 §6, likewise Posture B): PMO authors the budget and owns the figure; ERP receives the
 *  ACTIVE version so the GL reports against it and its native overspend controls enforce it. Listed here
 *  so the shipped router/dispatch machinery routes it generically. */
export const ERPNEXT_BUDGET_DOMAIN: PmoDomain = 'budget';

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
  /** ⚑ HIGH-1 — fires immediately after an amend's CANCEL succeeds and BEFORE the replacement create
   *  (the `after-cancel-before-create` fault seam, FR-ENA-003). This is the window in which the
   *  predecessor is a tombstone and its replacement does not exist yet; for an `upsertOnGrain` kind that
   *  means ERPNext is enforcing nothing, so the recovery from it has to be provable at the real served
   *  boundary. Optional — a production caller that never arms the fault gate omits it (a true no-op). */
  afterCancelHook?: () => Promise<void>;
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
  // ⚑ FR-BUD-121 / AC-BUD-031 — THE UPSERT. For a kind whose natural grain ERP itself enforces as
  // unique (`upsertOnGrain`, today ERP `Budget`), a create against an ALREADY-OCCUPIED grain must edit
  // the document that is there, not mint a second one: ERPNext rejects the duplicate atomically
  // (budget-write spike §8), so the plain create fails and ERP goes on enforcing the SUPERSEDED figure
  // while PMO shows the revision. The target is resolved by the dispatch factory (`ctx.refs.self`) —
  // the adapter never guesses a PMO-id-to-ERP-name mapping — and with none resolved this is a plain
  // create, byte-for-byte. `commitEditResolved` re-reads the doc's CURRENT docstatus and routes
  // through `routeEdit`, so a submitted target takes the spike-frozen cancel + create-with-
  // `amended_from` revision path (§6: money fields are locked post-submit) and the superseded document
  // is left as a cancelled tombstone, never a live rival.
  if (entry.upsertOnGrain && deps.ctx.refs.self) {
    // ⚑ MED-1 (audit round 6): the resolved target may be a DRAFT — our own orphan from a
    // create-OK/submit-FAIL, adopted by the refs resolution because `amended_from` proves it is ours.
    // A create for this kind always ends SUBMITTED, so an upsert must too: leaving it a draft would
    // record the push as landed while ERPNext still enforces nothing, which is the exact class of
    // silent-untruth this program keeps removing. `submitAdoptedDraft` is therefore keyed on the same
    // property that makes a create submit.
    return commitEditResolved(command, deps, deps.ctx.refs.self, entry.submittable && entry.submitOnCreate !== false);
  }
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
 * adopt an orphaned amend create), and then — for a kind the adapter may auto-submit — run the R9
 * two-step submit + re-fetch on the new doc. A `submitOnCreate:false` kind (the revenue Sales Invoice,
 * OD-SAR-DRAFT-SUBMIT) is deliberately left a DRAFT: its replacement, exactly like its create, requires
 * a separate SoD-gated submit by a DIFFERENT approver (Luna re-audit BLOCK 1 — otherwise the author
 * amends their own submitted SI and self-approves the replacement). Returns the NEW ERP `name` + the
 * amended canonical (carrying `erp_amended_from` via `fromDoc`). Shared by
 * `commitTransition(verb:'amend')` and `commitUpdateSubmittable`'s routeEdit(1)=amend branch.
 */
async function commitAmend(command: AdapterCommand, deps: ErpAdapterDeps, oldExternalRecordId: string): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  // 1. cancel the old doc (an amend always cancels-then-recreates; the old name becomes a tombstone).
  await cancelDoc(deps.client, entry.doctype, oldExternalRecordId);
  // ⚑ HIGH-1 (audit round 5) — FROM HERE ON THE PREDECESSOR IS ALREADY A TOMBSTONE. The cancel and the
  // create cannot be made atomic (Frappe has no cross-document transaction, and creating first is not
  // available either: the duplicate guard refuses a create while the old doc is still live). So the ONE
  // thing this window owes the operator is an HONEST STATEMENT of what ERP now holds — for an
  // `upsertOnGrain` kind (ERP `Budget`) a failure here means the client's overspend control is currently
  // OFF, which "budget push failed" does not say. The classified code is preserved verbatim so a
  // transient failure stays RETRYABLE and the outbox's ordinary recovery re-drives it (a fresh grain read
  // then finds a tombstone, which is inert to the duplicate guard, and plainly re-creates).
  return await amendFrom(command, deps, oldExternalRecordId, entry, bodyFns).catch((error: unknown) => {
    throw describeAbandonedAmend(error, oldExternalRecordId, entry);
  });
}

/** The post-cancel half of `commitAmend` (create → submit → re-fetch), split out ONLY so the window
 *  after the cancel has a single catch boundary — no behavior of its own. */
async function amendFrom(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  oldExternalRecordId: string,
  entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind],
  bodyFns: DoctypeBodyFns,
): Promise<CommandResult> {
  // The FR-ENA-003 seam for the window this function IS — deliberately INSIDE the catch boundary
  // `commitAmend` wraps around it, so an injected failure here is described exactly like a real one.
  await deps.afterCancelHook?.();
  // 2. create the new doc with amended_from + the anchor stamp (the recovery-probe key, ADR-0058 §3).
  const record = recordWithResolvedItemsFallback(command.record, deps.ctx);
  const newBody = stampAnchor(
    { ...(bodyFns.toBody(record, deps.ctx) as Record<string, unknown>), amended_from: oldExternalRecordId },
    command.idempotencyKey,
    entry.anchorField,
  );
  const created = (await createDoc(deps.client, entry.doctype, newBody)) as { name: string };
  // 3. OD-SAR-DRAFT-SUBMIT (Luna re-audit BLOCK 1 — the SoD bypass): the amend/replacement path obeys
  // the SAME two-person rule as create. A `submitOnCreate:false` kind (the revenue Sales Invoice) is
  // NEVER auto-submitted here — the replacement lands as an ERP DRAFT (docstatus 0) awaiting the
  // SEPARATE SoD-gated `verb:'submit'` transition by a DIFFERENT approver. Without this, an author
  // could amend their own submitted SI (an `update` of a submitted doc routes here via routeEdit(1))
  // and self-approve the replacement, defeating the signed-off approver≠author SoD entirely.
  // Every other submittable kind (purchase-invoice, Pay payment entries) keeps the R9 two-step.
  if (!entry.submittable || entry.submitOnCreate === false) {
    const canonical: PmoRecord = { ...bodyFns.fromDoc(created), id: command.record.id };
    return { externalRecordId: created.name, canonical };
  }
  // 4. R9 two-step: submit the new doc + re-fetch (the amend produces a submittable doc — the stale-
  // status trap applies, same as commitCreate). Fires afterSubmitHook for FR-ENA-003 seam parity.
  await submitDoc(deps.client, entry.doctype, created.name);
  await deps.afterSubmitHook?.();
  const refetched = await getDoc(deps.client, entry.doctype, created.name);
  const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
  return { externalRecordId: created.name, canonical };
}

/**
 * ⚑ HIGH-1 — an amend that lost its replacement AFTER the predecessor was already cancelled.
 *
 * Re-raises the SAME error object with its classification, retryability and transport status fully
 * intact (a transient stays retryable so the outbox recovery owns it; a rejection stays terminal), but
 * with the message stating what ERPNext now HOLDS. For a kind whose grain ERP itself enforces
 * (`upsertOnGrain` — `Budget`) that statement is the money fact: the control this push exists to install
 * is currently ABSENT, which "budget push failed" does not say. Enriching in place rather than wrapping
 * is deliberate — a wrapper would drop `ErpError`'s `status`/`retryable` and its `instanceof` identity,
 * which the transport and the outbox both read. `cancelledExternalRecordId` is attached so a programmatic
 * consumer can name the tombstone without parsing prose. `redactErrorForOutbox` persists the message to
 * the outbox `last_error`, which is what the push banner renders.
 */
function describeAbandonedAmend(error: unknown, oldExternalRecordId: string, entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind]): unknown {
  if (!(error instanceof Error)) return error;
  const marked = error as Error & SupersededDocumentMarker;
  if (marked.cancelledExternalRecordId) return marked; // already described — never garble the message
  marked.cancelledExternalRecordId = oldExternalRecordId;
  const enforcement = entry.upsertOnGrain
    ? ` ⛑ ERPNext is therefore enforcing NO ${entry.doctype.toLowerCase()} for this grain right now.`
    : '';
  marked.message =
    `the superseded ERPNext ${entry.doctype} "${oldExternalRecordId}" is already CANCELLED and its ` +
    `replacement did not land: ${error.message}.${enforcement}`;
  return marked;
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
  const externalRecordId = command.record.externalRecordId;
  if (typeof externalRecordId !== 'string' || externalRecordId.length === 0) {
    throw new AdapterError('commit-rejected', 'update requires record.externalRecordId (nothing to edit)');
  }
  return commitEditResolved(command, deps, externalRecordId);
}

/**
 * Edit an ALREADY-EXISTING submittable ERP document whose name is already resolved — the shared body of
 * `commitUpdateSubmittable` (target = `record.externalRecordId`) and of `commitCreate`'s
 * `upsertOnGrain` branch (target = `ctx.refs.self`, FR-BUD-121 / AC-BUD-031). ONE routing rule for
 * both, so an upsert can never diverge from an update.
 */
async function commitEditResolved(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  externalRecordId: string,
  /**
   * ⚑ MED-1 — submit the target after the field PUT when it turns out to be a DRAFT. Passed ONLY by
   * `commitCreate`'s `upsertOnGrain` branch, where the draft is PMO's own adopted orphan and a create
   * would have ended submitted anyway. Deliberately NOT the default: an ordinary `update` of a draft
   * (a Desk-authored PI/PE) must keep its current behaviour and never gain a submit as a side effect.
   */
  submitAdoptedDraft = false,
): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  const bodyFns = requireBodyFns(deps, kind);
  const current = await getDoc(deps.client, entry.doctype, externalRecordId);
  const docstatus = (current as { docstatus?: number | null }).docstatus ?? 0;
  const route = routeEdit(docstatus); // 'update' | 'amend' (routeEdit throws on docstatus 2)
  if (route === 'amend') return commitAmend(command, deps, externalRecordId);
  const body = bodyFns.toBody(command.record, deps.ctx);
  const updated = (await updateDoc(deps.client, entry.doctype, externalRecordId, body)) as { name: string };
  if (submitAdoptedDraft) {
    // R9 two-step, exactly as `commitCreate`: submit, then RE-FETCH (the PUT response's derived fields
    // are stale — the re-fetch is the only trustworthy read).
    await submitDoc(deps.client, entry.doctype, externalRecordId);
    await deps.afterSubmitHook?.();
    const refetched = await getDoc(deps.client, entry.doctype, externalRecordId);
    return { externalRecordId, canonical: { ...bodyFns.fromDoc(refetched), id: command.record.id } };
  }
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

/**
 * Luna round-5 BLOCK 10 — applies THIS command's claim deadline to the client ONCE, at the single
 * entry point every operation/verb passes through, so every ERP call this commit makes (including the
 * amend's `cancel` → `create` pair, where the non-idempotent POST is the third call) is issued through
 * a client that refuses a POST past the deadline. Doing it here rather than per-path means a future
 * doctype or verb inherits the guard automatically and cannot forget it. No deadline on the command
 * (P0/P1, reads, any non-claimed commit) ⇒ the caller's own deps, byte-for-byte.
 */
function budgetedDeps(command: AdapterCommand, deps: ErpAdapterDeps): ErpAdapterDeps {
  if (command.commitDeadlineAtMs === undefined) return deps;
  return { ...deps, client: withCommitDeadline(deps.client, command.commitDeadlineAtMs) };
}

async function commitErpCommand(command: AdapterCommand, rawDeps: ErpAdapterDeps): Promise<CommandResult> {
  const deps = budgetedDeps(command, rawDeps);
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
    capabilityMap: new Set<PmoDomain>([
      ERPNEXT_COMPANIES_DOMAIN,
      ERPNEXT_PROCUREMENT_DOMAIN,
      ERPNEXT_REVENUE_DOMAIN,
      ERPNEXT_TIMESHEETS_DOMAIN,
      ERPNEXT_BUDGET_DOMAIN,
    ]),
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
