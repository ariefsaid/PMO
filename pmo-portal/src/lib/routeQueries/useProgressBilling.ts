import { repositories } from '../repositories';

export const projectClaimsQuery = (orgId: string | undefined, projectId: string) => ({
  queryKey: ['progress-claims', orgId, projectId],
  queryFn: () => repositories.progressBilling.listClaims(projectId),
  enabled: Boolean(orgId) && Boolean(projectId),
});
