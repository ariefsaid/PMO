import { useQuery } from '@tanstack/react-query';
import { listProjects, type ProjectWithRefs } from '@/src/lib/db/projects';
import { listClientCompanies, type CompanyRow } from '@/src/lib/db/companies';
import { listProjectManagers, type ProfileRow } from '@/src/lib/db/profiles';
import { useAuth } from '@/src/auth/useAuth';

/** Org-scoped project list. queryKey includes org_id so cache is tenant-scoped (FR-QRY-002). */
export function useProjects() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs[]>({
    queryKey: ['projects', orgId],
    queryFn: () => listProjects(),
    enabled: Boolean(orgId),
  });
}

export function useClientCompanies() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', 'client', orgId],
    queryFn: () => listClientCompanies(),
    enabled: Boolean(orgId),
  });
}

export function useProjectManagers() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProfileRow[]>({
    queryKey: ['profiles', 'pm', orgId],
    queryFn: () => listProjectManagers(),
    enabled: Boolean(orgId),
  });
}
