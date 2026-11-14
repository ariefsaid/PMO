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
import type { Adapter, AdapterCommand, CommandResult, PmoDomain, PmoRecord, SupersededDocumentMarker } from '../contract.ts';
import { AdapterError } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { cancelDoc, callMethod, createDoc, getDoc, submitDoc, submitFetchedDoc, updateDoc, withCommitDeadline, withRangeWriteDeadline, type ErpClientDeps } from './client.ts';
import { DOCTYPE_REGISTRY, type ErpCtx, type ErpDocKind } from './doctypeRegistry.ts';
import { findDefaultPurchaseTaxTemplate, resolvePurchaseTaxRows } from './erpPurchaseTaxRows.ts';
import { routeEdit } from './transitionPolicy.ts';
import { isLegacyBudgetArchiveCommand } from './dispatchBudget.ts';
import { parseBudgetIdentity } from './budgetAccountIdentity.ts';
import { erpGetByExternalId, erpListChangesSinceWatermark } from './adapterReads.ts';
import { toCents } from '../../budget/budgetAmount.ts';
import { parseExactCents } from '../../exactDecimal.ts';

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
/** #775 phase B (ADR-0059 Posture B, ADR-0081): expense claims post their accounting consequence. Driven ONLY by
 *  the erpnext-sweep pass — adapter-dispatch deliberately has no route for this domain. */
export const ERPNEXT_EXPENSES_DOMAIN: PmoDomain = 'expenses';

/** The ONE list of ERP domains adapter-dispatch routes: its adapter registry, its ERP-domain gate and the target-binding
 *  guards all derive from this. `expenses` is deliberately absent (sweep-driven, no dispatch route). A domain left out
 *  here is not an ERP domain to any of them (fail closed); a domain added here needs an entry in the role map
 *  (`_shared/moneyWriteRoles.ts`) or it has no writers. */
export const ERPNEXT_DISPATCH_DOMAINS: readonly PmoDomain[] = [
  ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN, ERPNEXT_REVENUE_DOMAIN, ERPNEXT_TIMESHEETS_DOMAIN, ERPNEXT_BUDGET_DOMAIN,
];
export const isErpDispatchDomain = (domain: string): boolean => (ERPNEXT_DISPATCH_DOMAINS as readonly string[]).includes(domain);

export interface DoctypeBodyFns {
  toBody: (record: PmoRecord, ctx: ErpCtx) => unknown;
  fromDoc: (doc: unknown) => PmoRecord;
}

export type BudgetRangeStage =
  | 'cancel_started'
  | 'cancelled'
  | 'post_started'
  | 'draft_witnessed'
  | 'distribution_put_started'
  | 'distribution_saved'
  | 'submit_started'
  | 'submitted';

export type BudgetRangeOperationState = Record<string, unknown> & {
  stage: BudgetRangeStage;
  identity: string;
  payloadDigest: string;
};

/** Repository operations over the existing external_command_outbox row, backed by 0578's service-only
 *  read + generation-CAS RPC. This is not a second queue: it is the provisional ERP witness needed by
 *  Budget's anchorless POST→PUT→submit sequence. */
export interface BudgetRangeOutbox {
  read(attempt: NonNullable<AdapterCommand['outboxCommit']>): Promise<BudgetRangeOperationState | null>;
  advance(
    attempt: NonNullable<AdapterCommand['outboxCommit']>,
    expectedStage: BudgetRangeStage | null,
    next: BudgetRangeOperationState,
  ): Promise<boolean>;
}

export interface ErpAdapterDeps {
  client: ErpClientDeps;
  /** Server-resolved Item validation for authoring writes; recovery that only mirrors never commits. */
  validateAuthoringItems?: (command: AdapterCommand, client: ErpClientDeps) => Promise<void>;
  /** The (kind)->{toBody,fromDoc} side table (FR-ENA-014); accumulates per slice 3-6 wiring. */
  doctypeBodies: Partial<Record<ErpDocKind, DoctypeBodyFns>>;
  /** Resolved refs (supplier/po/...) + the org binding's config defaults — built by the dispatch
   *  factory (2.13) for the ONE command it resolves an adapter instance for. */
  ctx: ErpCtx;
  /** Fires immediately after the submit PUT succeeds, before the post-submit re-fetch (FR-ENA-003 —
   *  the `after-submit-before-mirror` fault seam, wired by the edge fn, task 2.14). Optional — a
   *  production caller that never arms the fault gate can omit it (a true no-op). */
  afterSubmitHook?: () => Promise<void>;
  /** Checks shared company/contact identity only when authoring is actually attempted.
   * Completed outbox recovery converges its stored result without calling commit. */
  validateAuthoringPartyIdentity?: (command: AdapterCommand) => Promise<void>;
  /** ⚑ HIGH-1 — fires immediately after an amend's CANCEL succeeds and BEFORE the replacement create
   *  (the `after-cancel-before-create` fault seam, FR-ENA-003). This is the window in which the
   *  predecessor is a tombstone and its replacement does not exist yet; for an `upsertOnGrain` kind that
   *  means ERPNext is enforcing nothing, so the recovery from it has to be provable at the real served
   *  boundary. Optional — a production caller that never arms the fault gate omits it (a true no-op). */
  afterCancelHook?: () => Promise<void>;
  /** Range Budget's durable draft/cancel witness. Ordinary annual budgets keep the existing path. */
  budgetRangeOutbox?: BudgetRangeOutbox;
  /** The scope the adapter's change-feed reads poll under (the same company / ERP major the sweep uses). */
  readScope?: {
    /** The binding's ERP company; company-owned doctypes cannot be listed without it. */
    company?: string | null;
    /** The ERP major version (selects the budget field set). */
    versionMajor?: number;
    /** Pages listed per kind per read (default 1); the cursor resumes the walk. */
    maxPages?: number;
  };
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

type BudgetRangeDoc = Record<string, unknown>;
type BudgetRangeDistribution = { start_date: string; end_date: string; amountCents: string; percentUnits: string };
type BudgetRangeAttempt = NonNullable<AdapterCommand['outboxCommit']>;

const RANGE_VOLATILE_KEYS = new Set(['docstatus', 'modified', 'modified_by']);

function isRangeBudgetCommand(command: AdapterCommand): boolean {
  if (command.record.erp_doc_kind !== 'budget') return false;
  if (command.record.budget_mode === 'whole_project') return true;
  try {
    return typeof command.record.outbox_identity === 'string'
      && parseBudgetIdentity(command.record.outbox_identity).kind === 'range';
  } catch {
    return typeof command.record.to_fiscal_year === 'string'
      && command.record.to_fiscal_year !== command.record.fiscal_year;
  }
}

function canonicalValue(value: unknown, omitVolatile = false): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, omitVolatile));
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
    if (omitVolatile && RANGE_VOLATILE_KEYS.has(key)) return result;
    result[key] = canonicalValue((value as Record<string, unknown>)[key], omitVolatile);
    return result;
  }, {});
}

