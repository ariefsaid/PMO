import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { ProjectMoneyScopeContext } from '@/src/hooks/useProjectMoneyScope';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: {id: 'pm', role: 'Project Manager'} }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => ({data: {projects: []}, refetch: vi.fn()}) }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-27' }));
vi.mock('@/src/hooks/useProjectTransitions', () => ({ useProjectWinEligibility: () => ({data: undefined}) }));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProjectStatusLabel: () => (s: string) => s }));
import { useDealActions } from './useDealActions';
import { DealFigures } from './DealParts';
function View() {
  const d = useDealActions({id: 'p1', status: 'Leads', contract_value: 100, currency: 'USD'} as ProjectWithRefs);
  return <DealFigures d={d} />;
}
it('keeps deal figures within the selected project money scope', () => {
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><ProjectMoneyScopeContext.Provider value={false}><View /></ProjectMoneyScopeContext.Provider></ToastProvider></QueryClientProvider>);
  expect(screen.queryByText('Value')).toBeNull();
});
