import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

/**
 * AC-WCA-014 — the shared work-order and discipline pickers (#2517). A user picks one of the project's open work
 * orders (never a cancelled one) and one of the org's disciplines; with no project the work-order picker is
 * unavailable and says why; moving the record to another project drops the old project's work order.
 */
const h = vi.hoisted(() => ({
  workOrders: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  disciplines: { data: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  projectArg: [] as string[],
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectWorkOrders: (projectId: string) => { h.projectArg.push(projectId); return h.workOrders; },
}));
vi.mock('@/src/hooks/useWorkOrderCosts', () => ({ useCostDisciplines: () => h.disciplines }));

import { CostAttributionFields } from './CostAttributionFields';

beforeEach(() => {
  h.projectArg.length = 0;
  h.workOrders.data = [
    { id: 'wo1', wo_number: 'WO-001', title: 'Pipe rack', status: 'Issued', client_po_number: 'PO-9' },
    { id: 'wo2', wo_number: null, title: 'Tie-ins', status: 'Draft', client_po_number: null },
    { id: 'wo3', wo_number: 'WO-003', title: 'Scrapped scope', status: 'Cancelled', client_po_number: null },
  ];
  h.disciplines.data = [{ id: 'd1', code: 'CIV', name: 'Civil' }, { id: 'd2', code: 'MEC', name: 'Mechanical' }];
});

describe('AC-WCA-014 CostAttributionFields', () => {
  it('AC-WCA-014 offers the project\'s open work orders, never a cancelled one, and picks one', async () => {
    const onChange = vi.fn();
    render(<CostAttributionFields projectId="p1" value={{ workOrderId: null, disciplineId: null }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Work order' }));
    expect(await screen.findByRole('option', { name: /WO-001/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Tie-ins/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /WO-003/ })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: /WO-001/ }));
    expect(onChange).toHaveBeenLastCalledWith({ workOrderId: 'wo1', disciplineId: null });
    expect(h.projectArg).toContain('p1');
  });

  it('AC-WCA-014 picks a discipline from the org\'s list', async () => {
    const onChange = vi.fn();
    render(<CostAttributionFields projectId="p1" value={{ workOrderId: 'wo1', disciplineId: null }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Discipline' }));
    await userEvent.click(await screen.findByRole('option', { name: /Mechanical/ }));
    expect(onChange).toHaveBeenLastCalledWith({ workOrderId: 'wo1', disciplineId: 'd2' });
  });

  it('AC-WCA-014 without a project the work-order picker is unavailable and says why', () => {
    render(<CostAttributionFields projectId={null} value={{ workOrderId: null, disciplineId: null }} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Work order' })).toBeDisabled();
    expect(screen.getByText('Choose a project to pick one of its work orders.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Discipline' })).not.toBeDisabled();
  });

  it('AC-WCA-014 moving to another project drops the old project\'s work order, keeps the discipline', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CostAttributionFields projectId="p1" value={{ workOrderId: 'wo1', disciplineId: 'd1' }} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<CostAttributionFields projectId="p2" value={{ workOrderId: 'wo1', disciplineId: 'd1' }} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith({ workOrderId: null, disciplineId: 'd1' });
  });
});
