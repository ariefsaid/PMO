import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/src/lib/supabase/client';
import { useOrgId } from '@/src/hooks/useOrgId';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/** Read the active organization's business name for printable documents and exports (#2687, #2688). */
export function useOrgName(): string | undefined {
  const orgId = useOrgId();
  const query = useQuery({
    queryKey: ['org-name', orgId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.from('organizations').select('name').limit(1);
      if (error) return undefined;
      return data?.[0]?.name;
    },
    enabled: Boolean(orgId),
    ...SESSION_QUERY_OPTIONS,
  });
  return query.data;
}
