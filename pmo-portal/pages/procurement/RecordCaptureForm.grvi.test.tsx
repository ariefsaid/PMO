/**
 * RecordCaptureForm — Goods Receipt + Vendor Invoice folding (refactor:
 * procurement-detail-dedup). These specs lock the BEHAVIORAL CONTRACT the GR/VI
 * standalone forms previously hand-rolled inline in ProcurementDetails.tsx:
 *   - the `onStage` path stages (does NOT create directly) — no toast, no onCreate
 *   - the exact per-kind fields (GR: ref+status+date, NO amount; VI: ref+amount+status+date)
 *   - the PRESERVED data-testids the unit + e2e BDD layer keys off
 *   - VI status options exclude Paid (N1)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { RecordCaptureForm, RecordCaptureTrigger } from './RecordCaptureForm';

function renderForm(props: Partial<React.ComponentProps<typeof RecordCaptureForm>>) {
  const onCreate = props.onCreate ?? vi.fn().mockResolvedValue(undefined);
  const onClose = props.onClose ?? vi.fn();
  render(
    <ToastProvider>
      <RecordCaptureForm
        kind={props.kind ?? 'goods_receipt'}
        onCreate={onCreate}
        onClose={onClose}
        onStage={props.onStage}
        busy={props.busy}
        invoices={props.invoices}
      />
    </ToastProvider>,
  );
  return { onCreate, onClose, onStage: props.onStage };
}

describe('RecordCaptureForm — Goods Receipt kind', () => {
  it('exposes the PRESERVED GR data-testids (form/ref/status/date/save), default status Complete, NO amount', () => {
    renderForm({ kind: 'goods_receipt' });
    const form = screen.getByTestId('form-create-gr');
    expect(within(form).getByTestId('gr-ref-input')).toHaveAttribute('placeholder', 'e.g. DN-44120');
    const status = within(form).getByTestId('gr-status-select') as HTMLSelectElement;
    expect(status.value).toBe('Complete');
    // GR options are exactly Partial + Complete
    expect(Array.from(status.options).map((o) => o.value)).toEqual(['Partial', 'Complete']);
    expect(within(form).getByTestId('gr-date-input')).toBeInTheDocument();
    expect(within(form).getByTestId('btn-save-gr')).toBeInTheDocument();
    // GR has NO amount field
    expect(within(form).queryByTestId('vi-amount-input')).toBeNull();
    expect(form.querySelector('[name="amount"]')).toBeNull();
  });

  it('onStage stages the parsed GR fields and does NOT call onCreate / show a toast', async () => {
    const onStage = vi.fn();
    const { onCreate } = renderForm({ kind: 'goods_receipt', onStage });
    const status = screen.getByTestId('gr-status-select');
    await userEvent.selectOptions(status, 'Partial');
    await userEvent.type(screen.getByTestId('gr-ref-input'), 'DN-99');
    await userEvent.click(screen.getByTestId('btn-save-gr'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'createGR',
        status: 'Partial',
        referenceNumber: 'DN-99',
      }),
    );
    // Empty ref becomes null (verified by a second render path below)
  });

  it('empty GR ref stages referenceNumber null', async () => {
    const onStage = vi.fn();
    renderForm({ kind: 'goods_receipt', onStage });
    await userEvent.click(screen.getByTestId('btn-save-gr'));
    expect(onStage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'createGR', referenceNumber: null }),
    );
  });
});

describe('RecordCaptureForm — Vendor Invoice kind', () => {
  it('exposes the PRESERVED VI data-testids (form/ref/amount/status/date/save), default status Received, options exclude Paid', () => {
    renderForm({ kind: 'vendor_invoice' });
    const form = screen.getByTestId('form-create-vi');
    expect(within(form).getByTestId('vi-ref-input')).toHaveAttribute('placeholder', 'e.g. INV-2291');
    expect(within(form).getByTestId('vi-amount-input')).toBeInTheDocument();
    const status = within(form).getByTestId('vi-status-select') as HTMLSelectElement;
    expect(status.value).toBe('Received');
    expect(Array.from(status.options).map((o) => o.value)).toEqual(['Received', 'Scheduled']);
    expect(within(form).getByTestId('vi-date-input')).toBeInTheDocument();
    expect(within(form).getByTestId('btn-save-vi')).toBeInTheDocument();
  });

  it('onStage stages the parsed VI fields (amount parsed, ref/null) and skips onCreate', async () => {
    const onStage = vi.fn();
    const { onCreate } = renderForm({ kind: 'vendor_invoice', onStage });
    await userEvent.type(screen.getByTestId('vi-ref-input'), 'INV-7');
    await userEvent.type(screen.getByTestId('vi-amount-input'), '1,250.50');
    await userEvent.click(screen.getByTestId('btn-save-vi'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(onStage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'createVI',
        status: 'Received',
        referenceNumber: 'INV-7',
        amount: 1250.5,
      }),
    );
  });
});

describe('RecordCaptureTrigger — GR/VI label + testid overrides', () => {
  it('GR trigger uses btn-create-gr + "Record goods receipt"', () => {
    render(<RecordCaptureTrigger kind="goods_receipt" open={false} onOpen={() => {}} />);
    const trigger = screen.getByTestId('btn-create-gr');
    expect(trigger).toHaveTextContent(/record goods receipt/i);
    // D17: ghost/link styling — never a solid fill at rest
    expect(trigger.className).not.toContain('bg-primary');
  });

  it('VI trigger uses btn-create-vi + "Record vendor invoice"', () => {
    render(<RecordCaptureTrigger kind="vendor_invoice" open={false} onOpen={() => {}} />);
    const trigger = screen.getByTestId('btn-create-vi');
    expect(trigger).toHaveTextContent(/record vendor invoice/i);
    expect(trigger.className).not.toContain('bg-primary');
  });
});
