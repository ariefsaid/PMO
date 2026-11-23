import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import type { DashboardAcceptance, DashboardItem, DashboardLine } from '@/src/lib/workOrderDashboard';

/**
 * Org-wide reads behind the work-order dashboard's progress and discipline (#2805). Each is ONE keyset-paged read of the
 * table the project page already reads, without the project filter: the request count follows the row count in
 * thousands, never the number of work orders or projects. RLS scopes every row; org_id is never sent.
 */
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>;

export function listAllWorkOrderLines(): Promise<DashboardLine[]> {
  return fetchAllRowsByKeyset<DashboardLine>((afterId, limit) => {
    let q = supabase.from('work_order_lines').select('id, work_order_id, boq_item_id, quantity').order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as Page<DashboardLine>;
  });
}

/** Only the contract lines some work order is allocated to: the rate weights progress, the discipline filters. */
export function listAllocatedBoqItems(): Promise<DashboardItem[]> {
  return fetchAllRowsByKeyset<DashboardItem>((afterId, limit) => {
    let q = supabase.from('boq_items')
      .select('id, rate, item_code, unit, earning_basis, description, discipline_id, work_order_lines!inner(id)')
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as Page<DashboardItem>;
  });
}

/** Confirmed acceptances only: a Draft or Withdrawn one never counts toward progress (`deriveScopeProgress`). */
export function listAllConfirmedAcceptances(): Promise<Array<DashboardAcceptance & { id: string }>> {
  return fetchAllRowsByKeyset<DashboardAcceptance & { id: string }>((afterId, limit) => {
    let q = supabase.from('work_order_acceptances')
      .select('id, work_order_id, status, lines:work_order_acceptance_lines(boq_item_id, quantity)')
      .eq('status', 'Confirmed')
      .order('id', { ascending: true });
    if (afterId !== null) q = q.gt('id', afterId);
    return q.limit(limit) as unknown as Page<DashboardAcceptance & { id: string }>;
  });
}
