import { supabase } from '@/src/lib/supabase/client';
import { fetchAllRowsByKeyset } from '@/src/lib/pagedRead';
import type { DashboardAcceptance, DashboardItem, DashboardLine } from '@/src/lib/workOrderDashboard';

/**
 * Org-wide reads behind the work-order dashboard's progress and discipline (#2805). Each is ONE keyset-paged read of the
 * table the project page already reads, without the project filter: the request count follows the row count in
 * thousands, never the number of work orders or projects. RLS scopes every row; org_id is never sent.
 */
export function listAllWorkOrderLines(): Promise<DashboardLine[]> {
  return fetchAllRowsByKeyset((afterId, limit) => {
    const q = supabase.from('work_order_lines').select('id, work_order_id, boq_item_id, quantity').order('id', { ascending: true });
    return (afterId !== null ? q.gt('id', afterId) : q).limit(limit);
  });
}

/** Only the contract lines some work order is allocated to: the rate weights progress, the discipline filters. */
export async function listAllocatedBoqItems(): Promise<DashboardItem[]> {
  const rows = await fetchAllRowsByKeyset((afterId, limit) => {
    const q = supabase.from('boq_items')
      .select('id, rate, item_code, unit, earning_basis, description, discipline_id, work_order_lines!inner(id)')
      .order('id', { ascending: true });
    return (afterId !== null ? q.gt('id', afterId) : q).limit(limit);
  });
  return rows.map(({ work_order_lines: _lines, ...item }) => item);
}

/** Confirmed acceptances only: a Draft or Withdrawn one never counts toward progress (`deriveScopeProgress`). */
export function listAllConfirmedAcceptances(): Promise<DashboardAcceptance[]> {
  return fetchAllRowsByKeyset((afterId, limit) => {
    const q = supabase.from('work_order_acceptances')
      .select('id, work_order_id, status, lines:work_order_acceptance_lines(boq_item_id, quantity)')
      .eq('status', 'Confirmed')
      .order('id', { ascending: true });
    return (afterId !== null ? q.gt('id', afterId) : q).limit(limit);
  });
}
