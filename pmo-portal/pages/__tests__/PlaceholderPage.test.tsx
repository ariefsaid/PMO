import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

import PlaceholderPage from '../PlaceholderPage';

/**
 * B-10 (AC-W2-IA-005): /reports renders an honest "arrives later" placeholder with
 * a way back, not a fake-functional stub or a blank page.
 *
 * The Reports placeholder must:
 * 1. Show an explanatory message — "arrives in a later release" (or similar).
 * 2. Provide a keyboard-reachable Back / next-step action (a link or button that
 *    takes the user somewhere useful — not a dead-end).
 * 3. Not look like a live functional page (no live CTA that would fail).
 *
 * OD-W2-5 ratified: keep the /reports route (deep-link resolves, no 404) but make
 * the stub honest and navigable.
 */

const renderReports = () =>
  render(
    <MemoryRouter>
      <PlaceholderPage title="Reports" />
    </MemoryRouter>,
  );

describe('PlaceholderPage — /reports honest stub (B-10, AC-W2-IA-005)', () => {
  it('AC-W2-IA-005: the Reports stub shows an "arrives later" message', () => {
    renderReports();
    // The sub copy must indicate future availability — no fake teaser.
    expect(screen.getByText(/arrives in a later release/i)).toBeInTheDocument();
  });

  it('AC-W2-IA-005: the Reports stub provides a keyboard-reachable back action', () => {
    renderReports();
    // A Back link or button must be present and focusable.
    const back = screen.getByRole('link', { name: /back to dashboard/i });
    expect(back).toBeInTheDocument();
    back.focus();
    expect(back).toHaveFocus();
  });

  it('AC-W2-IA-005: the Reports stub has no live functional CTA (no fake-success button)', () => {
    renderReports();
    // There must be no unlabelled / unexplained button that looks live.
    const buttons = screen.queryAllByRole('button');
    // Any button present must be disabled (honest placeholder, not a dead-end modal opener).
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
