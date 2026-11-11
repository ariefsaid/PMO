import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import type { BudgetLineItemRow } from '@/src/lib/db/budgets';
import { fromPercents } from '@/src/lib/budget/budgetDistribution';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';
import { financeTestI18n } from '@/test/financeI18nTestInstance';
import DistributionGrid from './DistributionGrid';

const EN = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const years = [
  { name: '2025', start: '2025-01-01', end: '2025-12-31' },
  { name: '2026', start: '2026-01-01', end: '2026-12-31' },
  { name: '2027', start: '2027-01-01', end: '2027-12-31' },
];
const baseLines = [{
  id: 'line-1',
  budget_version_id: 'v1',
  category: 'Labor',
  description: 'Developers',
  budgeted_amount: 100.01,
  actual_amount: 0,
  fiscal_year: null,
  org_id: 'org1',
}] as BudgetLineItemRow[];

function renderGrid(overrides: Partial<React.ComponentProps<typeof DistributionGrid>> = {}) {
  const onSave = vi.fn().mockResolvedValue(true);
  const view = render(
    <FinanceI18nTestProvider>
      <DistributionGrid
        versionId="v1"
        lines={baseLines}
        projectStart="2026-01-01"
        projectEnd="2026-12-31"
        fiscalYears={years}
        currency="USD"
        editorIdentity="user1:Finance"
        savedPlan={null}
        onSave={onSave}
        {...overrides}
      />
    </FinanceI18nTestProvider>,
  );
  return { ...view, onSave };
}

afterEach(async () => {
  resetActiveLocale();
  await financeTestI18n.changeLanguage('en');
});

