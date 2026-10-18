import { describe, expect, it } from 'vitest';
import type { ProjectFinances } from './projectFinances';
import { buildProjectMoneyPosition, type ProjectMoneyPositionInput } from './projectFinances';

const erpActuals = (
  total: string | null = '0.10',
  categories: ProjectFinances['actuals']['categories'] = [
    { category: 'Labor', mapped: true, amount: total },
  ],
  overrides: Partial<ProjectFinances['actuals']> = {},
): ProjectFinances['actuals'] => ({
  currency: 'USD',
  as_of: '2026-10-17T00:00:00Z',
  total,
  excludes_restricted_rows: false,
  categories,
  ...overrides,
});

const input = (overrides: Partial<ProjectMoneyPositionInput> = {}): ProjectMoneyPositionInput => ({
  projectCurrency: 'USD',
  contractValue: 0.3,
  activeBudget: 1,
  ledgerBasis: 'erp',
  committedSpend: 10,
  commitmentPending: false,
  commitmentError: false,
  actuals: erpActuals(),
  ...overrides,
});

describe('buildProjectMoneyPosition', () => {
  it('AC-PMP-002 uses exact contract subtraction and the established rounded ratio', () => {
    const source = input();
    const before = structuredClone(source);

    expect(buildProjectMoneyPosition(source)).toMatchObject({
      actual: { amount: '0.10', basis: 'erp', complete: true },
      comparableActual: 0.1,
      contractAfterCost: '0.20',
      contractAfterCostTone: 'pos',
      spendPercent: 10,
    });
    expect(source).toEqual(before);
  });

  it('AC-PMP-002 keeps negative and zero remainder signs and does not clamp the spend ratio', () => {
    const negative = buildProjectMoneyPosition(input({
      contractValue: 100,
      activeBudget: 20,
      actuals: erpActuals('125.00'),
    }));
    const zero = buildProjectMoneyPosition(input({
      contractValue: 0.1,
      activeBudget: 0.1,
      actuals: erpActuals('0.10'),
    }));

    expect(negative).toMatchObject({
      contractAfterCost: '-25.00',
      contractAfterCostTone: 'neg',
      spendPercent: 625,
    });
    expect(zero).toMatchObject({
      contractAfterCost: '0.00',
      contractAfterCostTone: 'pos',
      spendPercent: 100,
    });
  });

  it('AC-PMP-001 separates mapping coverage from amount completeness', () => {
    const mappedMissingAmounts = buildProjectMoneyPosition(input({
      actuals: erpActuals('10.00', [
        { category: 'Labor', mapped: true, amount: null },
        { category: 'Materials', mapped: true, amount: null },
      ]),
    }));
    const empty = buildProjectMoneyPosition(input({
      actuals: erpActuals('0.00', []),
    }));
    const unmapped = buildProjectMoneyPosition(input({
      actuals: erpActuals('10.00', [
        { category: 'Labor', mapped: true, amount: '10.00' },
        { category: 'Materials', mapped: false, amount: null },
      ]),
    }));
    const restricted = buildProjectMoneyPosition(input({
      actuals: erpActuals('10.00', [
        { category: 'Labor', mapped: true, amount: '10.00' },
      ], { excludes_restricted_rows: true }),
    }));

    expect(mappedMissingAmounts).toMatchObject({
      actual: { complete: false, amount: null },
      headlineState: 'unavailable',
      coverage: { kind: 'complete', mapped: 2, total: 2 },
    });
    expect(empty).toMatchObject({
      actual: { complete: false, amount: null },
      headlineState: 'unavailable',
      coverage: { kind: 'unavailable', mapped: 0, total: 0 },
    });
    expect(unmapped).toMatchObject({
      headlineState: 'partial',
      coverage: { kind: 'partial', mapped: 1, total: 2 },
    });
    expect(restricted).toMatchObject({
      headlineState: 'partial',
      coverage: { kind: 'partial', mapped: 1, total: 1 },
    });
  });

  it.each([
    { label: 'a successful zero', committedSpend: 0, pending: false, error: false, amount: '0.00', complete: true, headline: 'available' },
    { label: 'a pending read', committedSpend: undefined, pending: true, error: false, amount: null, complete: false, headline: 'loading' },
    { label: 'a failed read', committedSpend: 10, pending: false, error: true, amount: null, complete: false, headline: 'unavailable' },
    { label: 'a nonfinite reading', committedSpend: Number.NaN, pending: false, error: false, amount: null, complete: false, headline: 'unavailable' },
  ] as const)('AC-PMP-001 preserves PMO actual state for $label', ({ committedSpend, pending, error, amount, complete, headline }) => {
    expect(buildProjectMoneyPosition(input({
      ledgerBasis: 'pmo',
      committedSpend,
      commitmentPending: pending,
      commitmentError: error,
      actuals: undefined,
    }))).toMatchObject({
      actual: { amount, basis: 'pmo', complete },
      headlineState: headline,
      coverage: { kind: 'pmo', mapped: 0, total: 0 },
    });
  });

  it('AC-PMP-001 returns unavailable when the selected ledger source is unavailable', () => {
    expect(buildProjectMoneyPosition(input({
      ledgerBasis: 'unavailable',
      actuals: undefined,
    }))).toMatchObject({
      actual: { amount: null, currency: null, basis: 'unavailable', complete: false },
      headlineState: 'unavailable',
      coverage: { kind: 'unavailable', mapped: 0, total: 0 },
    });
  });

  it('AC-PMP-002 leaves comparisons unavailable for mismatched currencies or unusable operands', () => {
    const mismatched = buildProjectMoneyPosition(input({
      actuals: erpActuals('10.00', [{ category: 'Labor', mapped: true, amount: '10.00' }], { currency: 'EUR' }),
    }));
    const noContract = buildProjectMoneyPosition(input({ contractValue: null }));
    const nonfiniteContract = buildProjectMoneyPosition(input({ contractValue: Number.POSITIVE_INFINITY }));
    const noBudget = buildProjectMoneyPosition(input({ activeBudget: undefined }));
    const zeroBudget = buildProjectMoneyPosition(input({ activeBudget: 0 }));

    expect(mismatched).toMatchObject({
      actual: { complete: true, currency: 'EUR' },
      headlineState: 'available',
      comparableActual: null,
      contractAfterCost: null,
      contractAfterCostTone: undefined,
      spendPercent: null,
    });
    expect(noContract).toMatchObject({
      comparableActual: 0.1,
      contractAfterCost: null,
      contractAfterCostTone: undefined,
      spendPercent: 10,
    });
    expect(nonfiniteContract.contractAfterCost).toBeNull();
    expect(nonfiniteContract.contractAfterCostTone).toBeUndefined();
    expect(noBudget.spendPercent).toBeNull();
    expect(zeroBudget.spendPercent).toBeNull();
  });
});
