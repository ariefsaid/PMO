import { AppError } from '../appError';

export interface WatermarkUpsertInput {
  orgId: string;
  externalTier: string;
  domain: string;
  cursor: string;
}

export interface ServiceRoleTableClient {
  from(table: string): {
    upsert(rows: unknown, options: { onConflict: string }): Promise<{ error: { message: string; code?: string } | null }>;
  };
}

/**
 * Machine-only watermark writer (FR-EAS-052, AC-EAS-051). Takes an INJECTED service-role client; there is
 * no browser-client writer and no repository entry. The adapter-dispatch edge-function boundary is its only
 * caller in this plan.
 */
export async function upsertWatermark(client: ServiceRoleTableClient, input: WatermarkUpsertInput): Promise<void> {
  const { error } = await client.from('external_sync_watermarks').upsert(
    {
      org_id: input.orgId,
      external_tier: input.externalTier,
      domain: input.domain,
      watermark_cursor: input.cursor,
    },
    { onConflict: 'org_id,external_tier,domain' },
  );
  if (error) throw new AppError(error.message, error.code);
}
