/** AC-014 (#2709) — Administration › Built-in roles: one setting, off by default. The switch is an OrgSwitchSetting (#2746): toggle, refusal and Admin-only are AC-OSM-004/005. */
import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ data: false, refetch: vi.fn() }),
  useSetOrgSwitch: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
import OrgBuiltInRoles from './OrgBuiltInRoles';

it('AC-014 reads Off by default as a switch named Offer built-in roles', () => {
  render(<OrgBuiltInRoles />);
  expect(screen.getByRole('switch', { name: 'Offer built-in roles' })).toHaveAttribute('aria-checked', 'false');
});
