import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/** The Admin switch for crew loans: off by default, only an Admin changes it, a change goes through the repository. */
const h = vi.hoisted(() => ({ admin: true, enabled: false, set: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.admin }));
vi.mock('@/src/lib/repositories/crews', () => ({
  crewLoanRepository: { enabled: () => Promise.resolve(h.enabled), setEnabled: (v: boolean) => h.set(v) },
}));
import OrgCrewLoans from './OrgCrewLoans';

const view = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OrgCrewLoans /></QueryClientProvider>);

describe('crew loans setting', () => {
  beforeEach(() => { h.admin = true; h.enabled = false; h.set.mockClear(); });

  it('is off by default and an Admin turns it on', async () => {
    const user = userEvent.setup();
    view();
    const sw = await screen.findByRole('switch', { name: /Allow lending workers between crews/ });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    await waitFor(() => expect(h.set).toHaveBeenCalledWith(true));
  });

  it('is read-only for anyone but an Admin', async () => {
    h.admin = false;
    view();
    const sw = await screen.findByRole('switch', { name: /Allow lending workers between crews/ });
    expect(sw).toBeDisabled();
    expect(screen.getByText('Only an Admin can change this.')).toBeInTheDocument();
  });
});
