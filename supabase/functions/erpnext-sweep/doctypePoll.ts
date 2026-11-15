// The sweep's modified-poll doctype walk (THEME-BACK-40, #1643): pass (2), runSweep per doctype under the per-tick
// document and time budgets, least-recently-attempted first, with the in-flight adopt guard and the per-doctype
// watermark and error state. Moved verbatim from index.ts.
import { applyErpContactFeed } from '../_shared/erpnextContacts.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runSweep } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import { listErpChangesSinceWatermark } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
// HIGH-A: which per-change apply failure is a terminal ack-and-skip vs. a halt (see feedErrorPolicy.ts).
import { erpFeedApplyErrorPolicy } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts';
import { createErpFeedDeps, ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { featureKeyForKind, KIND_DOMAIN, sweepKindsForOrg } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { sweepFieldsForKind, KINDS_NEEDING_FULL_DOC, pollFiltersForKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/pollSpec.ts';
import { ErpError } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { AdapterError } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { FetchDeadlineError } from '../_shared/fetchWithDeadline.ts';
import { recordErrorEvent, type ErrorEventSupabaseLike } from '../_shared/errorEvent.ts';
import type { ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { createInFlightAnchorProbe, type InFlightAnchorProbe } from '../_shared/inFlightAnchorProbe.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { featureDisabled, type OrgBinding, fetchErpDoc, erpClientForBinding } from './sweepShared.ts';

function sweepErrorCode(error: unknown): string {
  if (error instanceof ErpError && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) {
    return `erp-http-${error.status}`;
  }
  if (error instanceof FetchDeadlineError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))) {
    return 'erp-timeout';
  }
  if (error instanceof AdapterError && error.code === 'external-unreachable') return 'erp-unreachable';
  if (error instanceof Error) return 'apply-failed';
  return 'unknown';
}

const SWEEP_ERROR_EVENT_TIMEOUT_MS = 2_000;

async function recordSweepErrorEvent(supabase: ErrorEventSupabaseLike, event: Parameters<typeof recordErrorEvent>[1]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      recordErrorEvent(supabase, event),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, SWEEP_ERROR_EVENT_TIMEOUT_MS); }),
    ]);
  } catch {
    // Best effort by design: reporting a failed doctype must not stall its siblings.
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The `filterRow` predicate for one kind: skips any document the in-flight probe claims.
 *
 * Returns `undefined` only when there is nothing to apply (an anchor-less kind with no base filter), so
 * the poll keeps its exact pre-existing shape. The caller's own `filterRow` (the BLOCK A1 `payment_type`
 * discriminator) is preserved and evaluated FIRST — a row it already rejects costs no outbox read.
 */
export function inFlightAnchorFilter(
  kind: ErpDocKind,
  probe: InFlightAnchorProbe,
  baseFilter?: (row: Record<string, unknown>) => boolean,
): ((row: Record<string, unknown>) => Promise<boolean>) | undefined {
  const anchorField = DOCTYPE_REGISTRY[kind].anchorField;
  // deno-lint-ignore require-await -- preserve async rejection semantics for a synchronous baseFilter.
  if (!anchorField) return baseFilter ? async (row) => baseFilter(row) : undefined;
  return async (row: Record<string, unknown>): Promise<boolean> => {
    if (baseFilter && !baseFilter(row)) return false;
    const anchor = row[anchorField];
    if (typeof anchor !== 'string' || anchor === '') return true;
    return !(await probe(anchor));
  };
}

/**
 * The poll watermark key (FR-ENA-080: org × doctype), stored in `external_sync_watermarks.domain`. Unchanged
 * `<domain>::<doctype>` for every kind that is alone on its (domain, doctype) — so no shipped cursor resets — and
 * qualified with the kind when two kinds share BOTH (#775 phase B: `expense-payment` and `expense-receipt` are one
 * domain on one doctype; one shared cursor would let the first kind's poll advance past the second's changes).
 * Exported for direct unit testing (AC-EXP-122).
 */
export function sweepWatermarkDomain(kind: ErpDocKind): string {
  const doctype = DOCTYPE_REGISTRY[kind].doctype;
  const domain = KIND_DOMAIN[kind];
  // `expense-journal` shipped alone on its (domain, doctype); a kind added later (`imprest-transfer`) is the one that gets
  // qualified, so the shipped cursor is not reset.
  const shared = kind !== 'expense-journal' && (Object.keys(DOCTYPE_REGISTRY) as ErpDocKind[])
    .some((other) => other !== kind && KIND_DOMAIN[other] === domain && DOCTYPE_REGISTRY[other].doctype === doctype);
  return shared ? `${domain}::${doctype}::${kind}` : `${domain}::${doctype}`;
}

