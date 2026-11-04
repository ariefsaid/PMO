import { type SupabaseClient } from '@supabase/supabase-js';
import { dispatchExternallyOwnedWrite, toDispatchError } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { ERPNEXT_COMPANIES_DOMAIN, ERPNEXT_PROCUREMENT_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { Adapter, AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import type { DispatchMoneyOutboxDeps } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { canonicalCommandDigest } from './moneyOutboxDeps.ts';
import { assertNewReceiptLinesAllowed, requiresReceiptLineEntitlement } from './receiptLineGuard.ts';
import { dispatchErrorStatus } from './dispatchErrorStatus.ts';
import { maybeFault, type FaultGate } from './faultSeams.ts';
import { getReadModelWriter } from './readModelWriters.ts';
import { isBudgetPushCommand, recordBudgetPushFailure } from './budgetDispatch.ts';
import type { AdapterFactory, AdapterSelectContext } from './dispatchAdapters.ts';
import type { ProcurementSourceLine } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';

export type DispatchAttemptOutcome = { ok: true; result: unknown } | { ok: false; response: Response };

/** Run adapter selection, the fenced dispatch, and the post-write mirror/ref recording for one command. */
export async function runDispatchAttempt(args: {
  command: AdapterCommand;
  /** The tier `checkCommandAuthorization` employed for this org/domain (index.ts) — the receipt-line
   *  guard's registry key. Required: the guard must never guess a tier from the payload. */
  tier: string;
  serviceClient: SupabaseClient;
  orgId: string;
  adapterFactory: AdapterFactory;
  faultGate: FaultGate;
  userId: string;
  erpAuth: ErpAuthPairCache;
  moneyOutboxResolvers: Record<string, (ctx: AdapterSelectContext) => Promise<DispatchMoneyOutboxDeps>>;
  budgetVersionMajor: 15 | 16 | null;
  headers: HeadersInit;
  outboxRecordId?: string;
  releaseSubmitClearance: () => Promise<void>;
  recordTimesheetPushFailure: (failure: AppError) => Promise<void>;
}): Promise<DispatchAttemptOutcome> {
  const {
    command, serviceClient, orgId, adapterFactory, faultGate, userId, erpAuth, tier,
    moneyOutboxResolvers, budgetVersionMajor, headers, outboxRecordId,
    releaseSubmitClearance, recordTimesheetPushFailure,
  } = args;
  let adapter: Adapter;
  let money: DispatchMoneyOutboxDeps | undefined;
  let occupantConsentId: string | undefined;
  try {
    const context: AdapterSelectContext = { orgId, command, serviceClient, faultGate, userId, erpAuth };
    context.captureOccupantConsent = (id) => { occupantConsentId = id; };
    const record = command.record as Record<string, unknown>;
    // The ORIGINAL inbound record reference, kept for the guard below: a create replay replaces
    // `command.record` with the stored payload, and the guard's predicate must classify caller intent,
    // not server-stamped transport material.
    const inboundRecord = command.record;
    const isReceiptCreate = command.domain === ERPNEXT_PROCUREMENT_DOMAIN && command.operation === 'create'
      && record.erp_doc_kind === 'goods-receipt';
    // #1783 item 1: the receipt-line intent is decided on the ORIGINAL inbound record, BEFORE a create
    // replay can replace `command.record` with the stored payload — server-stamped transport lines must
    // never select this guard's policy on a retry.
    const receiptLineIntent = requiresReceiptLineEntitlement(tier, command);
    context.receiptLineIntent = receiptLineIntent;
    let rawReceiptDigest: string | undefined;
    let existingRow = false;
    if (isReceiptCreate || receiptLineIntent) {
      if (isReceiptCreate) {
        rawReceiptDigest = await canonicalCommandDigest({ domain: command.domain, operation: command.operation, record });
      }
      const { data, error } = await serviceClient.from('external_command_outbox')
        .select('payload,payload_digest,procurement_input_digest')
        .eq('org_id', orgId).eq('domain', command.domain).eq('pmo_record_id', command.record.id)
        .eq('idempotency_key', command.idempotencyKey!).maybeSingle();
      if (error) throw new AppError(error.message, error.code);
      existingRow = Boolean(data);
      if (isReceiptCreate && data) {
        context.replay = true;
        const stored = data as { payload: Record<string, unknown> | null; payload_digest: string | null; procurement_input_digest: string | null };
        if (stored.procurement_input_digest != null) {
          const snapshot = stored.payload?.pmo_gr_snapshot as { raw_digest?: unknown; supplier?: unknown; po?: unknown } | undefined;
          const { created_after: _createdAfter, ...material } = stored.payload ?? {};
          const storedDigest = await canonicalCommandDigest({ domain: command.domain, operation: command.operation, record: material });
          if (!/^[0-9a-f]{64}$/.test(stored.procurement_input_digest) || !snapshot || snapshot.raw_digest !== stored.procurement_input_digest
              || (snapshot.supplier !== null && typeof snapshot.supplier !== 'string')
              || (snapshot.po !== null && typeof snapshot.po !== 'string')
              || stored.payload_digest !== storedDigest || rawReceiptDigest !== stored.procurement_input_digest) {
            throw new AppError('idempotency-key-payload-mismatch', 'commit-rejected');
          }
          command.record = stored.payload as PmoRecord;
          context.trustedReceiptSnapshot = true;
        }
      }
    }
    let sourceLines: ProcurementSourceLine[] | undefined;
    if (!context.replay && command.domain === ERPNEXT_PROCUREMENT_DOMAIN && command.operation === 'create'
        && ['purchase-order', 'goods-receipt', 'purchase-invoice'].includes(String(record.erp_doc_kind))) {
      context.captureProcurementSourceLines = (lines) => { sourceLines = lines; };
    }
    // #1783 item 1 (FR-PLN-004/006): the NEW caller-directed line write requires Full — after the
    // replay/digest block above (so an accepted row is exempt through the EXISTING protocol) and
    // before the adapter factory (so a refusal leaves no credential read, no outbox row, no ERP call).
    // The predicate sees the original inbound record, not a replayed one.
    await assertNewReceiptLinesAllowed({
      tier,
      command: { ...command, record: inboundRecord },
      orgId,
      serviceClient,
      existingRow,
    });
    adapter = await adapterFactory(context);
    const snapshot = command.record.pmo_gr_snapshot as Record<string, unknown> | undefined;
    if (isReceiptCreate && !context.replay && snapshot && rawReceiptDigest) {
      snapshot.raw_digest = rawReceiptDigest;
      context.procurementInputDigest = rawReceiptDigest;
    }
    if (sourceLines !== undefined && typeof command.record.procurementId === 'string') {
      context.procurementSnapshot = { caseId: command.record.procurementId, lines: sourceLines };
    }
    // Task 6.4 (ADR-0058): every non-read-only erpnext command routes through the money-idempotency
    // outbox — `dispatchExternallyOwnedWrite` requires `money` to be set for this tier (it throws
    // "dispatched without outbox deps" otherwise, the exact failure this task closes). P0/P1 (every
    // other tier) never resolves this — `money` stays `undefined`, their path is byte-for-byte.
    const resolveMoneyOutbox = moneyOutboxResolvers[adapter.tier];
    if (resolveMoneyOutbox && (command.operation as string) !== 'read') {
      money = await resolveMoneyOutbox(context);
    }
  } catch (err) {
    // The submit never reaches ERP — end the body-rewrite freeze now rather than in five minutes.
    await releaseSubmitClearance();
    // ⚑ LOW-1 (audit round 5): classify with the SAME shared rule as the dispatch exit below. The old
    // hand-rolled `new AppError(err.message)` dropped a structurally-present `.code`, and adapter select
    // now legitimately throws one: `resolveBudgetRefs` runs the real `resolveBudgetAccounts` pre-flight
    // (AC-BUD-011's zero-ERP-calls contract) and raises `BudgetCategoryUnmappedError` — a plain `Error`
    // subclass with `code = 'budget-category-unmapped'`. Dropping it gave the operator a bare 400 /
    // ADAPTER_SELECT_FAILED instead of the 422 that NAMES the unmapped categories.
    const appError = err instanceof AppError ? err : toDispatchError(err);
    // A timesheet push fails MOST often right here: the fail-closed ref pre-flight (employee-unlinked /
    // project-unmapped / activity-type-unconfigured / cross-org-link-rejected / daily-hours-exceed-24)
    // runs inside the factory, deliberately BEFORE the outbox claim and any ERP call.
    await recordTimesheetPushFailure(appError);
    await recordBudgetPushFailure({ serviceClient, orgId, command, budgetVersionMajor, failure: appError }); // HIGH-2: an adapter-select-time budget rejection is durable too
    // AC-TSP-031 — a CLASSIFIED business rejection raised here (the fail-closed ref pre-flight above)
    // is unprocessable-entity, not "malformed request": the body was fine, the RULE refused it. Same
    // ladder as the dispatch catch below (`dispatchErrorStatus`), so the two exits cannot drift; an
    // unclassified failure keeps this exit's own 400.
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: appError.code ?? 'ADAPTER_SELECT_FAILED', message: appError.message }), {
        status: dispatchErrorStatus(appError.code, 400),
        headers,
      }),
    };
  }

  // Fault-seam-injected wrapper (short-circuit before/at commit, FR-ENA-003): 'unreachable' /
  // 'reject-validation' / 'timeout' fire here, before the real adapter.commit() ever runs — each a
  // no-op unless its header matches. Wrapping the adapter (not editing dispatch.ts) means the seam's
  // thrown AdapterError still passes through dispatchExternallyOwnedWrite's own AdapterError→AppError
  // classification unmodified, so that pure/unit-tested module (dispatch.test.ts) needs no changes.
  const dispatchAdapter: Adapter = {
    ...adapter,
    commit: async (cmd: AdapterCommand) => {
      await maybeFault('unreachable', faultGate);
      await maybeFault('reject-validation', faultGate);
      await maybeFault('timeout', faultGate);
      return adapter.commit(cmd);
    },
  };

  try {
    // ── 4/5/6. command invoke → read-model update → external_refs record → return
    // (AC-EAS-033 steps 3/4/5, in that exact order — enforced inside dispatchExternallyOwnedWrite). ──
    const result = await dispatchExternallyOwnedWrite({
      adapter: dispatchAdapter,
      command,
      // Multi-domain read-model writer registry (task 1.6) — replaces the inline if-chain. An
      // unknown domain throws (no silent skip); ClickUp's `tasks` writer is byte-for-byte moved.
      writeReadModel: async (canonical: PmoRecord, options?: { isReplay?: boolean }) => {
        // Fault seam: between commit and mirror (FR-ENA-003) — a no-op unless armed. Runs before
        // the per-domain mirror write; commit has already returned (dispatch.ts's fixed order).
        await maybeFault('after-commit-before-mirror', faultGate);
        // Multi-domain read-model writer registry (task 1.6) — supersedes slice 0's inline
        // if-chain (its ClickUp/reference branches moved byte-for-byte into readModelWriters.ts).
        const writer = getReadModelWriter(command.domain);
        // ⚑ BLOCKER 2 (FU-2): thread the replay flag so the budget writer refuses to resurrect a
        // Desk-cancelled Budget from a stored-canonical replay (no fresh ERP success).
        await writer.upsert({ serviceClient: serviceClient as never, orgId, callerUserId: userId, isReplay: options?.isReplay ?? false }, canonical, command);
      },
      // Cast: the real supabase-js client's .from().upsert() returns a thenable
      // PostgrestFilterBuilder, not a plain Promise — structurally satisfies
      // ServiceRoleTableClient at runtime but is not nominally assignable (same
      // documented cast pattern as agent-dispatch/index.ts).
      //
      // Companies-domain STORAGE-layer encoding (task 6.4 fix-round, live-bench-discovered
      // 2026-07-12): `external_refs.external_record_id` for a party (Supplier/Customer) is ALWAYS
      // "<Doctype>:<name>" (task 3.2's collision rule, partyAdopt.ts's `externalIdFor` — the SAME
      // encoding the dispatch factory's shared `stripDoctypePrefix` (erpnext/dispatchRefs.ts) already
      // strips back off on every READ path). The adapter's own return value (`mapping.externalRecordId`,
      // also the served-fn HTTP response body) stays the BARE ERP name (AC-ENA-040: Supplier autonames
      // by `field:supplier_name`) — only THIS write applies the prefix, never the wire contract.
      recordExternalRef: (mapping) => {
        const kind = (command.record as { erp_doc_kind?: unknown }).erp_doc_kind;
        const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
        const externalRecordId =
          mapping.domain === ERPNEXT_COMPANIES_DOMAIN && entry ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;
        return recordExternalRefWrite(serviceClient as never, { ...mapping, externalRecordId, orgId });
      },
      // Delete-aware dispatch (Slice C, AC-CUA-038, FR-CUA-026): a ClickUp-native delete
      // tombstones the mirrored `tasks` row (OD-CUA-2) — dependency/milestone rows are
      // preserved (no cascade), and the external_refs mapping is kept as-is (dispatch.ts
      // never calls recordExternalRef on a delete). Routed through the same registry (task
      // 1.6) — only domains whose writer defines `tombstone` support the delete branch;
      // others don't wire this dep (an omitted callback = no-op via dispatch.ts's optional
      // chaining, though only `tasks` reaches delete today).
      tombstoneReadModel: getReadModelWriter(command.domain).tombstone
        ? (pmoRecordId: string) =>
            getReadModelWriter(command.domain).tombstone!({ serviceClient: serviceClient as never, orgId }, pmoRecordId)
        : undefined,
      // The money-idempotency outbox (task 6.4, ADR-0058) — set only for a non-read-only erpnext
      // command (built above); every other tier's `money` stays `undefined` (byte-for-byte).
      money,
      // BFY FR-BFY-032: the year-qualified identity for the outbox row + `external_refs` (undefined
      // for every other domain ⇒ `command.record.id`, byte-for-byte).
      outboxRecordId,
    });
    // ECA-6: the push has landed, so the consent that allowed it is spent. A failure here is logged, not surfaced: the ERP
    // write already happened, and the consent names a document that no longer exists, so it cannot unlock another.
    if (occupantConsentId) {
      const { error: spendError } = await serviceClient.rpc('consume_budget_occupant_consent', {
        p_org_id: orgId, p_id: occupantConsentId, p_actor_id: userId,
      });
      if (spendError) console.error('[adapter-dispatch] could not spend the budget replace consent:', spendError.message);
    }
    return { ok: true, result };
  } catch (err) {
    // Server-side diagnostics only — the client body stays generic/typed. Without this, an
    // external-unreachable's underlying cause (which upstream status? fetch error? which path?)
    // is unrecoverable from any log.
    console.error('[adapter-dispatch] dispatch failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
    const appError = err instanceof AppError ? err : new AppError(err instanceof Error ? err.message : 'adapter dispatch failed');
    // 'command-held' (C-1): a mutable-anchor money doc held for operator resolution — a 409 Conflict
    // (retrying will NOT help; an operator must resolve), distinct from the transient 502 unreachable.
    // WIRE 4: `command-in-flight-for-record` (0116's one-in-flight-per-record index, classified in
    // dispatch.ts) is a genuine CONFLICT — another command for this PMO record is still settling.
    // Retrying now cannot help, but retrying LATER can, so it is a 409 like `command-held`, never a 500
    // carrying the raw index name.
    await recordTimesheetPushFailure(appError);
    // P3c defense-in-depth: the budget gate above already refuses an unmapped category / multi-FY
    // project BEFORE this try block ever runs, so this branch is unreachable in the normal path — but
    // `BudgetCategoryUnmappedError` (categoryAccountMap.ts) is a plain `Error` subclass, not an
    // `AppError`/`AdapterError`, so were it ever to bubble up from here (a race between the gate's map
    // read and `bodies/budget.ts`'s own re-check at commit time) the generic `new AppError(err.message)`
    // above would silently DROP its `.code`/`.unmappedCategories` and fall through to a bare 500. Budget
    // is a money-adjacent surface, so its own classified codes are preserved explicitly here.
    const isBudgetCode = (code: unknown): code is string => code === 'budget-category-unmapped' || code === 'budget-multi-fiscal-year';
    const budgetAppError: AppError =
      isBudgetPushCommand(command) && err instanceof Error && isBudgetCode((err as { code?: unknown }).code)
        ? new AppError(err.message, (err as unknown as { code: string }).code)
        : appError;
    // HIGH-2 — THE concrete gap the money-safety audit found: a budget push that clears the gate but
    // is then rejected by the ERP write ITSELF (the everyday "revise an already-pushed budget" path —
    // ERP's own `(company, project, fiscal_year, account)` duplicate guard rejects it, doctypeRegistry.ts
    // ~136-141) landed no mirror row at all, so `get_budget_projection.push_state` stayed indistinguishable
    // from "never pushed" and the sweep backstop had nothing to re-drive. Recorded with the BEST-classified
    // error (`budgetAppError`, not the generic `appError`) so the operator surface names the real reason.
    await recordBudgetPushFailure({ serviceClient, orgId, command, budgetVersionMajor, failure: budgetAppError });
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: budgetAppError.code ?? 'DISPATCH_FAILED', message: budgetAppError.message }), {
        // AC-TSP-031: the SAME ladder the adapter-select exit uses (unreachable 502 / classified business
        // rejection 422 / held-or-in-flight 409), with THIS exit's own 500 for an unclassified failure.
        status: dispatchErrorStatus(budgetAppError.code, 500),
        headers,
      }),
    };
  }
}
