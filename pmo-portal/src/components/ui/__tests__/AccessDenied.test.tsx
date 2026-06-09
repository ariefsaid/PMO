import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { AccessDenied } from '../AccessDenied';

/**
 * A-8 foundation: the single shared "you don't have access to this page" surface
 * used by the page-level RBAC gates (A-4 Sales, A-5 Companies, A-6 Timesheets).
 * It is a CLARITY surface (RLS is the authority) — a titled region with a clean
 * back action, never a wall of dead buttons.
 */
describe('AccessDenied — shared page-level denied surface (A-8)', () => {
  it('renders a titled region with the default title + sub copy', () => {
    render(<AccessDenied onBack={() => {}} />);
    // A labelled region so screen readers announce it as a discrete landmark.
    const region = screen.getByRole('region', { name: /no access|don't have access/i });
    expect(region).toBeInTheDocument();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it('renders a custom title + sub when provided', () => {
    render(
      <AccessDenied
        title="You don't have access to the Sales Pipeline"
        sub="The Sales Pipeline is available to managers and finance."
        onBack={() => {}}
      />,
    );
    expect(
      screen.getByText("You don't have access to the Sales Pipeline"),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The Sales Pipeline is available to managers and finance.'),
    ).toBeInTheDocument();
  });

  it('exposes a keyboard-reachable Back action that fires onBack', async () => {
    const onBack = vi.fn();
    render(<AccessDenied onBack={onBack} />);
    const back = screen.getByRole('button', { name: /back to dashboard/i });
    expect(back).toBeInTheDocument();
    // Keyboard-reachable (focusable native button).
    back.focus();
    expect(back).toHaveFocus();
    await userEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('lets the caller override the back label', () => {
    render(<AccessDenied onBack={() => {}} backLabel="Return home" />);
    expect(screen.getByRole('button', { name: 'Return home' })).toBeInTheDocument();
  });
});
