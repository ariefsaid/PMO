import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

// Mutable config so the "Help omitted when empty" leg can flip HELP_URL without
// vi.doMock/vi.resetModules (AMENDMENT, plan review) — the mock object below
// reads mockConfig.HELP_URL live on every ContextBar render.
const mockConfig = vi.hoisted(() => ({ HELP_URL: 'https://wa.me/6281234567890' }));
vi.mock('@/src/lib/legalConfig', () => ({
  get HELP_URL() {
    return mockConfig.HELP_URL;
  },
  HELP_WHATSAPP: '6281234567890',
}));

const mockAuth = vi.hoisted(() => ({
  currentUser: { full_name: 'Test User' },
  signOut: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => mockAuth }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Engineer', canImpersonate: false, viewAs: () => {} }),
}));

// NotificationBell is feature-gated off so it doesn't render.
vi.mock('@/src/lib/features', () => ({ isFeatureEnabled: () => false }));

import { ContextBar } from '@/src/components/shell/ContextBar';

function renderBar() {
  return render(
    <MemoryRouter>
      <ContextBar breadcrumb={[]} onOpenPalette={() => {}} onToggleRail={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockConfig.HELP_URL = 'https://wa.me/6281234567890';
});

describe('ContextBar legal entry points', () => {
  it('AC-LEG-025: the ONE account menu exposes Terms, Privacy and Help with correct attrs', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(menu).getByRole('menuitem', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(menu).getByRole('menuitem', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('AC-LEG-023: the shared account menu includes Terms, Privacy, Help as menuitems', async () => {
    renderBar();
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(menu).getByRole('menuitem', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(menu).getByRole('menuitem', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
  });

  it('AC-LEG-010/FR-LEG-028: Help is omitted when HELP_URL empty, Terms/Privacy remain', async () => {
    mockConfig.HELP_URL = '';
    renderBar();
    expect(screen.queryByRole('link', { name: /contact support via whatsapp/i })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: /contact support via whatsapp/i })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /^terms$/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^privacy$/i })).toBeInTheDocument();
  });
});