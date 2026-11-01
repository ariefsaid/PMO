// Compatibility seam for the financial-statement parsers. The implementation
// lives in focused sibling modules (validation, nativeReport, snapshotRow,
// readEnvelope); this file preserves the original public import path and the
// parsers' existing TypeError contracts.
export type {
  FinancialStatementKind,
  FinancialStatementPeriodKind,
  FinancialStatementRoundingMode,
} from './financialStatements/validation';

export type {
  FinancialStatementNativePayload,
  FinancialStatementNativeReport,
  FinancialStatementNativeReportPeriod,
  FinancialStatementNativeScalar,
  FinancialStatementTotalsPayload,
} from './financialStatements/nativeReport';

export type { FinancialStatementRow } from './financialStatements/snapshotRow';
export { parseFinancialStatementRow } from './financialStatements/snapshotRow';

export type {
  FinancialStatementCatalogue,
  FinancialStatementDetailResult,
  FinancialStatementGeneration,
  FinancialStatementPair,
  FinancialStatementRead,
  FinancialStatementResult,
  FinancialStatementScope,
  FinancialStatementScopeKind,
  FinancialStatementSelection,
  FinancialStatementTotalsResult,
  FinancialStatementViewKind,
  StatementPresentation,
} from './financialStatements/readEnvelope';
export { parseFinancialStatementCatalogue, parseFinancialStatementRead } from './financialStatements/readEnvelope';
