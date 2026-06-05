import { useQuery } from '@tanstack/react-query';
import {
  getExecutiveDashboard, type ExecutiveDashboard,
  getWinRate, type WinRate,
  getSalesPipeline, type SalesPipeline,
} from '@/src/lib/db/dashboard';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped executive dashboard aggregates. queryKey includes org_id so cache is tenant-scoped
 * (FR-QRY-DASH-001). Aggregates are computed in SQL (RPC) and RLS-scoped to the caller's org. */
export function useDashboard() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ExecutiveDashboard>({
    queryKey: ['dashboard', orgId],
    queryFn: () => getExecutiveDashboard(),
    enabled: Boolean(orgId),
  });
}

/**
 * Range descriptor for useWinRate. `key` is a stable string that identifies the period so
 * the TanStack queryKey changes when the period changes (ADR-0014 DD-1: independent cache key).
 */
export interface WinRateRange {
  from?: Date;
  to?: Date;
  /** Stable string key distinguishing the period ('all' | 'ytd' | 'q' | 't12'). */
  key: string;
}

/**
 * Win-rate for the caller's org over the given period range (FR-SPD-011).
 * queryKey is ['win-rate', orgId, range.key] — changing the period only invalidates this query,
 * not the heavy dashboard query (ADR-0014 DD-1).
 */
export function useWinRate(range: WinRateRange) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<WinRate>({
    queryKey: ['win-rate', orgId, range.key],
    queryFn: () => getWinRate(range.from, range.to),
    enabled: Boolean(orgId),
  });
}

/**
 * Sales pipeline stages + flat project list for the caller's org (FR-SPD-011).
 * queryKey includes org_id for cache isolation.
 */
export function useSalesPipeline() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesPipeline>({
    queryKey: ['sales-pipeline', orgId],
    queryFn: () => getSalesPipeline(),
    enabled: Boolean(orgId),
  });
}