async function fingerprint(value: unknown, omitVolatile = false): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(value, omitVolatile)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function centsFromErp(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  return parseExactCents(String(value));
}

function percentUnitsFromErp(value: unknown): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value);
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) return null;
  return BigInt(match[1]!) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
}

function normalizeRangeDistribution(value: unknown): BudgetRangeDistribution[] | null {
  if (!Array.isArray(value)) return null;
  const rows: BudgetRangeDistribution[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return null;
    const row = candidate as Record<string, unknown>;
    const amount = centsFromErp(row.amount);
    const percent = percentUnitsFromErp(row.percent);
    if (typeof row.start_date !== 'string' || typeof row.end_date !== 'string'
      || amount === null || amount < 0n || percent === null || percent < 0n || percent > 1_000_000n) return null;
    rows.push({ start_date: row.start_date, end_date: row.end_date, amountCents: String(amount), percentUnits: String(percent) });
  }
  return rows;
}

function requireBudgetRangeAttempt(command: AdapterCommand, record: Record<string, unknown>): BudgetRangeAttempt {
  const attempt = command.outboxCommit;
  const identity = record.outbox_identity;
  if (!attempt || !/^[0-9a-f-]{36}$/i.test(attempt.id) || !Number.isInteger(attempt.generation) || attempt.generation < 1
      || typeof attempt.payloadDigest !== 'string' || !/^[0-9a-f]{64}$/.test(attempt.payloadDigest)
      || typeof identity !== 'string' || attempt.identity !== identity) {
    throw new AppError('whole-project budget has no valid generation-fenced outbox claim', 'commit-rejected');
  }
  let parsed: ReturnType<typeof parseBudgetIdentity>;
  try { parsed = parseBudgetIdentity(identity); } catch {
    throw new AppError('whole-project budget has an invalid range identity', 'commit-rejected');
  }
  if (parsed.kind !== 'range' || parsed.versionId !== record.id || parsed.fiscalYear !== record.fiscal_year
      || parsed.toFiscalYear !== record.to_fiscal_year || parsed.erpAccount !== record.erp_account) {
    throw new AppError('whole-project budget identity does not match its approved range dimensions', 'commit-rejected');
  }
  return attempt;
}

function requireRangeOutbox(deps: ErpAdapterDeps): BudgetRangeOutbox {
  if (!deps.budgetRangeOutbox) {
    throw new AppError('whole-project budget staged outbox is unavailable', 'commit-rejected');
  }
  return deps.budgetRangeOutbox;
}

function heldRangeError(message: string): AppError {
  return new AppError(`whole-project budget held for operator review: ${message}`, 'command-held');
}

async function readRangeState(outbox: BudgetRangeOutbox, attempt: BudgetRangeAttempt): Promise<BudgetRangeOperationState | null> {
  let state: BudgetRangeOperationState | null;
  try {
    state = await outbox.read(attempt);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'command-held') throw error;
    throw new AppError('whole-project budget outbox state could not be read', 'external-unreachable');
  }
  if (state === null) return null;
  if (state.identity !== attempt.identity || state.payloadDigest !== attempt.payloadDigest
      || typeof state.stage !== 'string') {
    throw heldRangeError('the durable operation witness does not match this exact claim and payload');
  }
  return state;
}

async function advanceRangeState(
  outbox: BudgetRangeOutbox,
  attempt: BudgetRangeAttempt,
  expectedStage: BudgetRangeStage | null,
  next: BudgetRangeOperationState,
): Promise<void> {
  try {
    if (await outbox.advance(attempt, expectedStage, next)) return;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'command-held') throw error;
    throw new AppError('whole-project budget operation stage could not be persisted', 'external-unreachable');
  }
  throw heldRangeError('the outbox claim was superseded or its expected stage changed');
}

async function readAuthenticatedErpUser(client: ErpClientDeps): Promise<string> {
  const result = await callMethod(client, 'frappe.auth.get_logged_user') as { message?: unknown } | null;
  if (typeof result?.message !== 'string' || result.message.trim() === '') {
    throw new AdapterError('commit-rejected', 'whole-project budget cannot establish the ERPNext API user');
  }
  return result.message;
}

function assertRangeParent(
  doc: BudgetRangeDoc,
  expectedBody: Record<string, unknown>,
  name: string | null,
  owner?: string,
): void {
  if (name !== null && doc.name !== name) throw heldRangeError('ERPNext returned a different witnessed Budget');
  if (owner !== undefined && doc.owner !== owner) throw heldRangeError('the witnessed Budget owner no longer matches the ERPNext API user');
  for (const [field, expected] of Object.entries(expectedBody)) {
    if (field === 'budget_distribution') continue;
    const actual = doc[field];
    if (field === 'budget_amount') {
      if (centsFromErp(actual) !== centsFromErp(expected)) throw heldRangeError('the ERPNext Budget total differs from the approved amount');
    } else if (typeof expected === 'number') {
      if (Number(actual) !== expected) throw heldRangeError(`the ERPNext Budget ${field} differs from the approved value`);
    } else if (actual !== expected) {
      throw heldRangeError(`the ERPNext Budget ${field} differs from the approved value`);
    }
  }
}

function rangeIdentityBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    company: body.company,
    project: body.project,
    budget_against: body.budget_against,
    account: body.account,
    from_fiscal_year: body.from_fiscal_year,
    to_fiscal_year: body.to_fiscal_year,
  };
}

function rangeParentMatchesBody(doc: BudgetRangeDoc, body: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(body)) {
    if (field === 'budget_distribution' || field === 'budget_amount' || field === 'amended_from') continue;
    if (doc[field] !== expected) return false;
  }
  return centsFromErp(doc.budget_amount) === centsFromErp(body.budget_amount);
}

function assertRangeDistribution(doc: BudgetRangeDoc, expected: BudgetRangeDistribution[]): void {
  const actual = normalizeRangeDistribution(doc.budget_distribution);
  if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw heldRangeError('the ERPNext dated yearly rows differ from the exact approved amount vector');
  }
}

