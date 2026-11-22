import { useMutation, useQueryClient } from '@tanstack/react-query';
import { builtInRolesRepository } from '@/src/lib/repositories/builtInRoles';

/** Give a person a built-in role key, or clear it with null; refreshes the Users directory and the people pickers. */
export function useBuiltInRoleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string | null }) => builtInRolesRepository.assign(id, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['org-profiles'] });
      qc.invalidateQueries({ queryKey: ['profiles', 'pm'] });
    },
  });
}
