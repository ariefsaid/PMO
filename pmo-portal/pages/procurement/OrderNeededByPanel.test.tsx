import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const h = vi.hoisted(() => ({ required: true, header: null as string | null, set: vi.fn(async () => undefined), reload: vi.fn() }));
vi.mock('@/src/hooks/usePoNeededBy', () => ({
  usePoNeededByRequired: () => h.required,
  useProcurementNeededBy: () => ({ value: h.header, reload: h.reload }),
}));
vi.mock('@/src/lib/db/procurementNeededBy', () => ({ setProcurementNeededBy: h.set }));
import { OrderNeededByPanel } from './OrderNeededByPanel';

const items = [{ id: 'i1', name: 'Pipe', needed_by: null }, { id: 'i2', name: 'Valve', needed_by: null }];
beforeEach(() => { h.required = true; h.header = null; h.set.mockClear(); h.reload.mockClear(); });

describe('OrderNeededByPanel (1124d)', () => {
  it('AC-NBY-009 the rule is off: the panel renders nothing, so no purchase screen changes', () => {
    h.required = false;
    const { container } = render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-NBY-009 saving the order date sends it alone, so the database fills every line', async () => {
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.type(screen.getByLabelText('Order needed by'), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('p1', '2026-12-31', []));
  });
  it('AC-NBY-009 a line with its own date is sent as its own date', async () => {
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.type(screen.getByLabelText('Order needed by'), '2026-12-31');
    await userEvent.type(screen.getAllByLabelText('Line needed by')[1], '2026-12-15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.set).toHaveBeenCalledWith('p1', '2026-12-31', [{ itemId: 'i2', neededBy: '2026-12-15' }]));
  });
  it('AC-NBY-009 once the order is sent the dates are read-only', () => {
    h.header = '2026-12-31';
    render(<OrderNeededByPanel procurementId="p1" items={items} editable={false} />);
    expect(screen.getByTestId('order-needed-by-value')).toHaveTextContent('2026-12-31');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
