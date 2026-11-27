import { supabase } from '@/src/lib/supabase/client';

export const organizationRepository = {
  getName: async (): Promise<string | null> => {
    const { data, error } = await supabase.from('organizations').select('name').maybeSingle();
    return error ? null : data?.name ?? null;
  },
};
