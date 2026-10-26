import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import React from 'react';
import { BvACard } from '../BvACard';
import type { TopProject } from '@/src/lib/db/dashboard';

const projects: TopProject[] = [
  {
    id: 'd1', name: 'Meridian Steelworks', client_name: 'Meridian', currency: 'USD', contract_value: 5_000_000,
    budget: 4_700_000, spent: 2_100_000, status: 'Ongoing Project', actual_complete: true, actual_currency: 'USD',
  },
  {
    id: 'd2', name: 'SunVolt Install', client_name: 'SunVolt', currency: 'USD', contract_value: 3_000_000,
    budget: 2_000_000, spent: 1_960_000, status: 'Ongoing Project', actual_complete: true, actual_currency: 'USD',
  },
];

const CurrentRoute = () => <output aria-label="Current route">{useLocation().pathname}</output>;

describe('Executive spending row navigation', () => {
  it('AC-JR-W3B-04 keeps the risk flag and named project link separate from row activation', () => {
    render(<MemoryRouter><BvACard projects={projects} currency="USD" /><CurrentRoute /></MemoryRouter>);
    const table = screen.getByRole('table', { name: /spending comparison/ });
    const link = within(table).getByRole('link', { name: 'SunVolt Install' });
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('At risk')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'SunVolt Install' })).toHaveAttribute('href', '/projects/d2');
    expect(within(row).getByText('At risk').closest('a')).toBeNull();
    expect(row.onclick).toBeNull();
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.click(link);
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/projects/d2');
  });
});
