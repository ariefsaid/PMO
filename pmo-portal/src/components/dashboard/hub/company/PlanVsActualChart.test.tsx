import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    expect(rows.map((r) => r.percent)).toEqual([null, null, 40]);
  });

  it('#1240 D-005: carries the active budget when it is in the contract currency, else null', () => {
    const rows = planVsActualRows([
      p({ id: 'a', contract_value: 900, budget: 800 }),
      p({ id: 'b', contract_value: 800, budget: null }),
      p({ id: 'c', contract_value: 700, budget: 5, budget_currency: 'IDR' }),
    ], 'USD');
    expect(rows.map((r) => [r.id, r.budget])).toEqual([['a', 800], ['b', null], ['c', null]]);
  });

  it('keeps one currency (the organisation currency) and counts the rest as left out; biggest contract first, max 8', () => {
    const many = Array.from({ length: 10 }, (_, i) => p({ id: `p${i}`, contract_value: 100 + i }));
    const { length } = planVsActualRows([...many, p({ id: 'idr', currency: 'IDR', contract_value: 9e9 }), p({ id: 'none', contract_value: null })], 'USD');
    expect(length).toBe(8);
    expect(planVsActualRows(many, 'USD')[0].id).toBe('p9');
  });
});

describe('PlanVsActualChart', () => {
  it('labels each project bar with its series name and money value', () => {
    render(<MemoryRouter><PlanVsActualChart projects={[p({
      id: 'a', name: 'Alpha', contract_value: 2000, budget: 1500, spent: 500,
    })]} currency="USD" /></MemoryRouter>);
    const chart = screen.getByRole('img', { name: /plan vs actual by project/i });
    expect(chart.getAttribute('aria-label')).toContain('Alpha: Contract $2,000, Active budget $1,500, Spent $500');
  });

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

  it('says in view, under the chart, how many projects have no spent bar and why', () => {
    render(<MemoryRouter><PlanVsActualChart currency="USD" projects={[
      p({ id: 'a', name: 'A', contract_value: 900 }),
      p({ id: 'b', name: 'B', contract_value: 800, actual_complete: false }),
      p({ id: 'c', name: 'C', contract_value: 700, spent: null }),
      p({ id: 'd', name: 'D', contract_value: 600, currency: 'IDR' }),
      p({ id: 'e', name: 'E', contract_value: 500, currency: 'IDR' }),
    ]} /></MemoryRouter>);
    const note = screen.getByTestId('plan-actual-caption');
    expect(note).toHaveTextContent('Spent is incomplete for 2 projects; known bars are shown');
    expect(note).toHaveTextContent('2 projects in another currency are left out');
    expect(note).not.toHaveClass('sr-only');
  });

  it('adds no caption when every project is charted with its spending', () => {
    render(<MemoryRouter><PlanVsActualChart currency="USD" projects={[p({ id: 'a' })]} /></MemoryRouter>);
    expect(screen.queryByTestId('plan-actual-caption')).toBeNull();
  });

  it('#1240 D-005: the table shows the active budget (or says there is none) and spent as a share of the contract', () => {
    render(<MemoryRouter><PlanVsActualChart currency="USD" projects={[
      p({ id: 'a', name: 'Meridian', contract_value: 1_000_000, budget: 800_000, spent: 920_000 }),
      p({ id: 'b', name: 'Harbor', contract_value: 900_000, budget: null, spent: 100_000 }),
    ]} /></MemoryRouter>);
    const table = screen.getByRole('table', { name: /plan vs actual/i });
    const cells = (name: string) => within(within(table).getByRole('rowheader', { name }).closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);
    expect(cells('Meridian')).toEqual(['$1,000,000', '$800,000', '$920,000', '92%']);
    expect(cells('Harbor')).toEqual(['$900,000', 'No active budget', '$100,000', '11%']);
  });
});
