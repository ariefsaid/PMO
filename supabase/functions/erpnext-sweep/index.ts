/**
 * erpnext-sweep — Deno Edge Function entry point (task 8.6, AC-ENA-045/071, ADR-0055 §3 + ADR-0058 §Consequences).
 *
 * The reconciliation sweep — the convergence authority that catches webhook gaps (ADR-0055 §3:
 * webhooks for latency, sweep for truth) AND runs the outbox recovery pass (ADR-0058 §Consequences:
 * the SAME recovery algorithm as the retry flow, run as an explicit pass BEFORE the doctype sweep so
 * an orphaned commit / stuck committing / committed-but-unfinalized row is reconciled even if the
 * original retry never returned). Dedicated-sweep-secret-guarded (`verify_jwt = false`; the handler
 * verifies the bearer itself — it MUST equal ERPNEXT_SWEEP_SECRET, constant-time), mirroring
 * clickup-sweep's least-privilege pattern: the caller is the pg_cron job (migration 0101), not a
 * browser JWT, and the dedicated sweep secret can at worst trigger a tick — never grant DB access.
 * Registered-but-idle per the 0094 precedent: the cron helper no-ops until an operator creates the
 * Vault secrets, so the job fires as a no-op until then (no employing org ⇒ no-op).
 *
 * Per employing org, ONE cycle runs FOUR passes in order:
 *   (1) reconcileOrgOutbox — the ADR-0058 §4 outbox recovery pass (delegates to the REAL
 *       dispatchMoneyWrite per candidate — one algorithm, shared with the retry path);
 *   (2) the modified-poll doctype sweep (runSweep per doctype, the convergence authority — AC-ENA-071);
 *   (3) the ledger-mirror feed (feedLedgerMirrors, 8.6b — populates erp_gl_entry_mirror/
 *       erp_payment_ledger_mirror);
 *   (4) refreshActuals + refreshAging (slice 7 — read the freshly-fed mirror).
 * An org's failure is recorded WITHOUT blocking the others (sweep resilience: one client's bench
 * hiccup must not kill every org's refresh). Interactive priority over bulk (NFR-ENA-PERF-001).
 *
 * Thin wiring ONLY — the sweepCursor list+dedupe, applyFeed lineage, ledgerMirrorFeed, and
 * dispatchMoneyWrite reconcile are unit-proven elsewhere. `reconcileOrgOutbox` + `runErpSweepCycle`
 * are the testable core (outboxRecovery.test.ts); this Deno.serve wrapper is INTEGRATION-ONLY —
 * verified by `deno check` + the boot-smoke.
 */