function assertModified(doc: BudgetRangeDoc, value: unknown): asserts value is string {
  if (typeof value !== 'string' || typeof doc.modified !== 'string' || doc.modified !== value) {
    throw heldRangeError('the witnessed ERPNext modified stamp changed');
  }
}

async function assertContentFingerprint(doc: BudgetRangeDoc, expected: unknown): Promise<void> {
  if (typeof expected !== 'string' || await fingerprint(doc, true) !== expected) {
    throw heldRangeError('the witnessed ERPNext Budget was modified outside this operation');
  }
}

function getDocstatus(doc: BudgetRangeDoc): number {
  const status = Number(doc.docstatus);
  if (!Number.isInteger(status) || ![0, 1, 2].includes(status)) {
    throw heldRangeError('the witnessed ERPNext Budget has an unsupported status');
  }
  return status;
}

function buildRangeStage(
  attempt: BudgetRangeAttempt,
  stage: BudgetRangeStage,
  fields: Record<string, unknown> = {},
): BudgetRangeOperationState {
  return { ...fields, stage, identity: attempt.identity, payloadDigest: attempt.payloadDigest! };
}

async function commitV16WholeProjectBudget(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind],
): Promise<CommandResult> {
  let cancelledPredecessor: string | null = null;
  try {
    return await commitV16WholeProjectBudgetInternal(command, deps, entry, (name) => {
      cancelledPredecessor = name;
    });
  } catch (error) {
    if (cancelledPredecessor) throw describeAbandonedAmend(error, cancelledPredecessor, entry);
    throw error;
  }
}

