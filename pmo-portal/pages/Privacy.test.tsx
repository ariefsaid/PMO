import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// HOSTING_LOCATION mocked to 'Singapore' so AC-LEG-015 reads naturally.
const mockConfig = vi.hoisted(() => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Singapore',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/lib/legalConfig', () => mockConfig);

const mockAuth = vi.hoisted(() => ({ session: null as object | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: mockAuth.session }) }));

import Privacy from './Privacy';

function renderPrivacy() {
  return render(
    <MemoryRouter>
      <Privacy />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.session = null;
});

describe('Privacy page', () => {
  it('AC-LEG-002: renders the bare Privacy page — title present, no AppShell chrome', () => {
    renderPrivacy();
    expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('AC-LEG-013 / AC-LEG-027: one h1 + all 9 section headings as h2 (+ h2 heading token)', () => {
    renderPrivacy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    const h2Texts = h2s.map((h) => h.textContent ?? '');
    [
      'Data We Collect', 'Data Ownership', 'How We Use Your Data', 'AI Processing Disclosure',
      'Data Location', 'Data Export', 'Data Retention and Deletion', 'Confidentiality and Security',
      'Contact Us',
    ].forEach((t) => expect(h2Texts).toContain(t));

    // AMENDMENT (plan review): the h2 heading token class (20/700/-0.01em, DESIGN.md §3).
    h2s.forEach((h2) => expect(h2.className).toMatch(/text-\[20px\]/));
  });

  it('AC-LEG-007: renders config entity/domain/contact email/hosting location; no brackets', () => {
    renderPrivacy();
    expect(screen.getAllByText(/Acme Legal Test Co/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Singapore/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\[(LEGAL-ENTITY|DOMAIN|CONTACT_EMAIL|HOSTING)\]/);
  });

  it('AC-LEG-014: Data Ownership affirms client ownership + limited license', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Ownership/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/own/i);
    expect(text).toMatch(/license (necessary|needed) to operate/i);
  });

  it('AC-LEG-015: Data Location states the hosting location (Singapore)', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Location/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(section.textContent ?? '').toMatch(/Singapore/);
  });

  it('AC-LEG-016: Data Export — CSV/XLSX anytime + full export within 30 days on termination', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Export/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/CSV|XLSX/i);
    expect(text).toMatch(/30 days/i);
  });

  it('AC-LEG-017: Data Retention and Deletion — deleted within 60–90 days', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Retention and Deletion/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(section.textContent ?? '').toMatch(/60.?90 days/i);
  });

  it('AC-LEG-018: AI Processing Disclosure matches MSA brief §4 (OpenRouter, no training, no staff reading)', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /AI Processing Disclosure/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/OpenRouter|third-party LLM/i);
    expect(text).toMatch(/not.*train/i);
    expect(text).toMatch(/do not read|aggregates only/i);
  });

  it('AC-LEG-019: Confidentiality and Security — mutual confidentiality, daily backups, per-client isolation', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Confidentiality and Security/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/confidential/i);
    expect(text).toMatch(/daily backup/i);
    expect(text).toMatch(/isolat/i);
  });

  it('AC-LEG-020: Contact Us displays contact email + WhatsApp help link', () => {
    renderPrivacy();
    const heading = screen.getByRole('heading', { level: 2, name: /Contact Us/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(within(section).getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    const help = within(section).getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
  });

  // Shared-layout ACs (spec lists Privacy.test.tsx as a co-owner; layout is shared
  // with Terms, so these re-assert the contract for this page specifically).
  it('AC-LEG-030: unauthenticated back link → /login', () => {
    renderPrivacy();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('AC-LEG-031: cross-links Terms + Help (wa.me, new tab)', () => {
    renderPrivacy();
    expect(screen.getByRole('link', { name: /^Terms$/ })).toHaveAttribute('href', '/terms');
    // Two Help links legitimately render on Privacy (top-nav cross-link + Contact Us body, FR-LEG-020/024).
    const helpLinks = screen.getAllByRole('link', { name: /contact support via whatsapp/i });
    expect(helpLinks.length).toBeGreaterThan(0);
    helpLinks.forEach((help) => expect(help).toHaveAttribute('target', '_blank'));
  });

  it('AC-LEG-032 / AC-LEG-033: one <main id="main"> + skip link → #main', () => {
    renderPrivacy();
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main');
  });

  it('AC-LEG-035: deterministic render — same config → identical markup', () => {
    const a = renderPrivacy();
    const htmlA = a.container.innerHTML;
    a.unmount();
    const b = renderPrivacy();
    const htmlB = b.container.innerHTML;
    b.unmount();
    expect(htmlA).toBe(htmlB);
  });
});
