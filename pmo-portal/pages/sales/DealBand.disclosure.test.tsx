import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

const deal = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock('./useDealActions', () => ({
  useDealActions: () => deal.current,
  useStageJourneyStepLabel: () => (s: string) => s,
}));
vi.mock('./DealParts', () => ({
  DealActionButtons: () => null,
  DealFigures: () => null,
  DealDialogs: () => null,
  DealActionsZone: ({ d }: { d: { showWonPanel: boolean } }) => (d.showWonPanel ? <section id="deal-won-panel">won panel</section> : null),
}));
vi.mock('../project-detail/StageHistory', () => ({ default: () => null }));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProjectStatusLabel: () => (s: string) => s }));

import DealBand from './DealBand';

const base = {
  status: 'Leads', isDesktop: false, canTransition: true, isTerminal: false, nextStage: null, canWin: true,
  pending: false, setShowWonPanel: vi.fn(), runTransition: vi.fn(),
};
const project = { id: 'p1', status: 'Leads' } as never;
const ui = () => <MemoryRouter><DealBand project={project} /></MemoryRouter>;

describe('DealBand phone "Mark won" disclosure (#2079)', () => {
  it('announces collapsed, opens the details, then announces expanded and points at a panel that exists', async () => {
    deal.current = { ...base, showWonPanel: false };
    const { rerender } = render(ui());
    const button = screen.getByRole('button', { name: 'Mark won' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(button);
    expect(base.setShowWonPanel).toHaveBeenCalledWith(true);
    deal.current = { ...base, showWonPanel: true };
    rerender(ui());
    const open = screen.getByRole('button', { name: 'Mark won' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(open.getAttribute('aria-controls') ?? '')).toBeInTheDocument();
  });
});
