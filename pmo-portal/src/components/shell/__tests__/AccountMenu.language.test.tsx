import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

const h = vi.hoisted(() => ({
  write: vi.fn(async () => undefined),
  refresh: vi.fn(async () => ({ error: null })),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: {
      id: 'u-1',
      full_name: 'Portal User',
      org_id: 'org-1',
      locale: 'en',
      number_locale: 'id-ID',
      timezone: 'Asia/Jakarta',
    },
    signOut: vi.fn(),
    refreshCurrentUser: h.refresh,
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin', canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/lib/repositories/profilePreferences', () => ({
  profilePreferencesRepository: { setLocalePreferences: h.write },
}));

import { AccountMenu } from '../AccountMenu';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('Account menu language switch', () => {
  beforeEach(() => {
    h.write.mockClear();
    h.refresh.mockClear();
  });

  it('saves the selected language, preserves number/timezone settings, and keeps the current route', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/projects?view=kanban']}>
        <AccountMenu />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Bahasa Indonesia' }));

    await waitFor(() => expect(h.write).toHaveBeenCalledWith('u-1', {
      locale: 'id',
      numberLocale: 'id-ID',
      timezone: 'Asia/Jakarta',
    }));
    expect(h.refresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?view=kanban');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
