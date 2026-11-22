import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/** The crew loans card is one OrgSwitchSetting (#2746); toggle, refusal and read-only are AC-OSM-004/005. */
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ data: false, refetch: vi.fn() }),
  useSetOrgSwitch: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
import OrgCrewLoans from './OrgCrewLoans';

it('crew loans is off by default and shown as a switch', () => {
  render(<OrgCrewLoans />);
  expect(screen.getByRole('switch', { name: /Allow lending workers between crews/ })).toHaveAttribute('aria-checked', 'false');
});
