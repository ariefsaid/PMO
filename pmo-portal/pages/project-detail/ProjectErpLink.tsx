import { ProjectMatchReview } from '@/src/components/integrations/ProjectMatchReview';
import { useAuth } from '@/src/auth/useAuth';

/** Project detail uses the shared explicit-review surface, never an ERP-project create action. */
export function ProjectErpLink({ projectId }: { projectId: string }) {
  const { currentUser } = useAuth();
  return <ProjectMatchReview projectId={projectId} orgId={currentUser?.org_id} />;
}
