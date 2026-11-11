import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DealActionsZone, DealFigures } from './DealParts';
import type { DealActions } from './useDealActions';

const deal = () => ({
  project: { id: 'p1', status: 'Leads', currency: 'USD', contract_value: null, pm: null },
  cached: { contract_value: null, go_probability: null, win_probability: null, get_probability: 0.25 },
  pipelinePending: false, pipelineError: false, canEditProbability: false, canSeeMoney: true,
  isTerminal: false, canTransition: true, showWonPanel: true, canWin: true,
  probError: {}, headingRef: { current: null }, today: '2026-11-12',
} as unknown as DealActions);

const figure = (name: string) => within(screen.getByText(name).parentElement as HTMLElement);

describe('unrecorded deal figures', () => {
  it('F10 shows an unknown value rather than zero', () => {
    render(<DealFigures d={deal()} />);
    expect(figure('Value').getByText('—')).toBeInTheDocument();
  });
  it('F11 shows an unknown booking amount rather than zero', () => {
    render(<DealActionsZone d={deal()} />);
    expect(screen.getByText(/Booking/)).toHaveTextContent('—');
  });
  it('F13 shows an unknown go probability rather than zero', () => {
    render(<DealFigures d={deal()} />);
    expect(figure('% Go').getByText('—')).toBeInTheDocument();
  });
});