async function commitV16WholeProjectBudgetInternal(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind],
  onPredecessorCancelled: (name: string) => void,
): Promise<CommandResult> {
  const record = command.record as Record<string, unknown>;
  const account = record.erp_account;
  const fromFiscalYear = record.fiscal_year;
  const toFiscalYear = record.to_fiscal_year;
  const intent = record.budget_intent;
  if (typeof account !== 'string' || account.trim() === '' || typeof fromFiscalYear !== 'string'
      || typeof toFiscalYear !== 'string' || (intent !== 'ensure' && intent !== 'remove')) {
    throw new AdapterError('commit-rejected', 'whole-project budget has incomplete range dimensions');
  }
  const attempt = requireBudgetRangeAttempt(command, record);
  const outbox = requireRangeOutbox(deps);
  const state = await readRangeState(outbox, attempt);
  const bodyFns = requireBodyFns(deps, 'budget');
  const predecessor = record.budget_predecessor;
  const resolvedTarget = deps.ctx.refs.self ?? null;
  if (intent === 'remove' && (typeof predecessor !== 'string' || predecessor === '' || resolvedTarget !== predecessor)) {
    throw new AdapterError('commit-rejected', 'whole-project budget removal lacks its exact witnessed predecessor');
  }
  if (intent === 'ensure' && ((predecessor == null && resolvedTarget !== null)
      || (predecessor != null && (typeof predecessor !== 'string' || resolvedTarget !== predecessor)))) {
    throw new AdapterError('commit-rejected', 'whole-project budget revision target does not match its witnessed predecessor');
  }
  const target: string | null = intent === 'remove' ? predecessor as string : resolvedTarget;
  let cancellationStartedInThisCommit = false;

  const owner = await readAuthenticatedErpUser(deps.client);
  const body = intent === 'ensure' ? bodyFns.toBody(command.record, deps.ctx) as Record<string, unknown> : null;
  const expectedRows = body ? normalizeRangeDistribution(body.budget_distribution) : null;
  if (body && (!expectedRows || expectedRows.length === 0)) {
    throw new AdapterError('commit-rejected', 'whole-project budget has no exact dated distribution to write');
  }
  const expectedTotal = body ? centsFromErp(body.budget_amount) : null;
  if (body && (expectedTotal === null || expectedTotal <= 0n)) {
    throw new AdapterError('commit-rejected', 'whole-project budget total is invalid');
  }
  const distributionFingerprint = body ? await fingerprint(expectedRows) : null;

  const canonical = (doc: unknown, budgetIntent: unknown): PmoRecord => ({
    ...bodyFns.fromDoc(doc),
    id: command.record.id,
    fiscal_year: fromFiscalYear,
    to_fiscal_year: toFiscalYear,
    erp_account: account,
    budget_intent: budgetIntent,
  });

  const stateStage = state?.stage ?? null;
  if (state && state.stage === 'post_started') {
    throw heldRangeError('a Budget create may have reached ERPNext before its exact draft witness was durable');
  }
  if (state && state.expectedDistributionFingerprint !== (distributionFingerprint ?? null)) {
    throw heldRangeError('the approved yearly distribution changed after the ERP operation began');
  }

  // A range replacement cancels only the exact PMO-witnessed same-range predecessor. Validate its
  // complete approved replacement before creating the durable cancellation stage.
  let activeState = state;
  if (stateStage === null && target !== null) {
    const prior = await getDoc(deps.client, entry.doctype, target) as BudgetRangeDoc;
    if (!body) {
      assertRangeParent(prior, {
        company: deps.ctx.config.company,
        project: deps.ctx.refs.project,
        budget_against: 'Project',
        account,
        from_fiscal_year: fromFiscalYear,
        to_fiscal_year: toFiscalYear,
      }, target);
      if (getDocstatus(prior) === 2) throw heldRangeError('the predecessor was cancelled outside this witnessed operation');
      if (typeof record.budget_predecessor_modified !== 'string'
          || prior.modified !== record.budget_predecessor_modified) {
        throw heldRangeError('the PMO-witnessed predecessor modified stamp changed');
      }
    } else {
      assertRangeParent(prior, rangeIdentityBody(body), target);
      const priorStatus = getDocstatus(prior);
      if (priorStatus !== 1) throw new AdapterError('commit-rejected', `whole-project budget predecessor ${target} is not submitted`);
      if (typeof record.budget_predecessor_modified !== 'string'
          || prior.modified !== record.budget_predecessor_modified) {
        throw heldRangeError('the PMO-witnessed predecessor modified stamp changed');
      }
      if (rangeParentMatchesBody(prior, body) && normalizeRangeDistribution(prior.budget_distribution)
          && JSON.stringify(normalizeRangeDistribution(prior.budget_distribution)) === JSON.stringify(expectedRows)) {
        assertRangeDistribution(prior, expectedRows!);
        return { externalRecordId: target, canonical: canonical(prior, 'ensure') };
      }
    }
    if (getDocstatus(prior) !== 1) throw heldRangeError('the exact predecessor is neither a live submitted Budget nor a verified cancellation');
    const stateFields = {
      mode: intent === 'remove' ? 'remove' : 'replace',
      expectedDistributionFingerprint: distributionFingerprint,
      predecessorName: target,
      predecessorModified: prior.modified,
      predecessorFingerprint: await fingerprint(prior, true),
    };
    activeState = buildRangeStage(attempt, 'cancel_started', stateFields);
    await advanceRangeState(outbox, attempt, null, activeState);
    cancellationStartedInThisCommit = true;
  }

  if (activeState?.stage === 'cancel_started') {
    const targetName = activeState.predecessorName;
    if (typeof targetName !== 'string' || targetName === '' || targetName !== target) {
      throw heldRangeError('the durable cancellation target no longer matches this exact range command');
    }
    const current = await getDoc(deps.client, entry.doctype, targetName) as BudgetRangeDoc;
    const expectedTargetBody = {
      company: deps.ctx.config.company,
      project: deps.ctx.refs.project,
      budget_against: 'Project',
      account,
      from_fiscal_year: fromFiscalYear,
      to_fiscal_year: toFiscalYear,
    };
    assertRangeParent(current, expectedTargetBody, targetName);
    const status = getDocstatus(current);
    if (status === 2) {
      await assertContentFingerprint(current, activeState.predecessorFingerprint);
      if (activeState.mode === 'replace') onPredecessorCancelled(targetName);
      activeState = buildRangeStage(attempt, 'cancelled', {
        ...activeState,
        mode: activeState.mode,
        cancelledModified: current.modified,
      });
      await advanceRangeState(outbox, attempt, 'cancel_started', activeState);
    } else if (status === 1 && current.modified === activeState.predecessorModified && cancellationStartedInThisCommit) {
      await assertContentFingerprint(current, activeState.predecessorFingerprint);
      await cancelDoc(deps.client, entry.doctype, targetName);
      await deps.afterCancelHook?.();
      const readback = await getDoc(deps.client, entry.doctype, targetName) as BudgetRangeDoc;
      assertRangeParent(readback, expectedTargetBody, targetName);
      if (getDocstatus(readback) !== 2) throw new AppError('whole-project predecessor cancellation readback is unresolved', 'external-unreachable');
      await assertContentFingerprint(readback, activeState.predecessorFingerprint);
        if (activeState.mode === 'replace') onPredecessorCancelled(targetName);
      activeState = buildRangeStage(attempt, 'cancelled', {
        ...activeState,
        mode: activeState.mode,
        cancelledModified: readback.modified,
      });
      await advanceRangeState(outbox, attempt, 'cancel_started', activeState);
    } else {
      throw heldRangeError('the predecessor cancellation has no confirmed terminal witness');
    }
  }

  if (activeState?.stage === 'cancelled' && activeState.mode === 'remove') {
    const targetName = activeState.predecessorName;
    if (typeof targetName !== 'string' || !targetName) throw heldRangeError('the cancelled Budget name is missing');
    const readback = await getDoc(deps.client, entry.doctype, targetName) as BudgetRangeDoc;
    assertRangeParent(readback, {
      company: deps.ctx.config.company,
      project: deps.ctx.refs.project,
      budget_against: 'Project',
      account,
      from_fiscal_year: fromFiscalYear,
      to_fiscal_year: toFiscalYear,
    }, targetName);
    if (getDocstatus(readback) !== 2) throw heldRangeError('the exact predecessor cancellation is no longer present');
    await assertContentFingerprint(readback, activeState.predecessorFingerprint);
    return { externalRecordId: targetName, canonical: canonical(readback, 'remove') };
  }

  if (activeState?.stage === 'submitted') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name) throw heldRangeError('the submitted Budget witness has no name');
    const readback = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(readback, body!, name, owner);
    if (getDocstatus(readback) !== 1) throw heldRangeError('the witnessed submitted Budget is no longer submitted');
    assertRangeDistribution(readback, expectedRows!);
    return { externalRecordId: name, canonical: canonical(readback, 'ensure') };
  }

  if (activeState?.stage === 'cancelled') {
    if (!body || activeState.mode !== 'replace') throw heldRangeError('the canceled Budget operation has no replacement body');
    activeState = buildRangeStage(attempt, 'post_started', {
      ...activeState,
      mode: 'replace',
      expectedDistributionFingerprint: distributionFingerprint,
      amendedFrom: activeState.predecessorName,
    });
    await advanceRangeState(outbox, attempt, 'cancelled', activeState);
  } else if (activeState === null && body) {
    activeState = buildRangeStage(attempt, 'post_started', {
      mode: 'create',
      expectedDistributionFingerprint: distributionFingerprint,
    });
    await advanceRangeState(outbox, attempt, null, activeState);
  }

  if (activeState?.stage === 'post_started') {
    if (!body) throw heldRangeError('a removal operation cannot begin a create');
    const amendedFrom = activeState.amendedFrom;
    // The durable draft witness must exist before the dated child rows are written. Keeping the
    // distribution out of POST also lets recovery distinguish an unaccepted PUT from a saved one.
    const { budget_distribution: _distribution, ...parentBody } = body;
    const postBody = amendedFrom ? { ...parentBody, amended_from: amendedFrom } : parentBody;
    const created = await createDoc(deps.client, entry.doctype, postBody) as { name?: unknown };
    if (typeof created?.name !== 'string' || created.name === '') {
      throw new AppError('whole-project Budget create returned no stable document name', 'external-unreachable');
    }
    const draft = await getDoc(deps.client, entry.doctype, created.name) as BudgetRangeDoc;
    assertRangeParent(draft, postBody, created.name, owner);
    if (getDocstatus(draft) !== 0 || typeof draft.modified !== 'string') {
      throw heldRangeError('the returned Budget is not the exact witnessed draft');
    }
    activeState = buildRangeStage(attempt, 'draft_witnessed', {
      ...activeState,
      mode: activeState.mode,
      draftName: created.name,
      draftOwner: owner,
      initialModified: draft.modified,
      initialFingerprint: await fingerprint(draft, true),
      expectedDistributionFingerprint: distributionFingerprint,
    });
    await advanceRangeState(outbox, attempt, 'post_started', activeState);
  }

  if (activeState?.stage === 'draft_witnessed') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name || activeState.draftOwner !== owner) {
      throw heldRangeError('the durable draft witness is incomplete or belongs to another ERP user');
    }
    const draft = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(draft, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    if (getDocstatus(draft) !== 0) throw heldRangeError('the witnessed draft is no longer a draft before distribution PUT');
    assertModified(draft, activeState.initialModified);
    await assertContentFingerprint(draft, activeState.initialFingerprint);
    activeState = buildRangeStage(attempt, 'distribution_put_started', { ...activeState, mode: activeState.mode });
    await advanceRangeState(outbox, attempt, 'draft_witnessed', activeState);
    await updateDoc(deps.client, entry.doctype, name, { budget_distribution: body!.budget_distribution });
    const saved = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(saved, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    if (getDocstatus(saved) !== 0) throw heldRangeError('the distribution PUT changed the Budget lifecycle unexpectedly');
    assertRangeDistribution(saved, expectedRows!);
    activeState = buildRangeStage(attempt, 'distribution_saved', {
      ...activeState,
      mode: activeState.mode,
      savedModified: saved.modified,
      savedFingerprint: await fingerprint(saved, true),
    });
    await advanceRangeState(outbox, attempt, 'distribution_put_started', activeState);
  } else if (activeState?.stage === 'distribution_put_started') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name || activeState.draftOwner !== owner) {
      throw heldRangeError('the distribution PUT has no exact witnessed draft');
    }
    const current = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(current, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    if (getDocstatus(current) !== 0) throw heldRangeError('the distribution PUT target is no longer a draft');
    const currentRows = normalizeRangeDistribution(current.budget_distribution);
    if (currentRows && JSON.stringify(currentRows) === JSON.stringify(expectedRows)) {
      activeState = buildRangeStage(attempt, 'distribution_saved', {
        ...activeState,
        mode: activeState.mode,
        savedModified: current.modified,
        savedFingerprint: await fingerprint(current, true),
      });
      await advanceRangeState(outbox, attempt, 'distribution_put_started', activeState);
    } else {
      throw heldRangeError('the distribution PUT has no confirmed saved witness');
    }
  }

  if (activeState?.stage === 'distribution_saved') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name || activeState.draftOwner !== owner) {
      throw heldRangeError('the saved distribution has no exact draft witness');
    }
    const draft = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(draft, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    if (getDocstatus(draft) !== 0) throw heldRangeError('the exact saved Budget is no longer a draft before submit');
    assertModified(draft, activeState.savedModified);
    await assertContentFingerprint(draft, activeState.savedFingerprint);
    assertRangeDistribution(draft, expectedRows!);
    activeState = buildRangeStage(attempt, 'submit_started', { ...activeState, mode: activeState.mode });
    await advanceRangeState(outbox, attempt, 'distribution_saved', activeState);
    try {
      await submitFetchedDoc(deps.client, draft);
      await deps.afterSubmitHook?.();
    } catch (error) {
      if (error instanceof AppError && error.code === 'external-unreachable') throw error;
      throw new AppError('whole-project Budget submit outcome is uncertain; recovery will inspect the witnessed document', 'external-unreachable');
    }
    const submitted = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(submitted, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    if (getDocstatus(submitted) !== 1) throw new AppError('whole-project Budget submit readback is unresolved', 'external-unreachable');
    assertRangeDistribution(submitted, expectedRows!);
    activeState = buildRangeStage(attempt, 'submitted', { ...activeState, mode: activeState.mode });
    await advanceRangeState(outbox, attempt, 'submit_started', activeState);
    return { externalRecordId: name, canonical: canonical(submitted, 'ensure') };
  }

  if (activeState?.stage === 'submit_started') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name || activeState.draftOwner !== owner) {
      throw heldRangeError('the pending submit has no exact draft witness');
    }
    const current = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(current, activeState.amendedFrom ? { ...body!, amended_from: activeState.amendedFrom } : body!, name, owner);
    const status = getDocstatus(current);
    if (status === 1) {
      await assertContentFingerprint(current, activeState.savedFingerprint);
      assertRangeDistribution(current, expectedRows!);
      activeState = buildRangeStage(attempt, 'submitted', { ...activeState, mode: activeState.mode });
      await advanceRangeState(outbox, attempt, 'submit_started', activeState);
      return { externalRecordId: name, canonical: canonical(current, 'ensure') };
    }
    throw heldRangeError('the submit has no confirmed terminal witness');
  }

  if (activeState?.stage === 'submitted') {
    const name = activeState.draftName;
    if (typeof name !== 'string' || !name || !body) throw heldRangeError('the submitted range Budget witness is incomplete');
    const submitted = await getDoc(deps.client, entry.doctype, name) as BudgetRangeDoc;
    assertRangeParent(submitted, activeState.amendedFrom ? { ...body, amended_from: activeState.amendedFrom } : body, name, owner);
    if (getDocstatus(submitted) !== 1) throw heldRangeError('the witnessed submitted Budget is no longer submitted');
    assertRangeDistribution(submitted, expectedRows!);
    return { externalRecordId: name, canonical: canonical(submitted, 'ensure') };
  }

  throw heldRangeError(`the durable range operation is in an unsupported stage (${String(activeState?.stage)})`);
}

