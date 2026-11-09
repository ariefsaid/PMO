/**
 * #2104 perf(rbp) — grouped procurement lane. Every `ProcurementListRow` used to call
 * `useListReturn` itself, subscribing each row to `location`/`navigate`, so ANY URL change
 * re-rendered every row (~1k subtrees at 1k procurements), and the rows were not memoised,
 * so a search commit re-rendered every visible row even when its data was unchanged.
 *
 * AC: given the grouped procurement view with 200 rows, when a search commits, then only rows
 * whose data changed re-render.
 *
 * The count is taken inside the row component itself (the swapped-in probe records one hit per
 * parent-driven render of the row). That is exactly the cost the AC names; a Profiler around the
 * row would ALSO report an update for rows whose memo bailed out, so it would count renders that
 * never happened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, useNavigate } from 'react-router';

const probes = vi.hoisted(() => ({
  rowRenders: new Map<string, number>(),
  record: (id: string) => probes.rowRenders.set(id, (probes.rowRenders.get(id) ?? 0) + 1),
  reset: () => probes.rowRenders.clear(),
  total: () => [...probes.rowRenders.values()].reduce((sum, count) => sum + count, 0),
}));

vi.mock('../ProcurementListRow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ProcurementListRow')>();
  const Real = (actual as { ProcurementListRowBase?: typeof actual.ProcurementListRow })
    .ProcurementListRowBase ?? actual.ProcurementListRow;
  // One probe for both exports: whichever the list renders, it lands here and counts once per
  // render of the real row.
  const Probe = (props: React.ComponentProps<typeof actual.ProcurementListRow>) => {
    probes.record(props.row.id);
    return <Real {...props} />;
  };
  return {
    ...actual,
    ProcurementListRow: Probe,
    ProcurementListRowBase: Probe,
  };
});

import { ProcurementGroupedView } from '../list/ProcurementGroupedView';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

function makeRow(i: number, status: string): ProcurementWithRefs {
  return {
    id: `pr-${i}`,
    code: `PR-${String(i).padStart(4, '0')}`,
    title: `Procurement ${i}`,
    status,
    total_value: 1000 + i,
    currency: 'USD',
    created_at: '2026-06-01T00:00:00Z',
    project_id: 'project-xyz',
    requested_by_id: 'u1',
    project: { name: 'Harbour Bridge', code: 'HB-01' },
    requested_by: { full_name: 'Alice Engineer' },
    vendor: null,
    vendor_id: null,
  } as ProcurementWithRefs;
}

const TWELVE = [
  ...Array.from({ length: 6 }, (_, i) => makeRow(i, 'Requested')),
  ...Array.from({ length: 6 }, (_, i) => makeRow(i + 6, 'Approved')),
];

const PERSISTING = TWELVE.filter((row) => row.id !== 'pr-2' && row.id !== 'pr-8').map((row) => row.id);

function Harness({ rows, withNavButton = false }: { rows: ProcurementWithRefs[]; withNavButton?: boolean }) {
  const navigate = useNavigate();
  return <>
    {withNavButton && (
      <button type="button" onClick={() => navigate('/procurement?other=1')}>navigate</button>
    )}
    <ProcurementGroupedView rows={rows} role="Project Manager" reasonText={new Map()} />
  </>;
}

beforeEach(() => {
  probes.reset();
});

describe('#2104 procurement lane — only changed rows re-render', () => {
  it('a search commit (a subset of the same row objects) re-renders zero persisting rows', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/procurement']}>
        <Harness rows={TWELVE} />
      </MemoryRouter>,
    );
    expect(probes.total()).toBe(12);

    probes.reset();
    // The page's search produces a NEW array holding the SAME row object references
    // (client-side filter over the fetched list) — two rows filtered out.
    rerender(
      <MemoryRouter initialEntries={['/procurement']}>
        <Harness rows={TWELVE.filter((row) => row.id !== 'pr-2' && row.id !== 'pr-8')} />
      </MemoryRouter>,
    );

    for (const id of PERSISTING) {
      expect(probes.rowRenders.get(id) ?? 0).toBe(0);
    }
    expect(probes.total()).toBe(0);
  });

  it('a URL change (return-context navigation) re-renders zero persisting rows', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/procurement']}>
        <Harness rows={TWELVE} withNavButton />
      </MemoryRouter>,
    );
    expect(probes.total()).toBe(12);

    probes.reset();
    await user.click(screen.getByRole('button', { name: 'navigate' }));

    for (const row of TWELVE) {
      expect(probes.rowRenders.get(row.id) ?? 0).toBe(0);
    }
    expect(probes.total()).toBe(0);
  });
});
