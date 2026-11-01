import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/src/lib/legalConfig', () => ({
  LEGAL_ENTITY_NAME: 'Acme Legal Test Co',
  DOMAIN: 'acme.test.example',
  CONTACT_EMAIL: 'legal@acme.test.example',
  HELP_WHATSAPP: '6281234567890',
  HOSTING_LOCATION: 'Singapore',
  HELP_URL: 'https://wa.me/6281234567890',
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ session: null }) }));

import Privacy from './Privacy';

describe('AC-PHO-109 /privacy discloses the feedback button and surveys', () => {
  it('says what is asked, how often, what to leave out, who can switch it off and how to opt out', () => {
    render(
      <MemoryRouter>
        <Privacy />
      </MemoryRouter>,
    );
    const text = (document.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(text).toContain('Feedback button');
    expect(text).toContain('at most one every 30 days');
    expect(text).toContain('never in your first week');
    expect(text).toContain('never while you are filling in a form');
    expect(text).toContain('leave out customer names and amounts');
    expect(text).toContain('administrator can switch this off');
    expect(text).toContain('the opt-out below stops it for you');
  });
});
