// The live helpers every sweep pass shares (THEME-BACK-40, #1643): the loaded binding shape, the 0534 entitlement
// check, the per-org ERP client and full-document read, the outbox candidate listings, and the queue-fairness stamp.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';
import { erpnextRequest, type ErpClientDeps } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/client.ts';
import { guardedErpFetch } from '../_shared/erpHostGuard.ts';
import { resolveErpAuthPair, type ErpAuthPairCache } from '../_shared/erpAuthPair.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { outboxRowOf } from './outboxRows.ts';

/** Lists outbox reconcile candidates for an org via the SECURITY DEFINER RPC (mig 0095). The
 *  candidate rows are the `OutboxRow` camelCase shape `dispatchMoneyWrite` consumes. */
export type ListOutboxCandidates = (orgId: string) => Promise<OutboxRow[]>;

/**
 * domain → the plan switch that entitles it (0534). A domain with no switch (`budget`, core
 * `expenses`) is never held here. `companies` is the CRM master feed.
 */
export const DOMAIN_FEATURE_KEY: Record<string, string> = {
  procurement: 'procurement',
  revenue: 'revenue',
  companies: 'crm',
};

/** True when 0534's entitlement read says this org's module is switched off. A read that FAILED for this
 *  org holds every gated key (fail-closed): "we could not read the switch" is never evidence it is on.
 *  Terminal recovery is unaffected — a candidate ERP already accepted still finalizes (see the pass). */
export function featureDisabled(
  org: { disabledFeatureKeys?: readonly string[]; featuresUnreadable?: boolean },
  key: string,
): boolean {
  return org.featuresUnreadable === true || (org.disabledFeatureKeys ?? []).includes(key);
}

/** A loaded per-org ERPNext binding (the external_org_bindings row, PMO-shaped). */
export interface OrgBinding {
  orgId: string;
  /** Present on live bindings; optional only for backward-compatible legacy test fixtures. */
  bindingId?: string | null;
  siteUrl: string;
  secretRef: string;
  company: string;
  config: Record<string, unknown>;
  /** Luna BLOCK 9: the PMO domains this org actually assigned to the ERPNext tier
   *  (`external_domain_ownership`) — the sweep polls only these. */
  ownedDomains: string[];
  // task FIX-6 (Quality MINOR 4): the handshake-stamped ERPNext major version lives on the
  // `external_org_bindings.version_major` COLUMN (§4.1), never inside `config` (which has no
  // `version` key — `report_filter_shape`/`aging_report_names`/the account defaults live there).
  versionMajor: number | null;
  /** AC-TSP-022: the moment this org's ERPNext binding was activated. The timesheet backstop's
   *  `absent` queue is scoped to it — hours approved BEFORE the integration existed are never
   *  retroactively posted to the client's ledger by a background sweep. OPTIONAL so the existing
   *  per-pass tests keep their fixtures byte-for-byte; absent/null ⇒ the `absent` queue yields NOTHING,
   *  which is the fail-safe answer (never a retroactive push). `listEmployingOrgsLive` always sets it. */
  activatedAt?: string | null;
  /** Holder fence for statement-source writes in this sweep tick. */
  statementLockHolder?: string;
  statementReplayNeeded?: boolean;
  /** 0534: the plan-switch keys that resolve OFF for this org (service_resolved_org_features).
   *  OPTIONAL so existing per-pass/cycle fixtures stay byte-for-byte; absent ⇒ nothing is held. */
  disabledFeatureKeys?: string[];
  /** 0534: this org's entitlement read FAILED this tick. Set only for the org whose read failed, and it
   *  holds every gated key for it (fail-closed) while terminal recovery still runs. OPTIONAL so existing
   *  fixtures stay byte-for-byte; absent ⇒ the read succeeded (or was never attempted). */
  featuresUnreadable?: boolean;
  /** 0358: when this org's full (hourly) sweep last completed under its lock; null = never / unknown. */
  lastFullSweepAt?: string | null;
  /** 0642: when this org's native statement pass last PUBLISHED (its own marker, independent of the
   *  full run); null = never / unknown. Optional so existing cycle fixtures stay byte-for-byte. */
  lastStatementPassAt?: string | null;
}

/** Re-read ONE ERP doc in full (Luna BLOCK 6) — the list endpoint omits child tables, and a Receive
 *  Payment Entry's `references` child rows carry the Sales Invoice link the money read-model needs. */
export async function fetchErpDoc(client: ErpClientDeps, doctype: string, name: string): Promise<Record<string, unknown>> {
  const body = await erpnextRequest(client, {
    method: 'GET',
    path: `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
  });
  return ((body as { data?: Record<string, unknown> } | null)?.data ?? {}) as Record<string, unknown>;
}

// #651 / ADR-0072: ONE resolver for both directions — `_shared/erpAuthPair.ts`. The inline Vault-first
// block that used to live here (and its env-fallback-on-vault-error) is gone: a store that cannot answer
// now refuses (FR-ENA-018). `cache` is optional so the per-pass unit tests keep their two-arg call.
export async function erpClientForBinding(
  serviceClient: SupabaseClient,
  org: OrgBinding,
  cache?: ErpAuthPairCache,
): Promise<ErpClientDeps> {
  const { apiKey, apiSecret } = await resolveErpAuthPair(serviceClient, org, cache);
  return { fetchImpl: guardedErpFetch(org.siteUrl), apiKey, apiSecret, baseUrl: org.siteUrl };
}

/** The outbox-recovery listCandidates RPC wrapper (camelCase → OutboxRow). */
/** 0357: the org's `failed` outbox rows still waiting out their retry delay (not due, not exhausted). */
export async function listRetryPendingLive(serviceClient: SupabaseClient, orgId: string): Promise<ReadonlySet<string>> {
  const { data, error } = await serviceClient.rpc('outbox_retry_pending', { p_org_id: orgId });
  if (error) throw new AppError(error.message, error.code);
  return new Set(((data as unknown[] | null) ?? []).map(String));
}

export function listCandidatesLive(serviceClient: SupabaseClient): ListOutboxCandidates {
  return async (orgId: string) => {
    const { data, error } = await serviceClient.rpc('outbox_reconcile_candidates', { p_org_id: orgId });
    if (error) throw new AppError(error.message, error.code);
    const rows = (data as Array<Record<string, unknown>> | null) ?? [];
    return rows.map(outboxRowOf);
  };
}

/** THEME-BACK-06 (0427): stamp the rows a queue pass just selected, so the next tick serves the rows it
 *  did NOT select first. Written for rows that are skipped, waiting or failing too — that is the point. */
export async function stampQueueAttempt(serviceClient: SupabaseClient, table: string, orgId: string, column: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await serviceClient.from(table)
    .update({ last_attempt_at: new Date().toISOString() }).eq('org_id', orgId).in(column, ids);
  if (error) throw new AppError(error.message, error.code);
}

/** The queues' fair order, as a comparator over the rows' own keys: never attempted first, then the
 *  longest-waiting, then the oldest, then id (the same total order the SQL `order by` uses). */
export function byQueueFairness(a: { last_attempt_at?: string | null; created_at?: string | null; id?: string | null }, b: { last_attempt_at?: string | null; created_at?: string | null; id?: string | null }): number {
  return (a.last_attempt_at ?? '').localeCompare(b.last_attempt_at ?? '')
    || (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || (a.id ?? '').localeCompare(b.id ?? '');
}
