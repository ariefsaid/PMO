# Plan #766 — part 4: UI (dialogs, Billing tab, strings)

> Part of [`2026-10-06-progress-billing.md`](2026-10-06-progress-billing.md). Tasks C15–C29. Requires part 3.
> Next: [part 5](2026-10-06-progress-billing.part5-pack-e2e.md).
>
> House rules this part follows: shared form primitives (`EntityFormModal`, `NumberField`, `SelectField`,
> `TextField`, `TextArea`, `FormSection`, `FormGrid`, `Combobox`) with `WorkOrderFormModal.tsx` as the template;
> money and quantities parsed ONLY with `parseMoneyInputAtScale` (the viewer's number convention, #468) and
> seeded ONLY with `formatMoneyInputValue`; every displayed number through `src/lib/format.ts`
> (`formatCurrencyCents`, `formatNumberExact`, `formatUtcMonthYear` — no `Intl`/`toLocaleString` elsewhere, eslint
> enforces it); every destructive or ERP-bound write behind `ConfirmDialog`; a refused save leaves a persistent
> error in the dialog (`submitError`, #559) as well as the toast.

### Task C15 — test: BoQ line dialog (RED) · AC-PB-015

Create `pmo-portal/pages/project-detail/__tests__/BoqItemFormModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: vi.fn() }) }));
import BoqItemFormModal from '../BoqItemFormModal';

const WO = { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' } as WorkOrderRow;

function renderForm(item: BoqItemRow | null = null) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><BoqItemFormModal item={item} workOrders={[WO]} currencySymbolPrefix="Rp" onClose={vi.fn()} onSave={onSave} onError={vi.fn()} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}

async function fill(user: ReturnType<typeof userEvent.setup>, quantity: string, rate: string) {
  await user.type(screen.getByLabelText(/ERP item/), 'SURVEY');
  await user.type(screen.getByLabelText(/Description/), 'Route survey');
  await user.type(screen.getByLabelText(/Unit/), 'km');
  await user.type(screen.getByLabelText(/^Quantity/), quantity);
  await user.type(screen.getByLabelText(/Rate/), rate);
}

describe('BoqItemFormModal', () => {
  it('AC-PB-015 a valid line sends the exact input', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '10', '50000');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith({ itemCode: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, workOrderId: null });
  });

  it('AC-PB-015 a quantity with 4 decimals is refused', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '1.2345', '50000');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect((await screen.findAllByText('Enter a quantity above 0 with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-015 a negative rate is refused', async () => {
    const { onSave, user } = renderForm();
    await fill(user, '10', '-1');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect((await screen.findAllByText('Enter a rate of 0 or more with at most 2 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("AC-PB-015 the work order choice is this project's work orders plus none, and is sent", async () => {
    const { onSave, user } = renderForm();
    const select = screen.getByLabelText(/Work order/);
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(['None — the whole contract', 'WO-001 — Phase 1']);
    await fill(user, '10', '50000');
    await user.selectOptions(select, 'wo-1');
    await user.click(screen.getByRole('button', { name: 'Save line' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ workOrderId: 'wo-1' }));
  });

  it('AC-PB-015 editing seeds the stored line', () => {
    renderForm({ id: 'b1', org_id: 'o', project_id: 'p', work_order_id: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' } as BoqItemRow);
    expect(screen.getByLabelText(/Description/)).toHaveValue('Route survey');
    expect(screen.getAllByText('Edit bill of quantities line').length).toBeGreaterThan(0);
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/BoqItemFormModal.test.tsx` — Expect: module not found.

### Task C16 — BoQ line dialog (GREEN) · AC-PB-015

Create `pmo-portal/pages/project-detail/BoqItemFormModal.tsx`:

```tsx
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Combobox, EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import type { BoqItemInput, BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * Add or edit one bill-of-quantities line (#766). Rates exclude tax (DD-PBL-6). When ERPNext owns the revenue
 * domain the item is picked from the ERP catalogue (the line becomes an invoice line); otherwise it is typed.
 */
interface FormValues { itemCode: string; description: string; unit: string; quantity: string; rate: string; workOrderId: string }

export interface BoqItemFormModalProps {
  /** null = add a line; a row = edit it. */
  item: BoqItemRow | null;
  /** This project's work orders. */
  workOrders: WorkOrderRow[];
  currencySymbolPrefix: string;
  onClose: () => void;
  onSave: (input: BoqItemInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const BoqItemFormModal: React.FC<BoqItemFormModalProps> = ({ item, workOrders, currencySymbolPrefix, onClose, onSave, onError }) => {
  const { t } = useTranslation();
  const erpItems = useErpItemOptions('sales');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const validate = useCallback((v: FormValues) => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    const required = t('projectDetail.billing.boqForm.errors.required', 'Required');
    if (!v.itemCode.trim()) errors.itemCode = required;
    if (!v.description.trim()) errors.description = required;
    if (!v.unit.trim()) errors.unit = required;
    const quantity = parseMoneyInputAtScale(v.quantity, 3);
    if (quantity === null || quantity <= 0) errors.quantity = t('projectDetail.billing.boqForm.errors.quantity', 'Enter a quantity above 0 with at most 3 decimal places');
    const rate = parseMoneyInputAtScale(v.rate, 2);
    if (rate === null || rate < 0) errors.rate = t('projectDetail.billing.boqForm.errors.rate', 'Enter a rate of 0 or more with at most 2 decimal places');
    return errors;
  }, [t]);

  const form = useEntityForm<FormValues>({
    initialValues: item
      ? { itemCode: item.item_code, description: item.description, unit: item.unit,
          quantity: formatMoneyInputValue(Number(item.quantity)), rate: formatMoneyInputValue(Number(item.rate)),
          workOrderId: item.work_order_id ?? '' }
      : { itemCode: '', description: '', unit: '', quantity: '', rate: '', workOrderId: '' },
    validate,
    idPrefix: 'boq-item',
    module: 'billing',
    requiredFields: ['itemCode', 'description', 'unit', 'quantity', 'rate'],
  });
  const itemField = form.fieldProps('itemCode');
  const descriptionField = form.fieldProps('description');
  const unitField = form.fieldProps('unit');
  const quantityField = form.fieldProps('quantity');
  const rateField = form.fieldProps('rate');
  const woField = form.fieldProps('workOrderId');

  const checked = { itemCode: itemField, description: descriptionField, unit: unitField, quantity: quantityField, rate: rateField };
  const errorSummary = (() => {
    const items = (Object.keys(checked) as Array<keyof typeof checked>)
      .filter((key) => form.errors[key])
      .map((key) => ({ fieldId: checked[key].id, message: form.errors[key] as string }));
    return items.length > 0 ? items : undefined;
  })();

  const woOptions = [
    { value: '', label: t('projectDetail.billing.boqForm.noWorkOrder', 'None — the whole contract') },
    ...workOrders.map((wo) => ({ value: wo.id, label: wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title })),
  ];
  const itemLabel = t('projectDetail.billing.boqForm.item', 'ERP item');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const quantity = parseMoneyInputAtScale(values.quantity, 3);
      const rate = parseMoneyInputAtScale(values.rate, 2);
      if (quantity === null || rate === null) return;
      try {
        await onSave({
          itemCode: values.itemCode.trim(), description: values.description.trim(), unit: values.unit.trim(),
          quantity, rate, workOrderId: values.workOrderId || null,
        });
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={item
        ? t('projectDetail.billing.boqForm.titleEdit', 'Edit bill of quantities line')
        : t('projectDetail.billing.boqForm.titleNew', 'Add a bill of quantities line')}
      subtitle={t('projectDetail.billing.boqForm.subtitle', 'Rates exclude tax. A line may belong to one work order on this project.')}
      submitLabel={t('projectDetail.billing.boqForm.save', 'Save line')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('projectDetail.billing.boqForm.legend', 'Line')}>
        <FormGrid>
          {erpItems.connected ? (
            <Combobox label={itemLabel} required value={itemField.value || null}
              onChange={(value) => itemField.onChange(value)} loadOptions={erpItems.loadOptions} error={itemField.error} />
          ) : (
            <TextField id={itemField.id} label={itemLabel} required value={itemField.value}
              onChange={itemField.onChange} onBlur={itemField.onBlur} error={itemField.error} />
          )}
          <TextField id={descriptionField.id} label={t('projectDetail.billing.boqForm.description', 'Description')} required
            value={descriptionField.value} onChange={descriptionField.onChange} onBlur={descriptionField.onBlur}
            error={descriptionField.error} fullWidth />
          <TextField id={unitField.id} label={t('projectDetail.billing.boqForm.unit', 'Unit')} required
            value={unitField.value} onChange={unitField.onChange} onBlur={unitField.onBlur} error={unitField.error} />
          <NumberField id={quantityField.id} label={t('projectDetail.billing.boqForm.quantity', 'Quantity')} required
            value={quantityField.value} onChange={quantityField.onChange} onBlur={quantityField.onBlur}
            error={quantityField.error} localeAware />
          <NumberField id={rateField.id} label={t('projectDetail.billing.boqForm.rate', 'Rate (excl. PPN)')} required
            prefix={currencySymbolPrefix} value={rateField.value} onChange={rateField.onChange} onBlur={rateField.onBlur}
            error={rateField.error} localeAware />
          <SelectField id={woField.id} label={t('projectDetail.billing.boqForm.workOrder', 'Work order')}
            value={woField.value} onChange={woField.onChange} onBlur={woField.onBlur} options={woOptions} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default BoqItemFormModal;
```

Verify GREEN: same command as C15. Expect: 5/5.

### Task C17 — test: claim dialog (RED) · AC-PB-009

Create `pmo-portal/pages/project-detail/__tests__/ProgressClaimModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import ProgressClaimModal, { type ProgressClaimModalProps } from '../ProgressClaimModal';

const line = (id: string, code: string, description: string, unit: string, workOrderId: string | null) =>
  ({ id, org_id: 'o', project_id: 'p', work_order_id: workOrderId, item_code: code, description, unit, quantity: 10, rate: 50000, created_at: '' }) as BoqItemRow;
const BOQ = [line('b1', 'SURVEY', 'Route survey', 'km', null), line('b2', 'STATION', 'Station build', 'unit', 'wo-1')];
const WOS = [
  { id: 'wo-1', title: 'Phase 1', wo_number: 'WO-001', status: 'Issued' },
  { id: 'wo-2', title: 'Not yet issued', wo_number: null, status: 'Draft' },
] as WorkOrderRow[];

function renderModal(overrides: Partial<ProgressClaimModalProps> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ProgressClaimModal boqItems={BOQ} workOrders={WOS} contractNet={1_000_000} currencySymbolPrefix="Rp"
    hasDownPayment={false} claimedByBoqItem={{ b1: 4 }} assessedByBoqItem={{ b1: 6 }} assessmentMonth="2026-09-01"
    onClose={vi.fn()} onSave={onSave} onError={vi.fn()} {...overrides} /></ToastProvider>);
  return { onSave, user: userEvent.setup() };
}
const optionTexts = (label: RegExp) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);

describe('ProgressClaimModal', () => {
  it('AC-PB-009 a down payment sends the exact amount and percentage, with the proportional percentage as help', async () => {
    const { onSave, user } = renderModal();
    await user.selectOptions(screen.getByLabelText(/Claim type/), 'down_payment');
    await user.type(screen.getByLabelText(/Down payment amount/), '200000');
    expect(screen.getByText('Proportional to the contract: 20%')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Recovered from each claim/), '20');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'down_payment', workOrderId: null, downPaymentAmount: 200000, recoveryPct: 20 });
  });

  it('AC-PB-009 a 0% recovery is refused', async () => {
    const { onSave, user } = renderModal();
    await user.selectOptions(screen.getByLabelText(/Claim type/), 'down_payment');
    await user.type(screen.getByLabelText(/Down payment amount/), '200000');
    await user.type(screen.getByLabelText(/Recovered from each claim/), '0');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Enter a percentage above 0 and at most 100, with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("AC-PB-009 only the chosen scope's lines are offered, and only billable work orders are scopes", async () => {
    const { user } = renderModal();
    expect(optionTexts(/Bills/)).toEqual(['Lines with no work order', 'WO-001 — Phase 1']);
    expect(screen.getByLabelText(/SURVEY/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/STATION/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/Bills/), 'wo-1');
    expect(screen.getByLabelText(/STATION/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/SURVEY/)).toBeNull();
  });

  it('AC-PB-009 starting from the latest assessment fills assessed less claimed', async () => {
    const { onSave, user } = renderModal();
    await user.click(screen.getByRole('button', { name: /Start from the .* assessment/ }));
    expect(screen.getByLabelText(/SURVEY/)).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 2 }], recoverRemaining: false });
  });

  it('AC-PB-009 at least one quantity, each with at most 3 decimals, is required', async () => {
    const { onSave, user } = renderModal();
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Enter a quantity for at least one line')).length).toBeGreaterThan(0);
    await user.type(screen.getByLabelText(/SURVEY/), '1.2345');
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect((await screen.findAllByText('Each quantity must be above 0 with at most 3 decimal places')).length).toBeGreaterThan(0);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('AC-PB-009 recover the rest is sent when ticked', async () => {
    const { onSave, user } = renderModal({ hasDownPayment: true });
    await user.type(screen.getByLabelText(/SURVEY/), '3');
    await user.click(screen.getByLabelText('Recover the rest of the down payment with this claim'));
    await user.click(screen.getByRole('button', { name: 'Create claim' }));
    expect(onSave).toHaveBeenCalledWith({ kind: 'progress', workOrderId: null, lines: [{ boqItemId: 'b1', quantity: 3 }], recoverRemaining: true });
  });

  it('AC-PB-009 a project with a live down payment is not offered a second one', () => {
    renderModal({ hasDownPayment: true });
    expect(optionTexts(/Claim type/)).toEqual(['Progress — quantities against the bill of quantities']);
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/ProgressClaimModal.test.tsx` — Expect: module not found.

### Task C18 — claim dialog (GREEN) · AC-PB-009

Create `pmo-portal/pages/project-detail/ProgressClaimModal.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, EntityFormModal, FieldError, FormGrid, FormSection, NumberField, SelectField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, formatUtcMonthYear, parseMoneyInputAtScale } from '@/src/lib/format';
import { prefillFromAssessment, suggestedRecoveryPct } from '@/src/lib/progressBilling';
import type { BoqItemRow, ProgressClaimInput } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * Create a BILLING claim (#766, DD-PBL-7). Finance states the quantities; "start from the latest assessment" is a
 * pre-fill (assessed − already claimed), never a rule. Money is not sent: the server copies rates and computes
 * the down-payment recovery. A claim is raised to the ERP later, once evidence is attached.
 */
export interface ProgressClaimModalProps {
  boqItems: BoqItemRow[];
  /** This project's work orders; only Issued/Closed ones are offered as a scope. */
  workOrders: WorkOrderRow[];
  /** Net contract value — for the proportional-percentage hint only. */
  contractNet: number;
  currencySymbolPrefix: string;
  /** A live down payment exists: no second one is offered, and "recover the rest" is. */
  hasDownPayment: boolean;
  claimedByBoqItem: Record<string, number>;
  assessedByBoqItem: Record<string, number>;
  /** `YYYY-MM-01` of the latest assessment, or null. */
  assessmentMonth: string | null;
  onClose: () => void;
  onSave: (input: Omit<ProgressClaimInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

type Kind = ProgressClaimInput['kind'];

const ProgressClaimModal: React.FC<ProgressClaimModalProps> = ({
  boqItems, workOrders, contractNet, currencySymbolPrefix, hasDownPayment, claimedByBoqItem, assessedByBoqItem,
  assessmentMonth, onClose, onSave, onError,
}) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('progress');
  const [scope, setScope] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [recoverRest, setRecoverRest] = useState(false);
  const [dpAmount, setDpAmount] = useState('');
  const [recoveryPct, setRecoveryPct] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const scopes = workOrders.filter((wo) => wo.status === 'Issued' || wo.status === 'Closed');
  const inScope = boqItems.filter((line) => (line.work_order_id ?? '') === scope);
  const prefill = prefillFromAssessment(inScope.map((line) => line.id), assessedByBoqItem, claimedByBoqItem);
  const dpValue = parseMoneyInputAtScale(dpAmount, 2);
  const suggested = dpValue === null ? null : suggestedRecoveryPct(dpValue, contractNet);

  const kindOptions = [
    { value: 'progress', label: t('projectDetail.billing.claimForm.kindProgress', 'Progress — quantities against the bill of quantities') },
    ...(hasDownPayment ? [] : [{ value: 'down_payment', label: t('projectDetail.billing.claimForm.kindDownPayment', 'Down payment') }]),
  ];
  const scopeOptions = [
    { value: '', label: t('projectDetail.billing.claimForm.scopeContract', 'Lines with no work order') },
    ...scopes.map((wo) => ({ value: wo.id, label: wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title })),
  ];

  const build = (): { errs: Record<string, string>; input: Omit<ProgressClaimInput, 'projectId'> | null } => {
    const errs: Record<string, string> = {};
    if (kind === 'down_payment') {
      const pct = parseMoneyInputAtScale(recoveryPct, 3);
      if (dpValue === null || dpValue <= 0) {
        errs.dpAmount = t('projectDetail.billing.claimForm.errors.dpAmount', 'Enter a down payment above 0 with at most 2 decimal places');
      }
      if (pct === null || pct <= 0 || pct > 100) {
        errs.recoveryPct = t('projectDetail.billing.claimForm.errors.recoveryPct', 'Enter a percentage above 0 and at most 100, with at most 3 decimal places');
      }
      if (dpValue === null || pct === null || Object.keys(errs).length > 0) return { errs, input: null };
      return { errs, input: { kind, workOrderId: null, downPaymentAmount: dpValue, recoveryPct: pct } };
    }
    const lines: Array<{ boqItemId: string; quantity: number }> = [];
    for (const line of inScope) {
      const raw = (quantities[line.id] ?? '').trim();
      if (raw === '') continue;
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity <= 0) {
        errs[line.id] = t('projectDetail.billing.claimForm.errors.quantity', 'Each quantity must be above 0 with at most 3 decimal places');
      } else {
        lines.push({ boqItemId: line.id, quantity });
      }
    }
    if (Object.keys(errs).length === 0 && lines.length === 0) {
      errs.lines = t('projectDetail.billing.claimForm.errors.noQuantity', 'Enter a quantity for at least one line');
    }
    if (Object.keys(errs).length > 0) return { errs, input: null };
    return { errs, input: { kind, workOrderId: scope || null, lines, recoverRemaining: recoverRest } };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { errs, input } = build();
    setErrors(errs);
    if (!input) return;
    setSaving(true);
    setSaveError(null);
    void onSave(input)
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  const applyPrefill = () =>
    setQuantities(Object.fromEntries(Object.entries(prefill).map(([id, quantity]) => [id, formatMoneyInputValue(quantity)])));

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectDetail.billing.claimForm.title', 'New billing claim')}
      subtitle={t('projectDetail.billing.claimForm.subtitle', 'A claim becomes one ERP invoice. Attach the evidence before raising it.')}
      submitLabel={t('projectDetail.billing.claimForm.save', 'Create claim')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={kind !== 'progress' || dpAmount !== '' || recoveryPct !== '' || Object.values(quantities).some((q) => q !== '')}
    >
      <FormSection legend={t('projectDetail.billing.claimForm.kind', 'Claim type')}>
        <FormGrid>
          <SelectField id="claim-kind" label={t('projectDetail.billing.claimForm.kind', 'Claim type')} value={kind}
            onChange={(value) => { setKind(value as Kind); setErrors({}); }} options={kindOptions} />
          {kind === 'progress' && (
            <SelectField id="claim-scope" label={t('projectDetail.billing.claimForm.scope', 'Bills')} value={scope}
              onChange={(value) => { setScope(value); setQuantities({}); setErrors({}); }} options={scopeOptions} />
          )}
        </FormGrid>
      </FormSection>

      {kind === 'down_payment' ? (
        <FormSection legend={t('projectDetail.billing.claimForm.kindDownPayment', 'Down payment')}>
          <FormGrid>
            <NumberField id="claim-dp-amount" label={t('projectDetail.billing.claimForm.dpAmount', 'Down payment amount (excl. PPN)')}
              required prefix={currencySymbolPrefix} value={dpAmount} onChange={setDpAmount} error={errors.dpAmount} localeAware />
            <NumberField id="claim-recovery-pct" label={t('projectDetail.billing.claimForm.recoveryPct', 'Recovered from each claim (%)')}
              required value={recoveryPct} onChange={setRecoveryPct} error={errors.recoveryPct} localeAware
              helper={suggested === null ? undefined
                : t('projectDetail.billing.claimForm.recoveryHelp', 'Proportional to the contract: {{pct}}%', { pct: formatNumberExact(suggested) })} />
          </FormGrid>
        </FormSection>
      ) : (
        <FormSection legend={t('projectDetail.billing.claimForm.linesLegend', 'Quantities to bill')}>
          {assessmentMonth && Object.keys(prefill).length > 0 && (
            <Button type="button" variant="outline" size="sm" className="mb-3" onClick={applyPrefill}>
              {t('projectDetail.billing.claimForm.prefill', 'Start from the {{month}} assessment',
                { month: formatUtcMonthYear(new Date(`${assessmentMonth}T00:00:00Z`)) })}
            </Button>
          )}
          {inScope.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {t('projectDetail.billing.claimForm.noLines', 'No bill of quantities lines in this scope.')}
            </p>
          ) : (
            <FormGrid>
              {inScope.map((line) => (
                <NumberField key={line.id} id={`claim-qty-${line.id}`}
                  label={t('projectDetail.billing.claimForm.quantity', '{{item}} — {{description}} ({{unit}})',
                    { item: line.item_code, description: line.description, unit: line.unit })}
                  value={quantities[line.id] ?? ''}
                  onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))}
                  error={errors[line.id]} localeAware />
              ))}
            </FormGrid>
          )}
          {errors.lines && <FieldError>{errors.lines}</FieldError>}
          {hasDownPayment && (
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={recoverRest} onChange={(e) => setRecoverRest(e.target.checked)} />
              {t('projectDetail.billing.claimForm.recoverRest', 'Recover the rest of the down payment with this claim')}
            </label>
          )}
        </FormSection>
      )}
    </EntityFormModal>
  );
};

export default ProgressClaimModal;
```

If `SelectField`/`NumberField` on `dev` pass an event rather than a string to `onChange`, adapt the six inline
handlers to read `event.target.value` — `WorkOrderFormModal` shows which it is (it passes `fieldProps().onChange`
straight through).

Verify GREEN: same command as C17. Expect: 7/7.

### Task C19 — test: assessment dialog (RED) · AC-PB-019

Create `pmo-portal/pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx`:

```tsx
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
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/ProgressAssessmentModal.test.tsx` — Expect: module not found.

### Task C20 — assessment dialog (GREEN) · AC-PB-019

Create `pmo-portal/pages/project-detail/ProgressAssessmentModal.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, FormSection, NumberField, TextArea, TextField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BoqItemRow, ProgressAssessmentInput } from '@/src/lib/db/progressBilling';

/**
 * Record a progress ASSESSMENT (#766, DD-PBL-2/3): the quantity done to date on every BoQ line for one month.
 * Operational only — it sets #765's percent complete for that month and never creates an invoice. Every line is
 * sent (blank = 0) because the server treats a missing line as nothing done.
 */
export interface ProgressAssessmentModalProps {
  boqItems: BoqItemRow[];
  /** The latest assessment's quantities, used as the starting values. */
  assessedByBoqItem: Record<string, number>;
  /** `YYYY-MM`. */
  defaultMonth: string;
  onClose: () => void;
  onSave: (input: Omit<ProgressAssessmentInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const ProgressAssessmentModal: React.FC<ProgressAssessmentModalProps> = ({
  boqItems, assessedByBoqItem, defaultMonth, onClose, onSave, onError,
}) => {
  const { t } = useTranslation();
  const [month, setMonth] = useState(defaultMonth);
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(
    boqItems.map((line) => [line.id, assessedByBoqItem[line.id] === undefined ? '' : formatMoneyInputValue(assessedByBoqItem[line.id])]),
  ));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!MONTH_PATTERN.test(month.trim())) errs.month = t('projectDetail.billing.assessment.errors.month', 'Enter the month as YYYY-MM');
    const lines: ProgressAssessmentInput['quantities'] = [];
    for (const line of boqItems) {
      const raw = (quantities[line.id] ?? '').trim();
      if (raw === '') { lines.push({ boqItemId: line.id, quantityToDate: 0 }); continue; }
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity < 0) {
        errs[line.id] = t('projectDetail.billing.assessment.errors.quantity', 'Each quantity done to date must be 0 or more with at most 3 decimal places');
      } else {
        lines.push({ boqItemId: line.id, quantityToDate: quantity });
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSaveError(null);
    void onSave({ month: `${month.trim()}-01`, quantities: lines, note: note.trim() || null })
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectDetail.billing.assessment.title', 'Record progress')}
      subtitle={t('projectDetail.billing.assessment.subtitle', 'Quantities done to date for the month. This is the operational assessment — it never creates an invoice.')}
      submitLabel={t('projectDetail.billing.assessment.save', 'Save progress')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty
    >
      <FormSection legend={t('projectDetail.billing.assessment.title', 'Record progress')}>
        <FormGrid>
          <TextField id="assessment-month" label={t('projectDetail.billing.assessment.month', 'Month (YYYY-MM)')} required
            value={month} onChange={setMonth} error={errors.month} />
          {boqItems.map((line) => (
            <NumberField key={line.id} id={`assessment-qty-${line.id}`}
              label={t('projectDetail.billing.assessment.quantityToDate', '{{item}} — done to date ({{unit}})',
                { item: `${line.item_code} — ${line.description}`, unit: line.unit })}
              value={quantities[line.id] ?? ''}
              onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))}
              error={errors[line.id]} localeAware />
          ))}
          <TextArea id="assessment-note" label={t('projectDetail.billing.assessment.note', 'Note (optional)')}
            value={note} onChange={setNote} maxLength={500} rows={2} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ProgressAssessmentModal;
```

Verify GREEN: same command as C19. Expect: 5/5.

### Task C21 — test: evidence dialog (RED) · AC-PB-020

Create `pmo-portal/pages/project-detail/__tests__/ClaimEvidenceModal.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import ClaimEvidenceModal from '../ClaimEvidenceModal';

const doc = (id: string, title: string, status: string, filePath: string | null) =>
  ({ id, org_id: 'o', project_id: 'p', code: null, category: 'Report', title, revision: 'A', status, doc_date: null, author_id: null, file_path: filePath, created_at: '' }) as unknown as ProjectDocumentRow;
const DOCS = [
  doc('doc-1', 'Progress report', 'Issued', 'docs/report.pdf'),
  doc('doc-2', 'Draft report', 'Draft', 'docs/draft.pdf'),
  doc('doc-3', 'Report without file', 'Issued', null),
  doc('doc-4', 'Client acceptance', 'Approved', 'docs/bast.pdf'),
];

function renderModal(documents = DOCS, attached = ['doc-4']) {
  const onAttach = vi.fn().mockResolvedValue(undefined);
  render(<ToastProvider><ClaimEvidenceModal documents={documents} attachedDocumentIds={attached} onClose={vi.fn()} onAttach={onAttach} onError={vi.fn()} /></ToastProvider>);
  return { onAttach, user: userEvent.setup() };
}

describe('ClaimEvidenceModal', () => {
  it('AC-PB-020 offers only issued or approved documents with a file that are not already attached', () => {
    renderModal();
    expect(Array.from((screen.getByLabelText('Evidence document') as HTMLSelectElement).options).map((o) => o.textContent))
      .toEqual(['—', 'Progress report (Issued, rev A)']);
  });

  it('AC-PB-020 attaching sends the chosen document', async () => {
    const { onAttach, user } = renderModal();
    await user.selectOptions(screen.getByLabelText('Evidence document'), 'doc-1');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onAttach).toHaveBeenCalledWith('doc-1');
  });

  it('AC-PB-020 with no eligible document it says so and cannot submit', () => {
    renderModal([DOCS[1], DOCS[2]], []);
    expect(screen.getByText('No issued or approved document with a file on this project.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled();
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/ClaimEvidenceModal.test.tsx` — Expect: module not found.

### Task C22 — evidence dialog (GREEN) · AC-PB-020

Create `pmo-portal/pages/project-detail/ClaimEvidenceModal.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormSection, SelectField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

/**
 * Attach billing evidence to a claim (#766, DD-PBL-7): a document from THIS project's register that is Issued or
 * Approved (its content is frozen) and has a file. The server re-checks all of it; this list only stops the user
 * choosing something the server would refuse. Attach-only — there is no detach.
 */
export interface ClaimEvidenceModalProps {
  documents: ProjectDocumentRow[];
  attachedDocumentIds: string[];
  onClose: () => void;
  onAttach: (documentId: string) => Promise<void>;
  onError: (err: unknown) => void;
}

const EVIDENCE_STATUSES = new Set(['Issued', 'Approved']);

const ClaimEvidenceModal: React.FC<ClaimEvidenceModalProps> = ({ documents, attachedDocumentIds, onClose, onAttach, onError }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const eligible = documents.filter((d) => EVIDENCE_STATUSES.has(d.status) && Boolean(d.file_path) && !attachedDocumentIds.includes(d.id));
  const options = [
    { value: '', label: '—' },
    ...eligible.map((d) => ({
      value: d.id,
      label: `${d.code ? `${d.code} · ` : ''}${d.title} (${d.status}${d.revision
        ? `, ${t('projectDetail.billing.evidence.revision', 'rev {{revision}}', { revision: d.revision })}` : ''})`,
    })),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    setSaving(true);
    setSaveError(null);
    void onAttach(choice)
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  return (
    <EntityFormModal
      open
      title={t('projectDetail.billing.evidence.title', 'Attach billing evidence')}
      subtitle={t('projectDetail.billing.evidence.subtitle', "Choose an issued or approved document from this project's register, such as the progress report or the client's acceptance.")}
      submitLabel={t('projectDetail.billing.evidence.save', 'Attach')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={choice !== ''}
      submitDisabled={!choice}
    >
      <FormSection legend={t('projectDetail.billing.evidence.title', 'Attach billing evidence')}>
        {eligible.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t('projectDetail.billing.evidence.none', 'No issued or approved document with a file on this project.')}
          </p>
        ) : (
          <SelectField id="evidence-document" label={t('projectDetail.billing.evidence.document', 'Evidence document')}
            value={choice} onChange={setChoice} options={options} />
        )}
      </FormSection>
    </EntityFormModal>
  );
};

export default ClaimEvidenceModal;
```

Verify GREEN: same command as C21. Expect: 3/3.

### Task C23 — test: Billing tab (RED) · AC-PB-008, AC-PB-009

Create `pmo-portal/pages/project-detail/tabs/__tests__/BillingTab.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  connected: true,
  billing: { data: null as unknown, isPending: false, isError: false, refetch: vi.fn() },
  boq: [] as unknown[],
  claims: [] as unknown[],
  docs: [] as unknown[],
  m: {} as Record<string, { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean }>,
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: h.connected, loadOptions: vi.fn() }) }));
vi.mock('@/src/hooks/useProgressBilling', () => ({
  useProjectBilling: () => h.billing,
  useBoqItems: () => ({ data: h.boq, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectClaims: () => ({ data: h.claims, isPending: false, isError: false, refetch: vi.fn() }),
  useProgressBillingMutations: () => h.m,
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: h.docs, isPending: false, isError: false }) }));
import BillingTab from '../BillingTab';

const FACTS = {
  currency: 'IDR', contractNet: 1_000_000, workBilled: 250_000, dpBilled: 200_000, dpRecovered: 40_000, notSubmitted: 40_000,
  assessment: { month: '2026-10-01', pctComplete: 60 }, claimedByBoqItem: { b1: 5, b2: 6 }, assessedByBoqItem: { b1: 6 },
};
const BOQ = [
  { id: 'b1', org_id: 'o', project_id: 'p1', work_order_id: null, item_code: 'SURVEY', description: 'Route survey', unit: 'km', quantity: 10, rate: 50000, created_at: '' },
  { id: 'b2', org_id: 'o', project_id: 'p1', work_order_id: null, item_code: 'STATION', description: 'Station build', unit: 'unit', quantity: 5, rate: 100000, created_at: '' },
];
const claim = (id: string, extra: Record<string, unknown> = {}) => ({
  id, org_id: 'o', project_id: 'p1', work_order_id: null, kind: 'progress', currency: 'IDR', gross_amount: 200000,
  down_payment_amount: null, recovery_pct: null, dp_recovery_amount: 40000, dp_item_code: 'DP-ITEM', created_by: 'u-fin',
  created_at: '2026-10-01T00:00:00Z', withdrawn_by: null, withdrawn_at: null, lines: [], evidence: [], invoice: null, ...extra,
});
const CLAIMS = [
  claim('k1'),
  claim('k2', { evidence: [{ id: 'ev-1', document_id: 'doc-1', document_status: 'Issued', document_revision: 'A' }] }),
  claim('k3', { invoice: { si_number: 'ACC-SINV-1', status: 'Unpaid', amount: 160000 } }),
];
const DOCS = [{ id: 'doc-1', org_id: 'o', project_id: 'p1', code: null, category: 'Report', title: 'Progress report', revision: 'A', status: 'Issued', doc_date: null, author_id: null, file_path: 'docs/report.pdf', created_at: '' }];
const money = (value: number) => formatCurrencyCents(value, 'IDR');

beforeEach(() => {
  vi.clearAllMocks();
  h.role = 'Finance'; h.userId = 'u-fin'; h.connected = true;
  h.billing = { data: FACTS, isPending: false, isError: false, refetch: vi.fn() };
  h.boq = BOQ; h.claims = CLAIMS; h.docs = DOCS;
  h.m = Object.fromEntries(['createBoq', 'updateBoq', 'deleteBoq', 'recordAssessment', 'createClaim', 'attachEvidence', 'withdrawClaim', 'raiseInvoice']
    .map((name) => [name, { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }]));
});

function renderTab(clientId: string | null = 'c1') {
  render(<ToastProvider><BillingTab projectId="p1" currency="IDR" clientId={clientId} projectManagerId="pm-1" /></ToastProvider>);
  return userEvent.setup();
}

describe('BillingTab', () => {
  it('AC-PB-008 the summary shows contract, billed, assessed, the gap, DP held, not yet billed and not submitted, net of tax', () => {
    renderTab();
    expect(screen.getByTestId('billing-contract')).toHaveTextContent(money(1_000_000));
    expect(screen.getByTestId('billing-billed')).toHaveTextContent(money(250_000));
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent(money(600_000));
    expect(screen.getByTestId('billing-gap')).toHaveTextContent(money(350_000));
    expect(screen.getByTestId('billing-dp-held')).toHaveTextContent(money(160_000));
    expect(screen.getByTestId('billing-remaining')).toHaveTextContent(money(750_000));
    expect(screen.getByTestId('billing-not-submitted')).toHaveTextContent(money(40_000));
    expect(screen.getByTestId('billing-billed')).toHaveTextContent('excl. PPN');
  });

  it('AC-PB-008 with no assessment it says so instead of a figure, and shows no gap', () => {
    h.billing = { ...h.billing, data: { ...FACTS, assessment: null, assessedByBoqItem: {} } };
    renderTab();
    expect(screen.getByTestId('billing-assessed')).toHaveTextContent('No assessment yet');
    expect(screen.queryByTestId('billing-gap')).toBeNull();
  });

  it('AC-PB-008 a failed read shows the error, never zeros', () => {
    h.billing = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderTab();
    expect(screen.getByText("Couldn't load billing")).toBeInTheDocument();
    expect(screen.queryByTestId('billing-billed')).toBeNull();
  });

  it('AC-PB-008 the BoQ shows assessed, claimed and left-to-claim quantities and flags over-claiming', () => {
    renderTab();
    expect(screen.getByTestId('boq-assessed-b1')).toHaveTextContent('6');
    expect(screen.getByTestId('boq-claimed-b1')).toHaveTextContent('5');
    expect(screen.getByTestId('boq-remaining-b1')).toHaveTextContent('5');
    expect(screen.getByTestId('boq-assessed-b2')).toHaveTextContent('—');
    expect(screen.getByTestId('boq-remaining-b2')).toHaveTextContent('Over-claimed');
  });

  it('AC-PB-008 a claim without evidence can be evidenced but not raised', () => {
    renderTab();
    const actions = within(screen.getByTestId('claim-actions-k1'));
    expect(actions.getByRole('button', { name: 'Attach evidence' })).toBeInTheDocument();
    expect(actions.getByText('Attach evidence before raising')).toBeInTheDocument();
    expect(actions.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
    expect(screen.getByTestId('claim-evidence-k1')).toHaveTextContent('0');
    expect(screen.getByTestId('claim-evidence-k2')).toHaveTextContent('1');
  });

  it("AC-PB-009 raising confirms the server's figures and dispatches for the project's client", async () => {
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k2')).getByRole('button', { name: 'Raise invoice' }));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(200_000));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(40_000));
    expect(screen.getByTestId('raise-figures')).toHaveTextContent(money(160_000));
    await user.click(screen.getByRole('button', { name: 'Create ERP invoice' }));
    expect(h.m.raiseInvoice.mutateAsync).toHaveBeenCalledWith({ claimId: 'k2', customerId: 'c1', intent: { id: 'k2', idempotencyKey: expect.any(String) } });
  });

  it('AC-PB-009 a refused raise leaves the claim not raised', async () => {
    h.m.raiseInvoice.mutateAsync.mockRejectedValue(new Error('ERP unreachable'));
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k2')).getByRole('button', { name: 'Raise invoice' }));
    await user.click(screen.getByRole('button', { name: 'Create ERP invoice' }));
    expect(await screen.findAllByText('Not raised')).toHaveLength(2);
    expect(screen.getByText(/ACC-SINV-1/)).toBeInTheDocument();
  });

  it('AC-PB-008 attaching evidence sends the claim and the chosen document', async () => {
    const user = renderTab();
    await user.click(within(screen.getByTestId('claim-actions-k1')).getByRole('button', { name: 'Attach evidence' }));
    await user.selectOptions(screen.getByLabelText('Evidence document'), 'doc-1');
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(h.m.attachEvidence.mutateAsync).toHaveBeenCalledWith({ claimId: 'k1', documentId: 'doc-1' });
  });

  it("AC-PB-008 the project's PM records progress and edits the BoQ but has no billing buttons", () => {
    h.role = 'Project Manager'; h.userId = 'pm-1';
    renderTab();
    expect(screen.getByRole('button', { name: 'Record progress' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach evidence' })).toBeNull();
  });

  it('AC-PB-008 another PM does not record progress on this project', () => {
    h.role = 'Project Manager'; h.userId = 'pm-2';
    renderTab();
    expect(screen.queryByRole('button', { name: 'Record progress' })).toBeNull();
  });

  it('AC-PB-008 Finance gets no billing buttons without an ERP connection', () => {
    h.connected = false;
    renderTab();
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Raise invoice' })).toBeNull();
  });

  it('AC-PB-008 Finance gets no billing buttons when the project has no client', () => {
    renderTab(null);
    expect(screen.queryByRole('button', { name: 'New claim' })).toBeNull();
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/tabs/__tests__/BillingTab.test.tsx` — Expect: module not found.

### Task C24 — Billing tab (GREEN) · AC-PB-008, AC-PB-009

Create `pmo-portal/pages/project-detail/tabs/BillingTab.tsx`:

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, DataTable, ListState, useToast, type Column,
} from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { currencySymbol, formatCurrencyCents, formatNumber, formatNumberExact, formatUtcMonthYear } from '@/src/lib/format';
import { claimNet, remainingQuantity, summarizeBilling } from '@/src/lib/progressBilling';
import type {
  BoqItemInput, BoqItemRow, ProgressAssessmentInput, ProgressClaimInput, ProgressClaimWithInvoice,
} from '@/src/lib/db/progressBilling';
import { useBoqItems, useProgressBillingMutations, useProjectBilling, useProjectClaims } from '@/src/hooks/useProgressBilling';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useDocuments } from '@/src/hooks/useDocuments';
import { useErpItemOptions } from '@/src/hooks/useErpItemOptions';
import BoqItemFormModal from '../BoqItemFormModal';
import ProgressAssessmentModal from '../ProgressAssessmentModal';
import ProgressClaimModal from '../ProgressClaimModal';
import ClaimEvidenceModal from '../ClaimEvidenceModal';

