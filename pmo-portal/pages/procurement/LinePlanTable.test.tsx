import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LinePlanTable } from './LinePlanTable';

const lines = [{ id: 'l1', name: 'Cable' }, { id: 'l2', name: 'Pipe' }];
const rowOf = (name: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(name))!;

describe('LinePlanTable: one row per line, one column per planned fact', () => {
  it('AC-WPL-011 a cancelled work order stays visible, marked, on a line that already carries it, and is not offered elsewhere', () => {
    render(<LinePlanTable lines={lines} workOrders={{
      values: { l1: { workOrderId: 'w3', disciplineId: '' } }, onChange: () => {}, editable: true, requestWorkOrder: null, disciplines: [],
      options: [{ id: 'w3', label: 'WO-3', cancelled: true }, { id: 'w1', label: 'WO-1' }],
    }} />);
    const options = (name: string) => Array.from((screen.getByRole('combobox', { name: `Work order for ${name}` }) as HTMLSelectElement).options).map((o) => o.text);
    expect(options('Cable')).toEqual(['Same as the request', 'WO-1', 'WO-3 (cancelled)']);
    expect(options('Pipe')).toEqual(['Same as the request', 'WO-1']);
  });

  it('AC-PLP-010 a category picked on a row is reported for that line', async () => {
    const onChange = vi.fn();
    render(<LinePlanTable lines={lines} category={{ values: {}, onChange, editable: true, categories: [{ id: 'c1', name: 'Project', archived_at: null } as never] }} />);
    await userEvent.selectOptions(within(rowOf('Pipe')).getByRole('combobox', { name: 'Line category' }), 'c1');
    expect(onChange).toHaveBeenCalledWith('l2', 'c1');
  });

  it('AC-NBY-009 read-only, a line without its own date shows the order date it takes', () => {
    render(<LinePlanTable lines={lines} neededBy={{ values: { l2: '2026-12-15' }, onChange: () => {}, editable: false, orderDate: '2026-12-31' }} />);
    expect(within(rowOf('Cable')).getByText(/^31 Dec/)).toHaveClass('text-muted-foreground');
    expect(within(rowOf('Pipe')).getByText(/^15 Dec/)).toBeInTheDocument();
  });

  it('nothing to plan renders nothing', () => {
    const { container } = render(<LinePlanTable lines={lines} />);
    expect(container).toBeEmptyDOMElement();
  });
});
