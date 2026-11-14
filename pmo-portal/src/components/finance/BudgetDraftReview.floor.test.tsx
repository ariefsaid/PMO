import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({
  listOrgDrafts: vi.fn(),
  getActivationMode: vi.fn(),
  precheckActivation: vi.fn(),
  activateVersion: vi.fn(),
  getDistribution: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { budget: h } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1', role: 'Finance' } }) }));

import { BudgetDraftReview } from './BudgetDraftReview';

const draft = {
  id: 'a',
  projectId: 'p-a',
  projectCode: 'PRJ-a',
  projectName: 'Project a',
  currency: 'IDR',
  version: 1,
  name: 'Imported',
  total: 1000,
  createdBy: 'u9',
  editorIds: ['u9'],
  documentUrl: 'https://sp.example/a.xlsx',
  budgetMode: 'per_year',
  projectStart: null,
  projectEnd: null,
  lines: [],
};
const ready = { status: 'ready', erpCheck: 'available', fiscalYearNames: null, fiscalYears: null, issues: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.listOrgDrafts.mockResolvedValue([draft]);
  h.getActivationMode.mockResolvedValue('allowed');
  h.precheckActivation.mockResolvedValue(ready);
  h.activateVersion.mockResolvedValue({ pushState: 'pushed' });
  h.getDistribution.mockResolvedValue(null);
});
afterEach(cleanup);

it('floor: Open source document follows the linked budget source', async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Finance"><BudgetDraftReview /></ImpersonationProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Review 1 draft' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: /Select PRJ-a Project a/ })).not.toBeDisabled());

  const open = screen.getByRole('link', { name: 'Open' });
  expect(fireEvent.click(open)).toBe(true);
  expect(open).toHaveAttribute('href', 'https://sp.example/a.xlsx');
  expect(open).toHaveAttribute('target', '_blank');
});
