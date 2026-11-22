import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

/**
 * Operational "who is it waiting on" read (fix-waiting item 3, Waiting 3). One RPC answers for the three record
 * screens whose waiting state had no per-person read: a Draft work order (issue), an Ordered purchase (record its
 * delivery/receipt) and a Sent stock transfer (receive it). The database owns every rule: it returns the waiting-list
 * ASSIGNMENT for the kind (deliberately narrower than the write gate in places — see the migration header), so this
 * layer only maps the answer.
 *
 * SECURITY INVOKER on the database side: the record and the people are read through the caller's own RLS, org_id is
 * never sent, and an unreadable or non-waiting record returns the same empty assignment (no existence leak).
 */

export const OPERATIONAL_WAITING_KINDS = ['work_order_issue', 'delivery_record', 'transfer_receipt'] as const;
export type OperationalWaitingKind = (typeof OPERATIONAL_WAITING_KINDS)[number];

export interface OperationalWaitingPerson {
  id: string;
  name: string;
  /** The person's user_role enum value ("Admin", "Finance", …); the screen translates it, never stores prose. */
  role: string;
}

export interface OperationalWaitingRoute {
  approvers: OperationalWaitingPerson[];
  /** The known kind that was asked for, or null for an unknown kind. A known kind stays present even when nobody is assigned. */
  routeKind: string | null;
}

export const EMPTY_OPERATIONAL_WAITING_ROUTE: OperationalWaitingRoute = { approvers: [], routeKind: null };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Maps the RPC's jsonb to the typed seam. Unknown or malformed entries are dropped, never invented. */
export function mapOperationalWaitingRoute(data: unknown): OperationalWaitingRoute {
  if (!isRecord(data)) return EMPTY_OPERATIONAL_WAITING_ROUTE;
  const approvers: OperationalWaitingPerson[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data.approvers)) {
    for (const entry of data.approvers) {
      if (!isRecord(entry)) continue;
      const id = text(entry.id);
      const name = text(entry.name);
      const role = text(entry.role);
      if (!id || !name || !role || seen.has(id)) continue;
      seen.add(id);
      approvers.push({ id, name, role });
    }
  }
  return { approvers, routeKind: text(data.route_kind) };
}

/**
 * The people a single record waits on, for one of the three operationally-waiting states. The hook only fetches while
 * the screen says the record is actually waiting; this function itself never checks the status (the database does).
 */
export async function getOperationalWaitingRoute(
  kind: OperationalWaitingKind,
  recordId: string,
): Promise<OperationalWaitingRoute> {
  const { data, error } = await supabase.rpc('get_operational_waiting_route', {
    p_kind: kind,
    p_record_id: recordId,
  });
  if (error) throw new AppError(error.message, error.code);
  return mapOperationalWaitingRoute(data);
}
