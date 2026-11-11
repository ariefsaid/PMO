import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useUserViews', () => ({ useUserViews: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { crm: false, procurement: true, timesheets: true, revenue: true }, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import { Rail } from '../Rail';

describe('Rail without CRM', () => {
  it('FIN-S9: a PM in an org without CRM still reaches vendors from the rail', () => {
    render(<MemoryRouter><Rail /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Companies' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Suppliers' })).toHaveAttribute('href', '/companies?type=Vendor');
  });
});
