import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

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
  it('AC-LEG-025: desktop cluster has ONE inline Help icon-link, correct attrs, NO Terms/Privacy', () => {
    renderBar();
    const cluster = screen.getByTestId('desktop-account-cluster');
    const help = within(cluster).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    // No Terms/Privacy on the desktop chrome (FR-LEG-028).
    expect(within(cluster).queryByRole('link', { name: /^terms$/i })).toBeNull();
    expect(within(cluster).queryByRole('link', { name: /^privacy$/i })).toBeNull();
    // Exactly one Help link in the desktop cluster.
    expect(within(cluster).getAllByRole('link', { name: /contact support via whatsapp/i })).toHaveLength(1);
  });

  it('AC-LEG-023: mobile account menu includes Terms, Privacy, Help', async () => {
    renderBar();
    const menu = screen.getByTestId('mobile-account-menu');
    // Menu closed initially — open via the avatar trigger.
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    // Mobile menu entries carry role="menuitem" (the accessible menu contract),
    // which supersedes the implicit `link`/`a` role — query by menuitem.
    expect(within(menu).getByRole('menuitem', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
    expect(within(menu).getByRole('menuitem', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    const help = within(menu).getByRole('menuitem', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
  });

  // AMENDMENT (plan review, mandatory): no vi.doMock/vi.resetModules — set the
  // hoisted mockConfig.HELP_URL = '' and re-render via the hoisted mock (the
  // legalConfig mock above reads mockConfig.HELP_URL live via a getter).
  it('AC-LEG-010/FR-LEG-028: desktop Help + mobile Help omitted when HELP_URL empty', async () => {
    mockConfig.HELP_URL = '';
    renderBar();
    expect(screen.queryByRole('link', { name: /contact support via whatsapp/i })).toBeNull();

    // Mobile menu also omits Help when empty.
    await userEvent.click(screen.getByRole('button', { name: /account menu/i }));
    const menu = screen.getByTestId('mobile-account-menu');
    expect(within(menu).queryByRole('menuitem', { name: /contact support via whatsapp/i })).toBeNull();
    // Terms/Privacy still present regardless of Help.
    expect(within(menu).getByRole('menuitem', { name: /^terms$/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /^privacy$/i })).toBeInTheDocument();
  });
});
