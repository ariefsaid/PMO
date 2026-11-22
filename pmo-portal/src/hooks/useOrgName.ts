import { supabase } from '@/src/lib/supabase/client';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Read the active organization's business name for printable documents and exports (#2687, #2688). */
export function useOrgName(): string | undefined {
  const query = useOrgQuery(['org-name'], async () => {
    const { data, error } = await supabase.from('organizations').select('name').limit(1);
    if (error) return undefined;
    return data?.[0]?.name;
  }, { staleness: 'session' });
  return query.data;
}
