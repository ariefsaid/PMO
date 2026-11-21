/** Vendor response repository (#2702, ADR-0017): the API seam over the vendor-response DAL. The RPCs hold every rule. */
import * as dal from '@/src/lib/db/equipmentVendorResponse';
import { wrap } from './repositoryErrors';

export const equipmentVendorResponseRepository = {
  listBreakdowns: (assetIds: string[], from: string, to: string) => wrap(() => dal.listBreakdowns(assetIds, from, to)),
  record: (input: dal.VendorResponseInput) => wrap(() => dal.recordVendorResponse(input)),
  clear: (assetId: string, periodStart: string) => wrap(() => dal.clearVendorResponse(assetId, periodStart)),
};
