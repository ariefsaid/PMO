import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { ApprovalRoute } from '@/src/lib/procurement/approvalRoute';

interface RouteRpcRow {
  procurement_id: string;
  route: ApprovalRoute['route'];
  reason: ApprovalRoute['reason'];
  approvers: { id: string; full_name: string }[] | null;
  request_amount: number | string;
  line_budget: number | string | null;
  line_used: number | string | null;
}

const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/**
 * #803 FR-APR-021 — one RPC for every listed request. org_id is NEVER sent: the RPC is SECURITY INVOKER
 * and procurements RLS is the org boundary.
 */
export async function getProcurementApprovalRoutes(ids: string[]): Promise<ApprovalRoute[]> {
  if (ids.length === 0) return [];
  const { data, error } = (await supabase.rpc('get_procurement_approval_routes', { p_ids: ids })) as unknown as {
    data: RouteRpcRow[] | null;
    error: { message: string; code?: string } | null;
  };
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    procurementId: r.procurement_id,
    route: r.route,
    reason: r.reason,
    approvers: (r.approvers ?? []).map((a) => ({ id: a.id, fullName: a.full_name })),
    requestAmount: Number(r.request_amount),
    lineBudget: num(r.line_budget),
    lineUsed: num(r.line_used),
  }));
}

/**
 * Attach each Requested row's route (FR-APR-030/032), one RPC for the whole page (NFR-APR-003).
 * ponytail: a failed read leaves rows unrouted — the UI then applies the OD-PROC-1 role matrix
 * (FR-APR-035) while transition_procurement still enforces routing, so this degrades the hint, never
 * the control. Ceiling: a persistent RPC failure shows Approve to people the server will refuse.
 */
export async function attachApprovalRoutes<T extends { id: string; status: string }>(
  rows: T[],
): Promise<(T & { approvalRoute?: ApprovalRoute })[]> {
  const ids = rows.filter((r) => r.status === 'Requested').map((r) => r.id);
  if (ids.length === 0) return rows;
  let routes: ApprovalRoute[];
  try {
    routes = await getProcurementApprovalRoutes(ids);
  } catch {
    return rows;
  }
  const byId = new Map(routes.map((r) => [r.procurementId, r]));
  return rows.map((r) => {
    const route = byId.get(r.id);
    return route ? { ...r, approvalRoute: route } : r;
  });
}