/**
 * The kinds whose post-submit unknown may be left IN-FLIGHT (see `postSubmitUnknown`).
 *
 * ⚑ Luna round-3 BLOCK 1 — THIS RECLASSIFICATION IS ONLY SAFE WITH A DURABLE RECOVERY IDENTITY.
 * "In-flight" means the outbox row stays `committing` and a later recovery pass RE-CLAIMS it. That
 * pass is safe only if it can PROVE what ERP holds, i.e. if the kind has an immutable, REST-filterable
 * anchor the probe can find the already-submitted document by. `timesheet` has one (`note`,
 * `anchorMutable:false`). An ANCHORLESS kind (Material Request / RFQ / Supplier Quotation / Purchase
 * Order / Budget — `anchorField: null`) has none: the probe is skipped and
 * `reissueOnInconclusiveAbsence` then permits a fresh claim+POST, so the adapter would create and
 * submit a SECOND purchase commitment beside the live first one. (`sales-invoice` has an anchor, but
 * its SoD-gated `transition/submit` mints a key it never stamps, so a probe for that key finds
 * nothing — the same inconclusive-recovery hazard.)
 *
 * That anchorless recovery-identity gap is PRE-EXISTING and backlogged with the review's evidence; it
 * is not this slice's to carry. So the round-2 fix is scoped to the ONE domain this slice owns, and
 * EVERY other kind keeps its pre-existing behaviour: the post-submit error propagates exactly as
 * thrown. Widening this set is a money decision — it requires a recovery identity for the kind first.
 */
const POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT: ReadonlySet<ErpDocKind> = new Set<ErpDocKind>(['timesheet']);

/**
 * ⚑ AFTER A SUBMIT, "IT FAILED" IS NOT "IT DIDN'T HAPPEN" (Luna round-2 BLOCK 2).
 *
 * Everything that runs after `submitDoc` returns — the FR-ENA-003 `afterSubmitHook` seam, the R9 §5
 * post-submit re-fetch, the `fromDoc` mapping — is READ-ONLY, and by then ERPNext is holding a
 * SUBMITTED document. An exception escaping that region unclassified was being read as a rejection:
 * `dispatch.ts`'s `isRetryableTransport` recognises only `external-unreachable`, so `claimAndCommit`
 * marked the outbox row terminal `failed` and the mirror was written `failed` with no `ts_number` —
 * i.e. the shape that means "ERP never heard about this week". For a timesheet that is exactly the
 * state the Slice-A re-open ADMITS: PMO returns the week to Draft while the ERP Timesheet is live, the
 * corrected week is approved and pushed, and the client's project cost carries both. What actually
 * failed was the READ-BACK; nothing established that the document is absent.
 *
 * So the region is classified as a retryable TRANSPORT unknown. `claimAndCommit` then marks NOTHING:
 * the row stays `committing`, becomes reclaimable at lease expiry, and the recovery path probes by the
 * anchor key and ADOPTS the real document — the same durable state, and the same convergence, a real
 * process crash in this window produces. The re-open fence also refuses on a non-terminal row, so the
 * week cannot be re-opened while the outcome is unknown. The ERP name is carried in the message
 * because it is the one fact an operator or a probe-less recovery needs.
 *
 * ⛔ Deliberately NOT applied before/at the submit: a create or a submit that ERP REJECTS leaves no
 * submitted document, so it stays terminal (`commit-rejected`) and is not retried forever.
 *
 * ⛔ And deliberately NOT applied to a kind outside `POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT` (Luna round-3
 * BLOCK 1): without a durable recovery identity the retry is a DUPLICATE, not an adoption, so those
 * kinds get their error back untouched.
 */
function postSubmitUnknown(error: unknown, kind: ErpDocKind, doctype: string, name: string): unknown {
  if (!POST_SUBMIT_UNKNOWN_IS_IN_FLIGHT.has(kind)) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new AdapterError(
    'external-unreachable',
    `post-submit-unknown: ${doctype} ${name} was SUBMITTED in ERPNext, but the outcome could not be read back ` +
      `— treat as in-flight, never as absent (${detail})`,
  );
}

async function commitV16BudgetCreate(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind],
): Promise<CommandResult | null> {
  if (isRangeBudgetCommand(command)) {
    return commitV16WholeProjectBudget(command, deps, entry);
  }
  const record = command.record as Record<string, unknown>;
  const account = record.erp_account;
  const fiscalYear = record.fiscal_year;
  const intent = deps.ctx.budgetAccount?.intent;
  const fail = (detail: string): never => {
    throw new AdapterError('commit-rejected', `budget push: account ${String(account)} for ${String(fiscalYear)} ${detail}`);
  };
  if (typeof account !== 'string' || !account || typeof fiscalYear !== 'string' || !fiscalYear || !intent) {
    return fail('has incomplete v16 unit dimensions');
  }
  if (intent === 'ensure' && !deps.ctx.refs.self) return null;
  const bodyFns = requireBodyFns(deps, 'budget');
  const verify = (doc: Record<string, unknown>): void => {
    if (doc.docstatus === 0) fail(`is occupied by draft ${String(doc.name ?? '')}`);
    if (doc.company !== deps.ctx.config.company || doc.project !== deps.ctx.refs.project ||
        doc.account !== account || doc.from_fiscal_year !== fiscalYear || doc.to_fiscal_year !== fiscalYear) {
      fail('has an occupant with mismatched company, project, account, or year');
    }
  };
  const canonical = (doc: unknown): PmoRecord => ({
    ...bodyFns.fromDoc(doc), id: command.record.id, budget_intent: intent,
  });

  if (intent === 'ensure') {
    const current = await getDoc(deps.client, entry.doctype, deps.ctx.refs.self!);
    const doc = current as Record<string, unknown>;
    verify(doc);
    if (Number(doc.docstatus) !== 1) fail(`occupant ${String(doc.name)} is not submitted`);
    const replacement = recordWithResolvedItemsFallback(command.record, deps.ctx);
    const body = bodyFns.toBody(replacement, deps.ctx) as Record<string, unknown>;
    let amountsMatch: boolean;
    try {
      amountsMatch = toCents(String(doc.budget_amount)) === toCents(String(body.budget_amount));
    } catch {
      return fail('has an invalid or missing ERP budget amount');
    }
    if (amountsMatch) {
      return { externalRecordId: String(doc.name), canonical: canonical(doc) };
    }
    // Construct and validate replacement before the point-of-no-return cancel inside commitAmend.
    return commitAmend(command, deps, String(doc.name));
  }

  const predecessor = deps.ctx.budgetAccount?.predecessor;
  if (!predecessor) return fail('has no witnessed predecessor to remove');
  const target = predecessor;
  const doc = await getDoc(deps.client, entry.doctype, target) as Record<string, unknown>;
  if (doc.name !== target) return fail('received a different document than its witnessed predecessor');
  verify(doc);
  if (Number(doc.docstatus) === 0) fail(`is occupied by draft ${String(doc.name)}`);
  if (Number(doc.docstatus) === 2) return { externalRecordId: target, canonical: canonical(doc) };
  if (Number(doc.docstatus) === 1) {
    await cancelDoc(deps.client, entry.doctype, target);
    await deps.afterCancelHook?.();
  } else {
    fail(`has unsupported document status ${String(doc.docstatus)}`);
  }
  const readback = await getDoc(deps.client, entry.doctype, target) as Record<string, unknown>;
  if (readback.name !== target) return fail('received a different cancellation readback document');
  verify(readback);
  if (Number(readback.docstatus) !== 2) fail(`could not confirm cancellation of ${target}`);
  return { externalRecordId: target, canonical: canonical(readback) };
}

