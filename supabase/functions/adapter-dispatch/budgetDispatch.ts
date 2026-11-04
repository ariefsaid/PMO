import { type SupabaseClient } from '@supabase/supabase-js';
import {
  runBudgetGate,
  type FiscalYearRow,
  BudgetGateError,
  type BudgetGateDeps,
  type BudgetDistributionPlan,
  type BudgetDistributionRow,
  type BudgetVersionGateRow,
  type BudgetGateProjectRow,
} from '../../../pmo-portal/src/lib/budget/budgetGate.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { SupersededDocumentMarker } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { redactErrorForOutbox } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import {
  budgetAccountIdentity,
  budgetAccountPushKey,
  budgetRangeIdentity,
  parseBudgetIdentity,
} from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { planBudgetAccountIntents, planRangeAccountIntents, resolveV16BudgetAccounts } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountPlan.ts';
import { encodeFiscalYear } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts';
import { budgetPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts';
import { ERPNEXT_BUDGET_DOMAIN, ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { fetchAllRowsByKeyset } from '../../../pmo-portal/src/lib/pagedRead.ts';
import { ERP_PROBE_TIMEOUT_MS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { fetchWithDeadline } from '../_shared/fetchWithDeadline.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { classifyBudgetPushOutcome } from './budgetPushOutcome.ts';
import { isCanonicalUuid, isOpaqueIdempotencyKey } from './transitionTargetGuard.ts';
import { reportEdgeError } from '../_shared/reportEdgeError.ts';
import { surfaceActionRequired } from '../_shared/erpnextFeedDeps.ts';
import { readBudgetLineItems, readCategoryAccountMap } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import type { ErpBindingRow } from './dispatchAdapters.ts';

export type ErpBindingResolver = (serviceClient: SupabaseClient, orgId: string) => Promise<ErpBindingRow>;

export interface BudgetDispatchUnit {
  fiscalYear: string;
  toFiscalYear?: string | null;
  erpAccount: string | null;
  /** `<budget_version_id>:<encoded_fiscal_year>` — the outbox + external_refs identity. */
  identity: string;
  idempotencyKey: string;
  record: AdapterCommand['record'];
}

/** Return whether an archive cancellation can still have changed ERP state. A `superseded` intent
 *  is safe to release only when the service-role lookup proves no cancellation outbox row was ever
 *  issued for it; a stale/superseded command can still have reached ERPNext. */
export async function hasUnsettledBudgetArchiveCancellation(
  serviceClient: SupabaseClient,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  const intents = await fetchAllRowsByKeyset<{ id: string; state: string }>((afterId, limit) => {
    let query = serviceClient.from('budget_archive_cancel_intents')
      .select('id,state').eq('org_id', orgId).eq('project_id', projectId)
      .neq('state', 'complete').order('id', { ascending: true }).limit(limit);
    if (afterId !== null) query = query.gt('id', afterId);
    return query as never;
  });
  for (const intent of intents) {
    if (intent.state !== 'superseded') return true;
    const { data, error } = await serviceClient.from('external_command_outbox')
      .select('id').eq('org_id', orgId).eq('domain', 'budget').eq('operation', 'create')
      .filter('payload->>budget_archive_cancel_job_id', 'eq', intent.id).limit(1);
    if (error) throw new AppError('budget push: predecessor cancellation state could not be read', 'external-unreachable');
    if ((data ?? []).length > 0) return true;
  }
  return false;
}

export function isBudgetPushCommand(cmd: { domain: string; record: Record<string, unknown> }): boolean {
  return cmd.domain === ERPNEXT_BUDGET_DOMAIN && cmd.record.erp_doc_kind === 'budget';
}

/** Does this org have an ACTIVATED erpnext binding at all? A non-employing org's budget push is a
 *  BENIGN NO-OP — same posture as the timesheet "no chargeable hours" skip above — never a rejection, and
 *  critically the GATE never runs for it: a non-employing org legitimately carries zero
 *  `budget_category_account_map` rows, and running the map check anyway would record a spurious
 *  'budget-category-unmapped' failure into `budget_version_erp_mirror` for every org that will never use
 *  this feature (AC-BUD-001 — a non-employing org must stay byte-for-byte). */
export async function orgEmploysErpnext(serviceClient: SupabaseClient, orgId: string): Promise<boolean> {
  const { data } = await serviceClient
    .from('external_org_bindings')
    .select('activated_at')
    .eq('org_id', orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  return !!(data as { activated_at: string | null } | null)?.activated_at;
}

/** Wire `runBudgetGate`'s readers: the three PMO tables under the CALLER's own JWT (RLS is the org
 *  boundary — ADR-0059 §3.3), the map via the service-role reader `dispatchFactory.ts` already uses for
 *  the real push. */
export function buildBudgetGateDeps(callerClient: SupabaseClient, serviceClient: SupabaseClient, orgId: string, versionId: string, erpAuth: ErpAuthPairCache, resolveBinding: ErpBindingResolver): BudgetGateDeps {
  return {
    orgId,
    versionId,
    readVersion: async (id) => {
      const { data } = await callerClient
        .from('budget_versions')
        .select('id, org_id, project_id, status, activated_at, budget_mode')
        .eq('id', id)
        .maybeSingle();
      return (data as BudgetVersionGateRow | null) ?? null;
    },
    readProject: async (id) => {
      const { data } = await callerClient.from('projects').select('id, org_id, start_date, end_date').eq('id', id).maybeSingle();
      return (data as BudgetGateProjectRow | null) ?? null;
    },
    // ⚑ PAGED + fail-closed (audit round 8). The SHIPPED reader lives in `dispatchFactory.ts` beside
    // `readCategoryAccountMap` — one definition, unit-bound — because an unpaged read here silently
    // capped at PostgREST's 1000 rows and would push an UNDERSTATED Budget into the client's ERP.
    readLineItems: (id) => readBudgetLineItems(callerClient as never, id),
    readCategoryMap: () => readCategoryAccountMap(serviceClient as never, orgId),
    readFiscalYears: () => readErpFiscalYears(serviceClient, orgId, erpAuth, resolveBinding),
    readDistributionPlan: async () => {
      const { data, error } = await callerClient.from('budget_distribution_plans')
        .select('method, inputs, basis, category_overrides')
        .eq('budget_version_id', versionId)
        .maybeSingle();
      if (error) throw new AppError(`budget push: the saved distribution plan could not be read: ${error.message}`, 'commit-rejected');
      return (data as BudgetDistributionPlan | null) ?? null;
    },
    readDistributionRows: async () => {
      const rows = await fetchAllRowsByKeyset<BudgetDistributionRow & { id: string; amount: number | string }>((afterId, limit) => {
        const query = callerClient.from('budget_year_distributions')
          .select('id, category, fiscal_year, ordinal, amount, method, is_override')
          .eq('budget_version_id', versionId)
          .order('id', { ascending: true });
        return (afterId === null ? query : query.gt('id', afterId))
          .limit(limit) as PromiseLike<{ data: Array<BudgetDistributionRow & { id: string; amount: number | string }> | null; error: { message: string; code?: string } | null }>;
      });
      return rows.map(({ id: _id, amount, ...row }) => ({ ...row, amount: String(amount) }));
    },
  };
}

/**
 * ⚑ OQ-BUD-3b (owner ruling 2026-07-21) — read the CLIENT'S OWN fiscal calendar from ERPNext.
 *
 * A fiscal year is whatever the client declares (Apr–Mar, Jul–Jun, …) and Budget's `fiscal_year` is a
 * **Link by NAME** (spike §3). Deriving the calendar year of `start_date` — what this shipped as —
 * sends a value that for a non-calendar client names the WRONG Fiscal Year or none at all: an invalid
 * Link, and a real overspend control enforced against the wrong period.
 *
 * This is the ONE extra read per budget push the ruling accepts. It is deliberately NOT cached: the
 * cost of a stale calendar here is a budget filed against the wrong year, which is exactly the failure
 * being removed. Errors propagate — `runBudgetGate` fails closed on an unresolvable calendar rather
 * than falling back (the fallback IS the bug).
 */
async function readErpFiscalYears(serviceClient: SupabaseClient, orgId: string, cache: ErpAuthPairCache, resolveBinding: ErpBindingResolver): Promise<FiscalYearRow[]> {
  const binding = await resolveBinding(serviceClient, orgId);
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, { orgId, secretRef: binding.secret_ref }, cache);
  const url = new URL('/api/resource/Fiscal Year', binding.site_url);
  url.searchParams.set('fields', JSON.stringify(['name', 'year_start_date', 'year_end_date']));
  url.searchParams.set('limit_page_length', '0'); // all of them — a client may declare many years
  // ⚑ Server-side hang guard (money path): this raw read bypasses the bounded `erpnextRequest` client,
  // so a slow/down ERPNext would otherwise block the edge worker on this fetch forever. Bound it at the
  // same probe budget the recovery reads use; a deadline (or any network failure) fails CLOSED as
  // `external-unreachable`, exactly like a non-2xx — the budget gate then refuses rather than filing
  // against a guessed calendar, and the sweep backstop re-drives it.
  let res: Response;
  try {
    res = await fetchWithDeadline(
      guardedErpFetch(binding.site_url),
      url.toString(),
      // #655: never follow a redirect off the admin-nominated host; a 3xx fails the `!res.ok` check below.
      { headers: { Authorization: `token ${apiKey}:${apiSecret}`, Accept: 'application/json' }, redirect: 'manual' },
      ERP_PROBE_TIMEOUT_MS,
    );
  } catch {
    throw new AppError('could not read the ERPNext fiscal calendar (unreachable)', 'external-unreachable');
  }
  if (!res.ok) {
    throw new AppError(`could not read the ERPNext fiscal calendar (HTTP ${res.status})`, 'external-unreachable');
  }
  const body = (await res.json()) as { data?: unknown };
  const rows = Array.isArray(body.data) ? body.data : [];
  return rows.filter(
    (r): r is FiscalYearRow =>
      typeof (r as FiscalYearRow)?.name === 'string' &&
      typeof (r as FiscalYearRow)?.year_start_date === 'string' &&
      typeof (r as FiscalYearRow)?.year_end_date === 'string',
  );
}

async function reportBudgetMirrorWriteFailure(orgId: string, versionId: string): Promise<void> {
  try {
    await reportEdgeError({
      fn: 'adapter-dispatch', errorCode: 'BUDGET_FAILURE_MIRROR_WRITE_FAILED',
      ...(isCanonicalUuid(versionId) ? { contextId: versionId } : {}), orgId,
    });
  } catch {
    // Reporting must never replace the original budget rejection.
  }
}

/** Record the gate's durable failure into the ADR-0059 §6 side mirror — BEFORE returning the rejection —
 *  so the operator surface + the sweep backstop's work queue both see it. Only written when the gate had
 *  already resolved a `fiscalYear` (the mirror's grain): an earlier rejection (version/project unreadable,
 *  no activation stamp) has no fiscal year to key a row on, and `budget_version_erp_mirror`'s own writer
 *  (`readModelWriters.ts`) already refuses a fiscal-year-less row for the identical reason. Best-effort —
 *  a failure to record this must never mask the rejection the caller already gets. */
async function recordBudgetGateFailure(serviceClient: SupabaseClient, orgId: string, versionId: string, err: BudgetGateError, versionMajor?: number | null): Promise<void> {
  if (!err.fiscalYear) return;
  try {
    const row = {
      org_id: orgId,
      budget_version_id: versionId,
      fiscal_year: err.fiscalYear,
      push_state: 'failed',
      push_error: err.code,
      unmapped_categories: err.unmappedCategories ?? null,
    };
    if (versionMajor === 16) {
      const { error } = await serviceClient.from('budget_version_account_erp_mirror').upsert({
        ...row, erp_account: '', budget_intent: 'ensure', created_at: new Date().toISOString(),
        to_fiscal_year: null,
      }, { onConflict: 'org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account' });
      if (error) throw error;
    } else {
      const { error } = await serviceClient.from('budget_version_erp_mirror').upsert(row, {
        onConflict: 'org_id,budget_version_id,fiscal_year',
      });
      if (error) throw error;
    }
  } catch (mirrorErr) {
    console.error('[adapter-dispatch] failed to record budget gate failure:', mirrorErr);
    await reportBudgetMirrorWriteFailure(orgId, versionId);
  }
}

/** Build the server-derived, per-year push plan before adapter selection or outbox work. */
export async function buildBudgetDispatchPlan(args: {
  command: AdapterCommand;
  callerClient: SupabaseClient;
  serviceClient: SupabaseClient;
  orgId: string;
  erpAuth: ErpAuthPairCache;
  headers: HeadersInit;
  resolveBinding: ErpBindingResolver;
}): Promise<{ versionMajor: 15 | 16 | null; units: BudgetDispatchUnit[] | null } | Response> {
  const { command, callerClient, serviceClient, orgId, erpAuth, headers, resolveBinding } = args;
  if (!isBudgetPushCommand(command)) return { versionMajor: null, units: null };
  let budgetVersionMajor: 15 | 16 | null = null;
  let budgetUnits: BudgetDispatchUnit[];


    if (!(await orgEmploysErpnext(serviceClient, orgId))) {
      return new Response(
        JSON.stringify({ externalRecordId: null, canonical: { id: command.record.id }, skipped: 'org-not-employing-erpnext' }),
        { status: 200, headers },
      );
    }

    const versionId = String(command.record.id);
    // ⚑ HIGH 5 (FR-BFY-056) — a PER-YEAR retry. The client names the ONE fiscal year the operator is
    // retrying (`record.target_fiscal_year`); activation sends none and still fans out to every plan
    // year below. Validated against the gate's plan (the live-ERP-checked calendar), never trusted: a
    // year that is not a phased plan entry is refused, never silently widened to the whole fan-out.
    const targetFiscalYearRaw = (command.record as { target_fiscal_year?: unknown }).target_fiscal_year;
    const targetFiscalYear = typeof targetFiscalYearRaw === 'string' && targetFiscalYearRaw.length > 0 ? targetFiscalYearRaw : null;
    try {
      const bindingSnapshot = await resolveBinding(serviceClient, orgId);
      const versionMajor = bindingSnapshot.version_major;
      if (versionMajor !== 15 && versionMajor !== 16) {
        throw new BudgetGateError('config-rejected', 'budget push requires a supported ERP binding version');
      }
      budgetVersionMajor = versionMajor;
      const gate = await runBudgetGate(buildBudgetGateDeps(callerClient, serviceClient, orgId, versionId, erpAuth, resolveBinding));
      const isWholeProjectRange = versionMajor === 16 && gate.budgetMode === 'whole_project';
      if (versionMajor === 15 && gate.budgetMode === 'whole_project') {
        throw new BudgetGateError('commit-rejected', 'budget push: whole-project budgets are unsupported on ERPNext v15');
      }
      if (isWholeProjectRange && targetFiscalYear !== null && targetFiscalYear !== gate.range?.fromFiscalYear) {
        throw new BudgetGateError('commit-rejected', 'budget push: a range budget retry must target its starting fiscal year');
      }
      // ⚑ BFY FR-BFY-030/031/032/036 — THE FAN-OUT. The gate returns a per-year PLAN; each entry
      // becomes one command with:
      //   • `record.id` UNCHANGED — the bare `budget_version_id` UUID. It is the gate's own query key,
      //     the mirror's FK, and the inbound feed's lookup; a year in it makes all three wrong.
      //   • `outbox_identity` = `<vid>:<encoded-fy>` — the SEPARATE, year-qualified identity the outbox
      //     row and `external_refs` are keyed on, so the outbox unique/one-in-flight indexes (0096/0134)
      //     and `external_refs` (0088) scope per year: two years can be in flight at once, and a retry
      //     of year 2 with year 1 terminal is a retry, not a duplicate.
      //   • `idempotency_key` = `bud:<vid>:<encoded-fy>:<epoch>` — derived HERE, from DB truth, so the
      //     foreground and the sweep land on the identical string with no shared client state.
      //   • `project_start_date`/`project_end_date` — the FR-BFY-080 push-time span witness, carried on
      //     a NON-body field (they are not ERP `Budget` fields) for the mirror writer to stamp.
      // Server truth REPLACES the payload for every field the push body is built from (ADR-0059 §3.3):
      // `projectId` (camelCase) feeds the cross-org pre-flight + ERP-project resolution;
      // `fiscal_year`/`line_items` (snake_case) feed `bodies/budget.ts`'s `budgetToBody`, ONE YEAR AT A
      // TIME (no body-level split — the split is the plan's, and the plan is PMO's own line items).
      // ⚑ HIGH 5 (FR-BFY-056): scope the fan-out to the retried year, if one was named. Fail closed on a
      // year the plan does not contain — a retry must act on exactly the row the operator clicked.
      // ⚑ `target_fiscal_year` only scopes WHICH units this request drives; it is not part of any unit's
      // command. Left on the unit record it entered the outbox payload digest, so an operator's per-year
      // Retry no longer matched the digest its own activation saved under the same key: an account
      // already confirmed in ERPNext was refused as a key-reuse mismatch, recorded `failed`, and then
      // parked `held` by the sweep with nothing left to re-send it. Activation and Retry build the same unit.
      const {
        target_fiscal_year: _targetFiscalYear,
        budget_intent: _callerBudgetIntent,
        source_kind: _callerSourceKind,
        budget_predecessor: _callerBudgetPredecessor,
        budget_predecessor_modified: _callerPredecessorModified,
        budget_archive_cancel_job_id: _callerArchiveJobId,
        budget_archive_source_mirror_id: _callerArchiveMirrorId,
        outbox_identity: _callerOutboxIdentity,
        project_start_date: _callerProjectStartDate,
        project_end_date: _callerProjectEndDate,
        activated_at: _callerActivatedAt,
        erp_account: _callerErpAccount,
        ...unitRecordBase
      } = command.record as AdapterCommand['record'] & {
        target_fiscal_year?: unknown;
        budget_intent?: unknown;
        source_kind?: unknown;
        budget_predecessor?: unknown;
        budget_predecessor_modified?: unknown;
        budget_archive_cancel_job_id?: unknown;
        budget_archive_source_mirror_id?: unknown;
        outbox_identity?: unknown;
        project_start_date?: unknown;
        project_end_date?: unknown;
        activated_at?: unknown;
        erp_account?: unknown;
      };
      const planEntries = isWholeProjectRange ? [] : targetFiscalYear === null
        ? gate.plan
        : gate.plan.filter((entry) => entry.fiscal_year === targetFiscalYear);
      if (!isWholeProjectRange && targetFiscalYear !== null && planEntries.length === 0 &&
          !(versionMajor === 16 && gate.inSpanFiscalYears.includes(targetFiscalYear))) {
        throw new BudgetGateError(
          'commit-rejected',
          `budget push: fiscal year "${targetFiscalYear}" is not a phased year of this budget version`,
          undefined,
          targetFiscalYear,
        );
      }
      if (versionMajor === 16) {
        const history = await fetchAllRowsByKeyset<{ id: string; budget_version_id: string; fiscal_year: string; to_fiscal_year: string | null; erp_account: string; erp_budget_name: string | null; erp_cancelled_at: string | null; erp_docstatus: number | null; erp_modified: string | null }>((afterId, limit) => {
          let query = serviceClient.from('budget_version_account_erp_mirror')
            .select('id,budget_version_id,fiscal_year,to_fiscal_year,erp_account,erp_budget_name,erp_cancelled_at,erp_docstatus,erp_modified,budget_versions!inner(project_id)')
            .eq('org_id', orgId)
            .eq('budget_versions.project_id', gate.projectId)
            .order('id', { ascending: true })
            .limit(limit);
          if (afterId !== null) query = query.gt('id', afterId);
          return query as never;
        });
        const outOfSpan = isWholeProjectRange ? undefined : history.find((row) => row.erp_account && row.erp_budget_name && !row.erp_cancelled_at && row.erp_docstatus !== 2 && !gate.inSpanFiscalYears.includes(row.fiscal_year));
        if (outOfSpan) {
          throw new BudgetGateError(
            'commit-rejected',
            `budget push: prior account ${outOfSpan.erp_account} for fiscal year ${outOfSpan.fiscal_year} is outside the current project span and requires operator action`,
            undefined,
            outOfSpan.fiscal_year,
          );
        }
        const refs = isWholeProjectRange
          ? await fetchAllRowsByKeyset<{ id: string; pmo_record_id: string; external_record_id: string }>((afterId, limit) => {
            let query = serviceClient.from('external_refs')
              .select('id,pmo_record_id,external_record_id')
              .eq('org_id', orgId).eq('domain', 'budget').eq('external_tier', 'erpnext')
              .order('id', { ascending: true }).limit(limit);
            if (afterId !== null) query = query.gt('id', afterId);
            return query as never;
          })
          : [];
        const refsByIdentity = new Map(refs.map((row) => [row.pmo_record_id, row.external_record_id]));
        const prior = history.flatMap((row) => {
          if (!row.erp_account || !row.erp_budget_name) return [];
          let pmoWitnessed = false;
          if (isWholeProjectRange && row.to_fiscal_year) {
            try {
              const identity = budgetRangeIdentity(row.budget_version_id, row.fiscal_year, row.to_fiscal_year, row.erp_account);
              pmoWitnessed = refsByIdentity.get(identity) === row.erp_budget_name;
            } catch {
              pmoWitnessed = false;
            }
          }
          return [{
            fiscalYear: row.fiscal_year,
            toFiscalYear: row.to_fiscal_year,
            erpAccount: row.erp_account,
            erpBudgetName: row.erp_budget_name,
            cancelledAt: row.erp_cancelled_at,
            pmoWitnessed,
            docstatus: row.erp_docstatus,
            erpModified: row.erp_modified,
          }];
        });
        if (isWholeProjectRange) {
          const range = gate.range;
          if (!range || !gate.distributionRows) throw new BudgetGateError('budget-distribution-stale', 'budget push: approved range rows are unavailable');
          const desired = resolveV16BudgetAccounts(gate.sourceLineItems, gate.categoryMap);
          const accountVectors = new Map<string, Array<{ year: string; amount: string }>>();
          for (const accountRow of desired) {
            const categories = gate.categoryMap.filter((row) => row.erp_account === accountRow.account)
              .map((row) => row.category)
              .filter((category) => gate.sourceLineItems.some((line) => line.category === category));
            if (categories.length !== 1) {
              throw new BudgetGateError('commit-rejected', `budget push: range account ${accountRow.account} does not resolve to exactly one source category`);
            }
            const category = categories[0]!;
            const categoryRows = gate.distributionRows.filter((row) => row.category === category);
            if (categoryRows.length !== range.fiscalYears.length) {
              throw new BudgetGateError('budget-distribution-stale', `budget push: yearly rows for ${category} are incomplete`);
            }
            accountVectors.set(accountRow.account, range.fiscalYears.map((year, index) => {
              const row = categoryRows.find((candidate) => candidate.fiscal_year === year.name && candidate.ordinal === index);
              if (!row) throw new BudgetGateError('budget-distribution-stale', `budget push: yearly row for ${category} is missing`);
              return { year: year.name, amount: row.amount };
            }));
          }
          budgetUnits = planRangeAccountIntents(range, desired, prior).map((intent) => {
            const identity = budgetRangeIdentity(gate.versionId, intent.fiscalYear, intent.toFiscalYear, intent.erpAccount);
            return {
              fiscalYear: intent.fiscalYear,
              toFiscalYear: intent.toFiscalYear,
              erpAccount: intent.erpAccount,
              identity,
              idempotencyKey: budgetAccountPushKey(identity, gate.activatedAt),
              record: {
                ...unitRecordBase,
                id: gate.versionId,
                erp_doc_kind: 'budget',
                budget_mode: 'whole_project',
                projectId: gate.projectId,
                fiscal_year: intent.fiscalYear,
                to_fiscal_year: intent.toFiscalYear,
                line_items: gate.sourceLineItems,
                fiscal_years: gate.fiscalYears,
                ...(intent.intent === 'ensure' ? { year_amounts: accountVectors.get(intent.erpAccount) } : {}),
                erp_account: intent.erpAccount,
                budget_intent: intent.intent,
                budget_predecessor: intent.predecessor,
                budget_predecessor_modified: intent.predecessorModified,
                outbox_identity: identity,
                project_start_date: gate.projectStartDate,
                project_end_date: gate.projectEndDate,
                activated_at: gate.activatedAt,
              } as AdapterCommand['record'],
            };
          });
        } else {
          const byYear = new Map(planEntries.map((entry) => [entry.fiscal_year, entry]));
          const accountYears = (targetFiscalYear ? [targetFiscalYear] : gate.inSpanFiscalYears)
            .filter((year) => gate.inSpanFiscalYears.includes(year));
          budgetUnits = accountYears.flatMap((year) => {
            const entry = byYear.get(year) ?? { fiscal_year: year, line_items: [] };
            const desired = resolveV16BudgetAccounts(entry.line_items, gate.categoryMap);
            return planBudgetAccountIntents(year, desired, prior).map((intent) => {
              const identity = budgetAccountIdentity(gate.versionId, intent.fiscalYear, intent.erpAccount);
              return {
                fiscalYear: intent.fiscalYear,
                erpAccount: intent.erpAccount,
                identity,
                idempotencyKey: budgetAccountPushKey(identity, gate.activatedAt),
                record: {
                  ...unitRecordBase,
                  id: gate.versionId,
                  erp_doc_kind: 'budget',
                  projectId: gate.projectId,
                  fiscal_year: intent.fiscalYear,
                  line_items: entry.line_items,
                  erp_account: intent.erpAccount,
                  budget_intent: intent.intent,
                  budget_predecessor: intent.predecessor,
                  outbox_identity: identity,
                  project_start_date: gate.projectStartDate,
                  project_end_date: gate.projectEndDate,
                  activated_at: gate.activatedAt,
                } as AdapterCommand['record'],
              };
            });
          });
        }
      } else {
        budgetUnits = planEntries.map((entry) => {
          const encodedFiscalYear = encodeFiscalYear(entry.fiscal_year);
          const identity = `${gate.versionId}:${encodedFiscalYear}`;
          return {
            fiscalYear: entry.fiscal_year,
            erpAccount: null,
            identity,
            idempotencyKey: budgetPushKey(gate.versionId, encodedFiscalYear, gate.activatedAt),
            record: {
              ...unitRecordBase,
              projectId: gate.projectId,
              fiscal_year: entry.fiscal_year,
              line_items: entry.line_items,
              outbox_identity: identity,
              project_start_date: gate.projectStartDate,
              project_end_date: gate.projectEndDate,
              activated_at: gate.activatedAt,
            } as AdapterCommand['record'],
          };
        });
      }
      // The FINAL server-derived key is validated at the served boundary, never trusted (FR-BFY-031).
      // An unencodable/unparseable year is refused BEFORE the outbox, exactly like a client key would be.
      for (const unit of budgetUnits) {
        if (!isOpaqueIdempotencyKey(unit.idempotencyKey)) {
          throw new BudgetGateError(
            'commit-rejected',
            `budget push: the server-derived idempotency key for fiscal year "${unit.fiscalYear}" is not a valid opaque key`,
            undefined,
            unit.fiscalYear,
          );
        }
      }
      if (versionMajor === 16 && budgetUnits.length > 0) {
        let cancellationWait: string | null = null;
        if (isWholeProjectRange) {
          if (await hasUnsettledBudgetArchiveCancellation(serviceClient, orgId, gate.projectId)) {
            cancellationWait = 'waiting-for-budget-archive-cancellation';
          }
        }
        const slots = budgetUnits.map((unit) => ({
          org_id: orgId,
          budget_version_id: gate.versionId,
          fiscal_year: unit.fiscalYear,
          to_fiscal_year: unit.toFiscalYear ?? null,
          erp_account: unit.erpAccount,
          budget_intent: (unit.record as Record<string, unknown>).budget_intent,
          push_state: 'pending',
          push_error: cancellationWait,
          activated_at_witness: gate.activatedAt,
          pushed_project_start_date: gate.projectStartDate,
          pushed_project_end_date: gate.projectEndDate,
        }));
        const { error: slotError } = await serviceClient.from('budget_version_account_erp_mirror').upsert(slots, {
          onConflict: 'org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account',
          ignoreDuplicates: true,
        });
        if (slotError) throw new BudgetGateError('commit-rejected', 'budget push: could not persist the account unit queue');
        // The account-grained queue is now durable for every unit in this attempt. Retire any prior
        // gate-failure sentinel so it cannot outrank the account outcomes from this retry.
        const { error: sentinelError } = await serviceClient.from('budget_version_account_erp_mirror').delete()
          .eq('org_id', orgId).eq('budget_version_id', gate.versionId).eq('erp_account', '')
          .in('fiscal_year', [...new Set(budgetUnits.map((unit) => unit.fiscalYear))]);
        if (sentinelError) throw new BudgetGateError('commit-rejected', 'budget push: could not clear the prior gate-failure status');
        if (isWholeProjectRange) {
          let waitingRows = serviceClient.from('budget_version_account_erp_mirror')
            .update({ push_state: 'pending', push_error: cancellationWait })
            .eq('org_id', orgId).eq('budget_version_id', gate.versionId)
            .eq('fiscal_year', gate.range!.fromFiscalYear).eq('to_fiscal_year', gate.range!.toFiscalYear)
            .in('erp_account', [...new Set(budgetUnits.map((unit) => unit.erpAccount).filter((account): account is string => account !== null))])
            .is('erp_cancelled_at', null);
          waitingRows = cancellationWait
            ? waitingRows.in('push_state', ['pending', 'failed']) as typeof waitingRows
            : waitingRows.eq('push_state', 'pending').eq('push_error', 'waiting-for-budget-archive-cancellation') as typeof waitingRows;
          const { error: waitingError } = await waitingRows;
          if (waitingError) throw new BudgetGateError('commit-rejected', 'budget push: predecessor cancellation wait state could not be recorded');
          if (cancellationWait) {
            return new Response(JSON.stringify({
              error: 'budget-cancellation-pending',
              message: 'An earlier ERPNext Budget cancellation is unresolved; range units are pending and no replacement was created.',
            }), { status: 202, headers });
          }
        }
      }
    } catch (err) {
      const gateErr = err instanceof BudgetGateError ? err : new BudgetGateError('commit-rejected', err instanceof Error ? err.message : 'budget gate failed');
      await recordBudgetGateFailure(serviceClient, orgId, versionId, gateErr, budgetVersionMajor);
      return new Response(JSON.stringify({ error: 'commit-rejected', message: gateErr.message }), { status: 422, headers });
    }
  return { versionMajor: budgetVersionMajor, units: budgetUnits };
}

  /**
   * Luna re-audit HIGH-2 (2026-07-21), ADR-0059 §6/FR-BUD-123 — record a POST-GATE budget push
   * failure as DURABLE, operator-visible state. `recordBudgetGateFailure` (above) covers only a
   * REJECTION BY THE GATE ITSELF (unmapped category, multi-FY, unresolved fiscal year) — a failure
   * from adapter-select or the ERP write ITSELF (the money-safety-audit's concrete scenario: a
   * revision's own outbox/ERP round-trip rejected by ERP's `(company, project, fiscal_year, account)`
   * duplicate guard) landed NO mirror row at all, so `get_budget_projection.push_state` stayed `NULL`
   * — indistinguishable from "never pushed" — and the sweep backstop (which only re-drives
   * `pending`/`failed` rows) had nothing to pick up. ADR-0059 §3.2 STANDS: the swallow itself is
   * correct — activation must never fail because ERP failed — but "swallowed" must mean "recorded and
   * surfaced", never "lost". Keyed on the mirror's own `(org_id, budget_version_id, fiscal_year)`
   * grain; the gate REPLACES `command.record.fiscal_year` with its own server-resolved value on a
   * PASS (line ~772), so by the time either catch block below runs it is real, not a payload guess.
   * Best-effort, like every other action-required surface — never masks the caller's own error.
   */
export async function recordBudgetPushFailure(args: {
  serviceClient: SupabaseClient;
  orgId: string;
  command: AdapterCommand;
  budgetVersionMajor: 15 | 16 | null;
  failure: AppError;
}): Promise<void> {
  const { serviceClient, orgId, command, budgetVersionMajor, failure } = args;
    if (!isBudgetPushCommand(command)) return;
    // ⚑ M-2 (Luna audit round 3) — a 409 is not a push failure. `command-in-flight-for-record` is the
    // normal outcome of a double-clicked Retry (or the backstop racing the operator): the command that
    // IS settling owns the outcome, so recording one here raised a false money alarm and could
    // overwrite the winner's `pushed` with `failed`. `command-held` is real but belongs in `held`, the
    // state the backstop deliberately excludes because a human must resolve it. See budgetPushOutcome.ts.
    const outcome = classifyBudgetPushOutcome(failure.code);
    if (!outcome.record) return;
    const fiscalYear = (command.record as { fiscal_year?: unknown }).fiscal_year;
    if (typeof fiscalYear !== 'string' || fiscalYear === '') return; // the gate never resolved one — recordBudgetGateFailure already owns that rejection
    const versionId = String(command.record.id);
    // ⚑ HIGH-1 (audit round 5): when THIS attempt cancelled the previous ERP Budget and then failed to
    // create its replacement, ERPNext is enforcing NOTHING for that project/fiscal year — and a bare
    // `push_error='external-unreachable'` does not say so. Record the money statement (bounded +
    // token-scrubbed by the same redactor the outbox uses) under its own named reason, so the operator
    // surface reports "the control is currently OFF", not merely "the push failed".
    const superseded = (failure as AppError & SupersededDocumentMarker).cancelledExternalRecordId;
    const reason = superseded ? 'budget-enforcement-absent' : (failure.code ?? 'DISPATCH_FAILED');
    const pushError = superseded ? `${reason}: ${redactErrorForOutbox(failure)}` : reason;
    try {
      // ⚑ FR-BFY-080: the push-time span witness is stamped on EVERY mirror outcome, failed included.
      // The gate put the project's own dates on the command; a post-gate failure therefore records the
      // span it was judged against. (§3a consults the witness only on a `pushed` row — F-A — so this is
      // provenance for the operator surface, never an attribution input.)
      const witnessStart = (command.record as { project_start_date?: unknown }).project_start_date;
      const witnessEnd = (command.record as { project_end_date?: unknown }).project_end_date;
      // ⚑ #479: the activation witness is stamped on EVERY outcome, failed included — same reasoning
      // as the span witness above. A failed row that records WHICH activation was attempted is what
      // lets an operator tell "this push failed" from "a later activation superseded it".
      const witnessActivatedAt = (command.record as { activated_at?: unknown }).activated_at;
      const failureRow = {
        org_id: orgId,
        budget_version_id: versionId,
        fiscal_year: fiscalYear,
        to_fiscal_year: (command.record as { to_fiscal_year?: unknown }).to_fiscal_year ?? null,
        push_state: outcome.pushState,
        push_error: pushError,
        ...(typeof witnessActivatedAt === 'string' && witnessActivatedAt !== ''
          ? { activated_at_witness: witnessActivatedAt }
          : {}),
        ...(typeof witnessStart === 'string' && witnessStart !== ''
          ? {
              pushed_project_start_date: witnessStart,
              pushed_project_end_date: typeof witnessEnd === 'string' && witnessEnd !== '' ? witnessEnd : null,
            }
          : {}),
      };
      const accountRecord = command.record as { outbox_identity?: unknown; erp_account?: unknown; budget_intent?: unknown };
      const accountIdentity = typeof accountRecord.outbox_identity === 'string'
        ? parseBudgetIdentity(accountRecord.outbox_identity)
        : null;
      if (accountIdentity?.erpAccount) {
        const { error } = await serviceClient.from('budget_version_account_erp_mirror').upsert({
          ...failureRow,
          erp_account: accountIdentity.erpAccount,
          budget_intent: accountRecord.budget_intent === 'remove' ? 'remove' : 'ensure',
        }, { onConflict: 'org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account' });
        if (error) throw error;
      } else if (budgetVersionMajor === 16) {
        const { error } = await serviceClient.from('budget_version_account_erp_mirror').upsert({
          ...failureRow, erp_account: '', budget_intent: 'ensure', created_at: new Date().toISOString(),
        }, { onConflict: 'org_id,budget_version_id,fiscal_year,to_fiscal_year,erp_account' });
        if (error) throw error;
      } else {
        const { error } = await serviceClient.from('budget_version_erp_mirror').upsert(failureRow, {
          onConflict: 'org_id,budget_version_id,fiscal_year',
        });
        if (error) throw error;
      }
    } catch (recordErr) {
      console.error('[adapter-dispatch] failed to record budget push failure:', recordErr);
      await reportBudgetMirrorWriteFailure(orgId, versionId);
    }
    await surfaceActionRequired(serviceClient as never, orgId, superseded ? 'budget-enforcement-absent' : 'budget-push-failed', {
      versionId,
      reason: superseded ? pushError : (failure.code ?? failure.message),
    });
  }
