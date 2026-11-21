import type {
  BackchargeRow, BillCertificateInput, BillResult, CertificateFilters, CertificateRow, CertificateView, RateLineRow,
  RecordBackchargeInput, SetRateInput, SubcontractPoOption,
} from '@/src/lib/db/subcontractCertificates';

/** Subcontractor progress certificates, the rate card and backcharges (#2584). Every rule lives in the database. */
export interface SubcontractCertificateRepository {
  list(filters?: CertificateFilters): Promise<{ rows: CertificateRow[]; hasMore: boolean }>;
  view(id: string): Promise<CertificateView>;
  prepare(poId: string, periodStart: string): Promise<string>;
  submit(id: string): Promise<void>;
  returnToPreparer(id: string, reason: string): Promise<void>;
  approve(id: string): Promise<void>;
  cancel(id: string, reason: string): Promise<void>;
  bill(input: BillCertificateInput): Promise<BillResult>;
  setDeselection(input: { certificateId: string; workDate: string; workOrderLineId: string; crewId: string; deselect: boolean; reason?: string | null }): Promise<void>;
  prepareAcceptance(certificateId: string): Promise<string>;
  recordBackcharge(input: RecordBackchargeInput): Promise<string>;
  setBackcharge(certificateId: string, backchargeId: string, include: boolean): Promise<void>;
  openBackcharges(vendorId: string, projectId: string): Promise<BackchargeRow[]>;
  rateLines(vendorId?: string): Promise<RateLineRow[]>;
  setRate(input: SetRateInput): Promise<string>;
  subcontractPos(): Promise<SubcontractPoOption[]>;
}
