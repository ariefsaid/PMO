import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';

const wh = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id: `r${id}`, external_id: id, code: `W${id}`, name, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '', ...over });
const h = vi.hoisted(() => ({
  conn: { data: undefined as unknown },
  master: vi.fn(),
  save: { mutateAsync: vi.fn(), isPending: false },
  may: { setValue: true },
}));
vi.mock('@/src/hooks/useOdoo', () => ({ useOdooConnection: () => h.conn, useMasterRecords: h.master, useOdooSetup: () => h.save }));
vi.mock('./useOdooCan', () => ({ useOdooCan: () => h.may }));
import { OdooWarehouseDefault } from './OdooWarehouseDefault';

const ACTIVE = [wh('1', 'Main'), wh('2', 'Site'), wh('3', 'Old', { active: false }), wh('4', 'Gone', { tombstoned_at: '2026-01-01T00:00:00Z' })];
beforeEach(() => {
  vi.clearAllMocks();
  h.may = { setValue: true };
  h.conn.data = { status: 'active', activated: true, config: { default_warehouse_id: '1' } };
  h.master.mockImplementation((input: { externalIds?: string[] }) => ({ data: { rows: input.externalIds ? ACTIVE.filter((r) => input.externalIds!.includes(r.external_id)) : ACTIVE, total: 4 }, isPending: false }));
  h.save.mutateAsync.mockResolvedValue({});
});
afterEach(cleanup);
const choices = () => Array.from((screen.getByLabelText('Default receiving warehouse') as HTMLSelectElement).options).map((o) => o.textContent);

it('AC-ODC-060 only active, not-deleted warehouses are offered', () => {
  render(<OdooWarehouseDefault />);
  expect(choices()).toEqual(['Choose…', 'W1 Main', 'W2 Site']);
  expect(h.master).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warehouse' }), true);
  expect(h.master.mock.calls.every(([i]) => i.includeInactive !== true || i.externalIds)).toBe(true);
});

it('AC-ODC-060 saving sends the chosen warehouse as the default', async () => {
  render(<OdooWarehouseDefault />);
  fireEvent.change(screen.getByLabelText('Default receiving warehouse'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.save.mutateAsync).toHaveBeenCalledWith({ default_warehouse_id: '2' }));
});

it('AC-ODC-060 a default archived or deleted in Odoo says so and is not kept as a choice', () => {
  h.conn.data = { status: 'active', activated: true, config: { default_warehouse_id: '3' } };
  render(<OdooWarehouseDefault />);
  expect(screen.getByText(/Needs attention: the default warehouse was archived in Odoo/)).toBeInTheDocument();
  expect((screen.getByLabelText('Default receiving warehouse') as HTMLSelectElement).value).toBe('');
  cleanup();
  h.conn.data = { status: 'active', activated: true, config: { default_warehouse_id: '4' } };
  render(<OdooWarehouseDefault />);
  expect(screen.getByText(/Needs attention: the default warehouse was deleted in Odoo/)).toBeInTheDocument();
});

it('a role that cannot set values sees the default but no control', () => {
  h.may = { setValue: false };
  render(<OdooWarehouseDefault />);
  expect(screen.getByText('Main')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Default receiving warehouse')).not.toBeInTheDocument();
});

it('nothing is shown before the company is chosen', () => {
  h.conn.data = { status: 'active', activated: false, config: {} };
  const { container } = render(<OdooWarehouseDefault />);
  expect(container).toBeEmptyDOMElement();
});

it('AC-ODC-084 has no axe violations', async () => {
  const { container } = render(<OdooWarehouseDefault />);
  expect((await axe(container, { rules: { region: { enabled: false } } })).violations).toEqual([]);
});
