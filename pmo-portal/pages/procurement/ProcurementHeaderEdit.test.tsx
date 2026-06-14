import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [{ value: 'proj-1', label: 'HQ Fit-Out' }] }),
  useVendorOptions: () => ({ data: [] }),
}));

import { ProcurementHeaderEdit } from './ProcurementHeaderEdit';

function renderEdit(props: Partial<React.ComponentProps<typeof ProcurementHeaderEdit>> = {}) {
  const onSave = props.onSave ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  const onClose = props.onClose ?? vi.fn();
  render(
    <ToastProvider>
      <ProcurementHeaderEdit
        title={props.title ?? 'Welding consumables'}
        projectId={props.projectId ?? 'proj-1'}
        projectName={props.projectName ?? 'HQ Fit-Out'}
        vendorId={props.vendorId ?? null}
        vendorName={props.vendorName ?? null}
        onSave={onSave}
        onError={onError}
        onClose={onClose}
      />
    </ToastProvider>,
  );
  return { onSave, onError, onClose };
}

beforeEach(() => vi.clearAllMocks());

// CW-3a: the Edit affordance moved to the canonical RecordHeader action zone (it is owned
// by ProcurementDetails now); this panel is CONTROLLED — when mounted it renders the edit
// form directly. The goal-oracle (Save delegates the right patch; Save disabled on empty
// title; Save closes the panel) is unchanged.
describe('AC-PROC-002 ProcurementHeaderEdit (Draft-header inline edit)', () => {
  it('AC-PROC-002: renders the edit form directly when mounted (opened from the header Edit action)', () => {
    renderEdit();
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save request/i })).toBeInTheDocument();
  });

  it('AC-PROC-002: edit + Save delegates the patch and closes the panel', async () => {
    const { onSave, onClose } = renderEdit();
    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Welding consumables Q3');
    await userEvent.click(screen.getByRole('button', { name: /save request/i }));
    expect(onSave).toHaveBeenCalledWith({
      title: 'Welding consumables Q3',
      projectId: 'proj-1',
      vendorId: null,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-PROC-002: Save is disabled when the title is cleared', async () => {
    renderEdit();
    await userEvent.clear(screen.getByLabelText(/title/i));
    expect(screen.getByRole('button', { name: /save request/i })).toBeDisabled();
  });

  it('AC-PROC-002: Cancel closes the panel', async () => {
    const { onClose } = renderEdit();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