// ── #916: the doctype walk's per-tick budgets ──────────────────────────────────────────────────
// The walk used to list + apply EVERY doctype's full modified-poll inside one invocation; on a full
// year of books that hit the edge runtime's CPU hard limit (HTTP 546) mid-pass, stranding actuals /
// Paid status / receipts. Both budgets make the walk a bounded quantum per tick: the per-doctype
// watermark (`external_sync_watermarks`) is the persisted cursor, the listing order is the total
// order `modified asc, name asc`, and the cursor filter is INCLUSIVE — so the next tick resumes
// exactly at the boundary (no document skipped, none double-applied; the writers are idempotent
// upserts and the per-row source-mod guard re-applies an equal stamp idempotently). The first sweep
// after a reset or a new binding (cursor NULL → oldest-first backfill) is resumable by construction.

/** Max ERP list PAGES ONE doctype's poll may fetch in one tick (2 × the 500-row page = ≤1000 docs
 *  listed per doctype). The same bounded-pages shape as the ledger feed (#901), tighter because the
 *  walk APPLIES each doc through ~4 DB round-trips where the ledger batch-upserts. */
export const SWEEP_LIST_MAX_PAGES = 2;

/** Max documents LISTED across one org's whole walk in one tick — the walk stops before starting
 *  another doctype once spent (a doctype already started finishes its own bounded quantum, so the
 *  worst-case overrun is ONE doctype's `SWEEP_LIST_MAX_PAGES × 500`). */
export const SWEEP_TICK_MAX_DOCS = 1_000;

/** Whole-tick wall-clock budget for the walk (the pass-2 doctype loop), measured from the INVOCATION
 *  start the serve handler stamps, so every org's walk in the tick shares one clock. Wall clock is a
 *  PROXY here — the hard constraint is CPU time, which the doc budgets bound directly; this stops a
 *  slow/unreachable ERP from holding the worker while staying far under any CPU limit. */
// Leaves 25 seconds beyond the native statement stage for context, admission and teardown. The
// 100-second invocation budget remains below the conservative 150-second Edge wall-clock ceiling.
export const SWEEP_TICK_TIME_BUDGET_MS = 100_000;

/**
 * #916 fix round (starvation): ONE org's doctypes ordered LEAST-RECENTLY-ATTEMPTED first.
 *
 * The fixed registry order plus the shared tick budget let an always-busy registry-earlier doctype
 * (e.g. a Timesheet backlog) consume the whole document budget EVERY tick, so the registry-later
 * doctypes (revenue / budget / timesheet pushes) never ran again. The per-doctype watermark row
 * carries the attempt recency — `external_sync_watermarks.updated_at`, stamped when the walk starts
 * and refreshed again when its cursor advances — so halted work yields priority to siblings. Rows
 * sort ASC by `updated_at`; a doctype with NO row (never attempted) comes first. Ties keep registry order
 * (the sort is stable), which is exactly the pre-fix behavior on a fresh org.
 *
 * Exported for direct unit testing (the sweepTickBudget starvation test drives it through the
 * shipped `sweepOrgDoctypesLive`).
 */
export async function orderedSweepKindsForOrg(
  serviceClient: SupabaseClient,
  orgId: string,
  ownedDomains: readonly string[],
): Promise<Array<{ kind: ErpDocKind; doctype: string }>> {
  const kinds = sweepKindsForOrg(ownedDomains);
  if (kinds.length <= 1) return kinds;
  const domains = kinds.map(({ kind }) => sweepWatermarkDomain(kind));
  let rows: Array<{ domain: string; updated_at: string | null }>;
  try {
    const { data, error } = await serviceClient.from('external_sync_watermarks')
      .select('domain, updated_at')
      .eq('org_id', orgId).eq('external_tier', ERPNEXT_TIER)
      .in('domain', domains);
    if (error) throw new AppError(error.message, error.code);
    rows = (data as Array<{ domain: string; updated_at: string | null }> | null) ?? [];
  } catch (err) {
    // Ordering is a fairness optimization, not a correctness control: a failed recency read degrades
    // this tick to the registry order (logged) rather than skipping the org's sweep.
    console.error(`[erpnext-sweep] org ${orgId}: watermark-recency load failed `
      + `${err instanceof Error ? err.message : String(err)} — this tick keeps registry order`);
    return kinds;
  }
  const lastAttemptAtMs = new Map<string, number>();
  for (const row of rows) {
    const t = Date.parse(row.updated_at ?? '');
    lastAttemptAtMs.set(row.domain, Number.isFinite(t) ? t : 0);
  }
  // Never-run (no row) → 0 → sorts first; ASC = least-recently-attempted first; stable sort keeps
  // registry order within ties.
  const recency = ({ kind }: { kind: ErpDocKind }): number => lastAttemptAtMs.get(sweepWatermarkDomain(kind)) ?? 0;
  return [...kinds].sort((a, b) => recency(a) - recency(b));
}

