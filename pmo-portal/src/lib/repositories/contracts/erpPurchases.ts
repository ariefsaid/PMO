/** ERP purchase documents contract (ADR-0093). */
import type { ErpLinkResponse, ErpLinkRow, ErpPurchaseRow } from '../erpPurchases';

/** #775 phase B — read-only views of the expense posting side mirror and the account map (RLS-scoped, 0270). */
/** ADR-0093: ERP purchase documents, linked into purchases (never adopted, never pushed). */
export interface ErpPurchaseRepository {
  list(projectId?: string): Promise<ErpPurchaseRow[]>;
  /** The default orphan list: set-aside documents are left out. */
  listOrphans(projectId?: string): Promise<ErpPurchaseRow[]>;
  hasAny(): Promise<boolean>;
  listLinked(procurementId: string): Promise<ErpPurchaseRow[]>;
  link(rows: ErpLinkRow[], dryRun?: boolean): Promise<ErpLinkResponse>;
  unlink(linkId: string): Promise<void>;
}
