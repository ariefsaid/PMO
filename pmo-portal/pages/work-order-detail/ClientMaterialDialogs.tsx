import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextArea, TextField, type SubmitError } from '@/src/components/ui';
import { formatNumberExact } from '@/src/lib/format';
import type { ClientRequisitionLineRow } from '@/src/lib/repositories/clientRequisitions';
import type { CsrLineFigures } from '@/src/lib/clientRequisitionRollup';
import type { StockItemRow } from '@/src/lib/db/stockMaster';
import { readQuantity, useSubmitError, type Option } from './clientMaterialText';

// ── requisition form (create / edit draft) ───────────────────────────────────────────────────────────────────

export interface RequisitionDraftLine { stockItemId: string; takeoff: string; requested: string; allocationId: string }

export interface RequisitionFormProps {
  title: string;
  submitLabel: string;
  items: Array<Pick<StockItemRow, 'id' | 'code' | 'name'> & { unit: string }>;
  allocationOptions: Option[];
  initial: { clientReference: string; lines: RequisitionDraftLine[] };
  onClose: () => void;
  onSave: (v: { clientReference: string | null; lines: Array<{ stockItemId: string; takeoffQuantity: string; requestedQuantity?: string; workOrderLineId: string | null }> }) => Promise<unknown>;
}

const blankLine = (): RequisitionDraftLine => ({ stockItemId: '', takeoff: '', requested: '', allocationId: '' });

