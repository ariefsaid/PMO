/** Vendor withholding slip repository contract. */
import type { RecordSlipInput, CorrectSlipInput, VoidSlipInput, SlipWriteResult } from '@/src/lib/vendorWithholdingSlip';
import type {
  BillContextLabels,
  BillCursor,
  BillPage,
  ReadBillContextsInput,
  SlipCursor,
  SlipDetail,
  SlipPage,
} from '@/src/lib/db/vendorWithholdingSlips';

/** The assembled set of repositories the FE/CRUD layer consumes (one per entity). */
export interface VendorWithholdingSlipsRepository {
  record(input: RecordSlipInput): Promise<SlipWriteResult>;
  correct(input: CorrectSlipInput): Promise<SlipWriteResult>;
  void(input: VoidSlipInput): Promise<SlipWriteResult>;
  listSlips(params?: { vendorId?: string; taxPeriod?: string; invoiceId?: string; cursor?: SlipCursor; limit?: number }): Promise<SlipPage>;
  listBills(params?: { vendorId?: string; pphType?: string; currency?: string; invoiceIds?: string[]; candidatesOnly?: boolean; cursor?: BillCursor; limit?: number }): Promise<BillPage>;
  coverage(invoiceIds: string[]): Promise<BillPage['rows']>;
  readBillContexts(input: ReadBillContextsInput): Promise<BillContextLabels>;
  get(slipId: string): Promise<SlipDetail>;
}
