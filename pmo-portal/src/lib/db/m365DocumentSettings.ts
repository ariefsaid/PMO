import { AppError, assertWriteLanded, toAppError } from '@/src/lib/appError';
import { supabase } from '@/src/lib/supabase/client';
import type { MicrosoftLibraryDefault } from '@/src/lib/m365/reference';

type DefaultLibraryRow = {
  default_site_id: string | null;
  default_site_name: string | null;
  default_drive_id: string | null;
  default_drive_name: string | null;
};

const DEFAULT_FIELDS = 'default_site_id,default_site_name,default_drive_id,default_drive_name';

export async function getDefaultLibrary(): Promise<MicrosoftLibraryDefault | null> {
  const { data, error } = await supabase
    .from('org_m365_document_settings')
    .select(DEFAULT_FIELDS)
    .maybeSingle();
  if (error) throw toAppError(error);
  if (!data) return null;
  const row = data as DefaultLibraryRow;
  const values = [row.default_site_id, row.default_site_name, row.default_drive_id, row.default_drive_name];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => typeof value !== 'string' || value.trim() === '')) {
    throw new AppError('The Microsoft document default could not be loaded.');
  }
  return {
    site_id: row.default_site_id!,
    site_name: row.default_site_name!,
    drive_id: row.default_drive_id!,
    drive_name: row.default_drive_name!,
  };
}

export async function setDefaultLibrary(value: MicrosoftLibraryDefault | null): Promise<void> {
  const { data, error } = await supabase
    .from('org_m365_document_settings')
    .upsert({
      default_site_id: value?.site_id ?? null,
      default_site_name: value?.site_name ?? null,
      default_drive_id: value?.drive_id ?? null,
      default_drive_name: value?.drive_name ?? null,
    }, { onConflict: 'org_id' })
    .select('org_id');
  if (error) throw toAppError(error);
  assertWriteLanded(data, 'Microsoft document settings could not be saved.');
}
