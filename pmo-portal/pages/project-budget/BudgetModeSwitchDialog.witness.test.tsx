import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import financeEn from '@/public/locales/en/finance.json';
import financeId from '@/public/locales/id/finance.json';
import type { BudgetLineItemRow } from '@/src/lib/db/budgets';
import BudgetModeSwitchDialog from './BudgetModeSwitchDialog';

i18next.addResourceBundle('en', 'finance', financeEn, true, true);
i18next.addResourceBundle('id', 'finance', financeId, true, true);

describe('BudgetModeSwitchDialog unreadable lines (#2091)', () => {
  it('tells the person what to do next and keeps Confirm unavailable', async () => {
    const lines = [{ id: 'l1', category: 'Materials', budgeted_amount: 'not-a-number', fiscal_year: null }] as unknown as BudgetLineItemRow[];
    render(
      <BudgetModeSwitchDialog open versionId="v1" currentMode="whole_project" lines={lines} fiscalYearNames={['2026']} currency="IDR" contextKey="k" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/reload the page and try again/i);
  });

  it('keeps the specific reason next to the next step, not a generic line only', async () => {
    const lines = [{ id: 'l1', category: 'Materials', budgeted_amount: 'not-a-number', fiscal_year: null }] as unknown as BudgetLineItemRow[];
    render(
      <BudgetModeSwitchDialog open versionId="v1" currentMode="whole_project" lines={lines} fiscalYearNames={['2026']} currency="IDR" contextKey="k" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/reload the page and try again/i);
    expect(alert).toHaveTextContent(/reason:.*not-a-number|reason:.*amount/i);
  });
});
