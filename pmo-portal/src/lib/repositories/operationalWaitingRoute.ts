import { getOperationalWaitingRoute, type OperationalWaitingKind, type OperationalWaitingRoute } from '@/src/lib/db/operationalWaitingRoute';
import { wrap } from './repositoryErrors';

/**
 * Standalone typed repository for the operational waiting route (ADR-0017 seam). It is deliberately not folded into
 * the shared `repositories` barrel: the route answer is caller-scoped and only the three record screens consume it.
 */
export interface OperationalWaitingRouteRepository {
  get(kind: OperationalWaitingKind, recordId: string): Promise<OperationalWaitingRoute>;
}

export const operationalWaitingRouteRepository: OperationalWaitingRouteRepository = {
  get: (kind, recordId) => wrap(() => getOperationalWaitingRoute(kind, recordId)),
};
