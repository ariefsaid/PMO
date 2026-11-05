import type { ConnectionRecord } from '@/src/lib/adapterSeam/odoo/connectionState';

export interface MasterRecord {
  id: string;
  external_id: string;
  code: string | null;
  name: string;
  parent_external_id: string | null;
  active: boolean;
  tombstoned_at: string | null;
  attrs: Record<string, unknown>;
  as_of: string;
}

export type DirectoryKind = 'product' | 'uom' | 'warehouse' | 'location' | 'account' | 'tax' | 'analytic_account';
/** Every kind the mirror holds; the pickers also read payment journals, which have no directory page. */
export type MirrorKind = DirectoryKind | 'journal';

export interface ListMasterInput {
  kind: MirrorKind;
  search?: string;
  page: number;
  pageSize: number;
  purpose?: 'purchase' | 'sale';
  includeInactive?: boolean;
  /** Only these records (units for the visible rows). */
  externalIds?: string[];
  /** Only locations of these warehouses. */
  warehouseIds?: string[];
}

export interface OdooConnectionRead {
  status: string;
  activated: boolean;
  connection: ConnectionRecord | null;
  capabilities: { missing?: string[]; version_major?: number } | null;
  config: Record<string, unknown>;
}

export type PurchaseCommandKind = 'purchase-order' | 'goods-receipt' | 'purchase-invoice' | 'payment';

/** One command PMO sent (or tried to send) to Odoo for a purchase case that Odoo has not settled yet (FR-OPP-071). */
export interface PurchaseCommand {
  id: string;
  kind: PurchaseCommandKind;
  state: string;
  lastError: string | null;
  updatedAt: string;
  /** Who dispatched it: a held payment cannot be resolved by this person (FR-OPP-063). */
  actorUserId: string | null;
}

export type RevenueCommandKind = 'sales-invoice' | 'incoming-payment';
export interface RevenueCommand {
  id: string;
  recordId: string;
  kind: RevenueCommandKind;
  state: string;
  lastError: string | null;
  updatedAt: string;
  actorUserId: string | null;
}

export interface OdooCreditNote {
  id: string;
  number: string;
  date: string | null;
  currency: string | null;
  amount: number | null;
  status: string;
  readAt: string;
}

export interface OdooRepository {
  listMasterRecords(input: ListMasterInput): Promise<{ rows: MasterRecord[]; total: number }>;
  masterSummary(kind: MirrorKind): Promise<{ inactive: number; tombstoned: number; asOf: string | null }>;
  getConnection(): Promise<OdooConnectionRead>;
  /** Unsettled Odoo commands of one case (RLS: own org). `now` is injectable for the day a failed one stops being news. */
  listPurchaseCommands(procurementId: string, now?: Date): Promise<PurchaseCommand[]>;
  /** Unsettled invoice and receipt commands tied to this PMO invoice. */
  listRevenueCommands(invoiceId: string, now?: Date): Promise<RevenueCommand[]>;
  /** The commands for the visible PMO invoice rows, used by the list page without per-row reads. */
  listRevenueCommandsForInvoices(invoiceIds: string[], now?: Date): Promise<RevenueCommand[]>;
  /** Credit notes mirrored from Odoo and tied to one PMO invoice. */
  listRevenueCreditNotes(invoiceId: string): Promise<OdooCreditNote[]>;
  /** FR-OPP-063: Admin or Finance, never the dispatcher (the database decides). `paymentNumber` is the number Odoo shows for the payment. */
  resolveHeldPayment(input: { outboxId: string; resolution: 'adopt' | 'absent'; paymentNumber?: string; reason?: string }): Promise<void>;
  /** Revenue held rows resolve against their model-specific Odoo document number. */
  resolveHeldRevenueCommand(input: { outboxId: string; kind: RevenueCommandKind; resolution: 'adopt' | 'absent'; documentNumber?: string; reason?: string }): Promise<void>;
  setup<T>(setupAction: string, input?: Record<string, unknown>): Promise<T>;
}