/**
 * The project's Billing tab (#766). Three things on one page, kept visibly apart (DD-PBL-2):
 *   • the PM's ASSESSMENT of progress ("Record progress") — operational, never an invoice;
 *   • the bill of quantities both are measured against;
 *   • Finance's BILLING CLAIMS — evidence first, then one ERP invoice each.
 * Figures come from get_project_billing and are derived with the management pack's helpers (DD-PBL-9).
 * ⚑ Nothing ERP-bound or destructive writes on one click; the server is the authority on every rule.
 */
export interface BillingTabProps {
  projectId: string;
  currency: string;
  /** The project's client — the invoice customer. No client, no billing buttons. */
  clientId: string | null;
  /** Decides who may record progress (#765's rule). */
  projectManagerId: string | null;
}

/** `YYYY-MM` in the browser's zone. ponytail: only the dialog's default — the user can change it and the
 *  server truncates to the month; switch to the org timezone if month-end entries land in the wrong month. */
function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const Figure: React.FC<{ testId: string; label: string; value: string; note?: string }> = ({ testId, label, value, note }) => (
  <div>
    <dt className="text-[12px] text-muted-foreground">{label}</dt>
    <dd className="tabular text-[15px] font-semibold" data-testid={testId}>{value}</dd>
    {note && <dd className="text-[11px] text-muted-foreground">{note}</dd>}
  </div>
);

