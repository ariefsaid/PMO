import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { RevenuePlanModal } from './RevenuePlanModal';

const m = vi.hoisted(() => ({ setDay: vi.fn(), setMonth: vi.fn(), clear: vi.fn() }));
vi.mock('@/src/hooks/useWorkOrderRevenuePlan', () => ({
  useRevenuePlanMutations: () => ({ setDay: { mutateAsync: m.setDay }, setMonth: { mutateAsync: m.setMonth }, clear: { mutateAsync: m.clear } }),
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-12-15' }));

beforeEach(() => { setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' }); m.setDay.mockReset().mockResolvedValue(undefined); m.setMonth.mockReset().mockResolvedValue(23); m.clear.mockReset().mockResolvedValue(1); });

describe('RevenuePlanModal (#2671)', () => {
  it('AC-WRP-003 a month amount is sent with the first of the month and the keep-edited choice', async () => {
    const onClose = vi.fn();
    render(<RevenuePlanModal workOrderId="w" woLabel="WO-A" currency="IDR" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Amount/), '1000.01');
    await userEvent.click(screen.getByLabelText('Keep days I edited on their own'));
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(m.setMonth).toHaveBeenCalledWith({ workOrderId: 'w', month: '2026-12-01', amount: '1000.01', keepEdited: true }));
    expect(onClose).toHaveBeenCalled();
  });
  it('AC-WRP-005 refuses a missing or malformed amount before calling the server (FR-WRP-005)', async () => {
    render(<RevenuePlanModal workOrderId="w" woLabel="WO-A" currency="IDR" onClose={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect((await screen.findAllByText('Enter an amount.')).length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText(/Amount/), '1.234');
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect((await screen.findAllByText(/up to 2 decimals/)).length).toBeGreaterThan(0);
    expect(m.setMonth).not.toHaveBeenCalled();
  });
  it('shows the database refusal in the form and stays open', async () => {
    m.setMonth.mockRejectedValue(Object.assign(new Error('WRP_NO_WORKING_DAY: the month has no free working day on this work order'), { code: '23514' }));
    const onClose = vi.fn();
    render(<RevenuePlanModal workOrderId="w" woLabel="WO-A" currency="IDR" onClose={onClose} />);
    await userEvent.type(screen.getByLabelText(/Amount/), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(m.setMonth).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
