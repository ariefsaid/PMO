// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TopProject } from '@/src/lib/db/dashboard';
import { sortExecutiveProjects } from './executiveProjectOrder';

const project = (id: string, name: string, spent: number | null): TopProject => ({
  id, name, spent, client_name: null, currency: 'USD', actual_currency: 'USD',
  contract_value: 2_000, budget: 1_000, budget_currency: 'USD',
  actual_complete: spent !== null, actual_coverage_count: spent === null ? 0 : 1,
  actual_coverage_total: 1, status: 'Ongoing Project',
});

describe('Executive comparison order', () => {
  it('AC-806-HIERARCHY-SORT puts exceptions first, then sorts every other project by name', () => {
    const rows = [project('z', 'Zulu', 500), project('a', 'Alpha', null), project('r', 'Risk', 950)];
    expect(sortExecutiveProjects(rows).map(({ id }) => id)).toEqual(['r', 'a', 'z']);
    expect(rows.map(({ id }) => id)).toEqual(['z', 'a', 'r']);
  });
});
