// #1507 S7: project profit and loss follows the tier; the ERPNext section is not mounted for an Odoo organisation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FinanceI18nTestProvider } from '@/test/financeI18nTestProvider';

const h = vi.hoisted(() => ({ odoo: false, error: false, retry: vi.fn() }));
vi.mock('@/src/hooks/useOdooLedger', () => ({ useOdooLedgerMode: () => ({ odoo: h.odoo, onLedger: h.odoo, pending: false, error: h.error, retry: h.retry }) }));
vi.mock('@/src/components/financial-statements/OdooStatementsSection', () => ({
  OdooStatementsSection: ({ projectId }: { projectId?: string }) => <div data-testid="odoo-statements-stub" data-project={projectId} />,
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => ({ eligible: true, isPending: true, isError: false, data: undefined, refetch: vi.fn() }),
  useFinancialStatement: () => ({ eligible: true, isPending: false, isFetching: false, isError: false, data: undefined, refetch: vi.fn() }),
}));

import ProjectProfitLossSection from '../ProjectProfitLossSection';

afterEach(() => { cleanup(); h.error = false; h.retry.mockReset(); });
describe('ProjectProfitLossSection by tier', () => {
  it('Odoo: the Odoo section for this project', () => {
    h.odoo = true;
    render(<ProjectProfitLossSection projectId="p1" />);
    expect(screen.getByTestId('odoo-statements-stub')).toHaveAttribute('data-project', 'p1');
  });
  it('#2065 a failed mode read shows a plain notice with Retry above the saved-report section', async () => {
    h.odoo = false;
    h.error = true;
    render(<FinanceI18nTestProvider><ProjectProfitLossSection projectId="p1" /></FinanceI18nTestProvider>);
    expect(screen.getByText('We could not check where these figures come from')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.retry).toHaveBeenCalledTimes(1);
  });
  it('anything else: the saved-report section (which stays quiet while it loads)', () => {
    h.odoo = false;
    const { container } = render(<ProjectProfitLossSection projectId="p1" />);
    expect(screen.queryByTestId('odoo-statements-stub')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="odoo-statements-stub"]')).toBeNull();
  });
});
