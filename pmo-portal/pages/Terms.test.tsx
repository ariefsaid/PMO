import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import legalEn from '../public/locales/en/legal.json';
import legalId from '../public/locales/id/legal.json';

// Fixed config → deterministic assertions (AC-LEG-006/034). Mocked so the page
// test is independent of env; the real module is proven in legalConfig.test.ts.
const mockConfig = vi.hoisted(() => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Jakarta',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/lib/legalConfig', () => mockConfig);

// Control session for the auth-aware back link (AC-LEG-030).
const mockAuth = vi.hoisted(() => ({ session: null as object | null }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: mockAuth.session }) }));

import Terms from './Terms';

function renderTerms() {
  return render(
    <MemoryRouter>
      <Terms />
    </MemoryRouter>,
  );
}

function renderTermsWithDestinations() {
  return render(
    <MemoryRouter initialEntries={['/terms']}>
      <Routes>
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<p>Privacy page opened</p>} />
        <Route path="/login" element={<p>Sign-in page opened</p>} />
        <Route path="/" element={<p>App page opened</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockAuth.session = null; // unauthenticated primary audience
});

describe('Terms page', () => {
  it('AC-LEG-001: renders the bare Terms page — title present, no AppShell chrome', () => {
    renderTerms();
    expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument();
    // Bare public page (FR-LEG-003): no rail nav landmark, no ContextBar banner landmark.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();
  });

  it('AC-LEG-004 / AC-LEG-027: one h1 + 8 h2 section headings', () => {
    renderTerms();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);

    const h2s = screen.getAllByRole('heading', { level: 2 });
    const h2Texts = h2s.map((h) => h.textContent ?? '');
    [
      'Acceptance of Terms', 'Services', 'User Responsibilities', 'Data Ownership',
      'Confidentiality', 'Limitation of Liability', 'Term and Termination', 'Governing Law',
    ].forEach((t) => expect(h2Texts).toContain(t));


  });

  it('AC-LEG-006: renders config entity/domain/contact email; no bracket placeholders', () => {
    renderTerms();
    // Renders multiple times across sections — assert presence, not uniqueness.
    expect(screen.getAllByText(/Acme Legal Test Co/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/acme\.test\.example/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/\[(LEGAL-ENTITY|DOMAIN|CONTACT_EMAIL|HOSTING)\]/);
  });

  it('AC-LEG-010: Services section references the MSA / master subscription agreement', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /^Services$/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    expect(within(section).getByText(/master subscription|MSA/i)).toBeInTheDocument();
  });

  it('AC-LEG-011: Data Ownership affirms client ownership + limited license', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /Data Ownership/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/own/i);
    expect(text).toMatch(/license necessary to operate/i);
  });

  it('AC-LEG-012: Term and Termination includes initial / auto-renewal / convenience / cause', () => {
    renderTerms();
    const heading = screen.getByRole('heading', { level: 2, name: /Term and Termination/ });
    const section = heading.closest('section') ?? heading.parentElement!;
    const text = section.textContent ?? '';
    expect(text).toMatch(/Initial term/i);
    expect(text).toMatch(/Auto-renewal/i);
    expect(text).toMatch(/Termination for convenience/i);
    expect(text).toMatch(/Termination for cause/i);
  });

  it('AC-LEG-030: unauthenticated → "Back to sign in" → /login; authenticated → "Back to app" → /', () => {
    const { unmount } = renderTerms();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    unmount();

    mockAuth.session = { access_token: 'x' } as object; // truthy → authed
    renderTerms();
    expect(screen.getByRole('link', { name: /back to app/i })).toHaveAttribute('href', '/');
    mockAuth.session = null;
  });

  it('floor: clicking the unauthenticated back link opens sign-in', () => {
    renderTermsWithDestinations();
    fireEvent.click(screen.getByRole('link', { name: /back to sign in/i }));
    expect(screen.getByText('Sign-in page opened')).toBeInTheDocument();
  });

  it('floor: clicking the authenticated back link opens the app', () => {
    mockAuth.session = { access_token: 'x' } as object;
    renderTermsWithDestinations();
    fireEvent.click(screen.getByRole('link', { name: /back to app/i }));
    expect(screen.getByText('App page opened')).toBeInTheDocument();
  });

  it('floor: clicking the Privacy link opens the Privacy page', () => {
    renderTermsWithDestinations();
    fireEvent.click(screen.getByRole('link', { name: /^Privacy$/ }));
    expect(screen.getByText('Privacy page opened')).toBeInTheDocument();
  });

  it('AC-LEG-031: cross-links Privacy + Help (wa.me, new tab) + the auth-aware back link', () => {
    renderTerms();
    expect(screen.getByRole('link', { name: /^Privacy$/ })).toHaveAttribute('href', '/privacy');
    const help = screen.getByRole('link', { name: /contact support via whatsapp/i });
    expect(help).toHaveAttribute('href', 'https://wa.me/6281234567890');
    expect(help).toHaveAttribute('target', '_blank');
    expect(help).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
  });

  it('AC-LEG-028: links have descriptive labels (no "click here"); Help has the required aria-label', () => {
    renderTerms();
    const texts = screen.getAllByRole('link').map((a) => a.textContent ?? '');
    expect(texts.some((t) => /click here/i.test(t))).toBe(false);
    expect(screen.getByRole('link', { name: /contact support via whatsapp/i })).toBeInTheDocument();
  });

  it('AC-LEG-029: foreground uses the text-foreground token', () => {
    const { container } = renderTerms();
    expect(container.querySelector('.text-foreground')).not.toBeNull();
  });

  it('AC-LEG-032: exactly one <main> landmark with id="main"', () => {
    renderTerms();
    const mains = document.querySelectorAll('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
  });

  it('AC-LEG-033: a "Skip to main content" link targets #main', () => {
    renderTerms();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main');
  });

  it('AC-LEG-035: deterministic render — same config → identical markup; no date-derived text', () => {
    const a = renderTerms();
    const htmlA = a.container.innerHTML;
    a.unmount();
    const b = renderTerms();
    const htmlB = b.container.innerHTML;
    b.unmount();
    expect(htmlA).toBe(htmlB);
    expect(htmlA).not.toMatch(/last updated|effective (date|today)/i);
  });
});

