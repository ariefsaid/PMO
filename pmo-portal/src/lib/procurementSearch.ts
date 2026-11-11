import { externalRefsOf, type ProcurementWithRefs } from '@/src/lib/db/procurements';

/** Shared query match for the procurement table, board, and grouped views. */
export function matchesSearch(row: ProcurementWithRefs, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [row.title, row.code, row.vendor?.name, row.requested_by?.full_name, row.status, ...externalRefsOf(row)]
    .some((value) => value?.toLocaleLowerCase().includes(needle));
}
