// #1507 S7: project profit and loss follows the tier; the ERPNext section is not mounted for an Odoo organisation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ odoo: false }));
vi.mock('@/src/hooks/useOdooLedger', () => ({ useOdooLedgerMode: () => ({ odoo: h.odoo, onLedger: h.odoo, pending: false, error: false }) }));
vi.mock('@/src/components/financial-statements/OdooStatementsSection', () => ({
  OdooStatementsSection: ({ projectId }: { projectId?: string }) => <div data-testid="odoo-statements-stub" data-project={projectId} />,
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => ({ eligible: true, isPending: true, isError: false, data: undefined, refetch: vi.fn() }),
  useFinancialStatement: () => ({ eligible: true, isPending: false, isFetching: false, isError: false, data: undefined, refetch: vi.fn() }),
}));

import ProjectProfitLossSection from '../ProjectProfitLossSection';

afterEach(cleanup);
describe('ProjectProfitLossSection by tier', () => {
  it('Odoo: the Odoo section for this project', () => {
    h.odoo = true;
    render(<ProjectProfitLossSection projectId="p1" />);
    expect(screen.getByTestId('odoo-statements-stub')).toHaveAttribute('data-project', 'p1');
  });
  it('anything else: the saved-report section (which stays quiet while it loads)', () => {
    h.odoo = false;
    const { container } = render(<ProjectProfitLossSection projectId="p1" />);
    expect(screen.queryByTestId('odoo-statements-stub')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="odoo-statements-stub"]')).toBeNull();
  });
});