function withBudgetUnitCanonical(command: AdapterCommand, deps: ErpAdapterDeps, canonical: PmoRecord): PmoRecord {
  if (requireKind(command.record) !== 'budget' || deps.ctx.versionMajor !== 16) return canonical;
  const record = command.record as Record<string, unknown>;
  const intent = deps.ctx.budgetAccount?.intent;
  if (typeof record.fiscal_year !== 'string' || typeof record.erp_account !== 'string' || !intent) {
    throw new AdapterError('commit-rejected', 'budget push: v16 canonical is missing its server unit dimensions');
  }
  return { ...canonical, id: command.record.id, fiscal_year: record.fiscal_year, erp_account: record.erp_account, budget_intent: intent };
}

/**
 * #1462 — cancel an OLDER (year-grained, pre-v16) ERP `Budget` by its exact witnessed name.
 *
 * ⚑ CANCEL ONLY. There is no body builder here and there must never be one: an amendment/replacement is
 * a different, operator-initiated revision, and re-POSTing an old push would overwrite a document whose
 * figure PMO never re-approved. The whole operation is: read THAT document, prove it is still the one the
 * activation created, cancel it if submitted, read it back, and require docstatus 2.
 *
 * ⚑ Every dimension is proven from the DOCUMENT, never from the current map. A 15→16 re-bind changes the
 * map and the grain; neither is evidence about which old document this alarm names. On v16 the upgraded
 * representation must name ONE fiscal year (from == to); anything else is an unproven shape and holds.
 */
async function commitLegacyBudgetRemove(
  command: AdapterCommand,
  deps: ErpAdapterDeps,
  entry: (typeof DOCTYPE_REGISTRY)[ErpDocKind],
): Promise<CommandResult> {
  const record = command.record as Record<string, unknown>;
  const fiscalYear = record.fiscal_year;
  const target = deps.ctx.refs.self;
  const fail = (detail: string): never => {
    throw new AdapterError('commit-rejected', `legacy budget archive: ${String(target)} ${detail}`);
  };
  if (typeof fiscalYear !== 'string' || !fiscalYear) return fail('has no fiscal year');
  if (!target) return fail('has no witnessed predecessor');
  if (typeof deps.ctx.refs.project !== 'string' || !deps.ctx.refs.project) {
    return fail('cannot establish the expected ERP project');
  }
  if (typeof deps.ctx.config.company !== 'string' || !deps.ctx.config.company) {
    return fail('cannot establish the expected ERP company');
  }
  const bodyFns = requireBodyFns(deps, 'budget');
  const verify = (doc: Record<string, unknown>): void => {
    if (doc.name !== target) fail(`read back a different document (${String(doc.name ?? '')})`);
    if (doc.company !== deps.ctx.config.company) fail('has a different ERP company');
    if (doc.project !== deps.ctx.refs.project) fail('has a different ERP project');
    // An account-grained document is NOT this job's target: a legacy cancellation is account-less.
    if (doc.account !== undefined && doc.account !== null) fail('is account-grained, not a legacy document');
    // A legacy cancellation is currently enabled only on v15. If an installation exposes multiple
    // year fields, every supplied field must agree; a matching fiscal_year cannot mask a conflicting
    // span supplied by the same ERP document.
    const ownYear = typeof doc.fiscal_year === 'string' ? doc.fiscal_year : null;
    const fromYear = typeof doc.from_fiscal_year === 'string' ? doc.from_fiscal_year : null;
    const toYear = typeof doc.to_fiscal_year === 'string' ? doc.to_fiscal_year : null;
    if ((ownYear !== null && ownYear !== fiscalYear) ||
        (fromYear !== null && fromYear !== fiscalYear) ||
        (toYear !== null && toYear !== fiscalYear) ||
        (ownYear === null && (fromYear === null || toYear === null))) {
      fail('does not state an unambiguous matching fiscal year');
    }
    const status = Number(doc.docstatus);
    if (status === 0) fail('is a draft');
    else if (![1, 2].includes(status)) fail(`has unsupported document status ${String(doc.docstatus)}`);
  };
  const canonical = (doc: unknown): PmoRecord => ({
    ...bodyFns.fromDoc(doc), id: command.record.id, fiscal_year: fiscalYear,
    budget_intent: 'remove', source_kind: 'legacy',
  });

  const doc = (await getDoc(deps.client, entry.doctype, target)) as Record<string, unknown>;
  verify(doc);
  if (Number(doc.docstatus) === 2) return { externalRecordId: target, canonical: canonical(doc) };
  await cancelDoc(deps.client, entry.doctype, target);
  await deps.afterCancelHook?.();
  const readback = (await getDoc(deps.client, entry.doctype, target)) as Record<string, unknown>;
  verify(readback);
  if (Number(readback.docstatus) !== 2) fail('could not confirm cancellation');
  return { externalRecordId: target, canonical: canonical(readback) };
}