// Deno-native imports (not in pmo-portal/package.json)
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { runSweep } from '../../../pmo-portal/src/lib/adapterSeam/applyEngine.ts';
import { listErpChangesSinceWatermark } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/sweepCursor.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { createErpFeedDeps, ERPNEXT_TIER } from '../_shared/erpnextFeedDeps.ts';
import { DOCTYPE_REGISTRY, type ErpDocKind } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';
import { DOCTYPE_BODIES } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeBodies.ts';
import { KIND_DOMAIN, KIND_MIRROR_TABLE } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedKinds.ts';
import { feedLedgerMirrors } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/ledgerMirrorFeed.ts';
import { refreshAccountingSnapshots, type OrgAccountingScope } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/accountingFanout.ts';
import { dispatchMoneyWrite, type DispatchMoneyWriteDeps, type ExternalRefMapping, type OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import type { AdapterCommand, PmoRecord } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { resolveErpCredentials } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';
import type { ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { resolveErpDispatchAdapter } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts';
import { canonicalCommandDigest, createDbMoneyOutboxDeps } from '../adapter-dispatch/moneyOutboxDeps.ts';
import { getReadModelWriter } from '../adapter-dispatch/readModelWriters.ts';
import { recordExternalRef as recordExternalRefWrite } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { probeErpByAnchorKey, probeErpByPaymentComposite } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/recoveryProbe.ts';
import { ERPNEXT_COMPANIES_DOMAIN } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The list of doctypes the sweep polls, per domain. Built from DOCTYPE_REGISTRY (one source). */
const SWEEP_DOCTYPES: Array<{ kind: ErpDocKind; doctype: string }> = (Object.entries(DOCTYPE_REGISTRY) as Array<
  [ErpDocKind, { doctype: string }]
>).map(([kind, entry]) => ({ kind, doctype: entry.doctype }));

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (1) The outbox recovery pass — ADR-0058 §Consequences. Delegates to the REAL dispatchMoneyWrite per
//     candidate so the sweep path and the retry path share ONE reconciliation algorithm.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Lists outbox reconcile candidates for an org via the SECURITY DEFINER RPC (mig 0095). The
 *  candidate rows are the `OutboxRow` camelCase shape `dispatchMoneyWrite` consumes. */
export type ListOutboxCandidates = (orgId: string) => Promise<OutboxRow[]>;

/** Builds the DispatchMoneyWriteDeps for one candidate row (the sweep wires the real outbox deps +
 *  adapter + read-model writers per org; the test injects mocks). Async-capable so the live wiring can
 *  resolve the adapter/binding; a sync mock (`() => deps`) still satisfies it (await on a value is a value). */
export type BuildReconcileDeps = (row: OutboxRow) => DispatchMoneyWriteDeps | Promise<DispatchMoneyWriteDeps>;

export interface ReconcileOrgOutboxResult {
  /** Candidates the pass drove through dispatchMoneyWrite this run. */
  reconciled: number;
  /** Per-candidate outcomes (`ok` on a terminal reconcile; `error` when dispatchMoneyWrite threw — the
   *  sweep logs + continues so one bad row does not abort the pass). */
  errors: Array<{ id: string; error: string }>;
}

/**
 * The outbox recovery pass for ONE org (AC-ENA-045, ADR-0058 §Consequences). Lists the candidates
 * (pending/failed/committing-past-lease/committed) via `outbox_reconcile_candidates(org)` and drives
 * each through the REAL `dispatchMoneyWrite` — one algorithm, shared with the retry path. A candidate
 * whose reconcile throws is recorded + skipped (sweep resilience); the next schedule retries it.
 */
export async function reconcileOrgOutbox(
  listCandidates: ListOutboxCandidates,
  orgId: string,
  buildDeps: BuildReconcileDeps,
  dispatch: typeof dispatchMoneyWrite = dispatchMoneyWrite,
): Promise<ReconcileOrgOutboxResult> {
  const candidates = await listCandidates(orgId);
  let reconciled = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const candidate of candidates) {
    try {
      await dispatch(await buildDeps(candidate));
      reconciled += 1;
    } catch (err) {
      // A retryable reconcile (e.g. a quarantined row still in its window → "reconciling") is expected
      // mid-recovery; record + continue so one candidate does not abort the pass.
      errors.push({ id: candidate.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { reconciled, errors };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// (2)+(3)+(4) The per-org sweep cycle: doctype modified-poll → ledger feed → accounting refresh.
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** A loaded per-org ERPNext binding (the external_org_bindings row, PMO-shaped). */
interface OrgBinding {
  orgId: string;
  siteUrl: string;
  secretRef: string;
  company: string;
  config: Record<string, unknown>;
  // task FIX-6 (Quality MINOR 4): the handshake-stamped ERPNext major version lives on the
  // `external_org_bindings.version_major` COLUMN (§4.1), never inside `config` (which has no
  // `version` key — `report_filter_shape`/`aging_report_names`/the account defaults live there).
  versionMajor: number | null;
}

export interface ErpSweepCycleDeps {
  listEmployingOrgs: () => Promise<OrgBinding[]>;
  reconcileOrgOutbox: (org: OrgBinding) => Promise<ReconcileOrgOutboxResult>;
  sweepOrgDoctypes: (org: OrgBinding) => Promise<{ applied: number; error?: string }>;
  feedOrgLedgers: (org: OrgBinding) => Promise<{ gl: number; ple: number; error?: string }>;
  refreshOrgAccounting: (org: OrgBinding) => Promise<{ error?: string }>;
}

export interface ErpSweepCycleResult {
  orgs: number;
  perOrg: Array<{ orgId: string; reconcile: ReconcileOrgOutboxResult | null; sweep?: { applied: number }; ledger?: { gl: number; ple: number }; errors: string[] }>;
}

/**
 * Run ONE sweep cycle across every employing org. Per org, in order: (1) outbox recovery, (2) doctype
 * modified-poll sweep, (3) ledger-mirror feed, (4) accounting refresh. An org's failure is recorded
 * WITHOUT aborting the loop (sweep resilience). The reconcile pass runs FIRST so the doctype sweep
 * sees a consistent outbox (ADR-0058 §Consequences).
 */
export async function runErpSweepCycle(deps: ErpSweepCycleDeps): Promise<ErpSweepCycleResult> {
  const orgs = await deps.listEmployingOrgs();
  const perOrg: ErpSweepCycleResult['perOrg'] = [];
  for (const org of orgs) {
    const errors: string[] = [];
    // (1) outbox recovery FIRST.
    let reconcile: ReconcileOrgOutboxResult | null = null;
    try {
      reconcile = await deps.reconcileOrgOutbox(org);
      for (const e of reconcile.errors) errors.push(`reconcile:${e.id}:${e.error}`);
    } catch (err) {
      errors.push(`reconcile:${err instanceof Error ? err.message : String(err)}`);
    }
    // (2) doctype modified-poll sweep.
    let sweep: { applied: number } | undefined;
    try {
      const r = await deps.sweepOrgDoctypes(org);
      sweep = { applied: r.applied };
      if (r.error) errors.push(`sweep:${r.error}`);
    } catch (err) {
      errors.push(`sweep:${err instanceof Error ? err.message : String(err)}`);
    }
    // (3) ledger-mirror feed.
    let ledger: { gl: number; ple: number } | undefined;
    try {
      const r = await deps.feedOrgLedgers(org);
      ledger = { gl: r.gl, ple: r.ple };
      if (r.error) errors.push(`ledger:${r.error}`);
    } catch (err) {
      errors.push(`ledger:${err instanceof Error ? err.message : String(err)}`);
    }
    // (4) accounting refresh (reads the freshly-fed mirror).
    try {
      const r = await deps.refreshOrgAccounting(org);
      if (r.error) errors.push(`accounting:${r.error}`);
    } catch (err) {
      errors.push(`accounting:${err instanceof Error ? err.message : String(err)}`);
    }
    perOrg.push({ orgId: org.orgId, reconcile, sweep, ledger, errors });
  }
  return { orgs: orgs.length, perOrg };
}

// ────────────────────────────────────────────────────────────────────────────────────────────────
// The real wiring the Deno.serve wrapper uses (DB + env + createErpFeedDeps + the slice-7 fanout).
// ────────────────────────────────────────────────────────────────────────────────────────────────

/** Loads the employing orgs (activated erpnext bindings) + resolves each org's ERP client deps.
 *  Exported for unit testing (task FIX-5, Quality IMPORTANT 2 — the DB-error path must be observable,
 *  not silently swallowed). */
export async function listEmployingOrgsLive(serviceClient: SupabaseClient): Promise<OrgBinding[]> {
  const { data, error } = await serviceClient.from('external_org_bindings')
    .select('org_id, site_url, secret_ref, config, activated_at, version_major')
    .eq('external_tier', ERPNEXT_TIER);
  // task FIX-5: a real DB error must not be silently folded into "no employing orgs this cycle" — log
  // it so an outage is observable in the function logs. The sweep cycle still returns [] (fail-safe:
  // one bad DB round-trip skips this sweep tick rather than crashing the whole cron invocation).
  if (error) {
    console.error(`[erpnext-sweep] external_org_bindings load failed: code=${error.code ?? 'none'} message=${error.message}`);
    return [];
  }
  const rows = (data as Array<{ org_id: string; site_url: string; secret_ref: string; config: Record<string, unknown> | null; activated_at: string | null; version_major: number | null }> | null) ?? [];
  return rows.filter((r) => r.activated_at).map((r) => ({
    orgId: r.org_id,
    siteUrl: r.site_url,
    secretRef: r.secret_ref,
    company: (r.config?.company as string | undefined) ?? '',
    config: r.config ?? {},
    // task FIX-6 (Quality MINOR 4): version_major is a top-level column, not a `config` key.
    versionMajor: r.version_major ?? null,
  }));
}

async function erpClientForOrg(serviceClient: SupabaseClient, org: OrgBinding): Promise<ErpClientDeps> {
  const connectEnabled = Deno.env.get('EXTERNAL_CONNECT_ENABLED') === 'true';
  let apiKey: string;
  let apiSecret: string;

  if (connectEnabled) {
    // Use shared per-org Vault secret resolution (flag gate + binding lookup + tri-state)
    const result = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: org.orgId,
      tier: 'erpnext',
      lookupBinding: async (orgId, tier) => {
        const { data, error } = await serviceClient
          .from('external_org_bindings')
          .select('secret_ref')
          .eq('org_id', orgId)
          .eq('external_tier', tier)
          .maybeSingle();
        if (error) return null;
        return data as { secret_ref?: string | null } | null;
      },
      readVaultSecret: async (ref) => {
        const { data, error } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        if (error) {
          console.error('read_vault_secret failed', error);
          return null;
        }
        return (data as string | null) ?? null;
      },
    });

    if (result.kind === 'resolved') {
      // Vault stores apiKey:apiSecret format
      const idx = result.secret.indexOf(':');
      if (idx > 0 && idx < result.secret.length - 1) {
        apiKey = result.secret.slice(0, idx);
        apiSecret = result.secret.slice(idx + 1);
      } else {
        throw new AppError('ERPNext credential format invalid (expected apiKey:apiSecret)', 'config-rejected');
      }
    } else {
      // kind === 'no-binding' OR 'binding-vault-miss' → fall back to env resolver
      const creds = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
      apiKey = creds.apiKey;
      apiSecret = creds.apiSecret;
    }
  } else {
    const creds = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
    apiKey = creds.apiKey;
    apiSecret = creds.apiSecret;
  }

  return { fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl };
}

/** The outbox-recovery listCandidates RPC wrapper (camelCase → OutboxRow). */
function listCandidatesLive(serviceClient: SupabaseClient): ListOutboxCandidates {
  return async (orgId: string) => {
    const { data, error } = await serviceClient.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError(error.message, error.code);
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map((r) => ({
      id: String(r.id),
      domain: String(r.domain),
      pmoRecordId: String(r.pmo_record_id),
      idempotencyKey: String(r.idempotency_key),
      state: r.state as OutboxRow['state'],
      externalRecordId: (r.external_record_id as string | null) ?? null,
      canonical: (r.canonical as OutboxRow['canonical']) ?? null,
      claimGeneration: (r.claim_generation as number | undefined) ?? 0,
      payloadDigest: (r.payload_digest as string | null | undefined) ?? null,
    }));
  };
}

/** The per-org sweep: runSweep per doctype with the lineage-aware apply injected, per-doctype watermark. */
async function sweepOrgDoctypesLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ applied: number; error?: string }> {
  const client = await erpClientForOrg(serviceClient, org);
  let applied = 0;
  for (const { kind, doctype } of SWEEP_DOCTYPES) {
    const domain = KIND_DOMAIN[kind];
    const bodyFns = DOCTYPE_BODIES[kind];
    if (!bodyFns) continue; // not yet wired — skip (inert until the slice that wires it lands)
    const feedDeps = createErpFeedDeps(serviceClient as unknown as SupabaseClient, org.orgId, kind);
    // Per-doctype watermark (FR-ENA-080: org × doctype) — keyed on a namespaced domain value so each
    // doctype has its own cursor row on external_sync_watermarks (the applyEngine ctx.domain stays the
    // PMO domain for external_refs; the watermark key is the sweep's own concern).
    const wmDomain = `${domain}::${doctype}`;
    const watermarkDeps = {
      readWatermark: async () => {
        const { data } = await serviceClient.from('external_sync_watermarks').select('watermark_cursor')
          .eq('org_id', org.orgId).eq('external_tier', ERPNEXT_TIER).eq('domain', wmDomain).maybeSingle();
        return (data as { watermark_cursor?: string | null } | null)?.watermark_cursor ?? null;
      },
      advanceWatermark: async (cursor: string) => {
        const { error } = await serviceClient.from('external_sync_watermarks').upsert(
          { org_id: org.orgId, external_tier: ERPNEXT_TIER, domain: wmDomain, watermark_cursor: cursor },
          { onConflict: 'org_id,external_tier,domain' },
        );
        if (error) throw new AppError(error.message, error.code);
      },
    };
    try {
      const result = await runSweep(
        { tier: ERPNEXT_TIER, domain },
        {
          ...feedDeps,
          ...watermarkDeps,
          applyChange: (ctx, externalRecordId, canonical, sourceModMs, d) =>
            applyErpFeedEvent(ctx, externalRecordId, canonical, sourceModMs, d as Parameters<typeof applyErpFeedEvent>[4]),
          listChanges: (cursor) => listErpChangesSinceWatermark(
            { client, doctype, fields: ['name', 'modified', 'docstatus', 'amended_from'], fromDoc: bodyFns.fromDoc },
            cursor,
          ),
        },
      );
      applied += result.applied;
    } catch (err) {
      // An unreachable adapter (or one doctype's failure) is recorded but does NOT abort the other
      // doctypes/orgs (AC-CUA-044 sibling: the next schedule retries).
      return { applied, error: `${doctype}:${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return { applied };
}

/** The ledger-mirror feed for one org (8.6b). */
async function feedOrgLedgersLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ gl: number; ple: number; error?: string }> {
  try {
    const client = await erpClientForOrg(serviceClient, org);
    const r = await feedLedgerMirrors(serviceClient as unknown as Parameters<typeof feedLedgerMirrors>[0], {
      client, orgId: org.orgId, company: org.company,
    });
    return { gl: r.glFed, ple: r.pleFed };
  } catch (err) {
    return { gl: 0, ple: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The aging-snapshot provenance version string for an org (task FIX-6, Quality MINOR 4). Sourced
 * from `org.versionMajor` (the `external_org_bindings.version_major` COLUMN, handshake-stamped) —
 * `org.config.version` was never a real key (§4.1's `config` shape has no `version`: it carries
 * `report_filter_shape`/`aging_report_names`/the account defaults), so every aging snapshot's
 * `report_version` provenance was silently the empty string. Exported for direct unit testing.
 */
export function reportVersionFromOrg(org: Pick<OrgBinding, 'versionMajor'>): string {
  return org.versionMajor != null ? String(org.versionMajor) : '';
}

/** The accounting refresh for one org (slice 7 fanout — actuals + AP/AR aging from the mirror).
 *  Exported for unit testing (task FIX-6, Quality MINOR 4). */
export async function refreshOrgAccountingLive(serviceClient: SupabaseClient, org: OrgBinding): Promise<{ error?: string }> {
  try {
    const client = await erpClientForOrg(serviceClient, org);
    const reportVersion = reportVersionFromOrg(org);
    const scope: OrgAccountingScope = {
      orgId: org.orgId,
      client,
      actualsScope: {},
      apAgingScope: { reportName: 'Accounts Payable', snapshotTable: 'erp_ap_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
      arAgingScope: { reportName: 'Accounts Receivable', snapshotTable: 'erp_ar_aging_snapshot', filters: org.config.report_filter_shape as Record<string, unknown> ?? {}, reportVersion },
    };
    const results = await refreshAccountingSnapshots(serviceClient as unknown as Parameters<typeof refreshAccountingSnapshots>[0], [scope]);
    const err = results.find((r) => r.error)?.error;
    return err ? { error: err } : {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── 1. Authorization: the caller (the pg_cron job) must present the DEDICATED sweep secret (NOT the
  //    master service_role key — least-privilege, mirroring clickup-sweep). The cron presents this same
  //    secret from the Vault `erpnext_sweep_secret`; the master key never crosses into the DB. ──
  const sweepSecret = Deno.env.get('ERPNEXT_SWEEP_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!sweepSecret || !(await constantTimeBearerEquals(authHeader, `Bearer ${sweepSecret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'MISCONFIGURED', message: 'missing Supabase configuration' }, 500);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey) as unknown as SupabaseClient;

  const listCandidates = listCandidatesLive(serviceClient);
  const cycle = await runErpSweepCycle({
    listEmployingOrgs: () => listEmployingOrgsLive(serviceClient),
    reconcileOrgOutbox: (org) => reconcileOrgOutbox(listCandidates, org.orgId, (row) => buildReconcileDepsLive(serviceClient, org, row)),
    sweepOrgDoctypes: (org) => sweepOrgDoctypesLive(serviceClient, org),
    feedOrgLedgers: (org) => feedOrgLedgersLive(serviceClient, org),
    refreshOrgAccounting: (org) => refreshOrgAccountingLive(serviceClient, org),
  });
  return json({ ok: true, ...cycle });
});

/**
 * The full per-candidate `DispatchMoneyWriteDeps` wiring (SPEC-REVIEW RULING — the `not-implemented`
 * sentinel is retired: the C-1 'held' state makes sweep-side reconciliation the operational PE-recovery
 * path). Reassembles the SAME building blocks adapter-dispatch uses per request — `createDbMoneyOutboxDeps`
 * (the fenced outbox ops + the composite/anchor probe + the reissue policy), `resolveErpDispatchAdapter`
 * (the per-org ERP adapter), and the read-model writers — reconstructing the command from the outbox row
 * + its persisted `payload.erp_doc_kind`. Inert in practice until an org is flipped AND a money command
 * leaves a candidate (no employing org ⇒ no candidate ⇒ this never fires — "inert-by-empty-map").
 */
async function buildReconcileDepsLive(serviceClient: SupabaseClient, org: OrgBinding, row: OutboxRow): Promise<DispatchMoneyWriteDeps> {
  // Re-read the persisted operation + payload (the OutboxRow projection drops them) to reconstruct the command.
  const { data, error } = await serviceClient.from('external_command_outbox')
    .select('operation, payload').eq('id', row.id).maybeSingle();
  if (error || !data) throw new AppError(`outbox row ${row.id} not readable for reconcile`, error?.code ?? 'not-found');
  const rowExtra = data as { operation: 'create' | 'update' | 'transition'; payload: Record<string, unknown> | null };
  const payload = rowExtra.payload ?? {};
  const kind = payload.erp_doc_kind;
  const entry = typeof kind === 'string' && kind in DOCTYPE_REGISTRY ? DOCTYPE_REGISTRY[kind as ErpDocKind] : undefined;
  const bodyFns = typeof kind === 'string' ? DOCTYPE_BODIES[kind as ErpDocKind] : undefined;
  if (!entry || !bodyFns) {
    // Loud (never a silent no-op): a candidate whose kind we cannot resolve needs an operator, not a POST.
    throw new AppError(`erpnext-sweep reconcile: unresolvable erp_doc_kind '${String(kind)}' for ${row.domain}/${row.pmoRecordId}`, 'commit-rejected');
  }

  const { apiKey, apiSecret } = resolveErpCredentials(org.secretRef, (key) => Deno.env.get(key));
  const client = { fetchImpl: fetch, apiKey, apiSecret, baseUrl: org.siteUrl };
  // M-3: dispatch digests the exact payload persisted at INSERT. Reuse that full payload as the
  // digest input (and command record), rather than reconstructing only id + erp_doc_kind.
  const command: AdapterCommand = {
    domain: row.domain as AdapterCommand['domain'],
    operation: rowExtra.operation,
    record: payload as AdapterCommand['record'],
    idempotencyKey: row.idempotencyKey,
  };

  const adapter = await resolveErpDispatchAdapter({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    command,
    fetchImpl: fetch,
    apiKey,
    apiSecret,
    rateLimiter: { acquire: async () => {} },
    doctypeBodies: DOCTYPE_BODIES,
  });

  const anchorField = entry.anchorField;
  const probeDeps = { client, doctype: entry.doctype, anchorField: anchorField ?? '', fromDoc: bodyFns.fromDoc, pmoRecordId: row.pmoRecordId };
  const encodeExternalRecordId = (mapping: ExternalRefMapping): string =>
    mapping.domain === ERPNEXT_COMPANIES_DOMAIN ? `${entry.doctype}:${mapping.externalRecordId}` : mapping.externalRecordId;

  const { created_after: _createdAfter, ...digestPayload } = payload;
  const payloadDigest = await canonicalCommandDigest({ domain: command.domain, operation: command.operation, record: digestPayload });
  const money = createDbMoneyOutboxDeps({
    serviceClient: serviceClient as never,
    orgId: org.orgId,
    externalTier: ERPNEXT_TIER,
    operation: rowExtra.operation,
    reissueOnInconclusiveAbsence: !entry.anchorMutable,
    payloadDigest,
    encodeExternalRecordId,
    probeByRemarksKey: !anchorField
      ? async () => null
      : !entry.anchorMutable
        ? (_domain, idempotencyKey) => probeErpByAnchorKey(probeDeps, idempotencyKey)
        // Mutable anchor (PE): the composite probe reads its inputs from THIS row's persisted payload.
        : async (_domain, idempotencyKey) => {
            if (!payload.party || payload.paid_amount == null) return probeErpByAnchorKey(probeDeps, idempotencyKey);
            return probeErpByPaymentComposite(probeDeps, idempotencyKey, {
              partyType: String(payload.party_type ?? 'Supplier'),
              party: String(payload.party),
              paidAmount: payload.paid_amount as string | number,
              piNames: Array.isArray(payload.pi_names) ? (payload.pi_names as string[]) : [],
              createdAfter: String(payload.created_after ?? ''),
            });
          },
  });

  const writeReadModel = async (canonical: PmoRecord): Promise<void> => {
    await getReadModelWriter(row.domain).upsert({ serviceClient: serviceClient as never, orgId: org.orgId }, canonical, command);
  };
  const recordExternalRef = (mapping: ExternalRefMapping): Promise<void> =>
    recordExternalRefWrite(serviceClient as never, { ...mapping, externalRecordId: encodeExternalRecordId(mapping), orgId: org.orgId });

  return { adapter, command, writeReadModel, recordExternalRef, money };
}
