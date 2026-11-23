import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useOrgId } from '@/src/hooks/useOrgId';
import { operationalWaitingRouteRepository } from '@/src/lib/repositories/operationalWaitingRoute';
import type { OperationalWaitingKind, OperationalWaitingRoute } from '@/src/lib/db/operationalWaitingRoute';
import { waitingForText } from '@/src/lib/approvals/waitingFor';

/**
 * Who a single record is assigned to while it is in one of the three operational waiting states.
 *
 * The database names the assigned people (the labels come from organisation-visible profiles), so the cache key
 * carries the org AND the real signed-in user: a light account's own read is empty and must not be served from a full
 * account's cache. The read is enabled only when the screen itself says the record is waiting; `retry: false` because a
 * refusal is a fact — the screen offers its own retry instead of silently hammering the database.
 */
export function useOperationalWaitingRoute(
  kind: OperationalWaitingKind,
  recordId: string | undefined,
  enabled: boolean,
) {
  const orgId = useOrgId();
  const userId = useAuth().currentUser?.id;
  return useQuery({
    queryKey: ['operational-waiting-route', orgId, userId, kind, recordId],
    queryFn: () => operationalWaitingRouteRepository.get(kind, recordId!),
    enabled: Boolean(enabled && orgId && userId && recordId),
    retry: false,
  });
}

export interface OperationalWaitingTextOptions {
  /** Translates an enum role value through the app's role labels. Omit where the acting capacity, not the job role, matters. */
  roleLabel?: (role: string) => string;
  /** What to say when the database names nobody: the plain waiting sentence, or nothing at all. */
  empty?: 'plain' | 'none';
}

/**
 * Words the route through the shared canonical sentence (`waitingForText`). Names and roles are the facts the database
 * returned; nothing here invents a person or a role list. With roles supplied, the actual roles of the actual people
 * are used — never a static "all four roles" label.
 */
export function operationalWaitingForText(
  route: OperationalWaitingRoute | undefined,
  t: TFunction,
  options: OperationalWaitingTextOptions = {},
): string | null {
  if (!route) return null;
  const names = [...new Set(route.approvers.map((person) => person.name.trim()).filter(Boolean))];
  if (names.length === 0) {
    return options.empty === 'none' ? null : waitingForText({ names: [] }, t);
  }
  if (!options.roleLabel) return waitingForText({ names }, t);
  const roles = [...new Set(route.approvers.map((person) => person.role).filter(Boolean))];
  const labels = [...new Set(roles.map((role) => options.roleLabel!(role)).filter(Boolean))];
  if (labels.length === 1) return waitingForText({ names, role: labels[0] }, t);
  if (labels.length > 1) return waitingForText({ names, role: labels[0], alternativeRoles: labels.slice(1) }, t);
  return waitingForText({ names }, t);
}
