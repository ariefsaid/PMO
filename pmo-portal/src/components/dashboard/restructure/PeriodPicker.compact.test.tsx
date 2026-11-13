import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { PeriodPicker } from './PeriodPicker';
import { usePeriod } from './usePeriod';

vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }),
}));

const Harness = ({ compact = false }: { compact?: boolean }) => {
  const period = usePeriod();
  const location = useLocation();

  return (
    <>
      <PeriodPicker {...period} compact={compact} />
      <output data-testid="location-search">{location.search}</output>
    </>
  );
};

describe('PeriodPicker density', () => {
  it('uses the compact control for dense home headers without changing period selection', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard?period=ytd']}>
        <Harness compact />
      </MemoryRouter>,
    );

    const control = screen.getByRole('combobox', { name: 'Period' });
    expect(control).toHaveClass('h-[var(--control-height-sm)]');
    expect(control).not.toHaveClass('min-h-[var(--control-height)]', 'h-11', 'min-[1180px]:h-8');

    fireEvent.change(control, { target: { value: 'month' } });
    expect(screen.getByTestId('location-search')).toHaveTextContent('period=month');
  });

  it('keeps the default form-control density for non-home uses', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard?period=ytd']}>
        <Harness />
      </MemoryRouter>,
    );

    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveClass(
      'min-h-[var(--control-height)]',
      'h-11',
      'min-[1180px]:h-8',
    );
  });
});
