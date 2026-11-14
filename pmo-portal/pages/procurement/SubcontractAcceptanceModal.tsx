import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { statusLabel } from '@/src/lib/status/statusMap';
import {
  Button, EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextArea, TextField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type {
  PrepareSubcontractAcceptanceInput, SubcontractAcceptanceWithLines, SubcontractPoPositionRow,
} from '@/src/lib/db/subcontracts';

/**
 * Prepare (or re-record a Draft of) a subcontractor acceptance, then confirm or withdraw it (#1513 S7.3).
 * Quantities are CUMULATIVE verified-to-date per PO line, never a delta, and may not fall below the last
 * confirmed figure. More than the PO is allowed and shown as "verified, not on PO". Confirm/Withdraw are UX
 * gates only (the preparer cannot confirm unless the org has one active member); the server decides.
 */
export interface SubcontractAcceptanceModalProps {
  rows: SubcontractPoPositionRow[];
  acceptances: SubcontractAcceptanceWithLines[];
  documents: ProjectDocumentRow[];
  /** `YYYY-MM-DD`, injected so the default date is testable. */
  today: string;
  /** A Draft being re-recorded, or null for a new acceptance. */
  draft: SubcontractAcceptanceWithLines | null;
  preparedByMe?: boolean;
  canConfirm?: boolean;
  soleOperator?: boolean;
  onClose: () => void;
  onSave: (input: Omit<PrepareSubcontractAcceptanceInput, 'poId'>) => Promise<void>;
  onConfirm?: (id: string) => Promise<void>;
  onWithdraw?: (id: string) => Promise<void>;
  onError: (err: unknown) => void;
}

const EVIDENCE_STATUSES = new Set(['Issued', 'Approved']);
const milli = (n: number) => Math.round(n * 1000);

/** Per line, the cumulative quantity of the newest confirmed acceptance that states it. */
function lastConfirmed(acceptances: SubcontractAcceptanceWithLines[]): Map<string, number> {
  const confirmed = acceptances.filter((a) => a.status === 'Confirmed' && a.confirmed_at)
    .sort((a, b) => (a.confirmed_at as string).localeCompare(b.confirmed_at as string));
  const last = new Map<string, number>();
  for (const a of confirmed) for (const l of a.lines) last.set(l.boq_item_id, Number(l.quantity));
  return last;
}

const SubcontractAcceptanceModal: React.FC<SubcontractAcceptanceModalProps> = ({
  rows, acceptances, documents, today, draft, preparedByMe = false, canConfirm = false, soleOperator = false,
  onClose, onSave, onConfirm, onWithdraw, onError,
}) => {
  const { t } = useTranslation('procurement');
  const last = lastConfirmed(acceptances);
  const start = draft ? new Map(draft.lines.map((l) => [l.boq_item_id, Number(l.quantity)])) : last;
  const eligibleDocs = documents.filter((d) => EVIDENCE_STATUSES.has(d.status) && Boolean(d.file_path));

  const [date, setDate] = useState(draft?.acceptance_date ?? today);
  const [documentId, setDocumentId] = useState(draft?.document_id ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    rows.filter((r) => start.has(r.boq_item_id)).map((r) => [r.boq_item_id, formatMoneyInputValue(start.get(r.boq_item_id) as number)]),
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setSaveError(null);
    void work().then(onClose).catch((err: unknown) => {
      const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
      setSaveError({ headline, detail });
      onError(err);
    }).finally(() => setBusy(false));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errs.date = t('subcontract.acceptance.form.errors.date', 'Enter the acceptance date');
    const lines: PrepareSubcontractAcceptanceInput['lines'] = [];
    for (const r of rows) {
      const raw = (values[r.boq_item_id] ?? '').trim();
      if (raw === '') continue;
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity < 0) {
        errs[r.boq_item_id] = t('subcontract.acceptance.form.errors.quantity', 'Enter 0 or more with at most 3 decimal places');
        continue;
      }
      const floor = last.get(r.boq_item_id);
      if (floor !== undefined && milli(quantity) < milli(floor)) {
        errs[r.boq_item_id] = t('subcontract.acceptance.form.errors.belowConfirmed', 'This is cumulative and cannot be less than the last confirmed {{qty}}', { qty: formatNumberExact(floor) });
        continue;
      }
      lines.push({ boqItemId: r.boq_item_id, quantity });
    }
    if (Object.keys(errs).length === 0 && lines.length === 0) {
      errs.lines = t('subcontract.acceptance.form.errors.noLines', 'Enter a verified quantity for at least one line');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    run(() => onSave({
      acceptanceDate: date, lines, documentId: documentId || null, note: note.trim() || null,
      ...(draft ? { acceptanceId: draft.id } : {}),
    }));
  };

  const mayConfirm = Boolean(draft && onConfirm && canConfirm && (!preparedByMe || soleOperator));
  const docOptions = [
    { value: '', label: t('subcontract.acceptance.form.noDocument', 'None yet') },
    ...eligibleDocs.map((d) => ({ value: d.id, label: `${d.code ? `${d.code} · ` : ''}${d.title} (${statusLabel('document', d.status, t)})` })),
  ];

  return (
    <EntityFormModal open width="lg"
      title={draft ? t('subcontract.acceptance.form.titleEdit', 'Edit acceptance') : t('subcontract.acceptance.form.titleNew', 'Record acceptance')}
      submitLabel={draft ? t('subcontract.acceptance.form.save', 'Save acceptance') : t('subcontract.acceptance.form.prepare', 'Prepare acceptance')}
      onSubmit={handleSubmit} submitError={saveError} onClose={onClose} loading={busy}
      dirty={Object.values(values).some((v) => v !== '') || note !== '' || documentId !== ''}>
      <p className="mb-3 text-sm text-muted-foreground">{t('subcontract.acceptance.form.subtitle', 'Someone else confirms it with the signed document; it does not create a bill.')}</p>
      <FormSection legend={t('subcontract.acceptance.form.details', 'Acceptance')}>
        <FormGrid>
          <TextField id="sc-acc-date" type="date" label={t('subcontract.acceptance.form.date', 'Period date')} required
            value={date} onChange={setDate} error={errors.date} />
          <SelectField id="sc-acc-document" label={t('subcontract.acceptance.form.document', 'Signed acceptance document')}
            value={documentId} onChange={setDocumentId} options={docOptions}
            helper={eligibleDocs.length === 0
              ? t('subcontract.acceptance.form.noEligibleDocument', 'Upload and issue the signed document in the project register first. It is needed to confirm.')
              : t('subcontract.acceptance.form.documentHelp', 'From this project’s register: issued or approved, with a file. It is needed to confirm.')} />
        </FormGrid>
      </FormSection>
      <FormSection legend={t('subcontract.acceptance.form.quantities', 'Verified to date')}>
        <FormGrid>
          {rows.map((r) => {
            const floor = last.get(r.boq_item_id);
            return (
              <NumberField key={r.boq_item_id} id={`sc-acc-qty-${r.boq_item_id}`}
                label={t('subcontract.acceptance.form.quantityLine', '{{item}}: verified to date ({{unit}})', { item: `${r.item_code} — ${r.description}`, unit: r.unit })}
                value={values[r.boq_item_id] ?? ''} onChange={(v) => setValues((c) => ({ ...c, [r.boq_item_id]: v }))}
                helper={t('subcontract.acceptance.form.ordered', 'PO {{qty}} {{unit}}{{confirmed}}', {
                  qty: formatNumberExact(r.po_qty), unit: r.unit,
                  confirmed: floor === undefined ? '' : t('subcontract.acceptance.form.lastConfirmed', ', last confirmed {{qty}}', { qty: formatNumberExact(floor) }),
                })}
                error={errors[r.boq_item_id]} localeAware />
            );
          })}
        </FormGrid>
        {rows.map((r) => {
          const typed = parseMoneyInputAtScale((values[r.boq_item_id] ?? '').trim(), 3);
          if (typed === null || milli(typed) <= milli(r.po_qty)) return null;
          return (
            <p key={r.boq_item_id} data-testid={`sc-over-${r.boq_item_id}`} className="mt-1 text-sm font-medium text-warning-foreground">
              {t('subcontract.acceptance.form.overPo', '{{item}}: {{qty}} {{unit}} more than the PO, shown as verified, not on PO.', {
                item: r.item_code, qty: formatNumberExact((milli(typed) - milli(r.po_qty)) / 1000), unit: r.unit,
              })}
            </p>
          );
        })}
        {errors.lines && <p role="alert" className="mt-1 text-sm text-destructive-text">{errors.lines}</p>}
      </FormSection>
      <FormSection legend={t('subcontract.acceptance.form.noteLegend', 'Note')}>
        <TextArea id="sc-acc-note" label={t('subcontract.acceptance.form.note', 'Note (optional)')}
          value={note} onChange={setNote} maxLength={500} rows={2} fullWidth />
      </FormSection>
      {draft && (
        <FormSection legend={t('subcontract.acceptance.form.decide', 'Decide')}>
          <div className="flex flex-wrap items-center gap-2">
            {mayConfirm && (
              <Button type="button" variant="primary" size="sm" disabled={busy}
                onClick={() => run(() => (onConfirm as (id: string) => Promise<void>)(draft.id))}>
                {t('subcontract.acceptance.form.confirm', 'Confirm acceptance')}
              </Button>
            )}
            {onWithdraw && (
              <Button type="button" variant="ghost" size="sm" disabled={busy}
                className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
                onClick={() => run(() => onWithdraw(draft.id))}>
                {t('subcontract.acceptance.form.withdraw', 'Withdraw draft')}
              </Button>
            )}
          </div>
          {preparedByMe && canConfirm && !soleOperator && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('subcontract.acceptance.selfConfirmHint', 'You prepared this. Another Admin or Finance user must confirm it, unless you are the only active member.')}
            </p>
          )}
        </FormSection>
      )}
    </EntityFormModal>
  );
};

export default SubcontractAcceptanceModal;
