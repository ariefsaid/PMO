import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';

type Analytics = typeof import('@/src/lib/analytics');
const h = vi.hoisted(() => ({ revenue: true, role: 'Executive', track: vi.fn<Analytics['trackComingSoonClicked']>() }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.revenue }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/lib/analytics', async importOriginal => ({
  ...await importOriginal<Analytics>(),
  trackComingSoonClicked: h.track,
} satisfies Analytics));

import { BoardPackAction } from './BoardPackAction';

const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<BoardPackAction />} />
        <Route path="/reports" element={<p>pack page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('AC-MMP-015 dashboard Board pack', () => {
  it('AC-MMP-015: opens the management pack when it is available', async () => {
    h.revenue = true;
    h.role = 'Executive';
    renderAt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Board pack' }));
    expect(screen.getByText('pack page')).toBeInTheDocument();
  });

  it('AC-MMP-015: stays the disabled coming-soon control when Revenue is off', () => {
    h.revenue = false;
    h.role = 'Executive';
    renderAt();
    expect(screen.getByRole('button', { name: /board pack \(coming soon\)/i })).toBeDisabled();
  });

  it('AC-MMP-015: stays disabled for a role that cannot see the pack', () => {
    h.revenue = true;
    h.role = 'Engineer';
    renderAt();
    expect(screen.getByRole('button', { name: /board pack \(coming soon\)/i })).toBeDisabled();
  });

  it('AC-MMP-015: records demand when the disabled coming-soon action is clicked', async () => {
    h.revenue = false;
    h.role = 'Executive';
    h.track.mockClear();
    renderAt();
    const action = screen.getByRole('button', { name: /board pack \(coming soon\)/i });
    // The disabled control is pointer-transparent so the wrapper receives the user's click intent.
    await userEvent.setup().click(action.parentElement as HTMLElement);
    expect(h.track).toHaveBeenCalledWith('board-pack-export', 'dashboard');
  });
});
