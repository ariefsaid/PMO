import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LineWorkOrdersSection } from './LineWorkOrdersSection';

describe('AC-WPL-011 LineWorkOrdersSection empty states', () => {
  const lines = [{ id: 'l1', name: 'Cable' }];
  it('with no project it says to choose one first', () => {
    render(<LineWorkOrdersSection lines={lines} values={{}} onChange={() => {}} workOrders={null} disciplines={[]} />);
    expect(screen.getByTestId('line-work-orders-empty')).toHaveTextContent('Choose a project first');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('with a project that has no work orders it says what is missing and who adds them', () => {
    render(<LineWorkOrdersSection lines={lines} values={{}} onChange={() => {}} workOrders={[]} disciplines={[]} />);
    expect(screen.getByTestId('line-work-orders-empty')).toHaveTextContent('A project manager adds work orders');
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('a cancelled work order stays visible, marked, on a line that already carries it', () => {
    render(<LineWorkOrdersSection lines={lines} values={{ l1: { workOrderId: 'w3', disciplineId: '' } }} onChange={() => {}} workOrders={[{ id: 'w3', label: 'WO-3', cancelled: true }, { id: 'w1', label: 'WO-1' }]} disciplines={[]} />);
    const labels = Array.from((screen.getByRole('combobox', { name: 'Work order for Cable' }) as HTMLSelectElement).options).map((o) => o.text);
    expect(labels).toEqual(['Same as the request', 'WO-1', 'WO-3 (cancelled)']);
  });
});
