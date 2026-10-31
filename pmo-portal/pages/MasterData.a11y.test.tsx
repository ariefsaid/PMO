import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { axe } from 'jest-axe';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const h = vi.hoisted(() => ({ records: vi.fn() }));
vi.mock('@/src/hooks/useOdoo', () => ({
  useMasterRecords: (input: unknown, enabled?: boolean) => h.records(input, enabled),
  useMasterSummary: () => ({ data: { inactive: 1, tombstoned: 1, asOf: '2026-11-01T08:00:00Z' } }),
  useOdooConnection: () => ({ data: { status: 'active', activated: true, capabilities: { missing: [] }, connection: { state: 'unreachable', failures: 3, last_ok_at: null, last_checked_at: '2026-11-01T08:00:00Z', error_class: 'unreachable', missing: [] }, config: {} } }),
}));
import MasterDataPage from './MasterData';

const rows = [
  { id: 'a', external_id: '1', code: 'SM-1', name: 'Semen', parent_external_id: null, active: true, tombstoned_at: null, attrs: { uom_id: '5', purchasable: true, sellable: true }, as_of: '2026-11-01T08:00:00Z' },
  { id: 'b', external_id: '2', code: null, name: 'Pasir', parent_external_id: null, active: false, tombstoned_at: null, attrs: {}, as_of: '2026-11-01T08:00:00Z' },
];
beforeEach(() => { h.records.mockReturnValue({ data: { rows, total: 2 }, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }); });

it('AC-ODC-084 the directory page has no axe violations (items, with the unreachable notice showing)', async () => {
  const { container } = render(
    <ImpersonationProvider realRole="Admin"><MemoryRouter initialEntries={['/master-data/product']}><Routes><Route path="/master-data/:kind" element={<MasterDataPage />} /></Routes></MemoryRouter></ImpersonationProvider>,
  );
  expect(await screen.findByRole('tablist')).toBeInTheDocument();
  expect((await axe(container)).violations).toEqual([]);
});
