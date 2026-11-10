import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Administration from './Administration';

const pendingUsersPanel = vi.hoisted(() => new Promise<Record<string, never>>(() => {}));

vi.mock('./admin-panels/UsersPanel', () => pendingUsersPanel);
vi.mock('./AdminUsers', async () => {
  const ReactModule = await import('react');
  return { default: () => ReactModule.createElement('div', { 'data-testid': 'admin-users-loaded' }) };
});
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-test' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/auth/useIsOperator', () => ({ useOperatorMembership: () => ({ isOperator: false, isPending: false, isError: false, retry: vi.fn() }) }));

describe('Administration selected panel loading', () => {
  it('keeps the Administration navigation available while the selected panel chunk is pending', async () => {
    render(
      <MemoryRouter initialEntries={['/administration/users']}>
        <Administration />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Administration sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('admin-users-loaded')).not.toBeInTheDocument();
  });
});
