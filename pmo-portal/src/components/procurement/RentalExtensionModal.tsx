import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateField, EntityFormModal, FormGrid, FormSection, NumberField, type SubmitError } from '@/src/components/ui';
import { useRefusalText } from '@/src/lib/refusals';
import { defaultExtensionPeriod } from '@/src/lib/rentalPeriod';
import { formatDay, parseMoneyInputAtScale } from '@/src/lib/format';
import type { RentalExtensionInput } from '@/src/lib/repositories/purchaseTypes';

export interface ExtensionLine { id: string; name: string; description: string | null; quantity: number; rate: number }

export interface RentalExtensionModalProps {
  title: string;
  rentalFrom: string;
  rentalTo: string;
  lines: ExtensionLine[];
  onClose: () => void;
  /** Resolves with the id of the new purchase. */
  onSave: (input: Omit<RentalExtensionInput, 'originalId'>) => Promise<string>;
  onDone: (newId: string) => void;
}

/** The guided "Extend rental" step (FR-PTR-009): a new period and the carried-over lines, confirmed into a NEW purchase. */
const RentalExtensionModal: React.FC<RentalExtensionModalProps> = ({ title, rentalFrom, rentalTo, lines, onClose, onSave, onDone }) => {
  const { t } = useTranslation('purchaseTypes');
  const refusal = useRefusalText();
  const initial = defaultExtensionPeriod(rentalFrom, rentalTo);
  const newId = useRef(crypto.randomUUID());                                   // one id per open step, so a retry never makes a second purchase
  const lineIds = useRef(new Map(lines.map((l) => [l.id, crypto.randomUUID()])));
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.quantity)])));
  const [rate, setRate] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(l.rate)])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!from) next.from = t('extend.fromRequired', 'Choose the start of the new period.');
    if (!to) next.to = t('extend.toRequired', 'Choose the end of the new period.');
    else if (from && to < from) next.to = t('extend.toBeforeFrom', 'The end cannot be before the start.');
    else if (from && from <= rentalTo) next.from = t('extend.afterEnd', 'The new period must start after {{end}}.', { end: formatDay(rentalTo) });
    const out: NonNullable<RentalExtensionInput['lines']> = [];
    for (const l of lines) {
      const q = parseMoneyInputAtScale(qty[l.id]?.trim() ?? '', 2);
      const r = parseMoneyInputAtScale(rate[l.id]?.trim() ?? '', 2);
      if (q === null || q < 0 || r === null || r < 0) next[`line-${l.id}`] = t('extend.lineInvalid', 'Enter a quantity and a rate of 0 or more.');
      else out.push({ id: lineIds.current.get(l.id) as string, name: l.name, description: l.description, quantity: q, rate: r });
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ id: newId.current, from, to, lines: out })
      .then(onDone)
      .catch((error: unknown) => {
        const r = refusal(error, { context: { suppressCapture: true } });
        setSaveError(r.known ? { headline: t('extend.refused', 'The rental could not be extended'), detail: r.headline } : { headline: r.headline, detail: r.detail });
      })
      .finally(() => setBusy(false));
  };

  return (
    <EntityFormModal open width="lg" title={t('extend.title', 'Extend rental')} submitLabel={t('extend.submit', 'Create extension order')}
      onSubmit={submit} submitError={saveError} onClose={onClose} loading={busy} dirty={from !== initial.from || to !== initial.to}>
      <p className="mb-3 text-sm text-foreground">{t('extend.intro', '{{title}} runs {{from}} to {{to}}. This creates a new order for the extra period. It goes through approval like any other order.', { title, from: formatDay(rentalFrom), to: formatDay(rentalTo) })}</p>
      <FormSection legend={t('extend.periodLegend', 'New rental period')}>
        <FormGrid>
          <DateField label={t('extend.from', 'From')} required value={from} min={undefined} onChange={setFrom} error={errors.from} fullWidth />
          <DateField label={t('extend.to', 'To')} required value={to} min={from || undefined} onChange={setTo} error={errors.to} fullWidth />
        </FormGrid>
      </FormSection>
      {lines.length > 0 && (
        <FormSection legend={t('extend.linesLegend', 'Lines carried over')}>
          <ul className="space-y-3">
            {lines.map((l) => (
              <li key={l.id} className="space-y-2" data-testid="extension-line">
                <p className="text-sm font-medium">{l.name}</p>
                <FormGrid>
                  <NumberField label={t('extend.quantity', 'Quantity')} value={qty[l.id] ?? ''} onChange={(v) => setQty({ ...qty, [l.id]: v })} fullWidth />
                  <NumberField label={t('extend.rate', 'Rate')} value={rate[l.id] ?? ''} onChange={(v) => setRate({ ...rate, [l.id]: v })} error={errors[`line-${l.id}`]} fullWidth />
                </FormGrid>
              </li>
            ))}
          </ul>
        </FormSection>
      )}
    </EntityFormModal>
  );
};
export default RentalExtensionModal;