describe('DistributionGrid (#1472 B1)', () => {
  it('previews exact cents and saves only after the operator confirms the reviewed snapshot', async () => {
    setActiveLocale(EN);
    const { onSave } = renderGrid();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2026' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));

    const grid = screen.getByRole('table', { name: 'Category fiscal-year distribution' });
    expect(within(grid).getByRole('columnheader', { name: '2026' })).toBeInTheDocument();
    expect(within(grid).queryByRole('columnheader', { name: '2025' })).not.toBeInTheDocument();
    expect(within(grid).queryByRole('columnheader', { name: '2027' })).not.toBeInTheDocument();
    expect(within(grid).getAllByText('$100.01')).toHaveLength(4);
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Save reviewed distribution' }));
    const confirm = await screen.findByRole('dialog', { name: 'Save this distribution?' });
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Save distribution' }));

    expect(onSave).toHaveBeenCalledWith({
      method: 'percent_by_year',
      inputs: { '2026': '100' },
      categoryOverrides: {},
      basis: {
        projectStart: '2026-01-01',
        projectEnd: '2026-12-31',
        years: [{ name: '2026', start: '2026-01-01', end: '2026-12-31' }],
      },
      rows: [{ category: 'Labor', fiscal_year: '2026', ordinal: 0, amount: '100.01', method: 'percent_by_year', is_override: false }],
    }, [{ id: 'line-1', category: 'Labor', budgeted_amount: '100.01', fiscal_year: null }]);
  });

  it('invalidates a preview on source changes while preserving entered values for a fresh review', async () => {
    setActiveLocale(EN);
    const { onSave, rerender } = renderGrid();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2026' }), '100');
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));
    expect(screen.getByRole('button', { name: 'Save reviewed distribution' })).toBeInTheDocument();

    const changedLines = [{ ...baseLines[0], budgeted_amount: 125.01 }];
    rerender(
      <FinanceI18nTestProvider>
        <DistributionGrid
          versionId="v1"
          lines={changedLines}
          projectStart="2026-01-01"
          projectEnd="2026-12-31"
          fiscalYears={years}
          currency="USD"
          editorIdentity="user1:Finance"
          savedPlan={null}
          onSave={onSave}
        />
      </FinanceI18nTestProvider>,
    );

    expect(await screen.findByText(/source lines.*changed/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Shared input for 2026' })).toHaveValue('100');
    expect(screen.queryByRole('button', { name: 'Save reviewed distribution' })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('refuses to preview when a project span is not covered by the complete fiscal-year calendar', async () => {
    setActiveLocale(EN);
    renderGrid({
      projectStart: '2026-01-01',
      projectEnd: '2027-12-31',
      fiscalYears: [years[0], years[2]],
    });
    expect(screen.getByRole('status')).toHaveTextContent(/does not cover|missing fiscal-year coverage/i);
    expect(screen.queryByRole('button', { name: 'Preview distribution' })).not.toBeInTheDocument();
  });

  it('keeps an unknown persisted plan distinct from absence and retries its read', async () => {
    setActiveLocale(EN);
    const onRetryRead = vi.fn();
    const onReadinessChange = vi.fn();
    renderGrid({ savedPlanError: true, onRetryRead, onReadinessChange });

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load the saved distribution/i);
    expect(screen.getByRole('button', { name: 'Retry saved distribution read' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Preview distribution' })).not.toBeInTheDocument();
    await waitFor(() => expect(onReadinessChange).toHaveBeenCalledWith({ versionId: 'v1', status: 'error' }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry saved distribution read' }));
    expect(onRetryRead).toHaveBeenCalledTimes(1);
  });

  it('preserves entered overrides across a failed distribution read and its retry', async () => {
    setActiveLocale(EN);
    const { rerender, onSave } = renderGrid();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2026' }), '100');

    rerender(
      <FinanceI18nTestProvider>
        <DistributionGrid
          versionId="v1"
          lines={baseLines}
          projectStart="2026-01-01"
          projectEnd="2026-12-31"
          fiscalYears={years}
          currency="USD"
          editorIdentity="user1:Finance"
          savedPlan={null}
          savedPlanError
          onSave={onSave}
        />
      </FinanceI18nTestProvider>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the saved distribution/i);
    expect(screen.queryByRole('button', { name: 'Preview distribution' })).not.toBeInTheDocument();

    rerender(
      <FinanceI18nTestProvider>
        <DistributionGrid
          versionId="v1"
          lines={baseLines}
          projectStart="2026-01-01"
          projectEnd="2026-12-31"
          fiscalYears={years}
          currency="USD"
          editorIdentity="user1:Finance"
          savedPlan={null}
          onSave={onSave}
        />
      </FinanceI18nTestProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Shared input for 2026' })).toHaveValue('100');
  });

  it('associates invalid shared inputs with localized field errors', async () => {
    setActiveLocale(EN);
    renderGrid();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    const input = screen.getByRole('textbox', { name: 'Shared input for 2026' });
    await userEvent.type(input, 'Infinity');
    await userEvent.click(screen.getByRole('button', { name: 'Preview distribution' }));

    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)).toHaveTextContent(/enter a valid number/i);
    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/enter a valid number/i);
  });

  it('reports each readiness transition so the parent can block activation while edits are unsaved', async () => {
    setActiveLocale(EN);
    const onReadinessChange = vi.fn();
    renderGrid({ onReadinessChange });
    await waitFor(() => expect(onReadinessChange).toHaveBeenCalledWith({ versionId: 'v1', status: 'absent' }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Distribution method' }), 'percent_by_year');
    await userEvent.type(screen.getByRole('textbox', { name: 'Shared input for 2026' }), '100');
    await waitFor(() => expect(onReadinessChange).toHaveBeenCalledWith({ versionId: 'v1', status: 'dirty' }));
  });

  it('localizes validation errors in Indonesian', async () => {
    await financeTestI18n.changeLanguage('id');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    renderGrid();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Metode alokasi' }), 'percent_by_year');
    const input = screen.getByRole('textbox', { name: 'Masukan bersama untuk 2026' });
    await userEvent.type(input, '-1');

    expect(screen.getByTestId('distribution-validation-summary')).toHaveTextContent(/Masukkan nol atau angka positif untuk 2026/i);
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('loads canonical saved decimals into the active locale without marking a current plan stale', async () => {
    await financeTestI18n.changeLanguage('id');
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    const basisYears = years.slice(1);
    const result = fromPercents('100.01', ['50.5', '49.5'], basisYears);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const savedPlan = {
      method: 'percent_by_year' as const,
      inputs: { '2026': '50.5', '2027': '49.5' },
      categoryOverrides: {},
      basis: { projectStart: '2026-01-01', projectEnd: '2027-12-31', years: basisYears },
      rows: result.rows.map((row, ordinal) => ({ category: 'Labor' as const, fiscal_year: row.year, ordinal, amount: row.amount, method: 'percent_by_year' as const, is_override: false })),
    };
    const onReadinessChange = vi.fn();
    renderGrid({ projectEnd: '2027-12-31', savedPlan, onReadinessChange });

    await waitFor(() => expect(onReadinessChange).toHaveBeenCalledWith({ versionId: 'v1', status: 'current' }));
    expect(screen.getByRole('textbox', { name: 'Masukan bersama untuk 2026' })).toHaveValue('50,5');
    expect(screen.getByRole('textbox', { name: 'Masukan bersama untuk 2027' })).toHaveValue('49,5');
  });
});
