/**
 * Row / input / result types of the data modules, re-exported through the repository seam so hooks and
 * components name them from `@/src/lib/repositories` instead of importing `lib/db/*` (ADR-0017, #1632).
 * Type-only: nothing here runs, and it adds no module to the runtime graph.
 */
export type {
  ExecutiveDashboard,
  PMDashboardProject,
  WinRate,
  SalesPipeline,
  PipelineProject,
  BudgetReviewRow,
} from '@/src/lib/db/dashboard';
export type { ProjectWithRefs, ProjectStatus } from '@/src/lib/db/projects';
export type { OrgLocaleDefaultsRow } from '@/src/lib/db/orgs';
export type { AgentEventRow } from '@/src/lib/db/agentEvents';
export type {
  ProcurementDetail,
  ProcurementStatus,
  ProcurementReceiptRow,
  ProcurementInvoiceRow,
  CreateInvoiceInput,
  CaptureVendorInvoiceInput,
  ProcurementError,
} from '@/src/lib/db/procurementLifecycle';
export type {
  NewProcurementInput,
  AtomicProcurementInput,
  ProcurementHeaderPatch,
  ProcurementItemInput,
  ProcurementItemPatch,
  ProcurementItemRow,
  ProcurementDocumentInput,
  ProcurementDocumentRow,
} from '@/src/lib/db/procurementCrud';
export type { PurchaseRequestRow, RfqRow, PurchaseOrderRow, PaymentRow } from '@/src/lib/db/procurementRecords';
export type { ProcurementWithRefs, ProjectCommittedSpend } from '@/src/lib/db/procurements';
export type {
  MeetingWithRefs,
  MeetingInput,
  MeetingPatch,
  MeetingListParams,
  MeetingAttendeeWithRefs,
  MeetingAttendeeInput,
  MeetingGrantWithRefs,
} from '@/src/lib/db/meetings';
export type { TaskWithRefs } from '@/src/lib/db/tasks';
export type { ProjectDocumentRow, ProjectDocumentInput, DocStatus } from '@/src/lib/db/documents';
export type {
  ExpenseClaimFilters,
  ExpenseClaimInput,
  ExpenseClaimPatch,
  ExpenseClaimRoute,
  ExpenseClaimStatus,
  ExpenseClaimWithRefs,
  ExpenseKind,
  ExpenseLineInput,
} from '@/src/lib/db/expenseClaims';
export type { WorkOrderInput, WorkOrderPatch, WorkOrderStatus, SetWorkOrderValueInput } from '@/src/lib/db/workOrders';
export type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
