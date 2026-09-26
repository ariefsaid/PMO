import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ContextBar } from '../ContextBar';
import enCatalogue from '../../../../public/locales/en/common.json';
import idCatalogue from '../../../../public/locales/id/common.json';

let effectiveRole = 'Admin';
let canImpersonate = true;
const viewAs = vi.fn();
const signOut = vi.fn();
const onOpenPalette = vi.fn();
let displayName = 'Ada Lovelace';

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: 'Admin', canImpersonate, viewAs }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', full_name: displayName, org_id: 'org-1' },
    role: effectiveRole,
    signOut,
  }),
}));

// FR-AAN-038: the bell is gated behind `agentAssistant`, which defaults off in
// tests (VITE_FEATURES_AGENT_ASSISTANT unset — vite.config.ts test env). Most
// ContextBar tests exercise the flag-off state (its real default); the REC-3
// flag-on coverage lives in its own describe block below.
vi.mock('@/src/lib/features', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/features')>();
  return { ...real };
});
vi.mock('@/src/components/shell/NotificationBell', () => ({
  NotificationBell: () => <button type="button" aria-label="Notifications, 0 unread">Bell</button>,
}));

const breadcrumb = [{ label: 'Dashboard' }];

const renderBar = () =>
  render(
    <MemoryRouter>
      <ContextBar breadcrumb={breadcrumb} onOpenPalette={onOpenPalette} onToggleRail={vi.fn()} />
    </MemoryRouter>
  );

beforeEach(() => {
  displayName = 'Ada Lovelace';
  viewAs.mockClear();
  signOut.mockClear();
  onOpenPalette.mockClear();
  // Theme truth resets between tests (the DOM class is the source of truth).
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('theme');
});

describe('ContextBar', () => {
  it('renders the breadcrumb', () => {
    canImpersonate = true;
    renderBar();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('the ⌘K trigger advertises its shortcut and opens the palette', async () => {
    renderBar();
    const trigger = screen.getByRole('button', { name: /command palette/i });
    expect(trigger).toHaveAttribute('aria-keyshortcuts');
    await userEvent.click(trigger);
    expect(onOpenPalette).toHaveBeenCalled();
  });

  it('FR-AAN-038: the notification bell is absent while `agentAssistant` is off', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
  });

  it('the rail toggle (open navigation) is present', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument();
  });
});

