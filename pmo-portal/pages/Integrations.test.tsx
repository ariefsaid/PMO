/**
 * AC-ADMIA-006 — pages/Integrations.tsx: the PERSONAL (Member-owner) Microsoft 365 connect route at
 * `/integrations`, distinct from the organization-owned surface at `/administration/integrations`.
 *
 * The page heading and supporting copy must identify this route as "My integrations" / personal, and
 * must NOT imply that connecting a personal account makes an organization integration ready — the two
 * surfaces are owned by different principals (D2 / OQ-A, m365-operator-client-separation).
 *
 * The token-custody edge fn (initiate_connect, status, disconnect) is exercised by the card's own
 * tests (M365ConnectionCard.test.tsx); here the card is double-stubbed so the route-level copy is what
 * is asserted, not a re-run of the card's network contract.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/src/components/integrations/M365ConnectionCard', () => ({
  M365ConnectionCard: () => (
    <div data-testid="personal-m365-card">Personal Microsoft 365 connection card</div>
  ),
  default: () => <div data-testid="personal-m365-card">Personal Microsoft 365 connection card</div>,
}));

import IntegrationsPage from './Integrations';

const renderPage = () => render(<IntegrationsPage />);

afterEach(() => cleanup());

describe('Integrations — the PERSONAL connection route (AC-ADMIA-006)', () => {
  it('labels the route as personal integrations with a separating description', () => {
    renderPage();
    // The page-level h1 identifies the personal surface, not the org surface.
    expect(screen.getByRole('heading', { level: 1, name: 'My integrations' })).toBeInTheDocument();
    // Supporting copy is explicitly personal-account scope.
    expect(screen.getByText(/personal microsoft 365 account/i)).toBeInTheDocument();
    // The M365 card still renders — the route and its callback handling are unchanged.
    expect(screen.getByTestId('personal-m365-card')).toBeInTheDocument();
  });

  it('does not claim that a personal connection makes the organization integration ready', () => {
    renderPage();
    // AC-ADMIA-006: personal ≠ organization. The personal route must not assert org readiness.
    expect(
      screen.queryByText(/organization integration.*(ready|active|activated)/i),
    ).not.toBeInTheDocument();
  });
});