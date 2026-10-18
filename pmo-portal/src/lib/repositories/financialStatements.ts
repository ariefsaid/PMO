import { toAppError } from '@/src/lib/appError';
import {
  getFinancialStatement,
  getFinancialStatementCatalogue,
  type FinancialStatementCatalogueOptions,
  type GetFinancialStatementInput,
} from '@/src/lib/db/financialStatements';

export const financialStatementsRepository = {
  async catalogue(options: FinancialStatementCatalogueOptions = {}) {
    try {
      return await getFinancialStatementCatalogue(options);
    } catch (error) {
      throw toAppError(error);
    }
  },
  async get(input: GetFinancialStatementInput) {
    try {
      return await getFinancialStatement(input);
    } catch (error) {
      throw toAppError(error);
    }
  },
};
