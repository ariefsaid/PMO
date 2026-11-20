import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { can } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';

const h = vi.hoisted(() => ({ role: 'Admin' as string }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => can(action as never, entity as never, { realRole: h.role as Role }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useCrews', () => ({ CREW_QUERY_ROOTS: ['crews'], useCrews: () => ({ data: [] }) }));
vi.mock('@/src/lib/repositories/crews', () => ({
  crewRepository: { list: vi.fn().mockResolvedValue([]), workerRefs: vi.fn().mockResolvedValue([]), allRoles: vi.fn().mockResolvedValue([]), allMembers: vi.fn().mockResolvedValue([]), create: vi.fn(), place: vi.fn() },
}));
import { CrewImports } from './CrewImports';

const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><CrewImports /></QueryClientProvider>);

describe('AC-CIM-011 the Crews import buttons', () => {
  it('shows both to a crew manager', () => {
    h.role = 'Project Manager';
    renderIt();
    expect(screen.getByRole('button', { name: /Import crews/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import crew members/ })).toBeInTheDocument();
  });
  it('shows neither to a role that only reads crews', () => {
    h.role = 'Engineer';
    renderIt();
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
  });
});
