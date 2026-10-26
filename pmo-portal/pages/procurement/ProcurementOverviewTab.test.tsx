import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 1000000, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProjectCommittedSpend: () => ({ data: 0, isPending: false, isError: false }),
  useProjectReservedSpend: () => ({ data: 0, isPending: false, isError: false }),
}));

import { ProcurementOverviewTab } from './ProcurementOverviewTab';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { formatNumber, formatShortMoney } from '@/src/lib/format';

const renderReview = (projectId: string | null = 'proj-1') => render(
  <ImpersonationProvider realRole="Project Manager">
    <MemoryRouter>
      <ProcurementOverviewTab
        requestAmount={486000}
        requestCurrency="USD"
        selectedQuote={{ amount: 478500, currency: 'USD' }}
        orderedAmount={{ amount: 478500, currency: 'USD' }}
        items={[{ id: 'item-1', name: 'Desk', quantity: 2, rate: 100, amount: 200 }]}
        projectId={projectId}
        projectName="Meridian Solar Farm"
        projectLegalName="Meridian Solar Farm"
        totalValue={486000}
        status="Requested"
        currency="USD"
      />
    </MemoryRouter>
  </ImpersonationProvider>,
);

describe('Procurement review evidence', () => {
  it('keeps request, selected quote, and ordered amounts distinct while showing line evidence', () => {
    renderReview();

    const primary = formatShortMoney(486000, 'USD', { code: true });
    const amounts = screen.getByRole('region', { name: `Purchase amount · ${primary}` });
    expect(within(amounts).getByRole('heading', { name: `Purchase amount · ${primary}` })).toBeInTheDocument();
    expect(screen.getByText('Requested amount')).toBeInTheDocument();
    expect(screen.getByText('Selected quote amount')).toBeInTheDocument();
    expect(screen.getByText('Ordered amount')).toBeInTheDocument();
    expect(within(amounts).getByText(formatNumber(486000))).toBeInTheDocument();
    expect(within(amounts).getAllByText(formatNumber(478500))).toHaveLength(2);
    expect(screen.getByText('Desk')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requested items · USD' })).toBeInTheDocument();
    expect(screen.getByText(/2\s*×\s*100/)).toBeInTheDocument();
  });

  it('keeps the exact requested amount visible under the compact primary figure', () => {
    renderReview();
    const amounts = screen.getByRole('region', {
      name: `Purchase amount · ${formatShortMoney(486000, 'USD', { code: true })}`,
    });
    expect(within(amounts).getByText(formatNumber(486000))).toBeInTheDocument();
  });

  it('labels unknown selected and ordered amounts instead of formatting them as zero', () => {
    render(
      <ImpersonationProvider realRole="Project Manager">
        <MemoryRouter>
          <ProcurementOverviewTab
            requestAmount={486000}
            requestCurrency="USD"
            selectedQuote={{ amount: null, currency: 'USD' }}
            orderedAmount={{ amount: null, currency: 'USD' }}
            items={[]}
            projectId={null}
            projectName={null}
            totalValue={486000}
            status="Requested"
            currency="USD"
          />
        </MemoryRouter>
      </ImpersonationProvider>,
    );

    expect(screen.getAllByText('Not available')).toHaveLength(2);
  });

  it('shows project budget evidence only when a project is linked', () => {
    const { rerender } = renderReview();
    expect(screen.getByRole('heading', { name: /Budget impact/i })).toBeInTheDocument();

    rerender(
      <ImpersonationProvider realRole="Project Manager">
        <MemoryRouter>
          <ProcurementOverviewTab
            requestAmount={486000}
            requestCurrency="USD"
            selectedQuote={null}
            orderedAmount={null}
            items={[]}
            projectId={null}
            projectName={null}
            totalValue={486000}
            status="Requested"
            currency="USD"
          />
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    expect(screen.queryByRole('heading', { name: /Budget impact/i })).toBeNull();
  });
});
