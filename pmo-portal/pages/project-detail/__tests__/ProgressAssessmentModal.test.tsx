import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import ProgressAssessmentModal from '../ProgressAssessmentModal';

const line = (id: string, code: string, description: string, unit: string) =>
  ({ id, org_id: 'o', project_id: 'p', work_order_id: null, item_code: code, description, unit, quantity: 10, rate: 50000, created_at: '' }) as BoqItemRow;
const BOQ = [line('b1', 'SURVEY', 'Route survey', 'km'), line('b2', 'STATION', 'Station build', 'unit')];

function renderModal() {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProgressAssessmentModal boqItems={BOQ} assessedByBoqItem={{ b1: 6 }} defaultMonth="2026-09"
    onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}

describe('ProgressAssessmentModal', () => {
  it('AC-PB-019 every BoQ line is offered, pre-filled with the latest assessed quantity', () => {
    renderModal();
    expect(screen.getByLabelText(/SURVEY/)).toHaveValue('6');
    expect(screen.getByLabelText(/STATION/)).toHaveValue('');
    expect(screen.getByLabelText(/Month/)).toHaveValue('2026-09');
  });

  it('AC-PB-019 a save sends every line, blank as 0, with the first of the month', async () => {
    const { onSave, user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    expect(onSave).toHaveBeenCalledWith({
      month: '2026-09-01',
      quantities: [{ boqItemId: 'b1', quantityToDate: 6 }, { boqItemId: 'b2', quantityToDate: 0 }],
      note: null,
    });
  });

  it.each(['-1', '1.2345'])('AC-PB-019 a quantity of %s is refused', async (value) => {
    const { onSave, user } = renderModal();
    await user.type(screen.getByLabelText(/STATION/), value);
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    expect((await screen.findAllByText('Each quantity done to date must be 0 or more with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-019 a malformed month is refused', async () => {
    const { onSave, user } = renderModal();
    await user.clear(screen.getByLabelText(/Month/));
    await user.type(screen.getByLabelText(/Month/), '2026-13');
    await user.click(screen.getByRole('button', { name: 'Save progress' }));
    expect((await screen.findAllByText('Enter the month as YYYY-MM')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});
