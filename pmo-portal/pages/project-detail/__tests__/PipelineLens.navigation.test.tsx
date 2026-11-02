import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { createListReturnContext, LIST_RETURN_CONTEXT_KEY, LIST_SCROLL_RESTORE_STATE_KEY } from '@/src/lib/listReturnContext';

vi.mock('@/src/hooks/useProjectStageEntries', () => ({
  useProjectStageEntries: () => ({ data: [], isLoading: false, error: null }),
  useStageEntryMutations: () => ({ redate: { mutateAsync: vi.fn() }, addSkipped: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({
    data: {
      stages: [],
      projects: [{ id: 'd1', name: 'Acme Tender Bid', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5 }],
    },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});
// PipelineLens composes the win-eligibility preflight (3700397d9); this wayfinding test stubs it
// like the other lens suites, keeping the harness free of a QueryClient.
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => ({ data: 'allowed' }) }));

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1200000,
  currency: 'USD',
  budget: 0,
  spent: 0,
  decided_at: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const LocationObserver = () => {
  const location = useLocation();
  return (
    <div data-testid="location-observer">
      <span data-testid="loc-pathname">{location.pathname}</span>
      <span data-testid="loc-search">{location.search}</span>
      <span data-testid="loc-state">{JSON.stringify(location.state)}</span>
    </div>
  );
};

describe('PipelineLens SPA wayfinding navigation (Split 4)', () => {
  it('navigates via React Router Link to listReturnNavigation path and restores working-set state', async () => {
    const salesContext = createListReturnContext('sales', '/sales?view=table&classification=Tier1', 250);
    const initialLocationState = {
      [LIST_RETURN_CONTEXT_KEY]: salesContext,
      workingSet: 'Tier1',
    };

    render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/d1', state: initialLocationState }]}>
        <ImpersonationProvider realRole="Project Manager">
          <ToastProvider>
            <PipelineLens project={dealRow} locationState={initialLocationState} />
            <LocationObserver />
          </ToastProvider>
        </ImpersonationProvider>
      </MemoryRouter>
    );

    const backLink = screen.getByRole('link', { name: /Back to Sales Pipeline/i });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute('href', '/sales?view=table&classification=Tier1');

    const user = userEvent.setup();
    await user.click(backLink);

    // In a SPA, clicking the Link must transition the MemoryRouter location and preserve state
    expect(screen.getByTestId('loc-pathname')).toHaveTextContent('/sales');
    expect(screen.getByTestId('loc-search')).toHaveTextContent('?view=table&classification=Tier1');

    const stateText = screen.getByTestId('loc-state').textContent ?? '';
    const parsedState = JSON.parse(stateText);
    expect(parsedState.workingSet).toBe('Tier1');
    expect(parsedState[LIST_SCROLL_RESTORE_STATE_KEY]).toBeDefined();
    expect(parsedState[LIST_SCROLL_RESTORE_STATE_KEY].scrollTop).toBe(250);
  });
});