const BillingTab: React.FC<BillingTabProps> = ({ projectId, currency, clientId, projectManagerId }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const erp = useErpItemOptions('sales');
  const billing = useProjectBilling(projectId);
  const boq = useBoqItems(projectId);
  const claims = useProjectClaims(projectId);
  const workOrders = useProjectWorkOrders(projectId);
  const documents = useDocuments(projectId);
  const mutations = useProgressBillingMutations(projectId);

  // `undefined` = closed · `null` = add a line · a row = edit it.
  const [boqFormFor, setBoqFormFor] = useState<BoqItemRow | null | undefined>(undefined);
  const [deleteFor, setDeleteFor] = useState<BoqItemRow | null>(null);
  const [claimFormOpen, setClaimFormOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  // The idempotency key is minted when the confirm opens, so a retry of the same confirm reuses it (ADR-0058).
  const [raiseFor, setRaiseFor] = useState<{ claim: ProgressClaimWithInvoice; idempotencyKey: string } | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<ProgressClaimWithInvoice | null>(null);

  const boqRows = boq.data ?? [];
  const claimRows = claims.data ?? [];
  const summary = billing.data ? summarizeBilling(billing.data) : null;
  const excl = t('projectDetail.billing.summary.exclTax', 'excl. PPN');
  const money = (value: number) => `${formatCurrencyCents(value, currency)} ${excl}`;
  const cents = (value: number | string) => formatCurrencyCents(Number(value), currency);
  const monthLabel = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));

  const canBill = may('create', 'progressClaim') && erp.connected && clientId !== null;
  const canAssess = may('edit', 'projectProgress', { currentUserId: currentUser?.id, record: { project_manager_id: projectManagerId } });
  const liveDownPayment = claimRows.some((c) => c.kind === 'down_payment' && !c.withdrawn_at && c.invoice?.status !== 'Cancelled');

  const fail = (err: unknown) => {
    const { headline, detail } = classifyMutationError(err);
    toast(headline, detail, 'warning');
  };

  const saveBoq = async (input: BoqItemInput) => {
    if (boqFormFor) await mutations.updateBoq.mutateAsync({ id: boqFormFor.id, input });
    else await mutations.createBoq.mutateAsync(input);
    toast(t('projectDetail.billing.boq.toast.saved', 'Bill of quantities line saved'), input.itemCode, 'success');
    setBoqFormFor(undefined);
  };
  const saveAssessment = async (input: Omit<ProgressAssessmentInput, 'projectId'>) => {
    const pct = await mutations.recordAssessment.mutateAsync(input);
    toast(t('projectDetail.billing.assessment.toast.saved', 'Progress recorded: {{pct}}% complete', { pct: formatNumberExact(Number(pct)) }), undefined, 'success');
    setAssessOpen(false);
  };
  const saveClaim = async (input: Omit<ProgressClaimInput, 'projectId'>) => {
    const id = await mutations.createClaim.mutateAsync(input);
    toast(t('projectDetail.billing.claims.toast.created', 'Billing claim created'), undefined, 'success');
    setClaimFormOpen(false);
    if (typeof id === 'string') setEvidenceFor(id); // the next step is always the evidence (DD-PBL-7)
  };
  const attachEvidence = async (documentId: string) => {
    if (!evidenceFor) return;
    await mutations.attachEvidence.mutateAsync({ claimId: evidenceFor, documentId });
    toast(t('projectDetail.billing.claims.toast.evidenceAttached', 'Evidence attached'), undefined, 'success');
    setEvidenceFor(null);
  };
  const runRaise = async () => {
    if (!raiseFor || !clientId) return;
    const { claim, idempotencyKey } = raiseFor;
    try {
      await mutations.raiseInvoice.mutateAsync({ claimId: claim.id, customerId: clientId, intent: { id: claim.id, idempotencyKey } });
      toast(t('projectDetail.billing.claims.toast.raised', 'Invoice raised in the ERP'), undefined, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setRaiseFor(null);
    }
  };
  const runWithdraw = async () => {
    if (!withdrawFor) return;
    try {
      await mutations.withdrawClaim.mutateAsync(withdrawFor.id);
      toast(t('projectDetail.billing.claims.toast.withdrawn', 'Claim withdrawn'), undefined, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setWithdrawFor(null);
    }
  };
  const runDelete = async () => {
    if (!deleteFor) return;
    try {
      await mutations.deleteBoq.mutateAsync(deleteFor.id);
      toast(t('projectDetail.billing.boq.toast.deleted', 'Bill of quantities line deleted'), deleteFor.item_code, 'success');
    } catch (err) {
      fail(err);
    } finally {
      setDeleteFor(null);
    }
  };

  const boqColumns: Column<BoqItemRow>[] = [
    { key: 'item', header: t('projectDetail.billing.boq.column.item', 'Item'), cell: (row) => (
      <div className="flex flex-col">
        <span className="font-semibold">{row.item_code}</span>
        <span className="text-[11px] text-muted-foreground">{row.description}</span>
      </div>
    ) },
    { key: 'quantity', header: t('projectDetail.billing.boq.column.quantity', 'Quantity'), align: 'num',
      cell: (row) => <span className="tabular">{formatNumberExact(Number(row.quantity))} {row.unit}</span> },
    { key: 'rate', header: t('projectDetail.billing.boq.column.rate', 'Rate'), align: 'num',
      cell: (row) => <span className="tabular">{cents(row.rate)}</span> },
    { key: 'assessed', header: t('projectDetail.billing.boq.column.assessed', 'Assessed'), align: 'num', cell: (row) => {
      const assessed = summary?.assessedByBoqItem[row.id];
      return <span className="tabular" data-testid={`boq-assessed-${row.id}`}>{assessed === undefined ? '—' : formatNumberExact(assessed)}</span>;
    } },
    { key: 'claimed', header: t('projectDetail.billing.boq.column.claimed', 'Claimed'), align: 'num', cell: (row) => (
      <span className="tabular" data-testid={`boq-claimed-${row.id}`}>
        {summary ? formatNumberExact(summary.claimedByBoqItem[row.id] ?? 0) : '—'}
      </span>
    ) },
    { key: 'remaining', header: t('projectDetail.billing.boq.column.remaining', 'Left to claim'), align: 'num', cell: (row) => {
      if (!summary) return <span data-testid={`boq-remaining-${row.id}`}>—</span>;
      const left = remainingQuantity(Number(row.quantity), summary.claimedByBoqItem[row.id] ?? 0);
      return (
        <span className="tabular" data-testid={`boq-remaining-${row.id}`}>
          {formatNumberExact(left)}
          {left < 0 && <span className="ml-1 text-[11px] text-destructive-text">{t('projectDetail.billing.boq.overClaimed', 'Over-claimed')}</span>}
        </span>
      );
    } },
    { key: 'actions', header: t('projectDetail.billing.boq.column.actions', 'Actions'), cell: (row) => (
      <div className="flex gap-1.5">
        {may('edit', 'boqItem') && (
          <Button variant="ghost" size="sm" onClick={() => setBoqFormFor(row)}>{t('projectDetail.billing.boq.edit', 'Edit')}</Button>
        )}
        {may('delete', 'boqItem') && (
          <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
            onClick={() => setDeleteFor(row)}>{t('projectDetail.billing.boq.delete', 'Delete')}</Button>
        )}
      </div>
    ) },
  ];

  const claimColumns: Column<ProgressClaimWithInvoice>[] = [
    { key: 'claim', header: t('projectDetail.billing.claims.column.claim', 'Claim'), cell: (c) => (
      <span>{c.kind === 'down_payment'
        ? t('projectDetail.billing.claims.kind.downPayment', 'Down payment')
        : t('projectDetail.billing.claims.kind.progress', 'Progress')}</span>
    ) },
    { key: 'gross', header: t('projectDetail.billing.claims.column.gross', 'Claimed'), align: 'num',
      cell: (c) => <span className="tabular">{cents(c.gross_amount)}</span> },
    { key: 'recovery', header: t('projectDetail.billing.claims.column.recovery', 'Down payment recovered'), align: 'num',
      cell: (c) => <span className="tabular">{cents(c.dp_recovery_amount)}</span> },
    { key: 'net', header: t('projectDetail.billing.claims.column.net', 'Net'), align: 'num',
      cell: (c) => <span className="tabular">{cents(claimNet(Number(c.gross_amount), Number(c.dp_recovery_amount)))}</span> },
    { key: 'invoice', header: t('projectDetail.billing.claims.column.invoice', 'Invoice'), cell: (c) => (
      <span>{c.withdrawn_at
        ? t('projectDetail.billing.claims.withdrawn', 'Withdrawn')
        : c.invoice
          ? `${c.invoice.si_number ?? ''} · ${c.invoice.status}`
          : t('projectDetail.billing.claims.notRaised', 'Not raised')}</span>
    ) },
    { key: 'evidence', header: t('projectDetail.billing.claims.column.evidence', 'Evidence'), align: 'num',
      cell: (c) => <span className="tabular" data-testid={`claim-evidence-${c.id}`}>{formatNumber(c.evidence.length)}</span> },
    { key: 'actions', header: t('projectDetail.billing.claims.column.actions', 'Actions'), cell: (c) => {
      const open = !c.withdrawn_at && !c.invoice;
      return (
        <div className="flex flex-wrap items-center gap-1.5" data-testid={`claim-actions-${c.id}`}>
          {open && canBill && (
            <Button variant="outline" size="sm" onClick={() => setEvidenceFor(c.id)}>
              {t('projectDetail.billing.claims.attachEvidence', 'Attach evidence')}
            </Button>
          )}
          {open && canBill && (c.evidence.length > 0 ? (
            <Button variant="primary" size="sm" onClick={() => setRaiseFor({ claim: c, idempotencyKey: crypto.randomUUID() })}>
              {t('projectDetail.billing.claims.raise', 'Raise invoice')}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {t('projectDetail.billing.claims.evidenceNeeded', 'Attach evidence before raising')}
            </span>
          ))}
          {open && canBill && (
            <Button variant="ghost" size="sm" className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
              onClick={() => setWithdrawFor(c)}>{t('projectDetail.billing.claims.withdraw', 'Withdraw')}</Button>
          )}
        </div>
      );
    } },
  ];

  const evidenceClaim = claimRows.find((c) => c.id === evidenceFor);

  return (
    <div className="space-y-6">
      <Card variant="bare">
        <CardHead>{t('projectDetail.billing.summary.title', 'Billing summary')}</CardHead>
        <CardPad>
          {billing.isPending ? (
            <ListState variant="loading" rows={2} />
          ) : billing.isError || !summary ? (
            <ListState variant="error" title={t('projectDetail.billing.summary.error', "Couldn't load billing")} onRetry={() => void billing.refetch()} />
          ) : (
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Figure testId="billing-contract" label={t('projectDetail.billing.summary.contract', 'Contract value')} value={money(summary.contractNet)} />
              <Figure testId="billing-billed" label={t('projectDetail.billing.summary.billed', 'Billed to date')} value={money(summary.workBilled)} />
              <Figure testId="billing-assessed" label={t('projectDetail.billing.summary.assessed', 'Assessed to date')}
                value={summary.assessedToDate === null ? t('projectDetail.billing.summary.noAssessment', 'No assessment yet') : money(summary.assessedToDate)}
                note={summary.assessment ? t('projectDetail.billing.summary.assessedAsOf', 'as of {{month}}, {{pct}}% complete',
                  { month: monthLabel(summary.assessment.month), pct: formatNumberExact(summary.assessment.pctComplete) }) : undefined} />
              {summary.unbilledWork !== null && (
                <Figure testId="billing-gap" label={t('projectDetail.billing.summary.gap', 'Work done, not yet billed')} value={money(summary.unbilledWork)} />
              )}
              <Figure testId="billing-dp-held" label={t('projectDetail.billing.summary.dpHeld', 'Down payment held')} value={money(summary.dpHeld)} />
              <Figure testId="billing-remaining" label={t('projectDetail.billing.summary.remaining', 'Contract not yet billed')} value={money(summary.remaining)} />
              <Figure testId="billing-not-submitted" label={t('projectDetail.billing.summary.notSubmitted', 'Raised, not yet submitted')} value={money(summary.notSubmitted)} />
            </dl>
          )}
        </CardPad>
      </Card>

      <Card variant="bare">
        <CardHead className="justify-between">
          <span>{t('projectDetail.billing.boq.title', 'Bill of quantities')}</span>
          <div className="flex gap-1.5">
            {canAssess && boqRows.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setAssessOpen(true)}>
                {t('projectDetail.billing.assessment.record', 'Record progress')}
              </Button>
            )}
            {may('create', 'boqItem') && (
              <Button variant="primary" size="sm" onClick={() => setBoqFormFor(null)}>{t('projectDetail.billing.boq.add', 'Add line')}</Button>
            )}
          </div>
        </CardHead>
        <CardPad>
          <DataTable<BoqItemRow>
            rows={boqRows}
            columns={boqColumns}
            rowKey={(row) => row.id}
            state={boq.isPending ? 'loading' : boq.isError ? 'error' : boqRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.billing.boq.empty', 'No bill of quantities yet')}
            emptySub={t('projectDetail.billing.boq.emptySub', "Add the contract's priced lines to assess progress and bill by quantity.")}
            errorTitle={t('projectDetail.billing.boq.error', 'Couldn’t load the bill of quantities')}
            errorSub={t('projectDetail.billing.boq.errorSub', 'Retry, or reopen the project.')}
            onRetry={() => boq.refetch()}
          />
        </CardPad>
      </Card>

      <Card variant="bare">
        <CardHead className="justify-between">
          <span>{t('projectDetail.billing.claims.title', 'Billing claims')}</span>
          {canBill && (
            <Button variant="primary" size="sm" onClick={() => setClaimFormOpen(true)}>{t('projectDetail.billing.claims.new', 'New claim')}</Button>
          )}
        </CardHead>
        <CardPad>
          <DataTable<ProgressClaimWithInvoice>
            rows={claimRows}
            columns={claimColumns}
            rowKey={(row) => row.id}
            state={claims.isPending ? 'loading' : claims.isError ? 'error' : claimRows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('projectDetail.billing.claims.empty', 'No billing claims yet')}
            emptySub={t('projectDetail.billing.claims.emptySub', 'A claim bills a down payment or quantities done, as one ERP invoice.')}
            errorTitle={t('projectDetail.billing.claims.error', 'Couldn’t load the billing claims')}
            errorSub={t('projectDetail.billing.claims.errorSub', 'Retry, or reopen the project.')}
            onRetry={() => claims.refetch()}
          />
        </CardPad>
      </Card>

      {boqFormFor !== undefined && (
        <BoqItemFormModal item={boqFormFor} workOrders={workOrders.data ?? []} currencySymbolPrefix={currencySymbol(currency)}
          onClose={() => setBoqFormFor(undefined)} onSave={saveBoq} onError={fail} />
      )}
      {assessOpen && (
        <ProgressAssessmentModal boqItems={boqRows} assessedByBoqItem={summary?.assessedByBoqItem ?? {}} defaultMonth={thisMonth()}
          onClose={() => setAssessOpen(false)} onSave={saveAssessment} onError={fail} />
      )}
      {claimFormOpen && (
        <ProgressClaimModal boqItems={boqRows} workOrders={workOrders.data ?? []} contractNet={summary?.contractNet ?? 0}
          currencySymbolPrefix={currencySymbol(currency)} hasDownPayment={liveDownPayment}
          claimedByBoqItem={summary?.claimedByBoqItem ?? {}} assessedByBoqItem={summary?.assessedByBoqItem ?? {}}
          assessmentMonth={summary?.assessment?.month ?? null}
          onClose={() => setClaimFormOpen(false)} onSave={saveClaim} onError={fail} />
      )}
      {evidenceFor && (
        <ClaimEvidenceModal documents={documents.data ?? []}
          attachedDocumentIds={(evidenceClaim?.evidence ?? []).map((e) => e.document_id)}
          onClose={() => setEvidenceFor(null)} onAttach={attachEvidence} onError={fail} />
      )}
      {raiseFor && (
        <ConfirmDialog
          open
          title={t('projectDetail.billing.claims.confirmRaise.title', "Raise this claim's invoice?")}
          description={
            <div className="flex flex-col gap-2">
              <p>{t('projectDetail.billing.claims.confirmRaise.body', 'An ERP sales invoice draft is created from this claim. A different Admin or Finance user submits it.')}</p>
              <p data-testid="raise-figures">
                {t('projectDetail.billing.claims.confirmRaise.figures', 'Claimed {{gross}} · down payment recovered {{recovery}} · net {{net}} (excl. PPN)', {
                  gross: cents(raiseFor.claim.gross_amount),
                  recovery: cents(raiseFor.claim.dp_recovery_amount),
                  net: cents(claimNet(Number(raiseFor.claim.gross_amount), Number(raiseFor.claim.dp_recovery_amount))),
                  interpolation: { escapeValue: false },
                })}
              </p>
            </div>
          }
          confirmLabel={t('projectDetail.billing.claims.confirmRaise.confirm', 'Create ERP invoice')}
          loading={mutations.raiseInvoice.isPending}
          onConfirm={() => void runRaise()}
          onCancel={() => setRaiseFor(null)}
        />
      )}
      {withdrawFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.claims.confirmWithdraw.title', 'Withdraw this claim?')}
          description={t('projectDetail.billing.claims.confirmWithdraw.body', 'Withdrawing is final. Its quantities and down payment recovery are released for a new claim.')}
          confirmLabel={t('projectDetail.billing.claims.confirmWithdraw.confirm', 'Withdraw claim')}
          loading={mutations.withdrawClaim.isPending}
          onConfirm={() => void runWithdraw()}
          onCancel={() => setWithdrawFor(null)}
        />
      )}
      {deleteFor && (
        <ConfirmDialog
          open
          tone="destructive"
          title={t('projectDetail.billing.boq.confirmDelete.title', 'Delete this line?')}
          description={t('projectDetail.billing.boq.confirmDelete.body', 'The line is removed from the bill of quantities. A line already assessed or claimed cannot be deleted.')}
          confirmLabel={t('projectDetail.billing.boq.confirmDelete.confirm', 'Delete line')}
          loading={mutations.deleteBoq.isPending}
          onConfirm={() => void runDelete()}
          onCancel={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
};

export default BillingTab;
```

`may('edit', 'projectProgress', { currentUserId, record })` is #765's policy call; if `usePermission`'s context type on
`dev` does not yet carry `currentUserId`, pass it the same way #765's progress control does
(`grep -rn "'projectProgress'" pmo-portal/src pmo-portal/pages`).

Verify GREEN: same command as C23. Expect: 12/12. Mutation check (do not commit): change
`c.evidence.length > 0 ?` to `true ?` → the "without evidence" case red; revert.

### Task C25 — the Billing tab on the project page · AC-PB-008

In `pmo-portal/pages/project-detail/__tests__/ProjectDetail.tabs.test.tsx`:
1. After the line `vi.mock('../tabs/DocumentsTab', …);` add
   `vi.mock('../tabs/BillingTab', () => ({ default: () => <div data-testid="tab-billing">Billing</div> }));`
2. Inside the `describe(…)` block, before the "unknown tab" case, add:
   ```tsx
   it('AC-PB-008: /projects/:id/billing pre-selects the Billing tab', () => {
     renderAt('/projects/p1/billing');
     expect(screen.getByTestId('tab-billing')).toBeInTheDocument();
   });

   it('AC-PB-008: an Engineer has no Billing tab, even by deep link', () => {
     render(
       <ImpersonationProvider realRole="Engineer">
         <MemoryRouter initialEntries={['/projects/p1/billing']}>
           <ToastProvider>
             <Routes>
               <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
             </Routes>
           </ToastProvider>
         </MemoryRouter>
       </ImpersonationProvider>,
     );
     expect(screen.queryByTestId('tab-billing')).toBeNull();
   });
   ```

Run it RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail/__tests__/ProjectDetail.tabs.test.tsx`
Expect: the first new case fails (the route falls back to Overview).

Then in `pmo-portal/pages/project-detail/ProjectDetail.tsx`:
1. Add `import BillingTab from './tabs/BillingTab';` after the `WorkOrdersTab` import.
2. Replace `type PTab = 'overview' | 'budget' | 'procurement' | 'tasks' | 'work-orders' | 'documents';` with
   `type PTab = 'overview' | 'budget' | 'procurement' | 'tasks' | 'work-orders' | 'billing' | 'documents';`
3. Replace `const TAB_VALUES: PTab[] = ['overview', 'budget', 'procurement', 'tasks', 'work-orders', 'documents'];` with
   `const TAB_VALUES: PTab[] = ['overview', 'budget', 'procurement', 'tasks', 'work-orders', 'billing', 'documents'];`
4. If the component has no `usePermission()` result in scope yet, add `import { usePermission } from '@/src/auth/usePermission';`
   and, at the top of the component body, `const may = usePermission();` and
   `const canSeeBilling = may('view', 'progressClaim');`. If it already has `may`, add only the `canSeeBilling` line.
5. In the tab list, after `{ value: 'work-orders', label: t('projectDetail.tabs.workOrders', 'Work orders') },` add
   `...(canSeeBilling ? [{ value: 'billing' as const, label: t('projectDetail.tabs.billing', 'Billing') }] : []),`
   and add `canSeeBilling` to that `useMemo`'s dependency array (`[t]` → `[t, canSeeBilling]`).
6. After the `{tab === 'work-orders' && (…)}` block add:
   ```tsx
   {tab === 'billing' && canSeeBilling && (
     <BillingTab projectId={project.id} currency={project.currency} clientId={project.client_id ?? null}
       projectManagerId={project.project_manager_id ?? null} />
   )}
   ```

Verify GREEN: same command. Expect: all cases pass, including the existing ones.

### Task C26 — related-test sweep

```bash
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run pages/project-detail src/lib/progressBilling.test.ts src/lib/db src/hooks/useProgressBilling.test.tsx src/auth src/lib/repositories
```
Expect: all green. A red test you did not touch is a regression in your diff — fix the code, never the test.

### Task C27 — test: strings (RED) · AC-PB-014

Create `pmo-portal/src/lib/progressBilling.i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../public/locales/en/common.json';
import id from '../../public/locales/id/common.json';

type Tree = { [key: string]: string | Tree };
const leaves = (tree: Tree, prefix = ''): Record<string, string> => Object.fromEntries(
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string'
    ? [[`${prefix}${key}`, value]]
    : Object.entries(leaves(value, `${prefix}${key}.`)))),
);
const billing = (catalogue: unknown) => leaves(((catalogue as Tree).projectDetail as Tree).billing as Tree);
const SCREENS = [
  'pages/project-detail/tabs/BillingTab.tsx',
  'pages/project-detail/BoqItemFormModal.tsx',
  'pages/project-detail/ProgressClaimModal.tsx',
  'pages/project-detail/ProgressAssessmentModal.tsx',
  'pages/project-detail/ClaimEvidenceModal.tsx',
];

describe('progress billing strings', () => {
  it('AC-PB-014 every billing key exists, non-empty, in English and Indonesian', () => {
    const english = billing(en);
    const indonesian = billing(id);
    expect(Object.keys(indonesian).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of [...Object.entries(english), ...Object.entries(indonesian)]) {
      expect(value.trim(), key).not.toBe('');
    }
    expect(((en as unknown as Tree).projectDetail as Tree).tabs).toHaveProperty('billing');
    expect(((id as unknown as Tree).projectDetail as Tree).tabs).toHaveProperty('billing');
  });

  it('AC-PB-014 every key the billing screens use is in the catalogue', () => {
    const english = billing(en);
    const used = SCREENS.flatMap((file) => [...readFileSync(join(process.cwd(), file), 'utf8')
      .matchAll(/'projectDetail\.billing\.([A-Za-z.]+)'/g)].map((match) => match[1]));
    expect(used.length).toBeGreaterThan(80);
    expect(used.filter((key) => !(key in english))).toEqual([]);
  });
});
```

Verify RED: `cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run src/lib/progressBilling.i18n.test.ts` — Expect: fails (no `billing` subtree).

### Task C28 — strings + launch scope (GREEN) · AC-PB-014, NFR-PB-005

In `pmo-portal/public/locales/en/common.json`, inside `"projectDetail"`, add after `"backToProjects": …,`:

```json
"billing": {
  "assessment": {
    "errors": {
      "month": "Enter the month as YYYY-MM",
      "quantity": "Each quantity done to date must be 0 or more with at most 3 decimal places"
    },
    "month": "Month (YYYY-MM)",
    "note": "Note (optional)",
    "quantityToDate": "{{item}} — done to date ({{unit}})",
    "record": "Record progress",
    "save": "Save progress",
    "subtitle": "Quantities done to date for the month. This is the operational assessment — it never creates an invoice.",
    "title": "Record progress",
    "toast": { "saved": "Progress recorded: {{pct}}% complete" }
  },
  "boq": {
    "add": "Add line",
    "column": {
      "actions": "Actions",
      "assessed": "Assessed",
      "claimed": "Claimed",
      "item": "Item",
      "quantity": "Quantity",
      "rate": "Rate",
      "remaining": "Left to claim"
    },
    "confirmDelete": {
      "body": "The line is removed from the bill of quantities. A line already assessed or claimed cannot be deleted.",
      "confirm": "Delete line",
      "title": "Delete this line?"
    },
    "delete": "Delete",
    "edit": "Edit",
    "empty": "No bill of quantities yet",
    "emptySub": "Add the contract's priced lines to assess progress and bill by quantity.",
    "error": "Couldn’t load the bill of quantities",
    "errorSub": "Retry, or reopen the project.",
    "overClaimed": "Over-claimed",
    "title": "Bill of quantities",
    "toast": { "deleted": "Bill of quantities line deleted", "saved": "Bill of quantities line saved" }
  },
  "boqForm": {
    "description": "Description",
    "errors": {
      "quantity": "Enter a quantity above 0 with at most 3 decimal places",
      "rate": "Enter a rate of 0 or more with at most 2 decimal places",
      "required": "Required"
    },
    "item": "ERP item",
    "legend": "Line",
    "noWorkOrder": "None — the whole contract",
    "quantity": "Quantity",
    "rate": "Rate (excl. PPN)",
    "save": "Save line",
    "subtitle": "Rates exclude tax. A line may belong to one work order on this project.",
    "titleEdit": "Edit bill of quantities line",
    "titleNew": "Add a bill of quantities line",
    "unit": "Unit",
    "workOrder": "Work order"
  },
  "claimForm": {
    "dpAmount": "Down payment amount (excl. PPN)",
    "errors": {
      "dpAmount": "Enter a down payment above 0 with at most 2 decimal places",
      "noQuantity": "Enter a quantity for at least one line",
      "quantity": "Each quantity must be above 0 with at most 3 decimal places",
      "recoveryPct": "Enter a percentage above 0 and at most 100, with at most 3 decimal places"
    },
    "kind": "Claim type",
    "kindDownPayment": "Down payment",
    "kindProgress": "Progress — quantities against the bill of quantities",
    "linesLegend": "Quantities to bill",
    "noLines": "No bill of quantities lines in this scope.",
    "prefill": "Start from the {{month}} assessment",
    "quantity": "{{item}} — {{description}} ({{unit}})",
    "recoverRest": "Recover the rest of the down payment with this claim",
    "recoveryHelp": "Proportional to the contract: {{pct}}%",
    "recoveryPct": "Recovered from each claim (%)",
    "save": "Create claim",
    "scope": "Bills",
    "scopeContract": "Lines with no work order",
    "subtitle": "A claim becomes one ERP invoice. Attach the evidence before raising it.",
    "title": "New billing claim"
  },
  "claims": {
    "attachEvidence": "Attach evidence",
    "column": {
      "actions": "Actions",
      "claim": "Claim",
      "evidence": "Evidence",
      "gross": "Claimed",
      "invoice": "Invoice",
      "net": "Net",
      "recovery": "Down payment recovered"
    },
    "confirmRaise": {
      "body": "An ERP sales invoice draft is created from this claim. A different Admin or Finance user submits it.",
      "confirm": "Create ERP invoice",
      "figures": "Claimed {{gross}} · down payment recovered {{recovery}} · net {{net}} (excl. PPN)",
      "title": "Raise this claim's invoice?"
    },
    "confirmWithdraw": {
      "body": "Withdrawing is final. Its quantities and down payment recovery are released for a new claim.",
      "confirm": "Withdraw claim",
      "title": "Withdraw this claim?"
    },
    "empty": "No billing claims yet",
    "emptySub": "A claim bills a down payment or quantities done, as one ERP invoice.",
    "error": "Couldn’t load the billing claims",
    "errorSub": "Retry, or reopen the project.",
    "evidenceNeeded": "Attach evidence before raising",
    "kind": { "downPayment": "Down payment", "progress": "Progress" },
    "new": "New claim",
    "notRaised": "Not raised",
    "raise": "Raise invoice",
    "title": "Billing claims",
    "toast": {
      "created": "Billing claim created",
      "evidenceAttached": "Evidence attached",
      "raised": "Invoice raised in the ERP",
      "withdrawn": "Claim withdrawn"
    },
    "withdraw": "Withdraw",
    "withdrawn": "Withdrawn"
  },
  "evidence": {
    "document": "Evidence document",
    "none": "No issued or approved document with a file on this project.",
    "revision": "rev {{revision}}",
    "save": "Attach",
    "subtitle": "Choose an issued or approved document from this project's register, such as the progress report or the client's acceptance.",
    "title": "Attach billing evidence"
  },
  "summary": {
    "assessed": "Assessed to date",
    "assessedAsOf": "as of {{month}}, {{pct}}% complete",
    "billed": "Billed to date",
    "contract": "Contract value",
    "dpHeld": "Down payment held",
    "error": "Couldn't load billing",
    "exclTax": "excl. PPN",
    "gap": "Work done, not yet billed",
    "noAssessment": "No assessment yet",
    "notSubmitted": "Raised, not yet submitted",
    "remaining": "Contract not yet billed",
    "title": "Billing summary"
  }
},
```

and inside `"projectDetail"` → `"tabs"`, after `"ariaLabel": …,` add `"billing": "Billing",`.

In `pmo-portal/public/locales/id/common.json`, the same two places:

```json
"billing": {
  "assessment": {
    "errors": {
      "month": "Isi bulan dengan format YYYY-MM",
      "quantity": "Setiap kuantitas selesai harus 0 atau lebih dengan paling banyak 3 angka desimal"
    },
    "month": "Bulan (YYYY-MM)",
    "note": "Catatan (opsional)",
    "quantityToDate": "{{item}} — selesai s.d. saat ini ({{unit}})",
    "record": "Catat progres",
    "save": "Simpan progres",
    "subtitle": "Kuantitas yang selesai s.d. bulan ini. Ini penilaian operasional — tidak pernah membuat faktur.",
    "title": "Catat progres",
    "toast": { "saved": "Progres tercatat: {{pct}}% selesai" }
  },
  "boq": {
    "add": "Tambah baris",
    "column": {
      "actions": "Aksi",
      "assessed": "Dinilai",
      "claimed": "Ditagih",
      "item": "Item",
      "quantity": "Kuantitas",
      "rate": "Harga satuan",
      "remaining": "Sisa untuk ditagih"
    },
    "confirmDelete": {
      "body": "Baris dihapus dari bill of quantities. Baris yang sudah dinilai atau ditagih tidak dapat dihapus.",
      "confirm": "Hapus baris",
      "title": "Hapus baris ini?"
    },
    "delete": "Hapus",
    "edit": "Ubah",
    "empty": "Belum ada bill of quantities",
    "emptySub": "Tambahkan baris harga kontrak untuk menilai progres dan menagih per kuantitas.",
    "error": "Bill of quantities tidak dapat dimuat",
    "errorSub": "Coba lagi, atau buka ulang proyek.",
    "overClaimed": "Melebihi tagihan",
    "title": "Bill of quantities",
    "toast": { "deleted": "Baris bill of quantities dihapus", "saved": "Baris bill of quantities disimpan" }
  },
  "boqForm": {
    "description": "Deskripsi",
    "errors": {
      "quantity": "Isi kuantitas di atas 0 dengan paling banyak 3 angka desimal",
      "rate": "Isi harga 0 atau lebih dengan paling banyak 2 angka desimal",
      "required": "Wajib diisi"
    },
    "item": "Item ERP",
    "legend": "Baris",
    "noWorkOrder": "Tidak ada — seluruh kontrak",
    "quantity": "Kuantitas",
    "rate": "Harga satuan (belum termasuk PPN)",
    "save": "Simpan baris",
    "subtitle": "Harga belum termasuk pajak. Satu baris dapat terkait satu work order di proyek ini.",
    "titleEdit": "Ubah baris bill of quantities",
    "titleNew": "Tambah baris bill of quantities",
    "unit": "Satuan",
    "workOrder": "Work order"
  },
  "claimForm": {
    "dpAmount": "Nilai uang muka (belum termasuk PPN)",
    "errors": {
      "dpAmount": "Isi uang muka di atas 0 dengan paling banyak 2 angka desimal",
      "noQuantity": "Isi kuantitas untuk setidaknya satu baris",
      "quantity": "Setiap kuantitas harus di atas 0 dengan paling banyak 3 angka desimal",
      "recoveryPct": "Isi persentase di atas 0 dan paling tinggi 100, dengan paling banyak 3 angka desimal"
    },
    "kind": "Jenis tagihan",
    "kindDownPayment": "Uang muka",
    "kindProgress": "Progres — kuantitas terhadap bill of quantities",
    "linesLegend": "Kuantitas yang ditagih",
    "noLines": "Tidak ada baris bill of quantities dalam cakupan ini.",
    "prefill": "Mulai dari penilaian {{month}}",
    "quantity": "{{item}} — {{description}} ({{unit}})",
    "recoverRest": "Pulihkan sisa uang muka dengan tagihan ini",
    "recoveryHelp": "Proporsional terhadap kontrak: {{pct}}%",
    "recoveryPct": "Dipulihkan dari setiap tagihan (%)",
    "save": "Buat tagihan",
    "scope": "Menagih",
    "scopeContract": "Baris tanpa work order",
    "subtitle": "Satu tagihan menjadi satu faktur ERP. Lampirkan bukti sebelum menerbitkannya.",
    "title": "Tagihan baru"
  },
  "claims": {
    "attachEvidence": "Lampirkan bukti",
    "column": {
      "actions": "Aksi",
      "claim": "Tagihan",
      "evidence": "Bukti",
      "gross": "Ditagih",
      "invoice": "Faktur",
      "net": "Neto",
      "recovery": "Uang muka dipulihkan"
    },
    "confirmRaise": {
      "body": "Draf faktur penjualan ERP dibuat dari tagihan ini. Pengguna Admin atau Finance lain yang men-submit-nya.",
      "confirm": "Buat faktur ERP",
      "figures": "Ditagih {{gross}} · uang muka dipulihkan {{recovery}} · neto {{net}} (belum termasuk PPN)",
      "title": "Terbitkan faktur tagihan ini?"
    },
    "confirmWithdraw": {
      "body": "Penarikan bersifat final. Kuantitas dan pemulihan uang mukanya dilepas untuk tagihan baru.",
      "confirm": "Tarik tagihan",
      "title": "Tarik tagihan ini?"
    },
    "empty": "Belum ada tagihan",
    "emptySub": "Satu tagihan menagih uang muka atau kuantitas yang selesai, sebagai satu faktur ERP.",
    "error": "Tagihan tidak dapat dimuat",
    "errorSub": "Coba lagi, atau buka ulang proyek.",
    "evidenceNeeded": "Lampirkan bukti sebelum menerbitkan",
    "kind": { "downPayment": "Uang muka", "progress": "Progres" },
    "new": "Tagihan baru",
    "notRaised": "Belum diterbitkan",
    "raise": "Terbitkan faktur",
    "title": "Tagihan",
    "toast": {
      "created": "Tagihan dibuat",
      "evidenceAttached": "Bukti dilampirkan",
      "raised": "Faktur diterbitkan di ERP",
      "withdrawn": "Tagihan ditarik"
    },
    "withdraw": "Tarik",
    "withdrawn": "Ditarik"
  },
  "evidence": {
    "document": "Dokumen bukti",
    "none": "Tidak ada dokumen terbit atau disetujui yang memiliki berkas di proyek ini.",
    "revision": "rev {{revision}}",
    "save": "Lampirkan",
    "subtitle": "Pilih dokumen terbit atau disetujui dari register proyek ini, seperti laporan progres atau berita acara serah terima (BAST) klien.",
    "title": "Lampirkan bukti penagihan"
  },
  "summary": {
    "assessed": "Dinilai s.d. saat ini",
    "assessedAsOf": "per {{month}}, {{pct}}% selesai",
    "billed": "Ditagih s.d. saat ini",
    "contract": "Nilai kontrak",
    "dpHeld": "Uang muka tertahan",
    "error": "Data penagihan tidak dapat dimuat",
    "exclTax": "belum termasuk PPN",
    "gap": "Pekerjaan selesai, belum ditagih",
    "noAssessment": "Belum ada penilaian",
    "notSubmitted": "Diterbitkan, belum di-submit",
    "remaining": "Kontrak belum ditagih",
    "title": "Ringkasan penagihan"
  }
},
```

and in `"projectDetail"` → `"tabs"`, after `"ariaLabel": …,` add `"billing": "Penagihan",`.

In `pmo-portal/src/lib/i18n/launch-scope-routes.txt`, after the `/projects/:projectId/work-orders …` line add:

```
/projects/:projectId/billing      pages/project-detail/tabs/BillingTab.tsx pages/project-detail/BoqItemFormModal.tsx pages/project-detail/ProgressClaimModal.tsx pages/project-detail/ProgressAssessmentModal.tsx pages/project-detail/ClaimEvidenceModal.tsx
```

`OrgDownPaymentItem.tsx` stays English-only, as its sibling `OrgWithholdingAccount.tsx` (Administration is outside the
launch scope).

Verify GREEN:
```bash
cd pmo-portal && node -e "JSON.parse(require('fs').readFileSync('public/locales/en/common.json','utf8')); JSON.parse(require('fs').readFileSync('public/locales/id/common.json','utf8'))" \
  && ../scripts/with-test-lock.sh npx vitest run src/lib/progressBilling.i18n.test.ts src/lib/i18n
```
Expect: both JSON files parse; the new test and the existing launch-scope tests pass.

### Task C29 — Slice C gate

```bash
cd pmo-portal && ../scripts/with-test-lock.sh npm run typecheck \
  && npx eslint --max-warnings=0 pages/project-detail/tabs/BillingTab.tsx pages/project-detail/BoqItemFormModal.tsx pages/project-detail/ProgressClaimModal.tsx pages/project-detail/ProgressAssessmentModal.tsx pages/project-detail/ClaimEvidenceModal.tsx pages/project-detail/ProjectDetail.tsx pages/admin/OrgDownPaymentItem.tsx pages/Administration.tsx src/lib/progressBilling.ts src/lib/db/progressBilling.ts src/lib/db/orgs.ts src/lib/repositories/index.ts src/lib/repositories/types.ts src/hooks/useProgressBilling.ts src/auth/policy.ts \
  && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
```
Expect: 0 type errors, 0 lint warnings, all related tests green, ≥ 80% line coverage on the new files
(`npx vitest run --coverage --changed origin/dev`). Then the rendered Discover pass (`design-reviewer`, rich seed,
Billing tab as Finance, PM and Engineer) per `docs/qa-portfolio.md` — not part of this plan's tasks.
