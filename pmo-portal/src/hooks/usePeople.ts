import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { PersonInput } from '@/src/lib/db/people';

/** The People register (#2542 follow-up) over the repository seam; keys carry org_id (tenant scope). */
export function usePeople() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['people', orgId, 'list'],
    queryFn: () => repositories.people.list(),
    enabled: Boolean(orgId),
  });
}

/** Create, edit and archive; each refreshes the register, the person record and the expiry views. */
export function usePeopleMutations() {
  const qc = useQueryClient();
  const repo = repositories.people;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['people'] }),
    qc.invalidateQueries({ queryKey: ['document-expiry'] }),
  ]);
  const create = useMutation({ mutationFn: (v: PersonInput) => repo.create(v), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: string; input: PersonInput & { code: string } }) => repo.update(v.id, v.input), onSuccess: refresh });
  const archive = useMutation({ mutationFn: (id: string) => repo.archive(id), onSuccess: refresh });
  return { create, update, archive };
}
