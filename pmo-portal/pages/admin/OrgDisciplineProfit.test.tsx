/** AC-DPR-015 (#2669) — Administration: profit per discipline is one switch card (#2746); toggle, refusal and Admin-only are AC-OSM-004/005. */
import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.unmock('@/pages/admin/OrgDisciplineProfit'); // test/setup.ts stubs it for the Administration suites
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ data: false, refetch: vi.fn() }),
  useSetOrgSwitch: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
import OrgDisciplineProfit from './OrgDisciplineProfit';

it('AC-DPR-001 reads off by default as a switch named for what it shows', () => {
  render(<OrgDisciplineProfit />);
  expect(screen.getByRole('switch', { name: 'Show revenue next to cost per discipline' })).toHaveAttribute('aria-checked', 'false');
});
