import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteFormModal } from './UserForms';

/** Fix/walk-people item 3: the invite dialog asks the job role (built-in role) when the set is on, and the access level follows. */
const mount = (builtInEnabled: boolean) => {
  const onSubmit = vi.fn();
  render(<InviteFormModal isOperator={false} loading={false} submitError={null} onClose={() => {}} onSubmit={onSubmit} builtInEnabled={builtInEnabled} />);
  return onSubmit;
};

describe('Invite with a job role', () => {
  it('asks the job role, searchable, and sends the access level the role starts from', async () => {
    const onSubmit = mount(true);
    const user = userEvent.setup();
    expect(screen.queryByLabelText(/^Access level/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Email/), 'new@example.com');
    await user.click(screen.getByRole('combobox', { name: /Job role/ }));
    await user.type(screen.getByPlaceholderText('Search job roles'), 'store');
    await user.click(await screen.findByRole('option', { name: /Storekeeper/ }));
    expect(screen.getByText('Access level: Engineer (set by the job role)')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite user' }));
    expect(onSubmit).toHaveBeenCalledWith('new@example.com', 'Engineer', null, 'storekeeper');
  });

  it('will not send without a job role', async () => {
    const onSubmit = mount(true);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'new@example.com');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite user' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Choose the job role.')).length).toBeGreaterThan(0);
  });

  it('with the set off, asks the access level as before', async () => {
    const onSubmit = mount(false);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'new@example.com');
    await user.selectOptions(screen.getByLabelText(/^Access level/), 'Finance');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite user' }));
    expect(onSubmit).toHaveBeenCalledWith('new@example.com', 'Finance', null, null);
  });
});
