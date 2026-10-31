/** Reporting contracts: management pack, snapshots, financial statements, FX. */
import type { Tables } from '@/src/lib/supabase/database.types';
import type { ManagementPackFacts, ManagementPackRange, ProjectProgressInput } from '@/src/lib/db/managementPack';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import type { FinancialStatementCatalogue, FinancialStatementRead } from '@/src/lib/financialStatements';
import type { FinancialStatementCatalogueOptions, GetFinancialStatementInput } from '@/src/lib/db/financialStatements';

export type FxRateRow = Tables<'fx_rates'>;

export type FxRateInput = { rate_date: string; rate: number };

export type FxRateMatch = Pick<FxRateRow, 'rate' | 'rate_date'>;

export type FxRatePage = { rows: FxRateRow[]; nextCursor: string | null };

export type FxCommitCounts = { new: number; changed: number; unchanged: number };

export interface FxRatesRepository {
  list(before?: string): Promise<FxRatePage>;
  existing(dates: string[]): Promise<Pick<FxRateRow, 'rate_date' | 'rate'>[]>;
  onDate(base: string, quote: string, onDate: string): Promise<FxRateMatch | null>;
  upsert(rows: FxRateInput[]): Promise<FxCommitCounts>;
  context(): Promise<{ currency: string; timezone: string }>;
}

/** #765 — the monthly management pack (ADR-0076). */
export interface ReportsRepository {
  /** Facts for the pack from ONE SECURITY INVOKER RPC; RLS scopes the org. */
  managementPack(range: ManagementPackRange): Promise<ManagementPackFacts>;
  /** Record a project's month-end percent complete (one entry per project per month). */
  recordProgress(input: ProjectProgressInput): Promise<void>;
}

/** Authorized financial statement read envelopes; all scope enforcement remains server-side. */
export interface FinancialStatementsRepository {
  catalogue(options?: FinancialStatementCatalogueOptions): Promise<FinancialStatementCatalogue>;
  get(input: GetFinancialStatementInput): Promise<FinancialStatementRead>;
}

/** Read-only accounting snapshot surface (Slice 7, ADR-0048). RLS-scoped; no write path. */
export interface ErpSnapshotsRepository {
  actuals(): Promise<ErpActualsSnapshotRow[]>;
  apAging(): Promise<ErpAgingSnapshotRow[]>;
  arAging(): Promise<ErpAgingSnapshotRow[]>;
}
