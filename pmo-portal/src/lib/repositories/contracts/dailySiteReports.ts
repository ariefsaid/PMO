import type {
  DsrContractItem, DsrDraftInput, DsrListAdminOption, DsrListFilter, DsrListKind, DsrListOption, DsrReportHours, DsrPhoto,
  DsrQueueRow, DsrReport, DsrReportDetail, DsrReportListRow, DsrRevenueLineRow,
} from '@/src/lib/db/dailySiteReports';
import type { DsrValidationRoute } from '@/src/lib/db/dsrValidationRoute';

/** #1522 daily site report seam (ADR-0017). Every write is a server RPC; org_id never leaves the server. */
export interface DailySiteReportRepository {
  list(filter: DsrListFilter, page?: number): Promise<{ rows: DsrReportListRow[]; hasMore: boolean }>;
  get(id: string): Promise<DsrReportDetail | null>;
  listIdleReasons(): Promise<DsrListOption[]>;
  listWeatherConditions(): Promise<DsrListOption[]>;
  listListItems(kind: DsrListKind): Promise<DsrListAdminOption[]>;
  addListItem(kind: DsrListKind, label: string): Promise<void>;
  renameListItem(kind: DsrListKind, id: string, label: string): Promise<void>;
  setListItemArchived(kind: DsrListKind, id: string, archived: boolean): Promise<void>;
  listContractItems(workOrderId: string): Promise<DsrContractItem[]>;
  reportHours(reportId: string): Promise<DsrReportHours>;
  saveDraft(input: DsrDraftInput): Promise<string>;
  submit(id: string): Promise<void>;
  /** The author takes a sent report back to a draft, until it is validated or returned. */
  withdraw(id: string): Promise<void>;
  validate(id: string): Promise<void>;
  returnReport(id: string, reason: string): Promise<void>;
  correct(id: string, reason: string): Promise<string>;
  revenue(id: string): Promise<DsrRevenueLineRow[]>;
  workOrderRevenue(workOrderId: string): Promise<number>;
  queue(): Promise<DsrQueueRow[]>;
  /** fix-waiting item 3 (FR-WAIT-006): the server-computed validator route of ONE visible Submitted report. */
  validationRoute(reportId: string): Promise<DsrValidationRoute>;
  /** 2290: built-in job role keys whose holders may validate daily site reports in this organisation. */
  validateRoles(): Promise<string[]>;
  setValidateRoles(roles: string[]): Promise<string[]>;
  uploadPhoto(report: Pick<DsrReport, 'id' | 'org_id'>, file: File, kind?: DsrPhoto['kind']): Promise<void>;
  photoUrl(path: string): Promise<string>;
}
