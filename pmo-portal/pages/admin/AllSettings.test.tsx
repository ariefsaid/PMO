import React from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BahasaProvider } from '@/test/bahasa';
import { ORG_SETTINGS, orgSettingKeys, ORG_SETTING_GROUPS } from '@/src/lib/orgSettingsCatalogue';

/** #2746 AC-OSM-033: the page lists every catalogue setting by job group, shows on/off where a read exists, and links to where it is changed. */
const h = vi.hoisted(() => ({ canView: true, switches: {} as Record<string, boolean | undefined>, leave: undefined as unknown }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canView }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: (key: string) => ({ data: h.switches[key] }) }));
vi.mock('./allSettingsStatus', () => ({ STATUS_HOOKS: { leaveRequests: () => h.leave } }));
import AllSettings from './AllSettings';

const view = (ui: React.ReactNode = <AllSettings />) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AllSettings (AC-OSM-033)', () => {
  beforeEach(() => { h.canView = true; h.switches = {}; h.leave = undefined; });

  it('lists every setting once, in its job group, each linking to where it is changed', () => {
    view();
    for (const group of ORG_SETTING_GROUPS) expect(screen.getAllByRole('heading', { level: 2 }).some((el) => el.id === `all-settings-${group}`)).toBe(true);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(orgSettingKeys.length);
    for (const key of orgSettingKeys) expect(links.some((a) => a.getAttribute('href') === ORG_SETTINGS[key].route)).toBe(true);
  });

  it('shows On or Off for a switch read through the module, and nothing while it is unread', () => {
    h.switches = { crewLoans: true, clearance: false };
    view();
    const row = (name: string) => screen.getByRole('link', { name }).closest('li') as HTMLElement;
    expect(within(row('Crew loans')).getByText('On')).toBeInTheDocument();
    expect(within(row('Cleared-for-site checklist')).getByText('Off')).toBeInTheDocument();
    expect(within(row('Daily safety records')).queryByText(/^(On|Off)$/)).toBeNull();
  });

  it('reads a setting that is not on the module through its own hook', () => {
    h.leave = true;
    view();
    expect(within(screen.getByRole('link', { name: 'Leave requests' }).closest('li') as HTMLElement).getByText('On')).toBeInTheDocument();
  });

  it('says who can change each setting', () => {
    view();
    expect(within(screen.getByRole('link', { name: 'Labour cost' }).closest('li') as HTMLElement).getByText('Admin, Finance')).toBeInTheDocument();
  });

  it('shows a person without access a notice and no settings', () => {
    h.canView = false;
    view();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText(/You don't have access/)).toBeInTheDocument();
  });

  it('reads in Bahasa Indonesia', () => {
    render(<BahasaProvider><MemoryRouter><AllSettings /></MemoryRouter></BahasaProvider>);
    expect(screen.getByRole('heading', { name: 'Semua pengaturan' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pinjaman kru' })).toHaveAttribute('href', ORG_SETTINGS.crewLoans.route);
    expect(screen.getByRole('heading', { name: 'Pembelian' })).toBeInTheDocument();
  });
});
