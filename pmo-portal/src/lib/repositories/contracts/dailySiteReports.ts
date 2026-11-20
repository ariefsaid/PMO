import type {
  DsrContractItem, DsrDraftInput, DsrListFilter, DsrListOption, DsrReportHours, DsrPhoto,
  DsrQueueRow, DsrReport, DsrReportDetail, DsrReportListRow, DsrRevenueLineRow,
} from '@/src/lib/db/dailySiteReports';

/** #1522 daily site report seam (ADR-0017). Every write is a server RPC; org_id never leaves the server. */
export interface DailySiteReportRepository {
  list(filter: DsrListFilter, page?: number): Promise<{ rows: DsrReportListRow[]; hasMore: boolean }>;
  get(id: string): Promise<DsrReportDetail | null>;
  listIdleReasons(): Promise<DsrListOption[]>;
  listWeatherConditions(): Promise<DsrListOption[]>;
  listContractItems(workOrderId: string): Promise<DsrContractItem[]>;
  reportHours(reportId: string): Promise<DsrReportHours>;
  saveDraft(input: DsrDraftInput): Promise<string>;
  submit(id: string): Promise<void>;
  validate(id: string): Promise<void>;
  returnReport(id: string, reason: string): Promise<void>;
  correct(id: string, reason: string): Promise<string>;
  revenue(id: string): Promise<DsrRevenueLineRow[]>;
  workOrderRevenue(workOrderId: string): Promise<number>;
  queue(): Promise<DsrQueueRow[]>;
  uploadPhoto(report: Pick<DsrReport, 'id' | 'org_id'>, file: File, kind?: DsrPhoto['kind']): Promise<void>;
  photoUrl(path: string): Promise<string>;
}
