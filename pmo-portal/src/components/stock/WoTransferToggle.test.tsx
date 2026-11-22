import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => true }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({
  useOrgSwitch: () => ({ data: false, refetch: vi.fn() }),
  useSetOrgSwitch: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));

import { WoTransferToggle } from './WoTransferToggle';

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });

/** The switch behaviour (write, refusal, who may change it) is owned by OrgSwitchSetting (AC-OSM-004/005). */
describe('WoTransferToggle (AC-WOT-019)', () => {
  it('AC-WOT-019 renders the work-order transfers switch, off by default', () => {
    render(<WoTransferToggle />);
    expect(screen.getByRole('switch', { name: 'Work-order transfers' })).toHaveAttribute('aria-checked', 'false');
  });
});
