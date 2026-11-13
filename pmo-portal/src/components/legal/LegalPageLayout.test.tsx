import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';

// C6 (classes.md): a public page must expose exactly ONE main landmark. The shared legal chrome
// renders outside <Shell>, so it owns the page's only <main id="main"> (the skip link targets it);
// a second landmark would leave a screen-reader user with two "main" regions and an ambiguous
// skip target. axe's landmark-one-main rule is the machine gate, the assertions name the anatomy.
vi.mock('@/src/lib/legalConfig', () => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Jakarta',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: null }) }));

import { LegalPageLayout, LegalSection } from './LegalPageLayout';

const renderLayout = () =>
  render(
    <MemoryRouter>
      <LegalPageLayout title="Terms of service" variant="terms">
        <LegalSection title="1. Agreement">
          <p>The controlling agreement.</p>
        </LegalSection>
      </LegalPageLayout>
    </MemoryRouter>,
  );

describe('LegalPageLayout — C6 one main landmark', () => {
  it('renders exactly one main landmark and keeps the page content inside it', () => {
    renderLayout();

    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main');
    // The verdict heading and the body live INSIDE that one landmark, not beside it.
    expect(mains[0]).toContainElement(screen.getByRole('heading', { level: 1, name: 'Terms of service' }));
    expect(mains[0]).toContainElement(screen.getByText('The controlling agreement.'));
  });

  it('the skip link targets that one landmark', () => {
    renderLayout();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute('href', '#main');
    expect(document.querySelectorAll('main')).toHaveLength(1);
  });

  it('has no axe landmark-one-main violation', async () => {
    const { container } = renderLayout();
    const results = await axe(container, {
      runOnly: { type: 'rule', values: ['landmark-one-main'] },
    });
    expect(results.violations).toEqual([]);
  });
});
