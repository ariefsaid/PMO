/** AC-014/AC-015 (#2709) — Edit role: unchanged while the setting is off; a grouped role picker once on. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleFormModal } from './UserForms';
import type { UserDirectoryRow } from '@/src/lib/db/adminUsers';

const person: UserDirectoryRow = {
  id: 'u1', full_name: 'Test Person', email: 't@example.com', role: 'Engineer', built_in_role: null,
  status: 'active', org_id: 'o1', manager_id: null, manager: null,
};

const mount = (props: Partial<React.ComponentProps<typeof RoleFormModal>> = {}) => {
  const onSubmit = vi.fn();
  const onSubmitBuiltIn = vi.fn();
  render(<RoleFormModal user={person} submitError={null} onClose={() => {}} onSubmit={onSubmit} onSubmitBuiltIn={onSubmitBuiltIn} {...props} />);
  return { onSubmit, onSubmitBuiltIn };
};

describe('Edit role with built-in roles', () => {
  it('AC-014 setting off: no picker, the access level select saves as before', async () => {
    const { onSubmit, onSubmitBuiltIn } = mount();
    const user = userEvent.setup();
    expect(screen.queryByLabelText('Built-in role')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Role/), 'Finance');
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    expect(onSubmit).toHaveBeenCalledWith(person, 'Finance');
    expect(onSubmitBuiltIn).not.toHaveBeenCalled();
  });

  it('AC-015 setting on: the 28 roles are offered by level, and choosing one shows its access level read-only', async () => {
    const { onSubmit, onSubmitBuiltIn } = mount({ builtInEnabled: true });
    const user = userEvent.setup();
    const picker = screen.getByLabelText('Built-in role');
    const options = Array.from(picker.querySelectorAll('option'));
    expect(options.filter((o) => !o.disabled && o.value !== '')).toHaveLength(28);
    expect(options.filter((o) => o.disabled).map((o) => o.textContent)).toEqual(['Managers', 'Officers', 'Field']);
    await user.selectOptions(picker, 'billing_officer');
    expect(screen.getByText('Access level: Finance (set by the built-in role)')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Role/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    expect(onSubmitBuiltIn).toHaveBeenCalledWith(person, 'billing_officer');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('AC-015 a held role can be cleared', async () => {
    const { onSubmitBuiltIn } = mount({ builtInEnabled: true, user: { ...person, built_in_role: 'planner' } });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Built-in role'), '');
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    expect(onSubmitBuiltIn).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), null);
  });
});
