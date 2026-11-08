/** Odoo ledger contract (#1507 S7): health, source lines, statements and the Admin basis switch. */
import type {
  GetOdooStatementInput, OdooLedgerHealth, OdooLedgerLinesPage, OdooStatementCatalogue, OdooStatementRead, SwitchOdooLedgerBasisInput,
} from '@/src/lib/db/odooLedger';

export interface OdooLedgerRepository {
  health(projectId?: string): Promise<OdooLedgerHealth>;
  lines(input: { projectId: string; category: string; after?: string | null; limit?: number }): Promise<OdooLedgerLinesPage>;
  statementCatalogue(projectId?: string): Promise<OdooStatementCatalogue>;
  statement(input: GetOdooStatementInput): Promise<OdooStatementRead>;
  /** True when a cost account in Odoo is linked to the project (FR-ODA-052). */
  projectLinked(projectId: string): Promise<boolean>;
  /** The Odoo company's currency code (what ledger amounts are in), or null when not recorded. */
  companyCurrency(): Promise<string | null>;
  switchBasis(input?: SwitchOdooLedgerBasisInput): Promise<string>;
}
