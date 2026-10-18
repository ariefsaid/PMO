import { toAppError } from '@/src/lib/appError';
import { searchRecordReferences, type ReferenceSearchPage } from '@/src/lib/db/recordReferenceSearch';

/** Repository leaf for query-specific invoice, receipt, and project reference hits. */
export async function searchRecordReferencesRepository(query: string): Promise<ReferenceSearchPage> {
  try {
    return await searchRecordReferences(query);
  } catch (error) {
    throw toAppError(error);
  }
}