describe('C4: the legal body stays in English under the Indonesian locale', () => {
  const ID_NOTICE = 'Teks hukum ini tersedia dalam bahasa Inggris.';

  async function renderWithLanguage(language: 'en' | 'id') {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: language,
      fallbackLng: false,
      defaultNS: 'legal',
      resources: { en: { legal: legalEn }, id: { legal: legalId } },
    });
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <Terms />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('under id: the page shows the English legal body plus the one Indonesian line, above it', async () => {
    await renderWithLanguage('id');

    // The clauses are a contract: English, verbatim — no machine-translated clause ships.
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Acceptance of Terms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Governing Law' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ketentuan Layanan' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Penerimaan Ketentuan' })).toBeNull();

    // The page chrome around the body is still translated.
    expect(screen.getByRole('link', { name: 'Kembali ke halaman masuk' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Privasi' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Lompat ke konten utama' })).toHaveAttribute('href', '#main');

    // Exactly one Indonesian line, and it sits above the legal body it explains.
    const notices = screen.getAllByText(ID_NOTICE);
    expect(notices).toHaveLength(1);
    const firstSectionHeading = screen.getAllByRole('heading', { level: 2 })[0];
    expect(
      notices[0].compareDocumentPosition(firstSectionHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The English catalogue sentences still carry the configured entity, domain and contact address.
    expect(screen.getAllByText(/Acme Legal Test Co/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /legal@acme\.test\.example/i })).toBeInTheDocument();
  });

  it('under en: the same English body and no Indonesian line', async () => {
    await renderWithLanguage('en');
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.queryByText(ID_NOTICE)).toBeNull();
  });
});

