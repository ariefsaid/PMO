import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({ role: 'Finance' as string, bind: { mutateAsync: vi.fn(), isPending: false } }));
vi.mock('@/src/hooks/useImprest', () => ({ useSetCashAccount: () => h.bind }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { CashAccountSection } from './CashAccountSection';

const renderIt = (account: string | null = null) => render(<ToastProvider><CashAccountSection floatId="f1" account={account} /></ToastProvider>);
const bindWith = async (user: ReturnType<typeof userEvent.setup>, value = 'Site Cash - X') => {
  await user.type(screen.getByLabelText('ERP cash account name'), value);
  await user.click(screen.getByRole('button', { name: 'Set account' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Set account' }));
};

describe('#1515 S6 cash account', () => {
  beforeEach(() => { h.role = 'Finance'; h.bind = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }; });

  it('a bound account is shown read-only, with no way to change it', () => {
    renderIt('Site Cash - X');
    expect(screen.getByText('Site Cash - X')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set account' })).toBeNull();
  });

  it('Finance and Admin bind an unset account after a confirm', async () => {
    const user = userEvent.setup();
    renderIt();
    await bindWith(user);
    await waitFor(() => expect(h.bind.mutateAsync).toHaveBeenCalledWith({ floatId: 'f1', account: 'Site Cash - X' }));
  });

  it('nothing is sent until the confirm, and an empty name cannot be submitted', async () => {
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByRole('button', { name: 'Set account' })).toBeDisabled();
    await user.type(screen.getByLabelText('ERP cash account name'), 'A');
    await user.click(screen.getByRole('button', { name: 'Set account' }));
    expect(h.bind.mutateAsync).not.toHaveBeenCalled();
  });

  it.each(['PM', 'Engineer', 'Executive'])('a %s sees the unset state but no form (the can() gate)', (role) => {
    h.role = role;
    renderIt();
    expect(screen.getByText(/not posted to the ERP/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set account' })).toBeNull();
  });

  it.each([
    ['imprest-cash-account-locked', 'The cash account is already set or the float has moved cash', "This float's cash account can't be changed"],
    ['imprest-cash-account-taken', 'That account is already used by another float of this organization', 'That account belongs to another float'],
    ['imprest-cash-account-unfit', 'That account is not a cash account of the connected company', "That isn't a usable cash account"],
  ])('%s is refused with a plain message', async (code, message, headline) => {
    const user = userEvent.setup();
    h.bind.mutateAsync.mockRejectedValue(new AppError(message, code));
    renderIt();
    await bindWith(user);
    expect(await screen.findByText(headline)).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('ERP cash account name')).toBeInTheDocument(); // still unbound
  });
});
