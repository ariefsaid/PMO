import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/db/financialStatements', () => ({
  getFinancialStatement: vi.fn(),
  getFinancialStatementCatalogue: vi.fn(),
}));

import { AppError } from '@/src/lib/appError';
import * as dal from '@/src/lib/db/financialStatements';
import type { FinancialStatementCatalogue } from '@/src/lib/financialStatements';
import { financialStatementsRepository } from './financialStatements';

beforeEach(() => vi.clearAllMocks());

describe('financial statements repository', () => {
  it('AC-006 catalogue delegates the requested project scope and returns its typed DTO', async () => {
    const catalogue: FinancialStatementCatalogue = { state: 'unavailable', companyLabel: null, generation: null, periods: [], scopes: [] };
    vi.mocked(dal.getFinancialStatementCatalogue).mockResolvedValue(catalogue);
    await expect(financialStatementsRepository.catalogue({ projectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' })).resolves.toBe(catalogue);
    expect(dal.getFinancialStatementCatalogue).toHaveBeenCalledWith({ projectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' });
  });

  it('AC-006 get delegates the exact selection without broadening scope', async () => {
    const result = { state: 'unavailable', companyLabel: null, generation: null,
      selection: { periodKind: 'month', periodStart: '2024-02-01', statement: 'profit_and_loss', scopeKind: 'project', projectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', viewKind: 'project_totals' }, result: null } as const;
    const input = { periodKind: 'month', periodStart: '2024-02-01', statement: 'profit_and_loss', projectId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', viewKind: 'project_totals' } as const;
    vi.mocked(dal.getFinancialStatement).mockResolvedValue(result);
    await expect(financialStatementsRepository.get(input)).resolves.toBe(result);
    expect(dal.getFinancialStatement).toHaveBeenCalledWith(input);
  });

  it('AC-006 normalizes non-AppError failures while preserving PostgREST codes', async () => {
    vi.mocked(dal.getFinancialStatementCatalogue).mockRejectedValue({ message: 'Not permitted', code: '42501' });
    await expect(financialStatementsRepository.catalogue()).rejects.toMatchObject({
      name: 'AppError', message: 'Not permitted', code: '42501',
    });
    vi.mocked(dal.getFinancialStatement).mockRejectedValue(new AppError('Statement changed.', 'statement-snapshot-changed'));
    await expect(financialStatementsRepository.get({ periodKind: 'month', periodStart: '2024-02-01', statement: 'profit_and_loss' })).rejects.toMatchObject({ code: 'statement-snapshot-changed' });
  });
});
