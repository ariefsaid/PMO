import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { ReadModelWriter } from './types.ts';

/** P0 default: the generic `external_reference_items` mirror (byte-for-byte pre-1.6 `else` branch). */
export const referenceWriter: ReadModelWriter = {
  async upsert(ctx, canonical) {
    const { error } = await ctx.serviceClient.from('external_reference_items').upsert(
      { org_id: ctx.orgId, pmo_record_id: canonical.id, payload: canonical },
      { onConflict: 'org_id,pmo_record_id' },
    );
    if (error) throw new AppError(error.message, error.code);
  },
};
