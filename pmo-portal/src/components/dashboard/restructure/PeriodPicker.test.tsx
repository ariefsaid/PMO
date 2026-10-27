import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { PeriodPicker } from './PeriodPicker';
import { usePeriod } from './usePeriod';

vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));

const Harness = () => {
  const period = usePeriod();
  const location = useLocation();
  return <><PeriodPicker {...period} /><output data-testid="location-search">{location.search}</output></>;
};

describe('PeriodPicker', () => {
  it('changes the period in the URL while preserving the selected dashboard layout', () => {
    render(<MemoryRouter initialEntries={['/dashboard?layout=a&period=ytd']}><Harness /></MemoryRouter>);

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'month' } });

    expect(screen.getByTestId('location-search')).toHaveTextContent('layout=a');
    expect(screen.getByTestId('location-search')).toHaveTextContent('period=month');
  });

  it('shows two labeled month inputs for a custom range', () => {
    render(<MemoryRouter initialEntries={['/dashboard?period=custom&from=2026-02&to=2026-04']}><Harness /></MemoryRouter>);

    expect(screen.getByLabelText('From month')).toHaveValue('2026-02');
    expect(screen.getByLabelText('To month')).toHaveValue('2026-04');
    fireEvent.change(screen.getByLabelText('To month'), { target: { value: '2026-05' } });
    expect(screen.getByTestId('location-search')).toHaveTextContent('to=2026-05');
  });
});