/** Operator overrides (the "clock/env read" DI class): `ERPNEXT_SWEEP_TICK_MAX_DOCS` /
 *  `ERPNEXT_SWEEP_TICK_TIME_BUDGET_MS`. A missing/invalid value falls back to the shipped default. */
export const SWEEP_TICK_MAX_DOCS_ENV = 'ERPNEXT_SWEEP_TICK_MAX_DOCS';
export const SWEEP_TICK_TIME_BUDGET_MS_ENV = 'ERPNEXT_SWEEP_TICK_TIME_BUDGET_MS';

/** Optional per-tick budget knobs for the doctype walk. Absent ⇒ the shipped defaults above, clocked
 *  from `Date.now()` at entry (the `nowMs: number = Date.now()` default-param pattern). The serve
 *  handler passes the INVOCATION's start + its env reads; tests inject a controllable clock. */
export interface SweepTickBudgetOpts {
  /** The moment this tick began (the serve handler's entry), so the whole invocation shares one
   *  elapsed-time budget. Default: `nowMs()` at call. */
  tickStartMs?: number;
  /** Injected clock. Default `Date.now`. */
  nowMs?: () => number;
  /** Overrides `SWEEP_TICK_MAX_DOCS` (tests). */
  tickMaxDocs?: number;
  /** Overrides `SWEEP_TICK_TIME_BUDGET_MS` (tests). */
  tickTimeBudgetMs?: number;
  /** Overrides the per-doctype listing quantum `SWEEP_LIST_MAX_PAGES` (tests). */
  maxListPages?: number;
}

/** The per-org sweep: runSweep per doctype with the lineage-aware apply injected, per-doctype watermark.
 *  #916: the walk is BOUNDED per tick — each doctype lists at most `SWEEP_LIST_MAX_PAGES` pages, and
 *  the whole walk stops (finishing the doctype in flight; watermarks are persisted per doctype by
 *  `runSweep`) once the tick's document or elapsed-time budget is spent. A budget stop is NORMAL
 *  operation — never an error — the remaining doctypes resume next tick from their own watermarks.
 *  #916 fix round: the doctypes run LEAST-RECENTLY-ATTEMPTED first (never-run first), so a doctype
 *  the budget keeps skipping cannot starve forever behind an always-busy registry-earlier sibling. */