// ── The unified account menu (AC-ACCT-001/002/003/004) ──────────────────────
// One responsive avatar/identity trigger owns the ONLY account popup at every width.
describe('ContextBar — unified account menu', () => {
  it('AC-ACCT-001: one account trigger opens one menu with identity, profile, theme and sign out', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    // Signed-in identity is shown in the popup header.
    expect(within(menu).getByText('Ada Lovelace')).toBeInTheDocument();
    // Profile & preferences links to the still-directly-routable profile page.
    const profile = screen.getByRole('menuitem', { name: /profile & preferences/i });
    expect(profile).toHaveAttribute('href', '/settings/profile');
    // Both theme choices with the current theme identified (light by default).
    const light = screen.getByRole('menuitemradio', { name: /^light$/i });
    const dark = screen.getByRole('menuitemradio', { name: /^dark$/i });
    expect(light).toHaveAttribute('aria-checked', 'true');
    expect(dark).toHaveAttribute('aria-checked', 'false');
    // Sign out is a separated command.
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('AC-ACCT-002: choosing Light→Dark applies + persists, and the selected state flips', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^dark$/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    // The menu stays open so the new selected state is announced/visible.
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /^dark$/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /^light$/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('AC-ACCT-002: choosing Dark→Light applies + persists, and the selected state flips', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^light$/i }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(screen.getByRole('menuitemradio', { name: /^light$/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /^dark$/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('AC-ACCT-004: an eligible sample Admin sees the View as role section and choices invoke viewAs', async () => {
    canImpersonate = true;
    effectiveRole = 'Admin';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByText('View as role')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Engineer' }));
    expect(viewAs).toHaveBeenCalledWith('Engineer');
  });

  it('AC-ACCT-004: role preview keeps the real identity visible and can return to Admin', async () => {
    canImpersonate = true;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /return to admin/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'Finance' })).toHaveAttribute('aria-checked', 'true');
    expect(within(menu).getByRole('menuitemradio', { name: 'Engineer' })).toHaveAttribute('aria-checked', 'false');
    expect(within(menu).getByText('Admin')).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: /return to admin/i }));
    expect(viewAs).toHaveBeenCalledWith(null);
  });

  it('FR-ACCT-006: arrow, Home, End and Tab keys navigate or leave the menu without trapping focus', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));

    const profile = screen.getByRole('menuitem', { name: /profile & preferences/i });
    const light = screen.getByRole('menuitemradio', { name: /^light$/i });
    const signOutItem = screen.getByRole('menuitem', { name: /sign out/i });
    expect(profile).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(light).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(profile).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(signOutItem).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(profile).toHaveFocus();
    await userEvent.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open navigation/i })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: /command palette/i })).toHaveFocus();
  });

  it('AC-ACCT-004: an ordinary Admin (or non-admin) sees NO View as role section or choices', async () => {
    canImpersonate = false;
    effectiveRole = 'Admin'; // displayed role stays Admin; only the affordance is gone
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.queryByText('View as role')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Engineer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Project Manager' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /return to admin/i })).not.toBeInTheDocument();
    // The denial is about the affordance only — sign out still works.
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('AC-ACCT-003: the account trigger is a native focusable button (native Tab/Enter path)', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveAttribute('type', 'button');
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('AC-ACCT-001: a long signed-in name is constrained within the header trigger', () => {
    displayName = 'A very long enterprise display name that must not force the header wider than the viewport';
    renderBar();
    const trigger = screen.getByRole('button', { name: /account menu/i });
    expect(trigger).toHaveClass('max-w-[220px]');
    expect(screen.getByText(displayName)).toHaveClass('truncate');
  });

  it('AC-ACCT-003: Escape closes the menu and restores focus to the trigger', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    const trigger = screen.getByRole('button', { name: /account menu/i });
    await userEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('AC-ACCT-003: an outside mouse-down closes the menu', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Click a top-bar control outside the account menu wrapper.
    await userEvent.click(screen.getByRole('button', { name: /command palette/i }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('AC-ACCT-003: signing out closes the menu and calls signOut exactly once', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('AC-ACCT-001: the personal-sign-out/theme no longer occupy separate top-bar slots', () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    // No standalone inline Sign-out, theme-toggle, or desktop/mobile placement duplicates.
    expect(screen.queryByTestId('desktop-account-cluster')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-account-menu')).not.toBeInTheDocument();
    // Exactly one account trigger.
    expect(screen.getAllByRole('button', { name: /account menu/i })).toHaveLength(1);
  });
});

// AC-ACCT-006 — the account-menu visible labels come from the SELECTED locale's catalogue,
// not the code's English-source fallback.
describe('ContextBar — catalogue-backed account-menu labels (AC-ACCT-006)', () => {
  async function renderLocalized(lng: 'en' | 'id') {
    canImpersonate = false;
    effectiveRole = 'Finance';
    const instance = i18next.createInstance();
    await instance.init({
      lng,
      fallbackLng: 'en',
      ns: 'common',
      defaultNS: 'common',
      resources: {
        en: { common: enCatalogue },
        id: { common: idCatalogue },
      },
      interpolation: { escapeValue: false },
    });
    render(
      <I18nextProvider i18n={instance}>
        <MemoryRouter>
          <ContextBar
            breadcrumb={breadcrumb}
            onOpenPalette={onOpenPalette}
            onToggleRail={vi.fn()}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /account menu|menu akun/i }));
  }

  it('English catalogue: Profile & preferences and Light/Dark labels render from the catalogue', async () => {
    await renderLocalized('en');
    expect(screen.getByRole('menuitem', { name: /profile & preferences/i })).toHaveAttribute(
      'href',
      '/settings/profile',
    );
    expect(screen.getByRole('menuitemradio', { name: /^light$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /^dark$/i })).toBeInTheDocument();
  });

  it('Bahasa catalogue: Profil & preferensi and Terang/Gelap labels render from the catalogue', async () => {
    await renderLocalized('id');
    expect(screen.getByRole('menuitem', { name: /profil & preferensi/i })).toHaveAttribute(
      'href',
      '/settings/profile',
    );
    expect(screen.getByRole('menuitemradio', { name: /^terang$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /^gelap$/i })).toBeInTheDocument();
  });
});

// REC-3/FR-AAN-034/038: with `agentAssistant` on, ContextBar mounts the real
// NotificationBell (its own component/query — no `notificationCount` prop).
describe('ContextBar — agentAssistant flag on (REC-3)', () => {
  it('mounts the NotificationBell with a real destination (no dead no-op affordance)', async () => {
    const features = await import('@/src/lib/features');
    vi.spyOn(features, 'isFeatureEnabled').mockImplementation((key) => key === 'agentAssistant');
    canImpersonate = false;
    renderBar();
    expect(screen.getByRole('button', { name: /notifications, 0 unread/i })).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
