import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';

export interface PurchaseOrderSettings {
  enabled: boolean;
  signatureBlocks: string[];
  authorisedCollectors: string[];
}

export const DEFAULT_PO_SIGNATURE_BLOCKS = ['Prepared by', 'Approved by', 'Vendor acceptance'];

const fail = (error: { message: string; code?: string }): never => {
  throw new AppError(error.message, error.code);
};

/**
 * Reads purchase order print settings for the current caller's organization (#2688).
 * Scoped by RLS; org_id is never sent.
 */
export async function getPurchaseOrderSettings(): Promise<PurchaseOrderSettings> {
  const { data, error } = await supabase
    .from('purchase_order_settings')
    .select('print_enabled, signature_blocks, authorised_collectors')
    .limit(1);

  if (error) fail(error);

  const row = data?.[0];
  return {
    enabled: Boolean(row?.print_enabled),
    signatureBlocks: row?.signature_blocks?.length
      ? row.signature_blocks
      : DEFAULT_PO_SIGNATURE_BLOCKS,
    authorisedCollectors: row?.authorised_collectors ?? [],
  };
}

/**
 * Saves purchase order print settings via security-definer RPC po_set_print_settings (#2688).
 * Admin role enforced in the database.
 */
export async function setPurchaseOrderSettings(
  enabled: boolean,
  signatureBlocks: string[],
  authorisedCollectors: string[],
): Promise<void> {
  const { error } = await supabase.rpc('po_set_print_settings', {
    p_enabled: enabled,
    p_signature_blocks: signatureBlocks,
    p_authorised_collectors: authorisedCollectors,
  });

  if (error) fail(error);
}
