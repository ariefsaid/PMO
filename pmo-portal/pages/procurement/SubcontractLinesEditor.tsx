import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, FormSection, NumberField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatMoneyInputValue, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import { useBoqItems } from '@/src/hooks/useProgressBilling';
import type {
  AttributeSubcontractBillLineInput, SetPoLinesInput, SubcontractCapExceptionRow, SubcontractPoPositionRow,
} from '@/src/lib/db/subcontracts';

/** Both dialogs share the "quantity per BoQ line, blank = not on it" shape; the server re-checks every figure. */
function useLineForm<T>(
  build: (values: Record<string, string>, errs: Record<string, string>) => T[],
  onSave: (lines: T[]) => Promise<unknown>,
  onClose: () => void,
  initial: Record<string, string>,
) {
  const { t } = useTranslation('procurement');
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const lines = build(values, errs);
    if (Object.keys(errs).length === 0 && lines.length === 0) {
      errs.lines = t('subcontract.form.noLines', 'Enter a quantity for at least one line');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSaveError(null);
    void onSave(lines)
      .then(onClose)
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
      })
      .finally(() => setSaving(false));
  };
  return { values, setValues, errors, saving, saveError, submit };
}

const parseQty = (raw: string, errs: Record<string, string>, key: string, message: string): number | null => {
  const text = raw.trim();
  if (text === '') return null;
  const n = parseMoneyInputAtScale(text, 3);
  if (n === null || n <= 0) { errs[key] = message; return null; }
  return n;
};

/** Set (replace) the draft BoQ lines of a subcontract PO: a quantity per project BoQ item, the item's rate and unit. */
export const SubcontractLinesEditor: React.FC<{
  projectId: string;
  initial: Array<{ boq_item_id: string; quantity: number }>;
  currency: string;
  onClose: () => void;
  onSave: (lines: SetPoLinesInput[]) => Promise<unknown>;
}> = ({ projectId, initial, currency, onClose, onSave }) => {
  const { t } = useTranslation('procurement');
  const boq = useBoqItems(projectId);
  const items = boq.data ?? [];
  const bad = t('subcontract.form.quantity', 'Quantity must be more than 0 with at most 3 decimal places');
  const form = useLineForm<SetPoLinesInput>(
    (values, errs) => items.flatMap((item) => {
      const quantity = parseQty(values[item.id] ?? '', errs, item.id, bad);
      return quantity === null ? [] : [{ boqItemId: item.id, quantity, rate: Number(item.rate), unit: item.unit }];
    }),
    onSave, onClose,
    Object.fromEntries(initial.map((l) => [l.boq_item_id, formatMoneyInputValue(Number(l.quantity))])),
  );
  return (
    <EntityFormModal open width="lg" title={t('subcontract.editor.title', 'Set BoQ lines')}
      submitLabel={t('subcontract.editor.save', 'Save lines')} onSubmit={form.submit} submitError={form.saveError}
      onClose={onClose} loading={form.saving} dirty={Object.values(form.values).some((v) => v !== '')}>
      <p className="mb-3 text-sm text-muted-foreground">{t('subcontract.editor.subtitle', 'Saving replaces the draft; issuing freezes it.')}</p>
      <FormSection legend={t('subcontract.editor.legend', 'Quantity per line')}>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('subcontract.editor.noBoq', 'This project has no BoQ items yet.')}</p>
        ) : (
          <FormGrid>
            {items.map((item) => (
              <NumberField key={item.id} id={`sc-line-${item.id}`}
                label={t('subcontract.editor.line', '{{item}} ({{unit}})', { item: `${item.item_code} — ${item.description}`, unit: item.unit })}
                value={form.values[item.id] ?? ''} onChange={(v) => form.setValues((c) => ({ ...c, [item.id]: v }))}
                helper={t('subcontract.editor.rate', 'Rate {{rate}}', { rate: formatCurrency(Number(item.rate), currency) })}
                error={form.errors[item.id]} localeAware />
            ))}
          </FormGrid>
        )}
        {form.errors.lines && <p role="alert" className="mt-1 text-sm text-destructive-text">{form.errors.lines}</p>}
      </FormSection>
    </EntityFormModal>
  );
};

/** Attribute an un-lined bill to PO lines (OQ-10): the quantity billed per line, at the PO rate. */
export const SubcontractAttributeModal: React.FC<{
  rows: SubcontractPoPositionRow[];
  invoice: SubcontractCapExceptionRow;
  currency: string;
  onClose: () => void;
  onSave: (lines: AttributeSubcontractBillLineInput[]) => Promise<unknown>;
}> = ({ rows, invoice, currency, onClose, onSave }) => {
  const { t } = useTranslation('procurement');
  const bad = t('subcontract.form.quantity', 'Quantity must be more than 0 with at most 3 decimal places');
  const form = useLineForm<AttributeSubcontractBillLineInput>(
    (values, errs) => rows.flatMap((r) => {
      const quantity = parseQty(values[r.boq_item_id] ?? '', errs, r.boq_item_id, bad);
      return quantity === null ? [] : [{ boqItemId: r.boq_item_id, quantity, rate: r.rate }];
    }),
    onSave, onClose, {},
  );
  return (
    <EntityFormModal open width="lg"
      title={t('subcontract.attribute.title', 'Attribute lines to bill {{number}}', { number: invoice.number })}
      submitLabel={t('subcontract.attribute.save', 'Attribute lines')} onSubmit={form.submit} submitError={form.saveError}
      onClose={onClose} loading={form.saving} dirty={Object.values(form.values).some((v) => v !== '')}>
      <p className="mb-3 text-sm text-foreground">{t('subcontract.attribute.subtitle', 'This bill of {{amount}} was recorded without line quantities.', { amount: formatCurrency(invoice.amount, currency) })}</p>
      <FormSection legend={t('subcontract.attribute.legend', 'Quantity billed per line')}>
        <FormGrid>
          {rows.map((r) => (
            <NumberField key={r.boq_item_id} id={`sc-attr-${r.boq_item_id}`}
              label={t('subcontract.editor.line', '{{item}} ({{unit}})', { item: `${r.item_code} — ${r.description}`, unit: r.unit })}
              value={form.values[r.boq_item_id] ?? ''} onChange={(v) => form.setValues((c) => ({ ...c, [r.boq_item_id]: v }))}
              helper={t('subcontract.attribute.helper', 'PO {{po}}, verified {{verified}}, rate {{rate}}', {
                po: formatNumberExact(r.po_qty), verified: formatNumberExact(r.verified), rate: formatCurrency(r.rate, currency),
              })}
              error={form.errors[r.boq_item_id]} localeAware />
          ))}
        </FormGrid>
        {form.errors.lines && <p role="alert" className="mt-1 text-sm text-destructive-text">{form.errors.lines}</p>}
      </FormSection>
    </EntityFormModal>
  );
};