async function commitCreate(command: AdapterCommand, deps: ErpAdapterDeps): Promise<CommandResult> {
  const kind = requireKind(command.record);
  const entry = DOCTYPE_REGISTRY[kind];
  // #1462 — dispatch the LEGACY archive cancellation by source kind BEFORE either version branch, so a
  // v16 binding can never coerce an old year-grained document into the account-grained path.
  if (kind === 'budget' && isLegacyBudgetArchiveCommand(command)) {
    return commitLegacyBudgetRemove(command, deps, entry);
  }
  if (kind === 'budget' && deps.ctx.versionMajor === 16) {
    const result = await commitV16BudgetCreate(command, deps, entry);
    if (result) return result;
  }
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
    // `submitAdoptedDraft`: IF the resolved target is ever a DRAFT, a create for this kind always ends
    // SUBMITTED, so the upsert must too — leaving it a draft would record the push as landed while
    // ERPNext still enforces nothing, the exact class of silent-untruth this program keeps removing. So
    // the flag is keyed on the same property that makes a create submit.
    // ⚑ Round 7: today this cannot trigger for `budget`, the only `upsertOnGrain` kind — the refs
    // resolution now hands back ONLY a live (docstatus 1) document, so `commitEditResolved` always routes
    // to amend. Round 6's orphan-draft adoption, which was the one caller that produced a draft target,
    // was deleted (see `dispatchFactory.resolveBudgetRefs` for the full rationale). The flag is kept as
    // the correctness invariant a future recovery must satisfy, not as a live path.
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
    const canonical = withBudgetUnitCanonical(command, deps, { ...bodyFns.fromDoc(created), id: command.record.id });
    return { externalRecordId: created.name, canonical };
  }

  // R9 two-step (FR-ENA-044): the create-commit window is separate from the submit window.
  await submitDoc(deps.client, entry.doctype, created.name);
  // ⚑ PAST THIS LINE THE DOCUMENT IS SUBMITTED (Luna round-2 BLOCK 2) — see `postSubmitUnknown`.
  try {
    await deps.afterSubmitHook?.();
    // The POST/PUT response body carries a stale `status`/`outstanding_amount` (R9 §5 trap) — the
    // TRUE derived status is only ever visible on a fresh GET after submit.
    const refetched = await getDoc(deps.client, entry.doctype, created.name);
    const canonical = withBudgetUnitCanonical(command, deps, { ...bodyFns.fromDoc(refetched), id: command.record.id });
    return { externalRecordId: created.name, canonical };
  } catch (error) {
    throw postSubmitUnknown(error, kind, entry.doctype, created.name);
  }
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
    throw new AdapterError('commit-rejected', 'This record has no ERP link yet, so it cannot be sent.');
  }

  if (verb === 'submit') {
    await submitDoc(deps.client, entry.doctype, externalRecordId);
    // ⚑ PAST THIS LINE THE DOCUMENT IS SUBMITTED (Luna round-2 BLOCK 2) — see `postSubmitUnknown`.
    try {
      await deps.afterSubmitHook?.();
      const refetched = await getDoc(deps.client, entry.doctype, externalRecordId);
      const canonical: PmoRecord = { ...bodyFns.fromDoc(refetched), id: command.record.id };
      return { externalRecordId, canonical };
    } catch (error) {
      throw postSubmitUnknown(error, kind, entry.doctype, externalRecordId);
    }
  }

  if (verb === 'cancel') {
    // OQ-8 (R9 §5): cancel is `{docstatus:2}` — stock REST enforces cancel-only, never delete, on a
    // once-submitted doc. Chain-reverse ordering (PR-then-PO, PE-then-PI) is a caller/chain concern;
    // this is the single-doc cancel primitive.
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
  // #915 fix round — the replacement is settled BEFORE the cancel (the point of no return): when the
  // replacement body would POST with no tax fields, the company's CURRENT default template is validated
  // first, so a malformed default refuses with nothing cancelled and nothing POSTed.
  await assertAmendReplacementTaxesValid(command, deps, kind, bodyFns);
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

/**
 * #915 fix round — the amend's replacement is a Purchase Invoice POST like any other: ERPNext applies
 * the company's CURRENT default Purchase Taxes and Charges Template when the body carries neither
 * `taxes_and_charges` nor `taxes` (an edit/amend carries none — `piToBody` only sends tax fields for a
 * chosen template or entered amounts). So BEFORE the predecessor is cancelled (⚑ HIGH-1: a refusal
 * after the cancel strands a tombstone), the replacement body is built exactly as `amendFrom` will
 * build it and, when it carries no taxes, the current default is validated through the SAME resolver a
 * chosen template gets (`resolvePurchaseTaxRows` — a malformed default refuses `config-rejected` with
 * the chosen path's exact wording, naming the template, never the company). A valid default — or none —
 * leaves the replacement untouched: PMO never inlines the default here, ERPNext applies it at POST time.
 */
async function assertAmendReplacementTaxesValid(
  command: AdapterCommand, deps: ErpAdapterDeps, kind: ErpDocKind, bodyFns: DoctypeBodyFns,
): Promise<void> {
  if (kind !== 'purchase-invoice') return;
  const company = deps.ctx.config.company;
  if (typeof company !== 'string' || !company) return;
  const record = recordWithResolvedItemsFallback(command.record, deps.ctx);
  const body = bodyFns.toBody(record, deps.ctx) as Record<string, unknown>;
  if (body.taxes_and_charges !== undefined || body.taxes !== undefined) return;
  const template = await findDefaultPurchaseTaxTemplate(deps.client, company);
  if (!template) return;
  await resolvePurchaseTaxRows(deps.client, company, template);
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
    throw new AdapterError('commit-rejected', 'This record has no ERP link yet, so it cannot be sent.');
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
  const client = withCommitDeadline(deps.client, command.commitDeadlineAtMs);
  return {
    ...deps,
    client: isRangeBudgetCommand(command)
      ? withRangeWriteDeadline(client, command.commitDeadlineAtMs)
      : client,
  };
}

async function commitErpCommand(command: AdapterCommand, rawDeps: ErpAdapterDeps): Promise<CommandResult> {
  const deps = budgetedDeps(command, rawDeps);
  await deps.validateAuthoringPartyIdentity?.(command);
  await deps.validateAuthoringItems?.(command, deps.client);
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

/** Construct the erpnext adapter (task 2.12): the only entry point above the contract that ever sees
 *  an ERPNext/Frappe-shaped dependency bag — every method it exposes speaks PMO domain language only.
 *  The capabilityMap below declares what the system CAN natively own — an upper bound, not an
 *  ownership flip: actual ownership is the org's configured assignment plus project bindings
 *  (docs/GLOSSARY.md "Capability map", "Source of truth"). */
export function createErpAdapter(deps: ErpAdapterDeps): Adapter {
  return {
    tier: ERPNEXT_TIER,
    capabilityMap: new Set<PmoDomain>([
      ...ERPNEXT_DISPATCH_DOMAINS,
      // #775 phase B — expense postings (ADR-0081). Reached only through the erpnext-sweep pass; adapter-dispatch
      // still has no `expenses` route, and an org can employ it only through the release-guarded Admin switch.
      ERPNEXT_EXPENSES_DOMAIN,
    ]),
    commit: (command: AdapterCommand) => commitErpCommand(command, deps),
    // The sweep polls through `listErpChangesSinceWatermark` directly (it adds the outbox in-flight guard);
    // these are the contract's reads, over the same poll spec. See adapterReads.ts for the identity rules.
    listChangesSinceWatermark: (domain: PmoDomain, cursor: string | null) => erpListChangesSinceWatermark(deps, domain, cursor),
    getByExternalId: (domain: PmoDomain, externalRecordId: string) => erpGetByExternalId(deps, domain, externalRecordId),
  };
}
