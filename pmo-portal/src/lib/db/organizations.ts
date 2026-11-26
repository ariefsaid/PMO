import { AppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';

/** Resolve the target of a settings write using the caller's organization read policy. */
export async function getVisibleOrganizationId(refusal?: string): Promise<string> {
  const { data, error } = await supabase.from('organizations').select('id').limit(2);
  if (error) throw new AppError(error.message, error.code);
  if (!data?.length && refusal) throw new AppError(refusal, '42501');
  if (data?.length !== 1) throw new AppError('No single organisation is readable for the current user', 'no-org');
  return data[0].id;
}
