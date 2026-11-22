/** #2668 AC-WAG-008 — the work-order form offers area and group pickers only while the organisation keeps such a list. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderLists } from '@/src/hooks/useWorkOrderLists';

const h = vi.hoisted(() => ({ lists: null as unknown }));
vi.mock('@/src/hooks/useWorkOrderLists', () => ({ useWorkOrderLists: () => h.lists }));
import WorkOrderFormModal from '../WorkOrderFormModal';

const e = (id: string, name: string, archived_at: string | null = null) => ({ id, code: id, name, archived_at });
const NONE: WorkOrderLists = { areas: [], groups: [], liveAreas: [], liveGroups: [], hasLists: false };
const AREAS = [e('a-n', 'North'), e('a-old', 'Retired', '2026-01-01')];
const WITH_AREAS: WorkOrderLists = { areas: AREAS, groups: [], liveAreas: [AREAS[0]], liveGroups: [], hasLists: true };

const draft = (over: Partial<WorkOrderRow> = {}) => ({
  id: 'wo-1', org_id: 'o', project_id: 'p1', title: 'Phase 1', description: null, client_po_number: null, status: 'Draft',
  order_date: null, start_date: null, end_date: null, area_id: null, group_id: null, ...over,
}) as unknown as WorkOrderRow;

const onCreate = vi.fn();
const onUpdate = vi.fn();
const renderForm = (workOrder: WorkOrderRow | null) =>
  render(<WorkOrderFormModal workOrder={workOrder} currencySymbolPrefix="$" onClose={vi.fn()} onCreate={onCreate} onUpdate={onUpdate} />);

beforeEach(() => { h.lists = NONE; onCreate.mockReset().mockResolvedValue(undefined); onUpdate.mockReset().mockResolvedValue(undefined); });

describe('AC-WAG-008 area and group pickers', () => {
  it('AC-WAG-008 shows no picker, and sends no area or group, when the organisation has no lists', async () => {
    renderForm(draft());
    expect(screen.queryByTestId('wo-area')).not.toBeInTheDocument();
    expect(screen.queryByTestId('wo-group')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Title/), ' b');
    await userEvent.click(screen.getByRole('button', { name: 'Save work order' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('areaId');
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('groupId');
  });

  it('AC-WAG-008 lists only live areas (no group picker without live groups) and sends the chosen area on create', async () => {
    h.lists = WITH_AREAS;
    renderForm(null);
    const area = screen.getByTestId('wo-area');
    expect(screen.queryByTestId('wo-group')).not.toBeInTheDocument();
    expect(Array.from(area.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['No area', 'North']);
    await userEvent.type(screen.getByLabelText(/Title/), 'Phase 2');
    await userEvent.type(screen.getByTestId('wo-order-value'), '500');
    await userEvent.selectOptions(screen.getByTestId('wo-tax-treatment'), 'exclusive');
    await userEvent.type(screen.getByTestId('wo-tax-amount'), '0');
    await userEvent.selectOptions(area, 'a-n');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0]).toMatchObject({ areaId: 'a-n' });
  });

  it('AC-WAG-008 keeps an archived area the work order already names in its own picker, and can clear it', async () => {
    h.lists = WITH_AREAS;
    renderForm(draft({ area_id: 'a-old' }));
    const area = screen.getByTestId('wo-area') as HTMLSelectElement;
    expect(area.value).toBe('a-old');
    await userEvent.selectOptions(area, '');
    await userEvent.click(screen.getByRole('button', { name: 'Save work order' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate.mock.calls[0][1]).toMatchObject({ areaId: null });
  });
});
