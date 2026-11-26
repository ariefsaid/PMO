import { organizationRepository } from '@/src/lib/repositories/organizations';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Read the active organization's business name for printable documents and exports (#2687, #2688). */
export function useOrgName(): string | undefined {
  return useOrgQuery(['org-name'], organizationRepository.getName, { staleness: 'session' }).data ?? undefined;
}
