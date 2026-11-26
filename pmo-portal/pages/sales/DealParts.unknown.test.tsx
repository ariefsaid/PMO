import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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

  it('F14 keeps both probability estimates editable and saves each on blur', () => {
    const saveProbability = vi.fn(async (event: { preventDefault(): void }) => { event.preventDefault(); });
    const d = {
      ...deal(),
      canEditProbability: true,
      goInput: '80',
      getInput: '40',
      saveProbability,
      setGoInput: () => {},
      setGetInput: () => {},
      saving: null,
    } as DealActions;
    render(<DealFigures d={d} />);
    const goInput = screen.getByLabelText('Chance the project proceeds (%)');
    const getInput = screen.getByLabelText('Chance we win if the client proceeds (%)');
    expect(goInput).toBeEnabled();
    expect(getInput).toBeEnabled();
    fireEvent.blur(goInput);
    expect(saveProbability).toHaveBeenCalledWith(expect.anything(), 'go');
    fireEvent.blur(getInput);
    expect(saveProbability).toHaveBeenCalledWith(expect.anything(), 'get');
    expect(saveProbability).toHaveBeenCalledTimes(2);
  });
});
