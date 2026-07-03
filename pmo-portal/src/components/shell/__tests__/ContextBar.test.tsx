import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ContextBar } from '../ContextBar';

let effectiveRole = 'Admin';
let canImpersonate = true;
const viewAs = vi.fn();
const signOut = vi.fn();
const onOpenPalette = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole, realRole: 'Admin', canImpersonate, viewAs }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u1', full_name: 'Ada Lovelace', org_id: 'org-1' },
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
  viewAs.mockClear();
  signOut.mockClear();
  onOpenPalette.mockClear();
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
    // The flag defaults off in tests (vite.config.ts test env has no
    // VITE_FEATURES_AGENT_ASSISTANT) — this is the real default state.
    renderBar();
    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
  });

  it('Admin sees the view-as role control wired to viewAs (view-only)', async () => {
    effectiveRole = 'Admin';
    canImpersonate = true;
    renderBar();
    const roleBtn = screen.getByRole('button', { name: /view as role/i });
    await userEvent.click(roleBtn);
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Engineer' }));
    expect(viewAs).toHaveBeenCalledWith('Engineer');
  });

  it('non-admin does NOT see the view-as control', () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    expect(screen.queryByRole('button', { name: /view as role/i })).not.toBeInTheDocument();
  });

  it('sign-out calls signOut', async () => {
    canImpersonate = false;
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  // A-IMP-1: Sign-out button must carry touch-target class for ≥44px hit area on coarse pointers.
  it('A-IMP-1: sign-out button has .touch-target for WCAG 2.5.5 hit area', () => {
    canImpersonate = false;
    renderBar();
    const signOutBtn = screen.getByRole('button', { name: /sign out/i });
    expect(signOutBtn.className).toContain('touch-target');
  });

  // A-IMP-1: hamburger already carries touch-target (regression guard).
  it('A-IMP-1: hamburger (open nav) button has .touch-target', () => {
    renderBar();
    const hamburger = screen.getByRole('button', { name: /open navigation/i });
    expect(hamburger.className).toContain('touch-target');
  });

  // A-IMP-1: ⌘K trigger already carries touch-target (regression guard).
  it('A-IMP-1: command palette trigger has .touch-target', () => {
    renderBar();
    const trigger = screen.getByRole('button', { name: /command palette/i });
    expect(trigger.className).toContain('touch-target');
  });

  // AC-MOBILE-OVERFLOW-001 (header): on phones the role-switcher + Sign out collapse
  // behind an avatar "Account menu" so the desktop cluster doesn't squash the breadcrumb
  // to "Da…". The desktop cluster is CSS-hidden (`hidden sm:flex`); the mobile menu is
  // `sm:hidden`. Both live in the DOM (jsdom ignores the breakpoint), so we assert the
  // menu's behavior directly.
  it('the mobile account menu holds the role-switcher for admins', async () => {
    effectiveRole = 'Admin';
    canImpersonate = true;
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Engineer' }));
    expect(viewAs).toHaveBeenCalledWith('Engineer');
  });

  it('the mobile account menu signs out (and omits role-switch for non-admins)', async () => {
    canImpersonate = false;
    effectiveRole = 'Finance';
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.queryByRole('menuitem', { name: 'Engineer' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });

  it('the desktop right-cluster is breakpoint-gated (hidden sm:flex) so it never squashes the breadcrumb on phones', () => {
    canImpersonate = true;
    effectiveRole = 'Admin';
    const { container } = renderBar();
    // The cluster wrapper holds the desktop role-switcher + user chip + Sign out.
    const desktopSignOut = screen.getByRole('button', { name: /sign out/i });
    const wrapper = desktopSignOut.closest('div.hidden');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain('sm:flex');
    // And the mobile avatar trigger is the sm:hidden counterpart.
    const acct = screen.getByRole('button', { name: /account menu/i });
    expect(acct.closest('div')!.className).toContain('sm:hidden');
    expect(container).toBeTruthy();
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
