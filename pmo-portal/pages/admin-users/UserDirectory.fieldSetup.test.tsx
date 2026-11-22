import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

/** fix/walk-people item 7: a Foreman or Field user with no linked person, or a linked person in no crew, is flagged with the one action. */
const h = vi.hoisted(() => ({
  people: [] as Array<{ id: string; profile_id: string | null }>,
  placements: [] as Array<{ worker_id: string; valid_from: string; valid_to: string | null }>,
}));
vi.mock('@/src/hooks/useBuiltInRoles', () => ({ useBuiltInRoleMutation: () => ({}) }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: true }) }));
vi.mock('@/src/hooks/usePeople', () => ({ usePeople: () => ({ data: h.people }) }));
vi.mock('@/src/hooks/useCrews', () => ({ useAllCrewMembers: () => ({ data: h.placements }) }));
vi.mock('@/src/hooks/useOrgRoleNames', () => ({ useBuiltInRoleName: () => (k: string) => k }));

import { UserDirectory } from './UserDirectory';

const user = (id: string, key: string | null) => ({ id, full_name: `User ${id}`, email: `${id}@example.com`, role: 'Engineer', built_in_role: key, status: 'active', manager_id: null, manager: null });
const props = (rows: unknown[]) => ({
  rows, total: rows.length, page: 1, pageSize: 25, search: '', onSearchChange: vi.fn(), onPageChange: vi.fn(), state: undefined, onRetry: vi.fn(),
  canManage: true, canDisable: true, currentUserId: 'admin', isSoleAdmin: () => false, isAdminStateUnknown: () => false, focus: null, onJumpToUser: vi.fn(),
  onEditRole: vi.fn(), onChangeManager: vi.fn(), onSetStatus: vi.fn(),
});

describe('field-role setup flags in the Users directory', () => {
  it('flags an unlinked Foreman and a linked Field user with no crew, each with its action, and nobody else', () => {
    h.people = [{ id: 'p2', profile_id: 'u2' }, { id: 'p3', profile_id: 'u3' }];
    h.placements = [{ worker_id: 'p3', valid_from: '2000-01-01', valid_to: null }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MemoryRouter><UserDirectory {...(props([user('u1', 'foreman'), user('u2', 'field_user'), user('u3', 'foreman'), user('u4', 'storekeeper')]) as any)} /></MemoryRouter>);
    expect(screen.getByTestId('setup-gap-u1')).toHaveTextContent('Login not linked to a person');
    expect(screen.getByRole('link', { name: 'Link them to a person' })).toHaveAttribute('href', '/administration/people');
    expect(screen.getByTestId('setup-gap-u2')).toHaveTextContent('Not in any crew');
    expect(screen.getByRole('link', { name: 'Add them to a crew' })).toHaveAttribute('href', '/crews');
    expect(screen.queryByTestId('setup-gap-u3')).toBeNull();
    expect(screen.queryByTestId('setup-gap-u4')).toBeNull();
  });
});
