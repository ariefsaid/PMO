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

export interface ListMasterInput {
  kind: DirectoryKind;
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

export interface OdooRepository {
  listMasterRecords(input: ListMasterInput): Promise<{ rows: MasterRecord[]; total: number }>;
  masterSummary(kind: DirectoryKind): Promise<{ inactive: number; tombstoned: number; asOf: string | null }>;
  getConnection(): Promise<OdooConnectionRead>;
  setup<T>(setupAction: string, input?: Record<string, unknown>): Promise<T>;
}
