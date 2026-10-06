import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({ revenue: true, role: 'Executive', track: vi.fn() }));
vi.mock('@/src/auth/useFeature', () => ({ useFeature: () => h.revenue }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/lib/analytics', () => ({ trackComingSoonClicked: h.track }));

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
});
