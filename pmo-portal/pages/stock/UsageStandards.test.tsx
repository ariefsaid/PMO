import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import i18n from '@/src/lib/i18n';

const q = (data: unknown, over: Record<string, unknown> = {}) => ({ data, isPending: false, isError: false, refetch: vi.fn(), ...over });
const h = vi.hoisted(() => ({
  role: 'Project Manager' as string,
  list: null as unknown, counts: null as unknown,
  create: { mutateAsync: vi.fn(), isPending: false }, update: { mutateAsync: vi.fn(), isPending: false }, archive: { mutateAsync: vi.fn(), isPending: false },
  filter: null as unknown,
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string) => (action === 'view' ? true : h.role !== 'Engineer') }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/components/stock/StockTabs', () => ({ StockTabs: () => null }));
vi.mock('@/src/hooks/useUsageStandards', () => ({
  useUsageStandards: (f: unknown) => { h.filter = f; return h.list; },
  useStandardMatchCounts: () => h.counts,
  useUsageStandardMutations: () => ({ create: h.create, update: h.update, archive: h.archive }),
}));
vi.mock('@/src/hooks/useStock', () => ({
  useStockItems: () => q([{ id: 'i1', code: 'ROD', name: 'Welding rod', unit_id: 'u1', archived_at: null }, { id: 'i2', code: 'OLD', name: 'Retired', unit_id: 'u1', archived_at: '2026-01-01' }]),
  useStockUnits: () => q([{ id: 'u1', code: 'KG' }]),
}));

import UsageStandards from './UsageStandards';

const std = (over: Record<string, unknown> = {}) => ({ id: 's1', itemId: 'i1', workUnit: 'dia-inch', boqCodePrefix: 'WLD', qtyPerUnit: '0.050000', marginPct: '10.00', archivedAt: null, ...over });
const renderPage = () => render(<MemoryRouter><ToastProvider><UsageStandards /></ToastProvider></MemoryRouter>);

beforeEach(async () => {
  await i18n.changeLanguage('en');
  h.role = 'Project Manager';
  h.list = q({ rows: [std(), std({ id: 's2', workUnit: 'm2', boqCodePrefix: null, qtyPerUnit: '0.3', marginPct: '0.00' })], total: 2 });
  h.counts = q({ s1: 3, s2: 0 });
  h.create.mutateAsync = vi.fn().mockResolvedValue(undefined);
  h.update.mutateAsync = vi.fn().mockResolvedValue(undefined);
  h.archive.mutateAsync = vi.fn().mockResolvedValue(undefined);
});

describe('usage standards screen (#2577)', () => {
  it('FR-CUS-004 lists each standard with its item, unit, prefix, quantity in the item unit, margin and how many live lines it matches', () => {
    renderPage();
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('dia-inch'))!;
    expect(within(row).getByText('ROD')).toBeInTheDocument();
    expect(within(row).getByText(/starts with WLD/)).toBeInTheDocument();
    expect(within(row).getByText(/0\.05 KG/)).toBeInTheDocument();
    expect(within(row).getByText('10%')).toBeInTheDocument();
    expect(within(row).getByText('3 lines')).toBeInTheDocument();
  });

  it('FR-CUS-004 a standard that matches no live line says so (the symptom of a mistyped work unit)', () => {
    renderPage();
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('m2'))!;
    expect(within(row).getByText('No lines')).toBeInTheDocument();
    expect(within(row).getByText('any line')).toBeInTheDocument();
  });

  it('FR-CUS-004 an unavailable match count is said, never shown as zero', () => {
    h.counts = q(undefined, { isError: true });
    renderPage();
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText('No lines')).not.toBeInTheDocument();
  });

  it('FR-CUS-004 the filters feed the list query and start again at page one', async () => {
    renderPage();
    expect(h.filter).toMatchObject({ includeArchived: false, page: 0 });
    await userEvent.type(screen.getByLabelText('Work unit'), 'd');
    expect(h.filter).toMatchObject({ workUnit: 'd', page: 0 });
  });

  it('AC-CUS-011 an Engineer reads the list but has no way to add, edit or archive', () => {
    h.role = 'Engineer';
    renderPage();
    expect(screen.getByText('dia-inch')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New standard' })).not.toBeInTheDocument();
  });

  it('FR-CUS-001 a writer adds a standard: the typed decimals reach the repository as typed', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New standard' }));
    await userEvent.selectOptions(screen.getByLabelText(/^Consumable/), 'i1');
    await userEvent.type(screen.getByLabelText(/^Unit of work/), 'dia-inch');
    await userEvent.type(screen.getByLabelText(/^Quantity per unit of work/), '0.05');
    await userEvent.type(screen.getByLabelText('Waste margin %'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Add standard' }));
    expect(h.create.mutateAsync).toHaveBeenCalledWith({ itemId: 'i1', workUnit: 'dia-inch', boqCodePrefix: null, qtyPerUnit: '0.05', marginPct: '10' });
  });

  it('AC-CUS-014 an archived item is not offered for a new standard', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New standard' }));
    const options = within(screen.getByLabelText(/^Consumable/)).getAllByRole('option').map((o) => o.textContent);
    expect(options.join('|')).toContain('ROD');
    expect(options.join('|')).not.toContain('OLD');
  });

  it('FR-CUS-001 a quantity of zero is refused in the form before it is sent', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New standard' }));
    await userEvent.selectOptions(screen.getByLabelText(/^Consumable/), 'i1');
    await userEvent.type(screen.getByLabelText(/^Unit of work/), 'm');
    await userEvent.type(screen.getByLabelText(/^Quantity per unit of work/), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Add standard' }));
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findAllByText(/above zero/)).not.toHaveLength(0);
  });

  it('AC-CUS-003 a duplicate refusal is explained on the form, not as a generic failure', async () => {
    h.create.mutateAsync = vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New standard' }));
    await userEvent.selectOptions(screen.getByLabelText(/^Consumable/), 'i1');
    await userEvent.type(screen.getByLabelText(/^Unit of work/), 'dia-inch');
    await userEvent.type(screen.getByLabelText(/^Quantity per unit of work/), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Add standard' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
  });

  it('FR-CUS-001 a failed list read is an error with a retry, never an empty list', () => {
    h.list = q(undefined, { isError: true });
    renderPage();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
    expect(screen.queryByText('No usage standards yet')).not.toBeInTheDocument();
  });

  it('an empty list invites the first standard', () => {
    h.list = q({ rows: [], total: 0 });
    renderPage();
    expect(screen.getByText('No usage standards yet')).toBeInTheDocument();
  });
});
