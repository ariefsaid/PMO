import { getOdooLedgerHealth, getOdooProjectLinked, getOdooLedgerLines, getOdooStatement, getOdooStatementCatalogue, switchOdooLedgerBasis } from '@/src/lib/db/odooLedger';
import { wrap } from './repositoryErrors';
import type { OdooLedgerRepository } from './contracts/odooLedger';

export const odooLedgerRepository: OdooLedgerRepository = {
  health: (projectId) => wrap(() => getOdooLedgerHealth(projectId)),
  lines: (input) => wrap(() => getOdooLedgerLines(input)),
  statementCatalogue: (projectId) => wrap(() => getOdooStatementCatalogue(projectId)),
  statement: (input) => wrap(() => getOdooStatement(input)),
  projectLinked: (projectId) => wrap(() => getOdooProjectLinked(projectId)),
  switchBasis: (input) => wrap(() => switchOdooLedgerBasis(input)),
};
