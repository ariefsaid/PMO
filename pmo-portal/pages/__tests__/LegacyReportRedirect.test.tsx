import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { LegacyReportRedirect } from '../money-in/LegacyReportRedirect';

function CurrentLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Back</button></>;
}

describe('legacy money-in report destinations', () => {
  it.each([
    ['/reports?from=2026-01&to=2026-06', 'earned'],
    ['/revenue-by-project?from=2026-02&to=2026-05', 'billing'],
  ] as const)('replaces %s with the matching Project revenue view and carries the range', (legacyUrl, view) => {
    render(
      <MemoryRouter initialEntries={['/origin', legacyUrl]} initialIndex={1}>
        <Routes>
          <Route path="/origin" element={<p>Origin</p>} />
          <Route path="/reports" element={<LegacyReportRedirect view="earned" />} />
          <Route path="/revenue-by-project" element={<LegacyReportRedirect view="billing" />} />
          <Route path="/financial-statements" element={<CurrentLocation />} />
          <Route path="*" element={<Navigate to="/origin" replace />} />
        </Routes>
      </MemoryRouter>,
    );
    const url = screen.getByTestId('location').textContent ?? '';
    expect(url).toContain('section=project-revenue');
    expect(url).toContain(`view=${view}`);
    expect(url).toContain('from=');
    expect(url).toContain('to=');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Origin')).toBeInTheDocument();
  });
});
