import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import WorkOrderLinesModal from '../WorkOrderLinesModal';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';
import type { ContractLineFacts } from '@/src/lib/progressBilling';

const item: BoqItemRow = {
  id: 'boq-1', org_id: 'org-1', project_id: 'project-1', earning_basis: 'unit_rate',
  line_no: null, import_key: null, item_code: 'SURVEY', description: 'Survey route',
  unit: 'km', quantity: 100, rate: 500, created_at: '',
};
const allocation: WorkOrderLineRow = {
  id: 'line-1', org_id: 'org-1', work_order_id: 'wo-1', boq_item_id: 'boq-1', quantity: 10, created_at: '',
};
const contractLine: ContractLineFacts = {
  boqItemId: 'boq-1', earningBasis: 'unit_rate', lineNo: 1, orderedQuantity: 10,
  acceptedQuantity: 0, closedFinal: 0, earnedQuantity: 0, contractBalance: 90, allocations: [],
};

function renderLines(onClose = vi.fn(), onUpdate = vi.fn().mockResolvedValue(undefined), facts = contractLine) {
  render(
    <WorkOrderLinesModal
      workOrder={{ id: 'wo-1', wo_number: 'WO-1', title: 'Survey', status: 'Draft' }}
      boqItems={[item]}
      contractLines={[facts]}
      allocations={[allocation]}
      canEdit
      onClose={onClose}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onUpdate={onUpdate}
      onDelete={vi.fn().mockResolvedValue(undefined)}
      onError={vi.fn()}
    />,
  );
  return { onClose, onUpdate };
}

describe('WorkOrderLinesModal unsaved line quantities', () => {
  it('C1: explains beside a disabled Remove that a confirmed BAST accepted the allocation', () => {
    renderLines(undefined, undefined, {
      ...contractLine,
      allocations: [{ workOrderId: 'wo-1', boqItemId: 'boq-1', quantity: 10, claimedQuantity: 0, acceptedQuantity: 5, final: false }],
    });

    const remove = screen.getByRole('button', { name: /Remove SURVEY/ });
    expect(remove).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/A confirmed BAST already accepted 5 km/);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('CMP-005: Done asks before dropping an edited allocation and Keep editing retains it', async () => {
    const user = userEvent.setup();
    const { onClose } = renderLines();
    const quantity = screen.getByRole('textbox', { name: /SURVEY — Survey route/i });
    await user.clear(quantity);
    await user.type(quantity, '12.5');
    await user.click(screen.getByRole('button', { name: /^Done$/i }));

    const discard = await screen.findByRole('alertdialog', { name: /unsaved line changes/i });
    await user.click(within(discard).getByRole('button', { name: /keep editing/i }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /SURVEY — Survey route/i })).toHaveValue('12.5');
  });

  it('CMP-012: the modal close action confirms a changed quantity and Keep editing retains it', async () => {
    const user = userEvent.setup();
    const { onClose } = renderLines();
    const quantity = screen.getByRole('textbox', { name: /SURVEY — Survey route/i });
    await user.clear(quantity);
    await user.type(quantity, '12.5');
    await user.click(screen.getByRole('button', { name: /^close$/i }));

    const discard = await screen.findByRole('alertdialog', { name: /discard unsaved line changes/i });
    await user.click(within(discard).getByRole('button', { name: /keep editing/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /SURVEY — Survey route/i })).toHaveValue('12.5');
  });

  it('CMP-006: a successfully saved allocation is clean and can close without a discard prompt', async () => {
    const user = userEvent.setup();
    const { onClose, onUpdate } = renderLines();
    const quantity = screen.getByRole('textbox', { name: /SURVEY — Survey route/i });
    await user.clear(quantity);
    await user.type(quantity, '12.5');
    await user.click(screen.getByRole('button', { name: /save SURVEY/i }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('line-1', 12.5));
    await user.click(screen.getByRole('button', { name: /^Done$/i }));

    expect(screen.queryByRole('dialog', { name: /unsaved line changes/i })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
