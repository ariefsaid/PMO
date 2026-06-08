import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ProcurementDocumentsSection } from './ProcurementDocumentsSection';
import type { ProcurementDocumentRow } from '@/src/lib/db/procurementCrud';

const docs: ProcurementDocumentRow[] = [
  {
    id: 'd1', org_id: 'o', procurement_id: 'p', type: 'Spec sheet',
    reference_number: 'DOC-001', status: 'Approved', date: null, link: null,
  },
];

function renderSection(props: Partial<React.ComponentProps<typeof ProcurementDocumentsSection>> = {}) {
  const onAdd = props.onAdd ?? vi.fn().mockResolvedValue(undefined);
  const onDelete = props.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const onError = props.onError ?? vi.fn();
  const onRetry = props.onRetry ?? vi.fn();
  render(
    <ToastProvider>
      <ProcurementDocumentsSection
        documents={props.documents ?? docs}
        loading={props.loading ?? false}
        error={props.error ?? false}
        onRetry={onRetry}
        editable={props.editable ?? true}
        onAdd={onAdd}
        onDelete={onDelete}
        onError={onError}
      />
    </ToastProvider>,
  );
  return { onAdd, onDelete, onError, onRetry };
}

beforeEach(() => vi.clearAllMocks());

describe('AC-PROC-005 ProcurementDocumentsSection (metadata register)', () => {
  it('AC-PROC-005: lists document metadata with a tinted status pill', () => {
    renderSection();
    expect(screen.getByText('Spec sheet')).toBeInTheDocument();
    expect(screen.getByText('DOC-001')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('AC-PROC-005: loading + error states render', () => {
    const { rerender } = render(
      <ToastProvider>
        <ProcurementDocumentsSection
          documents={[]} loading error={false} onRetry={vi.fn()} editable
          onAdd={vi.fn()} onDelete={vi.fn()} onError={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
    rerender(
      <ToastProvider>
        <ProcurementDocumentsSection
          documents={[]} loading={false} error onRetry={vi.fn()} editable
          onAdd={vi.fn()} onDelete={vi.fn()} onError={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('AC-PROC-005: empty state teaches when there are no documents', () => {
    renderSection({ documents: [] });
    expect(screen.getByText(/No documents on this request yet/i)).toBeInTheDocument();
  });

  it('AC-PROC-005: Add document entry creates a metadata row (type + reference + status)', async () => {
    const { onAdd } = renderSection({ documents: [] });
    await userEvent.click(screen.getByTestId('add-document'));
    const form = screen.getByTestId('add-document-form');
    await userEvent.type(within(form).getByLabelText(/type/i), 'Datasheet');
    await userEvent.type(within(form).getByLabelText(/reference/i), 'DS-9');
    // Attach-file is a disabled affordance (Storage deferred), not a broken control.
    expect(within(form).getByTitle(/file upload coming soon/i)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: /add document/i }));
    expect(onAdd).toHaveBeenCalledWith({ type: 'Datasheet', referenceNumber: 'DS-9', status: 'Draft' });
  });

  it('AC-PROC-005: Remove confirms then delegates the delete', async () => {
    const { onDelete } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /remove spec sheet/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /remove document/i }));
    expect(onDelete).toHaveBeenCalledWith('d1');
  });

  it('AC-PROC-005: read-only mode hides add + remove chrome', () => {
    renderSection({ editable: false });
    expect(screen.getByText('Spec sheet')).toBeInTheDocument();
    expect(screen.queryByTestId('add-document')).toBeNull();
    expect(screen.queryByRole('button', { name: /remove spec sheet/i })).toBeNull();
  });
});