export async function sweepOrgDoctypesLive(serviceClient: SupabaseClient, org: OrgBinding, cache?: ErpAuthPairCache, opts: SweepTickBudgetOpts = {}): Promise<{ applied: number; error?: string; complete: boolean }> {
  // This is the inbound ERP read pass. The global switch holds polling and leaves every cursor alone;
  // outbox reconciliation and accepted-command closure run in their separate passes.
  if (featureDisabled(org, 'erp_sync')) return { applied: 0, error: 'feature-off:erp_sync', complete: true };
  const nowMs = opts.nowMs ?? Date.now;
  const tickStartMs = opts.tickStartMs ?? nowMs();
  const tickMaxDocs = opts.tickMaxDocs ?? SWEEP_TICK_MAX_DOCS;
  const tickTimeBudgetMs = opts.tickTimeBudgetMs ?? SWEEP_TICK_TIME_BUDGET_MS;
  const client = await erpClientForBinding(serviceClient, org, cache);
  let applied = 0;
  // HIGH-A: one doctype's failure is RECORDED and the loop CONTINUES. It used to `return`, so a single
  // refused/unreachable doctype abandoned every doctype after it for that org this tick — and with
  // `DOCTYPE_REGISTRY`'s order that meant a Timesheet problem silently stopped `employee` and `budget`
  // (the money-control push's own feed) from sweeping at all.
  const doctypeErrors: string[] = [];
  // #916: the tick's spent budget. `docsThisTick` counts documents LISTED (the quantum the walk
  // touches) — incremented the moment each doctype's bounded listing returns, regardless of the
  // apply outcome; the clock is read BEFORE each doctype so a doctype in flight always finishes
  // (its watermark then persists a clean resume point — aborting a batch mid-apply would stall:
  // the watermark only advances after the whole listed batch applies).
  let docsThisTick = 0;
  let walkedDoctypes = 0;
  // False once any doctype stopped short (tick budget, page quantum) so the caller does not stamp the run complete.
  let complete = true;
  // BLOCK 1 / round-7 B5: the pull-adopt guard. NOT a snapshot — the probe asks the outbox about each
  // CANDIDATE document at the moment the poll sees it, so neither a stale key set nor PostgREST's
  // `max_rows` ceiling can let a PMO-originated document be pull-adopted into a SECOND PMO row. A read
  // failure throws out of the poll below (fail closed): polling with a blind guard is exactly the state
  // that duplicated money rows. One probe per org tick shares the memo across that org's doctypes.
  const inFlightProbe = createInFlightAnchorProbe(serviceClient, org.orgId);
  // Luna BLOCK 9: only the doctypes whose PMO domain this org actually assigned to the ERPNext tier —
  // ordered least-recently-completed first (#916 fix round: see `orderedSweepKindsForOrg`).
  // 0534: a domain whose module resolves off is skipped entirely; its watermark is untouched, so the
  // feed resumes exactly where it stopped when the switch comes back on.
  const sweepKinds = (await orderedSweepKindsForOrg(serviceClient, org.orgId, org.ownedDomains))
    .filter(({ kind }) => {
      const key = featureKeyForKind(kind);
      return !key || !featureDisabled(org, key);
    });
  for (const { kind, doctype } of sweepKinds) {
    const elapsedMs = nowMs() - tickStartMs;
    if (docsThisTick >= tickMaxDocs || elapsedMs >= tickTimeBudgetMs) {
      console.warn(
        `[erpnext-sweep] org ${org.orgId}: tick budget reached after ${walkedDoctypes} doctype walk(s) `
          + `(${docsThisTick}/${tickMaxDocs} docs listed, ${elapsedMs}/${tickTimeBudgetMs} ms elapsed) — the remaining `
          + 'doctypes resume next tick from their persisted watermarks (#916)',
      );
      complete = false;
      break;
    }
    walkedDoctypes += 1;
    const domain = KIND_DOMAIN[kind];
    const bodyFns = DOCTYPE_BODIES[kind];
    if (!bodyFns) continue; // not yet wired — skip (inert until the slice that wires it lands)
    // WIRE 3 / round-7 B4 (CROSS-TENANT): scope the poll to the ERP Company this binding represents.
    // An ERPNext site hosts many Companies; without this the poll adopted ANOTHER tenant's Sales
    // Invoices / Receive PEs into this org's revenue and AR views, with no error anywhere.
    // `null` means UNSCOPEABLE (a company-scoped kind on a binding that names no company) — skip the
    // kind entirely and log it as the configuration error it is. It is deliberately NOT `[]` ("no
    // company dimension, sweep freely"), which is what would sweep the whole ERP site into one tenant.
    const poll = pollFiltersForKind(kind, org.company || null);
    if (poll === null) {
      console.error(
        `[erpnext-sweep] org ${org.orgId}: binding names no ERP company — the company-scoped '${kind}' poll is `
          + 'SKIPPED (an unscopeable poll would adopt every company on the site). Set config.company on the binding.',
      );
      continue;
    }
    const feedDeps = createErpFeedDeps(serviceClient as unknown as SupabaseClient, org.orgId, kind);
    // Per-doctype watermark (FR-ENA-080: org × doctype) — keyed on a namespaced domain value so each
    // doctype has its own cursor row on external_sync_watermarks (the applyEngine ctx.domain stays the
    // PMO domain for external_refs; the watermark key is the sweep's own concern).
    const wmDomain = sweepWatermarkDomain(kind);
    // #1607: the cursor this tick last saw. Every write states it (expected_cursor), so a party link that rewound the cursor
    // meanwhile is kept by the database instead of being overwritten by this older tick.
    let expectedCursor: string | null = null;
    const watermarkDeps = {
      readWatermark: async () => {
        const { data } = await serviceClient.from('external_sync_watermarks').select('watermark_cursor')
          .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain).maybeSingle();
        return (data as { watermark_cursor?: string | null } | null)?.watermark_cursor ?? null;
      },
      advanceWatermark: async (cursor: string) => {
        // `updated_at` is stamped EXPLICITLY (PostgREST's ON CONFLICT DO UPDATE sets every supplied
        // column): it refreshes the attempt recency used by orderedSweepKindsForOrg. Left implicit,
        // it would stay at first-insert and ordering would degenerate after a doctype's first walk.
        const { error } = await serviceClient.from('external_sync_watermarks').upsert(
          {
            org_id: org.orgId,
            external_tier: ERPNEXT_TIER,
            domain: wmDomain,
            watermark_cursor: cursor,
            ...(expectedCursor === null ? {} : { expected_cursor: expectedCursor }),
            last_error: null,
            last_error_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,external_tier,domain' },
        );
        if (error) throw new AppError(error.message, error.code);
        expectedCursor = cursor;
      },
    };
    // Luna BLOCK A1: `payment`/`incoming-payment` share the `Payment Entry` doctype — fetch
    // `payment_type` and filter the poll (server-side + defense-in-depth post-fetch) so a Pay doc is
    // NEVER adopted by the incoming-payment poll and vice-versa. #775 phase B adds the party/key
    // discriminator; all of it is `pollFiltersForKind` (above).
    // Luna BLOCK 6: fetch exactly the fields THIS kind's mapper consumes (money included), plus — where
    // the canonical depends on a child table the list endpoint cannot return (the Receive PE's
    // `references`) — re-read each changed doc in full.
    const fields = sweepFieldsForKind(kind, org.versionMajor ?? undefined);
    const hydrateDoc = KINDS_NEEDING_FULL_DOC.includes(kind)
      ? (name: string) => fetchErpDoc(client, doctype, name)
      : undefined;
    try {
      // Stamp the ATTEMPT, not only successful cursor advances: a halted doctype spent this tick's
      // listing budget too, and must yield priority to siblings on the next invocation.
      const { data: priorWatermark, error: priorWatermarkError } = await serviceClient.from('external_sync_watermarks')
        .select('watermark_cursor').eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain).maybeSingle();
      if (priorWatermarkError) throw new AppError(priorWatermarkError.message, priorWatermarkError.code);
      expectedCursor = (priorWatermark as { watermark_cursor?: string | null } | null)?.watermark_cursor ?? null;
      const { error: attemptError } = await serviceClient.from('external_sync_watermarks').upsert({
        org_id: org.orgId, external_tier: ERPNEXT_TIER, domain: wmDomain,
        watermark_cursor: (priorWatermark as { watermark_cursor?: string | null } | null)?.watermark_cursor ?? '',
        ...(expectedCursor === null ? {} : { expected_cursor: expectedCursor }),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,external_tier,domain' });
      if (attemptError) throw new AppError(attemptError.message, attemptError.code);
      const result = await runSweep(
        { tier: ERPNEXT_TIER, domain },
        {
          ...feedDeps,
          ...watermarkDeps,
          applyChange: (ctx, externalRecordId, canonical, sourceModMs, d) =>
            kind === 'contact' ? applyErpContactFeed(serviceClient, org.orgId, externalRecordId, canonical, sourceModMs) : applyErpFeedEvent(ctx, externalRecordId, canonical, sourceModMs, d as Parameters<typeof applyErpFeedEvent>[4]),
          // HIGH-A: a document PMO must NEVER adopt (a Desk-created Budget/Timesheet, or a procurement
          // doc whose PMO case link only the dispatch path can make) throws BY DESIGN. That is a
          // terminal, already-surfaced outcome for that ONE document — ack it and keep going, so the
          // watermark still advances and the changes behind it (a Desk cancel of a PMO-pushed Budget)
          // apply. Anything unclassified still halts this doctype, unadvanced, for the next tick.
          applyErrorPolicy: erpFeedApplyErrorPolicy,
          listChanges: async (cursor) => {
            const listed = await listErpChangesSinceWatermark(
              {
                client,
                doctype,
                fields,
                includeAmendedFrom: DOCTYPE_REGISTRY[kind].submittable,
                fromDoc: bodyFns.fromDoc,
                ...(hydrateDoc ? { hydrateDoc } : {}),
                // WIRE 3: the company conjunct rides alongside BLOCK A1's payment_type discriminator.
                extraFilters: poll.extraFilters,
                // BLOCK A1's post-fetch discriminator AND WIRE 3's per-document company gate — the
                // server-side filters above are an optimization, these are the authority — composed under
                // BLOCK 1's in-flight-adopt guard (`inFlightAnchorFilter` returns the base filter
                // unchanged when it has nothing of its own to add).
                ...(() => {
                  const filterRow = inFlightAnchorFilter(kind, inFlightProbe, poll.admits);
                  return filterRow ? { filterRow } : {};
                })(),
                // #916: the bounded listing quantum — the walk resumes at the persisted cursor.
                maxPages: opts.maxListPages ?? SWEEP_LIST_MAX_PAGES,
              },
              cursor,
            );
            // #916 fix round (budget undercount): the tick's document budget counts rows LISTED
            // (fetched) — the quantum the walk touches — NOT rows that applied. A 1,000-row listing
            // whose apply fails, or whose rows a per-row filter drops, costs the walk exactly as much
            // as one that applies; counting outcomes re-spent the same tick on the same work (a
            // failing doctype left the budget at zero and every later doctype walked anyway).
            // Counted HERE, the moment the listing returns, so the budget is spent regardless of the
            // apply outcome below (including a halt that aborts this doctype mid-batch).
            docsThisTick += listed.listedCount;
            if (!listed.caughtUp) complete = false;
            return listed;
          },
        },
      );
      applied += result.applied;
      // A successful walk with no changed rows has no cursor to advance, but it still recovers
      // the doctype and must clear its previous failure state.
      const { error: clearError } = await serviceClient.from('external_sync_watermarks').update({ last_error: null, last_error_at: null })
        .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain).not('last_error', 'is', null);
      if (clearError) throw new AppError(clearError.message, clearError.code);
      // Never silent: an acked-and-skipped document (never-adopt / lossy hint) is logged with its ERP
      // name so an operator can see exactly what the poll declined to import.
      for (const s of result.skipped) {
        console.warn(`[erpnext-sweep] org ${org.orgId} ${doctype} ${s.externalRecordId}: acked+skipped — ${s.error}`);
      }
    } catch (err) {
      // Full upstream detail stays in function logs only; watermarks are member-readable, so persist
      // only a diagnostic code derived from the error class/status.
      console.error(`[erpnext-sweep] ${doctype} walk failed`, err);
      const safeError = sweepErrorCode(err);
      try {
        const { error } = await serviceClient.from('external_sync_watermarks').update({ last_error: safeError })
          .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain);
        if (error) console.error('[erpnext-sweep] SWEEP_ERROR_WATERMARK_WRITE_FAILED');
      } catch {
        console.error('[erpnext-sweep] SWEEP_ERROR_WATERMARK_WRITE_FAILED');
      }
      const alertAt = nowMs();
      let shouldAlert = false;
      try {
        const { data, error } = await serviceClient.from('external_sync_watermarks')
          .update({ last_error_at: new Date(alertAt).toISOString() })
          .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain)
          .or(`last_error_at.is.null,last_error_at.lt.${new Date(alertAt - 3_600_000).toISOString()}`)
          .select('id');
        if (error) console.error('[erpnext-sweep] SWEEP_ERROR_ALERT_CLAIM_FAILED');
        else shouldAlert = Boolean(data?.length);
      } catch {
        console.error('[erpnext-sweep] SWEEP_ERROR_ALERT_CLAIM_FAILED');
      }
      if (shouldAlert) {
        await recordSweepErrorEvent(serviceClient as unknown as ErrorEventSupabaseLike, {
          fn: 'erpnext-sweep',
          errorCode: 'sweep-doctype-failed',
          contextId: wmDomain,
          orgId: org.orgId,
        });
      }
      // An unreachable adapter (or one doctype's failure) is recorded but does NOT abort the other
      // doctypes/orgs (AC-CUA-044 sibling: the next schedule retries).
      doctypeErrors.push(`${doctype}: sweep failed`);
      continue;
    }
  }
  return { applied, complete, ...(doctypeErrors.length > 0 ? { error: doctypeErrors.join(' | ') } : {}) };
}
