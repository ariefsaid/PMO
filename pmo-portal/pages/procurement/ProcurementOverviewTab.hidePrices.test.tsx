/** AC-009 (#2699) — the overview tab has no budget-impact panel (a price figure) for a person who may not see prices. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { ProcurementOverviewTab } from './ProcurementOverviewTab';

vi.mock('@/src/components/procurement/DecisionSupportPanel', () => ({ DecisionSupportPanel: () => <div data-testid="decision-support" /> }));

const renderTab = () => render(<MemoryRouter><ProcurementOverviewTab tiles={[]} detailRows={[{ label: 'Project', value: 'Site' }]} events={[]}
  projectId="proj-1" projectName="Site" totalValue={1000} status="Requested" currency="USD" /></MemoryRouter>);
afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 overview tab without prices', () => {
  it('shows the budget signal while prices are visible', () => {
    renderTab();
    expect(screen.getByTestId('decision-support')).toBeInTheDocument();
  });
  it('drops the budget signal when the server hides prices and keeps the detail rows', () => {
    act(() => setPricesHidden(true));
    renderTab();
    expect(screen.queryByTestId('decision-support')).toBeNull();
    expect(screen.getByText('Site', { selector: 'dd' })).toBeInTheDocument();
  });
});
