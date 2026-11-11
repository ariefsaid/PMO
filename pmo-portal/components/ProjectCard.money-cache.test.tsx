import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ProjectCard from './ProjectCard';
import { useProjectsMoneyCollection } from '@/src/hooks/useProjectsMoneyCollection';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const { collection } = vi.hoisted(() => ({ collection: vi.fn() }));
vi.unmock('@/src/hooks/useProjectsMoneyCollection');
vi.mock('@/src/lib/repositories/projectMoney', () => ({ projectMoneyRepository: { collection } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1', role: 'Finance' } }) }));

const project = { id: 'p1', name: 'Project', status: 'Ongoing Project', currency: 'USD', contract_value: 2000,
  project_manager_id: null, client: null, tax_treatment: 'exclusive' } as unknown as ProjectWithRefs;
const data = { p1: { ledgerBasis: 'pmo', actuals: { currency: 'USD', total: '950', asOf: null, excludesRestrictedRows: false,
  complete: true, categories: [] }, activeBudgetAmount: '1000', activeBudgetCurrency: 'USD', hasActiveBudget: true } };

function CardWithQuery({ currentProject }: { currentProject: ProjectWithRefs }) {
  const money = useProjectsMoneyCollection([currentProject.id]);
  return <><button onClick={() => void money.refetch()}>Refresh</button><ProjectCard project={currentProject} onOpen={() => {}}
    projectMoney={money.data?.[currentProject.id]} moneyPending={money.isPending} moneyError={money.isError} /></>;
}

describe('card with collection cache', () => {
  it('withholds retained data after the project currency changes and after a failed refetch', async () => {
    collection.mockReset().mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('refresh failed'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (currentProject: ProjectWithRefs) => <QueryClientProvider client={client}><MemoryRouter><CardWithQuery currentProject={currentProject} /></MemoryRouter></QueryClientProvider>;
    const { rerender } = render(tree(project));
    await waitFor(() => expect(screen.getByTestId('project-card-actual')).toHaveTextContent('$950'));
    rerender(tree({ ...project, currency: 'EUR' }));
    expect(collection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('project-card-actual')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-money-unavailable')).toBeInTheDocument();
    rerender(tree(project));
    expect(screen.getByTestId('project-card-actual')).toHaveTextContent('$950');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('project-card-actual')).toBeEmptyDOMElement());
    expect(client.getQueryData(['projects-money', 'org-1', 'p1'])).toEqual(data);
    expect(screen.getByTestId('project-card-active-budget')).toBeEmptyDOMElement();
    expect(screen.getByTestId('project-card-money-unavailable')).toBeInTheDocument();
  });
});
