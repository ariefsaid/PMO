import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { selectSalesProjects, sortSalesProjects } from './salesWorkingSet';

function project(
  overrides: Partial<PipelineProject> & Pick<PipelineProject, 'id' | 'name' | 'status'>,
): PipelineProject {
  return {
    id: overrides.id,
    name: overrides.name,
    short_name: null,
    client_name: null,
    status: overrides.status,
    contract_value: 100,
    currency: 'USD',
    tax_treatment: null,
    win_probability: 0.5,
    ...overrides,
  };
}

describe('Sales activity ordering', () => {
  const projects = [
    { id: 'missing-b', name: 'Maple', last_update: undefined },
    { id: 'late', name: 'Aster', last_update: '2026-04-10T12:00:00.000Z' },
    { id: 'early-z', name: 'Birch', last_update: '2026-04-01T12:00:00.000Z' },
    { id: 'invalid', name: 'Maple', last_update: 'not-a-date' },
    { id: 'early-a', name: 'Birch', last_update: '2026-04-01T12:00:00.000Z' },
  ];

  it('AC-SALES-C03: puts unavailable activity first, then oldest activity with stable name and ID ties', () => {
    expect(sortSalesProjects(projects, 'activity-oldest').map(({ id }) => id)).toEqual([
      'invalid',
      'missing-b',
      'early-a',
      'early-z',
      'late',
    ]);
  });

  it('AC-SALES-C03: keeps unavailable activity first when known activity is newest-first', () => {
    expect(sortSalesProjects(projects, 'activity-newest').map(({ id }) => id)).toEqual([
      'invalid',
      'missing-b',
      'late',
      'early-a',
      'early-z',
    ]);
    expect(projects.map(({ id }) => id)).toEqual([
      'missing-b',
      'late',
      'early-z',
      'invalid',
      'early-a',
    ]);
  });
});

describe('Sales visible working set', () => {
  afterEach(() => vi.useRealTimers());

  it('AC-SALES-C01: scope, stage, search, classifications, and activity sort select one shared set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'));
    const matching = project({
      id: 'a-stale-lead',
      name: 'Central Renewal',
      status: 'Leads',
      client_name: 'North Customer',
      service_line: 'Advisory',
      last_update: '2026-09-01T12:00:00.000Z',
    });
    const recent = project({
      id: 'b-recent-lead',
      name: 'Central Renewal',
      status: 'Leads',
      client_name: 'North Customer',
      service_line: 'Advisory',
      last_update: '2026-10-24T12:00:00.000Z',
    });
    const otherStage = project({
      id: 'c-stale-quotation',
      name: 'Central Renewal',
      status: 'Quotation Submitted',
      client_name: 'North Customer',
      service_line: 'Advisory',
      last_update: '2026-09-01T12:00:00.000Z',
    });
    const lost = project({
      id: 'd-declined',
      name: 'Central Renewal',
      status: 'Declined',
      client_name: 'North Customer',
      service_line: 'Advisory',
      last_update: '2026-09-01T12:00:00.000Z',
    });

    const visible = selectSalesProjects([matching, recent, otherStage], [lost], {
      scope: 'Needs attention',
      status: 'Leads',
      sort: 'activity-oldest',
      q: 'North',
      serviceLine: 'Advisory',
    });

    expect(visible.map(({ id }) => id)).toEqual(['a-stale-lead']);
  });
});
