import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DealActionButtons, DealActionsZone } from './DealParts';
import type { DealActions } from './useDealActions';

const deal = (showWonPanel: boolean) => ({
  project: { id: 'p1', status: 'Leads', currency: 'USD', contract_value: null, pm: null },
  cached: { contract_value: null, go_probability: null, win_probability: null, get_probability: 0.25 },
  isTerminal: false, canTransition: true, canWin: true, canLose: false, canDecline: false,
  nextStage: null, showWonPanel, pending: false,
  probError: {}, headingRef: { current: null }, today: '2026-11-12',
} as unknown as DealActions);

describe('Mark won disclosure', () => {
  it('announces collapsed, then expanded, and points at the panel it opens', () => {
    const { rerender } = render(<DealActionButtons d={deal(false)} />);
    expect(screen.getByRole('button', { name: 'Mark won' })).toHaveAttribute('aria-expanded', 'false');
    rerender(<><DealActionButtons d={deal(true)} /><DealActionsZone d={deal(true)} /></>);
    const button = screen.getAllByRole('button', { name: 'Mark won' })[0];
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
  });
});
