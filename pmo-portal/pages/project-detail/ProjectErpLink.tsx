import { useQuery } from '@tanstack/react-query';
import { ProjectMatchReview } from '@/src/components/integrations/ProjectMatchReview';
import { useAuth } from '@/src/auth/useAuth';
import { integrationsRepository } from '@/src/lib/repositories/integrations';
import { odooOwnsProjectsTier } from '@/src/lib/adapterSeam/odoo/ownership';
import { ProjectOdooLink } from './ProjectOdooLink';

/**
 * Project detail uses the shared explicit-review surface, never an ERP-project create action. An org connected to Odoo links to a cost
 * account instead. One org-scoped read of the ERP connections (shared with the integrations screen) decides which, and hands the
 * ERPNext one to the review so the page reads it once. No interval: connecting an ERP invalidates this key.
 */
export function ProjectErpLink({ projectId, managerId = null }: { projectId: string; managerId?: string | null }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const bindings = useQuery({
    queryKey: ['integrations', 'bindings', orgId],
    queryFn: () => integrationsRepository.listBindings(orgId!),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!orgId) return null;
  if (bindings.isPending) return null;
  const list = bindings.data ?? [];
  if (list.some((b) => odooOwnsProjectsTier(b.external_tier) && b.status === 'active')) return <ProjectOdooLink projectId={projectId} managerId={managerId} />;
  return <ProjectMatchReview projectId={projectId} orgId={orgId} binding={bindings.isError ? undefined : list.find((b) => !odooOwnsProjectsTier(b.external_tier)) ?? null} />;
}
