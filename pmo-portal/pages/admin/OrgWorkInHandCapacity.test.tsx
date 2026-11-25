import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/**
 * M8 — Admin monthly work capacity setting (AC-M8-004). Empty (null) is a valid default;
 * only an Admin sees and edits the control (database enforces via policy + column grant).
 */
const h = vi.hoisted(() => ({
  canManage: true,
  capacity: 2500000 as number | null,
  currency: 'IDR',
  mutateAsync: vi.fn(),
}));

vi.mock('@/src/hooks/useWorkInHand', () => ({
  useWorkInHandCapacity: () => ({ data: h.capacity, isSuccess: true, isError: false, refetch: vi.fn() }),
  useSetWorkInHandCapacity: () => ({ mutateAsync: h.mutateAsync, isPending: false }),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => h.currency }));

import OrgWorkInHandCapacity from './OrgWorkInHandCapacity';

const renderPanel = () => render(<ToastProvider><OrgWorkInHandCapacity /></ToastProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  h.canManage = true;
  h.capacity = 2500000;
  h.currency = 'IDR';
  h.mutateAsync.mockResolvedValue(undefined);
});

describe('monthly work capacity setting (M8)', () => {
  it('AC-M8-004 shows the saved capacity in org currency and saves a new value', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Monthly capacity (IDR)');
    expect(field).toHaveValue('2500000');
    await user.clear(field);
    await user.type(field, '3000000');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).toHaveBeenCalledWith(3000000);
  });

  it('AC-M8-004 shows the sensible empty state when unset and hides Clear capacity', () => {
    h.capacity = null;
    renderPanel();
    expect(screen.getByLabelText('Monthly capacity (IDR)')).toHaveValue('');
    expect(screen.getByText('Not set: months of work in hand is not calculated until a monthly capacity is entered.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear capacity' })).toBeNull();
  });

  it('AC-M8-004 clears monthly capacity back to null', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Clear capacity' }));
    expect(h.mutateAsync).toHaveBeenCalledWith(null);
  });

  it('refuses zero, negative, or more than two decimals without writing', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Monthly capacity (IDR)');
    await user.clear(field);
    await user.type(field, '0');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Monthly capacity must be greater than zero.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '10.123');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Give monthly capacity at most two decimals.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '2,500,000');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a valid amount.')).toBeInTheDocument();
  });

  it('accepts valid two-decimal values including 0.29 and 1000.29', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = screen.getByLabelText('Monthly capacity (IDR)');

    await user.clear(field);
    await user.type(field, '0.29');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).toHaveBeenLastCalledWith(0.29);

    await user.clear(field);
    await user.type(field, '1000.29');
    await user.click(screen.getByRole('button', { name: 'Save capacity' }));
    expect(h.mutateAsync).toHaveBeenLastCalledWith(1000.29);
  });

  it('shows nothing to anyone who may not manage monthly capacity', () => {
    h.canManage = false;
    renderPanel();
    expect(screen.queryByText('Monthly work capacity')).toBeNull();
  });
});
