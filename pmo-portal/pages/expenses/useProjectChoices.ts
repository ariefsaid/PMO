import { useMemo } from 'react';
import { useProjects } from '@/src/hooks/useProjects';
import { projectDisplayName } from '@/src/lib/projectDisplayName';

/** Project choices for expense forms. `isPending`/`isError` let a form tell "no projects" from "not loaded". */
export function useProjectChoices() {
  const { data, isPending, isError, refetch } = useProjects();
  const options = useMemo(() => (data ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [data]);
  return { options, isPending: Boolean(isPending), isError: Boolean(isError), refetch: () => void refetch() };
}
export type ProjectLoad = Pick<ReturnType<typeof useProjectChoices>, 'isPending' | 'isError' | 'refetch'>;
