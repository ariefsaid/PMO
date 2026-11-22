/** AC-TX-007 (#2712): the Edit role picker shows an org's own role names; the saved value stays the key. */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoleFormModal } from './UserForms';
import { setOrgRoleNames } from '@/src/hooks/useOrgRoleNames';
import type { UserDirectoryRow } from '@/src/lib/db/adminUsers';

const person: UserDirectoryRow = {
  id: 'u1', full_name: 'Test Person', email: 't@example.com', role: 'Engineer', built_in_role: null,
  status: 'active', org_id: 'o1', manager_id: null, manager: null,
};

afterEach(() => act(() => setOrgRoleNames({})));

describe('Edit role shows the organisation\'s role names', () => {
  it('uses the override in the picker and still saves the key', async () => {
    act(() => setOrgRoleNames({ en: { storekeeper: 'Yard Lead' } }));
    const onSubmitBuiltIn = vi.fn();
    render(<RoleFormModal user={person} submitError={null} onClose={() => {}} onSubmit={vi.fn()} onSubmitBuiltIn={onSubmitBuiltIn} builtInEnabled />);
    const picker = screen.getByLabelText('Job role');
    expect(Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)).toContain('Yard Lead');
    expect(Array.from(picker.querySelectorAll('option')).map((o) => o.textContent)).not.toContain('Storekeeper');
    await userEvent.selectOptions(picker, 'storekeeper');
    await userEvent.click(screen.getByRole('button', { name: 'Save job role' }));
    expect(onSubmitBuiltIn).toHaveBeenCalledWith(person, 'storekeeper');
  });
  it('shows today\'s names with no override', () => {
    render(<RoleFormModal user={person} submitError={null} onClose={() => {}} onSubmit={vi.fn()} onSubmitBuiltIn={vi.fn()} builtInEnabled />);
    expect(Array.from(screen.getByLabelText('Job role').querySelectorAll('option')).map((o) => o.textContent)).toContain('Storekeeper');
  });
});
