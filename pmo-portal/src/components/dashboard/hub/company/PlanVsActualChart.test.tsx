import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { TopProject } from '@/src/lib/db/dashboard';
import { PlanVsActualChart } from './PlanVsActualChart';
import { planVsActualRows } from './planVsActual';

const p = (over: Partial<TopProject>): TopProject => ({
  id: 'x', name: 'X', client_name: null, contract_value: 1000, currency: 'USD', budget: null, spent: 400,
  actual_currency: 'USD', actual_complete: true, ...over,
} as TopProject);

describe('planVsActualRows', () => {
  it('plans from contract value; actual only when complete and in the contract currency', () => {
    const rows = planVsActualRows([
      p({ id: 'a', contract_value: 500, spent: 200 }),
      p({ id: 'b', contract_value: 900, spent: 100, actual_complete: false }),
      p({ id: 'c', contract_value: 800, spent: 100, actual_currency: 'IDR' }),
    ], 'USD');
    expect(rows.map((r) => [r.id, r.plan, r.actual])).toEqual([['b', 900, null], ['c', 800, null], ['a', 500, 200]]);
  });

  it('keeps one currency (the organisation currency) and counts the rest as left out; biggest contract first, max 8', () => {
    const many = Array.from({ length: 10 }, (_, i) => p({ id: `p${i}`, contract_value: 100 + i }));
    const { length } = planVsActualRows([...many, p({ id: 'idr', currency: 'IDR', contract_value: 9e9 }), p({ id: 'none', contract_value: null })], 'USD');
    expect(length).toBe(8);
    expect(planVsActualRows(many, 'USD')[0].id).toBe('p9');
  });
});

describe('PlanVsActualChart', () => {
  it('names the chart and gives screen readers the figures as a table', () => {
    render(<MemoryRouter><PlanVsActualChart projects={[p({ id: 'a', name: 'Alpha', contract_value: 2000, spent: 500 })]} currency="USD" /></MemoryRouter>);
    expect(screen.getByRole('img', { name: /plan vs actual/i })).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /plan vs actual/i });
    expect(table).toHaveTextContent('Alpha');
    expect(table).toHaveTextContent('$2,000');
    expect(table).toHaveTextContent('$500');
  });

  it('says nothing is comparable instead of drawing an empty axis', () => {
    render(<MemoryRouter><PlanVsActualChart projects={[]} currency="USD" /></MemoryRouter>);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/no projects to compare/i)).toBeInTheDocument();
  });
});
