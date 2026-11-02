// The review row of an unclear ERP party match (AC-ECA-005 / AC-ECA-006, FR-ECA-016): the setup screen lists it beside the
// ones the matcher found, so a person decides it once. Written next to the admin notification, never instead of it, and a
// failure here is logged by code only: the party is skipped and the admin told either way.
import type { SupabaseClient } from '@supabase/supabase-js';
import { reviewReasonText } from '../../../pmo-portal/src/lib/adapterSeam/connect/match.ts';

export async function recordPartyReview(
  client: SupabaseClient, orgId: string,
  entry: { pmoIds: string[]; externalId: string; reason: 'ambiguous' | 'tax-conflict' },
): Promise<void> {
  try {
    const { error } = await client.rpc('record_connect_review', {
      p_org_id: orgId, p_tier: 'erpnext', p_kind: 'party', p_pmo_ids: entry.pmoIds, p_external_ids: [entry.externalId],
      p_reason: entry.reason, p_reason_text: reviewReasonText('party', { reason: entry.reason, pmoIds: entry.pmoIds, externalIds: [entry.externalId] }),
    });
    if (error) console.error('record_connect_review failed', error.code ?? 'unknown');
  } catch {
    console.error('record_connect_review failed');
  }
}
