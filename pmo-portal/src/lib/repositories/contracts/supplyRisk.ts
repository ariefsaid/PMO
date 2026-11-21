/** Supplier supply-risk repository contract (ADR-0017; #2583). */
import type { ExposedWorkOrderRow, SupplyRiskWarning } from '@/src/lib/db/supplyRisk';
import type { SupplyRiskStatus, SupplyRiskSuggestion } from '@/src/lib/supplyRisk';

export interface SupplyRiskRepository {
  /** The database's payables-age suggestion for a supplier; null when it is not a readable Vendor of the caller's org. */
  suggestion(companyId: string): Promise<SupplyRiskSuggestion | null>;
  /** Work orders exposed to the supplier (open orders), plus project-level orders naming no work order. */
  exposure(companyId: string): Promise<ExposedWorkOrderRow[]>;
  /** The only write: Admin/Finance, audited; a reason is required unless `active`. */
  setStatus(companyId: string, status: SupplyRiskStatus, reason: string | null): Promise<void>;
  /** Display name of whoever last changed the status, or null. */
  setterName(profileId: string): Promise<string | null>;
  /** Warnings for a project's (or one work order's) work orders exposed to an at_risk/inactive supplier. */
  warnings(scope: { projectId?: string; workOrderId?: string }): Promise<SupplyRiskWarning[]>;
}