export const RequisitionFormDialog: React.FC<RequisitionFormProps> = ({ title, submitLabel, items, allocationOptions, initial, onClose, onSave }) => {
  const { t } = useTranslation('workOrders');
  const submitError = useSubmitError();
  const [clientReference, setClientReference] = useState(initial.clientReference);
  const [lines, setLines] = useState<RequisitionDraftLine[]>(initial.lines.length ? initial.lines : [blankLine()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const itemOptions = useMemo(() => items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name} (${i.unit})` })), [items]);
  const patch = (i: number, p: Partial<RequisitionDraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const dirty = clientReference !== initial.clientReference || JSON.stringify(lines) !== JSON.stringify(initial.lines.length ? initial.lines : [blankLine()]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const out = lines.map((l, i) => {
      const take = readQuantity(l.takeoff);
      const req = l.requested.trim() === '' ? undefined : readQuantity(l.requested);
      if (!l.stockItemId) next[`item${i}`] = t('clientMaterial.form.itemRequired', 'Choose an item.');
      if (take === null) next[`take${i}`] = t('clientMaterial.form.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
      if (req === null) next[`req${i}`] = t('clientMaterial.form.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
      return { stockItemId: l.stockItemId, takeoffQuantity: take ?? '', requestedQuantity: req ?? undefined, workOrderLineId: l.allocationId || null };
    });
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ clientReference: clientReference.trim() || null, lines: out })
      .then(onClose)
      .catch((err: unknown) => setSaveError(submitError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <EntityFormModal open width="lg" title={title} submitLabel={submitLabel} onSubmit={submit} onClose={onClose}
      submitError={saveError} loading={busy} dirty={dirty}>
      <FormSection legend={t('clientMaterial.form.header', 'Requisition')}>
        <TextField id="csr-client-reference" label={t('clientMaterial.form.clientReference', 'Client reference')} value={clientReference}
          onChange={setClientReference} maxLength={120} fullWidth />
      </FormSection>
      <FormSection legend={t('clientMaterial.form.lines', 'Items')}>
        <div className="flex flex-col gap-4">
          {lines.map((l, i) => (
            <div key={i} className="flex flex-col gap-3 border-b border-border pb-4 last:border-b-0" data-testid={`csr-form-line-${i}`}>
              <SelectField id={`csr-item-${i}`} label={t('clientMaterial.form.item', 'Item')} value={l.stockItemId} onChange={(v) => patch(i, { stockItemId: v })}
                options={itemOptions} placeholder={t('clientMaterial.form.itemPlaceholder', 'Choose an item')} error={errors[`item${i}`]} required fullWidth />
              <FormGrid>
                <NumberField id={`csr-take-${i}`} label={t('clientMaterial.form.takeoff', 'Take-off quantity')} value={l.takeoff} localeAware required
                  onChange={(v) => patch(i, { takeoff: v })} error={errors[`take${i}`]} />
                <NumberField id={`csr-req-${i}`} label={t('clientMaterial.form.requested', 'Requested quantity')} value={l.requested} localeAware
                  onChange={(v) => patch(i, { requested: v })} error={errors[`req${i}`]}
                  helper={t('clientMaterial.form.requestedHelper', 'Leave blank to request the take-off quantity.')} />
              </FormGrid>
              {allocationOptions.length > 0 && (
                <SelectField id={`csr-alloc-${i}`} label={t('clientMaterial.form.allocation', 'Contract line (optional)')} value={l.allocationId}
                  onChange={(v) => patch(i, { allocationId: v })} options={[{ value: '', label: t('clientMaterial.form.noAllocation', 'None') }, ...allocationOptions]} fullWidth />
              )}
              {lines.length > 1 && (
                <button type="button" className="self-start text-control text-muted-foreground underline" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  {t('clientMaterial.form.removeLine', 'Remove this item')}
                </button>
              )}
            </div>
          ))}
          <button type="button" className="self-start text-control underline" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            {t('clientMaterial.form.addLine', 'Add an item')}
          </button>
        </div>
      </FormSection>
    </EntityFormModal>
  );
};

// ── reservation / release / pickup dialogs (one line each) ───────────────────────────────────────────────────

interface LineDialogProps {
  line: ClientRequisitionLineRow;
  figures: CsrLineFigures;
  onClose: () => void;
}

const LineHeading: React.FC<{ line: ClientRequisitionLineRow; note: string }> = ({ line, note }) => (
  <p className="mb-3 text-sm tabular-nums" data-testid="csr-dialog-line">{line.requisitionNumber} · {line.itemCode} · {line.itemName} ({line.unit}) — {note}</p>
);

export const ReservationDialog: React.FC<LineDialogProps & {
  onSave: (v: { quantity: string; clientReference: string; reservedOn: string | null; note: string | null }) => Promise<unknown>;
}> = ({ line, figures, onClose, onSave }) => {
  const { t } = useTranslation('workOrders');
  const submitError = useSubmitError();
  const [quantity, setQuantity] = useState('');
  const [reference, setReference] = useState('');
  const [on, setOn] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const room = Math.max(Number(figures.requested) - Number(figures.reserved), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = readQuantity(quantity);
    const next: Record<string, string> = {};
    if (q === null) next.quantity = t('clientMaterial.form.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
    else if (Math.round(Number(q) * 1000) > Math.round(room * 1000)) {
      next.quantity = t('clientMaterial.refusal.overRequested', 'Reserved would exceed requested by {{n}}.', { n: formatNumberExact((Math.round(Number(q) * 1000) - Math.round(room * 1000)) / 1000) });
    }
    if (!reference.trim()) next.reference = t('clientMaterial.reserve.referenceRequired', "Enter the client's reference.");
    setErrors(next);
    if (Object.keys(next).length || q === null) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ quantity: q, clientReference: reference.trim(), reservedOn: on || null, note: note.trim() || null })
      .then(onClose).catch((err: unknown) => setSaveError(submitError(err))).finally(() => setBusy(false));
  };
  return (
    <EntityFormModal open title={t('clientMaterial.reserve.title', 'Record reservation')} submitLabel={t('clientMaterial.reserve.submit', 'Record reservation')}
      onSubmit={submit} onClose={onClose} submitError={saveError} loading={busy} dirty={quantity !== '' || reference !== '' || note !== ''}>
      <LineHeading line={line} note={t('clientMaterial.reserve.room', '{{n}} can still be reserved', { n: formatNumberExact(room) })} />
      <FormGrid>
        <NumberField id="csr-rsv-quantity" label={t('clientMaterial.reserve.quantity', 'Quantity reserved')} value={quantity} localeAware required onChange={setQuantity} error={errors.quantity} />
        <TextField id="csr-rsv-reference" label={t('clientMaterial.reserve.reference', "Client's reference")} value={reference} required onChange={setReference} error={errors.reference} maxLength={200} />
        <TextField id="csr-rsv-date" type="date" label={t('clientMaterial.reserve.date', 'Date reserved')} value={on} onChange={setOn}
          helper={t('clientMaterial.reserve.dateHelper', 'Leave blank for today.')} />
      </FormGrid>
      <TextArea id="csr-rsv-note" label={t('clientMaterial.reserve.note', 'Note')} value={note} onChange={setNote} maxLength={1000} rows={2} fullWidth />
    </EntityFormModal>
  );
};

export const ReleaseDialog: React.FC<LineDialogProps & {
  onSave: (v: { quantity: string; reason: string }) => Promise<unknown>;
}> = ({ line, figures, onClose, onSave }) => {
  const { t } = useTranslation('workOrders');
  const submitError = useSubmitError();
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const room = Math.max(Number(figures.reserved) - Number(figures.collected), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = readQuantity(quantity);
    const next: Record<string, string> = {};
    if (q === null) next.quantity = t('clientMaterial.form.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
    else if (Math.round(Number(q) * 1000) > Math.round(room * 1000)) {
      next.quantity = t('clientMaterial.refusal.releaseBelowCollected', 'A release cannot take reserved below the {{n}} already collected.', { n: formatNumberExact(Number(figures.collected)) });
    }
    if (!reason.trim()) next.reason = t('clientMaterial.release.reasonRequired', 'Give a reason for the release.');
    setErrors(next);
    if (Object.keys(next).length || q === null) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ quantity: q, reason: reason.trim() })
      .then(onClose).catch((err: unknown) => setSaveError(submitError(err))).finally(() => setBusy(false));
  };
  return (
    <EntityFormModal open title={t('clientMaterial.release.title', 'Record release')} submitLabel={t('clientMaterial.release.submit', 'Record release')}
      onSubmit={submit} onClose={onClose} submitError={saveError} loading={busy} dirty={quantity !== '' || reason !== ''}>
      <LineHeading line={line} note={t('clientMaterial.release.room', '{{n}} can be released', { n: formatNumberExact(room) })} />
      <FormGrid>
        <NumberField id="csr-rel-quantity" label={t('clientMaterial.release.quantity', 'Quantity released')} value={quantity} localeAware required onChange={setQuantity} error={errors.quantity} />
      </FormGrid>
      <TextArea id="csr-rel-reason" label={t('clientMaterial.release.reason', 'Reason')} value={reason} onChange={setReason} error={errors.reason} maxLength={1000} rows={2} required fullWidth />
    </EntityFormModal>
  );
};

export const PickupDialog: React.FC<LineDialogProps & {
  locations: Option[];
  onSave: (v: { quantity: string; warehouseId: string; pickedUpOn: string | null; collector: string | null; paperReference: string | null }) => Promise<unknown>;
}> = ({ line, figures, locations, onClose, onSave }) => {
  const { t } = useTranslation('workOrders');
  const submitError = useSubmitError();
  const [quantity, setQuantity] = useState('');
  const [warehouseId, setWarehouseId] = useState(locations.length === 1 ? locations[0].value : '');
  const [on, setOn] = useState('');
  const [collector, setCollector] = useState('');
  const [paper, setPaper] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const room = Math.max(Number(figures.stillToCollect), 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = readQuantity(quantity);
    const next: Record<string, string> = {};
    if (q === null) next.quantity = t('clientMaterial.form.quantityError', 'Enter a quantity above 0 with at most 3 decimal places.');
    else if (Math.round(Number(q) * 1000) > Math.round(room * 1000)) next.quantity = t('clientMaterial.refusal.overCollect', 'Only {{n}} is still to collect.', { n: formatNumberExact(room) });
    if (!warehouseId) next.warehouse = t('clientMaterial.pickup.locationRequired', 'Choose where the material is received.');
    setErrors(next);
    if (Object.keys(next).length || q === null) return;
    setBusy(true);
    setSaveError(null);
    void onSave({ quantity: q, warehouseId, pickedUpOn: on || null, collector: collector.trim() || null, paperReference: paper.trim() || null })
      .then(onClose).catch((err: unknown) => setSaveError(submitError(err))).finally(() => setBusy(false));
  };
  return (
    <EntityFormModal open title={t('clientMaterial.pickup.title', 'Record pickup')} submitLabel={t('clientMaterial.pickup.submit', 'Record pickup')}
      onSubmit={submit} onClose={onClose} submitError={saveError} loading={busy} dirty={quantity !== '' || collector !== '' || paper !== ''}>
      <LineHeading line={line} note={t('clientMaterial.pickup.room', '{{n}} still to collect', { n: formatNumberExact(room) })} />
      <FormGrid>
        <NumberField id="csr-pick-quantity" label={t('clientMaterial.pickup.quantity', 'Quantity collected')} value={quantity} localeAware required onChange={setQuantity} error={errors.quantity} />
        <SelectField id="csr-pick-location" label={t('clientMaterial.pickup.location', 'Received at')} value={warehouseId} onChange={setWarehouseId} options={locations}
          placeholder={t('clientMaterial.pickup.locationPlaceholder', 'Choose a location')} error={errors.warehouse} required />
        <TextField id="csr-pick-date" type="date" label={t('clientMaterial.pickup.date', 'Date collected')} value={on} onChange={setOn}
          helper={t('clientMaterial.pickup.dateHelper', 'Leave blank for today.')} />
        <TextField id="csr-pick-collector" label={t('clientMaterial.pickup.collector', 'Collected by')} value={collector} onChange={setCollector} maxLength={200} />
        <TextField id="csr-pick-paper" label={t('clientMaterial.pickup.paper', 'Delivery paper reference')} value={paper} onChange={setPaper} maxLength={200} code />
      </FormGrid>
      <p className="mt-3 text-control text-muted-foreground">{t('clientMaterial.pickup.zeroValue', 'The material is received into stock at no cost.')}</p>
    </EntityFormModal>
  );
};
