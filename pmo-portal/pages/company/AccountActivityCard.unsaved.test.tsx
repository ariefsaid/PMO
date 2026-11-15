import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';

// #2080 — a half-written activity must survive an accidental click on another link.
const mut = { mutateAsync: vi.fn(), isPending: false };
vi.mock('@/src/hooks/useContacts', () => ({
  useContactsByCompany: () => ({ data: [{ id: 'ct1', full_name: 'Jane Doe' }], isPending: false, isError: false, refetch: vi.fn() }),
  useCompanyActivities: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn(), hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useContactMutations: () => ({ logActivity: mut, updateActivity: mut, deleteActivity: mut }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));

import { AccountActivityCard } from './AccountActivityCard';

const renderCard = () => render(
  <ToastProvider>
    <MemoryRouter initialEntries={['/companies/co1']}>
      <a href="/projects">Projects</a>
      <AccountActivityCard companyId="co1" />
    </MemoryRouter>
  </ToastProvider>,
);

describe('#2080 AccountActivityCard unsaved activity', () => {
  it('an untouched log form lets the user follow a link without a prompt', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('a typed note asks before leaving and Keep editing retains it', async () => {
    renderCard();
    await userEvent.type(screen.getByLabelText(/notes/i), 'Agreed the scope');
    await userEvent.click(screen.getByRole('link', { name: 'Projects' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Agreed the scope');
  });
});
