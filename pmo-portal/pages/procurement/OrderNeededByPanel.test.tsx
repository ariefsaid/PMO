import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const h = vi.hoisted(() => ({
  required: { data: true as boolean | undefined, isPending: false, isError: false, refetch: vi.fn() },
  header: { data: null as string | null | undefined, isPending: false, isError: false, refetch: vi.fn() },
  repo: { procurement: { setNeededBy: vi.fn(async () => undefined) } },
}));
vi.mock('@/src/hooks/usePoNeededBy', () => ({
  usePoNeededByRequired: () => h.required,
  useProcurementNeededBy: () => ({ ...h.header, value: h.header.data ?? null }),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: h.repo }));
import { OrderNeededByPanel } from './OrderNeededByPanel';

const items = [{ id: 'i1', name: 'Pipe', needed_by: null }, { id: 'i2', name: 'Valve', needed_by: null }];
beforeEach(() => {
  h.required = { data: true, isPending: false, isError: false, refetch: vi.fn() };
  h.header = { data: null, isPending: false, isError: false, refetch: vi.fn() };
  h.repo.procurement.setNeededBy.mockClear();
});

describe('OrderNeededByPanel (1124d)', () => {
  it('AC-NBY-009 the rule is off: the panel renders nothing, so no purchase screen changes', () => {
    h.required.data = false;
    const { container } = render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-NBY-009 saving the order date sends it alone, so the database fills every line', async () => {
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.type(screen.getByLabelText('Order needed by'), '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.procurement.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', []));
  });
  it('AC-NBY-009 a line with its own date is sent as its own date', async () => {
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.type(screen.getByLabelText('Order needed by'), '2026-12-31');
    await userEvent.type(screen.getAllByLabelText('Line needed by')[1], '2026-12-15');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.procurement.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', [{ itemId: 'i2', neededBy: '2026-12-15' }]));
  });
  it('AC-NBY-009 clearing a line override explicitly restores the header date', async () => {
    h.header.data = '2026-12-31';
    const lineItems = [{ ...items[0] }, { ...items[1], needed_by: '2026-12-15' }];
    render(<OrderNeededByPanel procurementId="p1" items={lineItems} editable />);
    await userEvent.clear(screen.getAllByLabelText('Line needed by')[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.procurement.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', [{ itemId: 'i2', neededBy: null }]));
  });
  it('AC-NBY-009 setting a line date to the header date removes its exception', async () => {
    h.header.data = '2026-12-31';
    const lineItems = [{ ...items[0] }, { ...items[1], needed_by: '2026-12-15' }];
    render(<OrderNeededByPanel procurementId="p1" items={lineItems} editable />);
    const lineDate = screen.getAllByLabelText('Line needed by')[1];
    await userEvent.clear(lineDate);
    await userEvent.type(lineDate, '2026-12-31');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.repo.procurement.setNeededBy).toHaveBeenCalledWith('p1', '2026-12-31', [{ itemId: 'i2', neededBy: null }]));
  });
  it('AC-NBY-009 a pending organisation setting is shown as loading, not treated as off', () => {
    h.required = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const { container } = render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    expect(container.querySelector('[data-testid="liststate-loading"]')).toBeInTheDocument();
    expect(screen.queryByLabelText('Order needed by')).not.toBeInTheDocument();
  });
  it('AC-NBY-009 a pending header date is shown as loading, never as an empty date input', () => {
    h.header = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    expect(screen.queryByLabelText('Order needed by')).not.toBeInTheDocument();
  });
  it('AC-NBY-009 a failed organisation setting read exposes a retry instead of hiding the setting state', async () => {
    h.required = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.required.refetch).toHaveBeenCalled();
    expect(screen.queryByLabelText('Order needed by')).not.toBeInTheDocument();
  });
  it('AC-NBY-009 a failed header read exposes retry and never shows a blank editable date', async () => {
    h.required = { data: true, isPending: false, isError: false, refetch: vi.fn() };
    h.header = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    render(<OrderNeededByPanel procurementId="p1" items={items} editable />);
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.header.refetch).toHaveBeenCalled();
    expect(screen.queryByLabelText('Order needed by')).not.toBeInTheDocument();
  });
  it('AC-NBY-009 once the order is sent the dates are read-only', () => {
    h.header.data = '2026-12-31';
    render(<OrderNeededByPanel procurementId="p1" items={items} editable={false} />);
    expect(screen.getByTestId('order-needed-by-value')).toHaveTextContent('2026-12-31');
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
