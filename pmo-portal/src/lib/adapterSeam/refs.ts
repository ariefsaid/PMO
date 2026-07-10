import { AppError } from '../appError';
import type { ServiceRoleTableClient } from './watermarks';

export interface ExternalRefRecord {
  orgId: string;
  domain: string;
  pmoRecordId: string;
  externalTier: string;
  externalRecordId: string;
}

/** Dispatch-side only external_refs writer (FR-EAS-043, AC-EAS-042 support). */
export async function recordExternalRef(client: ServiceRoleTableClient, input: ExternalRefRecord): Promise<void> {
  const { error } = await client.from('external_refs').upsert(
    {
      org_id: input.orgId,
      domain: input.domain,
      pmo_record_id: input.pmoRecordId,
      external_tier: input.externalTier,
      external_record_id: input.externalRecordId,
    },
    { onConflict: 'org_id,domain,pmo_record_id' },
  );
  if (error) throw new AppError(error.message, error.code);
}
