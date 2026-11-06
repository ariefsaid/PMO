import { ProjectMatchReview } from '@/src/components/integrations/ProjectMatchReview';
import { useAuth } from '@/src/auth/useAuth';
import { useOdooConnection } from '@/src/hooks/useOdoo';
import { ProjectOdooLink } from './ProjectOdooLink';

/** Project detail uses the shared explicit-review surface, never an ERP-project create action. An org connected to Odoo links to a cost account instead. */
export function ProjectErpLink({ projectId, managerId = null }: { projectId: string; managerId?: string | null }) {
  const { currentUser } = useAuth();
  const odoo = useOdooConnection().data;
  if (odoo?.status === 'active') return <ProjectOdooLink projectId={projectId} managerId={managerId} />;
  return <ProjectMatchReview projectId={projectId} orgId={currentUser?.org_id} />;
}
