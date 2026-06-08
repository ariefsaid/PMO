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
      />
    </ToastProvider>,
  );
  return { onSave, onError };
}

beforeEach(() => vi.clearAllMocks());

describe('AC-PROC-002 ProcurementHeaderEdit (Draft-header inline edit)', () => {
  it('AC-PROC-002: shows an Edit affordance at rest (not a form)', () => {
    renderEdit();
    expect(screen.getByTestId('edit-header')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save request/i })).toBeNull();
  });

  it('AC-PROC-002: Edit flips to a form, edit + Save delegates the patch', async () => {
    const { onSave } = renderEdit();
    await userEvent.click(screen.getByTestId('edit-header'));
    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Welding consumables Q3');
    await userEvent.click(screen.getByRole('button', { name: /save request/i }));
    expect(onSave).toHaveBeenCalledWith({
      title: 'Welding consumables Q3',
      projectId: 'proj-1',
      vendorId: null,
    });
  });

  it('AC-PROC-002: Save is disabled when the title is cleared', async () => {
    renderEdit();
    await userEvent.click(screen.getByTestId('edit-header'));
    await userEvent.clear(screen.getByLabelText(/title/i));
    expect(screen.getByRole('button', { name: /save request/i })).toBeDisabled();
  });
});
