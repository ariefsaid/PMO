import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ on: false, can: true, set: vi.fn(async () => true) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.can }));
vi.mock('@/src/lib/db/procurementNeededBy', () => ({ getPoNeededByRequired: async () => h.on, setPoNeededByRequired: h.set }));
import OrgOrderNeededBy from './OrgOrderNeededBy';

beforeEach(() => { h.on = false; h.can = true; h.set.mockClear(); });
const renderIt = () => render(<QueryClientProvider client={new QueryClient()}><OrgOrderNeededBy /></QueryClientProvider>);

describe('OrgOrderNeededBy (1124d)', () => {
  it('AC-NBY-010 reads off by default and an Admin turns it on', async () => {
    renderIt();
    const box = await screen.findByRole('checkbox', { name: /Require a needed-by date/ });
    expect(box).not.toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(h.set).toHaveBeenCalledWith(true));
  });
  it('AC-NBY-010 a role that may not manage sees it read-only', async () => {
    h.can = false;
    renderIt();
    expect(await screen.findByRole('checkbox', { name: /Require a needed-by date/ })).toBeDisabled();
  });
});
