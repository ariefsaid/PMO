import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { useIsOperator } from '@/src/auth/useIsOperator';

/**
 * Administration › Usage query (ops-admin-surface S5, FR-USE-002/003/004). Operator path uses
 * `getOperatorUsageSummary` (optionally scoped to `orgId` via the Operator org-switcher, S6);
 * org-Admin path uses `getOrgUsageSummary` (own org only, RLS-equivalent server-side assertion).
 * queryKey includes org_id + isOperator + the selected org filter so the cache never bleeds
 * across an Operator's org-switcher selection.
 */
export function useUsage(operatorOrgId?: string | null) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const isOperator = useIsOperator();
  return useQuery({
    queryKey: ['usage', orgId, isOperator, operatorOrgId ?? null],
    queryFn: () =>
      isOperator ? repositories.usage.getOperatorUsageSummary(operatorOrgId) : repositories.usage.getOrgUsageSummary(),
    // Operator-only (owner 2026-07-24): assistant cost/usage is a PLATFORM surface — an org-Admin
    // must not see it at all, not even their own org's rows. Gating the FETCH (not just the
    // markup) keeps the numbers out of the network tab entirely. NOTE: this is UX only —
    // `org_usage_summary()` is still callable by any org member (see the backlog follow-up).
    enabled: Boolean(orgId) && isOperator,
  });
}

/**
 * Per-run cost/latency stats for the agent cost dashboard (agent-cost-dashboard, AC-ACD-005/006).
 * Same operator/admin branch + cache-key discipline as `useUsage` (never bleeds across an
 * Operator's org-switcher selection); sources the `*_agent_run_stats` aggregate RPCs only
 * (NFR-PRIV-001). `useUsage` still supplies the Phase-1 summary columns (cached/reasoning ride its
 * existing rows) — this hook adds only the per-run percentile rows.
 */
export function useAgentRunStats(operatorOrgId?: string | null) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const isOperator = useIsOperator();
  return useQuery({
    queryKey: ['agent-run-stats', orgId, isOperator, operatorOrgId ?? null],
    queryFn: () =>
      isOperator
        ? repositories.usage.getOperatorAgentRunStats(operatorOrgId)
        : repositories.usage.getOrgAgentRunStats(),
    // Operator-only, same reasoning as useUsage above.
    enabled: Boolean(orgId) && isOperator,
  });
}
