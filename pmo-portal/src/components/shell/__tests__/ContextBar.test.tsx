import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const breadcrumb = [{ label: 'Dashboard' }];

const renderBar = () =>
  render(
    <ContextBar breadcrumb={breadcrumb} onOpenPalette={onOpenPalette} onToggleRail={vi.fn()} />
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

  it('B-5 (AC-W2-IXD-008): the notification bell is removed — no dead no-op affordance', () => {
    // OD-W2-5: the bell had no handler (no known destination — dead, not "coming soon").
    // Removed rather than disabled-with-tooltip because there is no known future destination.
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
});
