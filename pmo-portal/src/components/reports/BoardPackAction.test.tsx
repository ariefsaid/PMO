import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
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
        <Route path="/financial-statements" element={<ProjectRevenueHome />} />
      </Routes>
    </MemoryRouter>,
  );

function ProjectRevenueHome() {
  const location = useLocation();
  return <><p>Project revenue home</p><output data-testid="report-url">{location.pathname}{location.search}</output></>;
}

describe('dashboard Project revenue doorway', () => {
  it('opens the canonical home in Earned view when it is available', async () => {
    h.revenue = true;
    h.role = 'Executive';
    renderAt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project revenue' }));
    expect(screen.getByText('Project revenue home')).toBeInTheDocument();
    expect(screen.getByTestId('report-url')).toHaveTextContent('section=project-revenue');
    expect(screen.getByTestId('report-url')).toHaveTextContent('view=earned');
  });

  it('opens Billing when Earned is off but invoice reporting remains available', async () => {
    h.revenue = false;
    h.role = 'Executive';
    renderAt();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project revenue' }));
    expect(screen.getByText('Project revenue home')).toBeInTheDocument();
    expect(screen.getByTestId('report-url')).toHaveTextContent('view=billing');
  });

  it('stays disabled for a role that cannot see earned revenue', () => {
    h.revenue = true;
    h.role = 'Engineer';
    renderAt();
    expect(screen.getByRole('button', { name: /project revenue \(unavailable\)/i })).toBeDisabled();
  });
});
