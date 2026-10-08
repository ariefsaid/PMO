import { toAppError } from '@/src/lib/appError';
import * as dal from '@/src/lib/db/vendorWithholdingSlips';
import type { VendorWithholdingSlipsRepository } from './types';

async function wrap<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { throw toAppError(error); }
}

export const vendorWithholdingSlipsRepository: VendorWithholdingSlipsRepository = {
  record: (input) => wrap(() => dal.recordSlip(input)),
  correct: (input) => wrap(() => dal.correctSlip(input)),
  void: (input) => wrap(() => dal.voidSlip(input)),
  listSlips: (params = {}) => wrap(() => dal.listSlips({
    p_vendor_id: params.vendorId, p_tax_period: params.taxPeriod, p_invoice_id: params.invoiceId,
    p_before_period: params.cursor?.period, p_before_id: params.cursor?.id, limit: params.limit,
  })),
  listBills: (params = {}) => wrap(() => dal.listBills({
    p_vendor_id: params.vendorId, p_pph_type: params.pphType, p_currency: params.currency,
    p_invoice_ids: params.invoiceIds, p_candidates_only: params.candidatesOnly,
    p_after_date: params.cursor?.nullDate ? undefined : params.cursor?.date ?? undefined,
    p_after_id: params.cursor?.id, p_after_null_date: params.cursor?.nullDate,
    limit: params.limit,
  })),
  coverage: async (invoiceIds) => {
    const out: Awaited<ReturnType<typeof dal.listBills>>['rows'] = [];
    for (let offset = 0; offset < invoiceIds.length; offset += 100) {
      const result = await wrap(() => dal.listBills({ p_invoice_ids: invoiceIds.slice(offset, offset + 100), limit: 100 }));
      out.push(...result.rows);
    }
    return out;
  },
  get: (slipId) => wrap(() => dal.getSlip(slipId)),
};
