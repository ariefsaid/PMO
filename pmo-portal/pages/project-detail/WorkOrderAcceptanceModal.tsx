import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, FormSection, NumberField, SelectField, TextArea, TextField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BoqItemRow } from '@/src/lib/db/progressBilling';
import { fractionToPercentInput, milli, percentToFraction } from '@/src/lib/progressBilling';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';
import type {
  PrepareWorkOrderAcceptanceInput, WorkOrderAcceptanceWithLines, WorkOrderLineRow,
} from '@/src/lib/db/workOrderAcceptances';

/**
 * Prepare (or re-record a Draft of) a BAST — the client's acceptance of work on one work order (ADR-0091, OD-CQ-2).
 * Quantities are CUMULATIVE to date per allocated line, never a delta; a lump-sum line is a percent of its lot. A
 * stage BAST may leave lines out (they contribute nothing); a final one must state every allocated line. Confirming
 * is a separate step by someone else — this dialog only prepares. The server re-checks everything.
 */
export interface WorkOrderAcceptanceModalProps {
  workOrder: { id: string; wo_number: string | null; title: string; status: string };
  boqItems: BoqItemRow[];
  /** This work order's allocation rows — the only lines a BAST may state. */
  allocations: WorkOrderLineRow[];
  /** This work order's BAST headers, with lines (any status). */
  acceptances: WorkOrderAcceptanceWithLines[];
  documents: ProjectDocumentRow[];
  /** `YYYY-MM-DD` — injected so the default date is testable. */
  today: string;
  /** A Draft being re-recorded, or null for a new BAST. */
  draft: WorkOrderAcceptanceWithLines | null;
  onClose: () => void;
  onSave: (input: Omit<PrepareWorkOrderAcceptanceInput, 'workOrderId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

const EVIDENCE_STATUSES = new Set(['Issued', 'Approved']);

/** The latest confirmed cumulative header: newest confirmation, then id — never a sum over history. */
function latestConfirmed(acceptances: WorkOrderAcceptanceWithLines[]): WorkOrderAcceptanceWithLines | null {
  const confirmed = acceptances.filter((a) => a.status === 'Confirmed' && a.confirmed_at);
  confirmed.sort((a, b) => (b.confirmed_at as string).localeCompare(a.confirmed_at as string) || b.id.localeCompare(a.id));
  return confirmed[0] ?? null;
}

const WorkOrderAcceptanceModal: React.FC<WorkOrderAcceptanceModalProps> = ({
  workOrder, boqItems, allocations, acceptances, documents, today, draft, onClose, onSave, onError,
}) => {
  const { t } = useTranslation('project');
  const allocated = allocations
    .map((row) => ({ row, item: boqItems.find((b) => b.id === row.boq_item_id) }))
    .filter((entry): entry is { row: WorkOrderLineRow; item: BoqItemRow } => entry.item !== undefined)
    .sort((a, b) => (a.item.line_no ?? Number.MAX_SAFE_INTEGER) - (b.item.line_no ?? Number.MAX_SAFE_INTEGER)
      || a.item.created_at.localeCompare(b.item.created_at) || a.item.id.localeCompare(b.item.id));
  const start = draft ?? latestConfirmed(acceptances);
  const startQuantity = new Map((start?.lines ?? []).map((l) => [l.boq_item_id, Number(l.quantity)]));
  const eligibleDocs = documents.filter((d) => EVIDENCE_STATUSES.has(d.status) && Boolean(d.file_path));

  const [date, setDate] = useState(draft?.acceptance_date ?? today);
  const [isFinal, setIsFinal] = useState(draft?.is_final ?? false);
  const [documentId, setDocumentId] = useState(draft?.document_id ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    allocated.filter(({ item }) => startQuantity.has(item.id)).map(({ item }) => {
      const quantity = startQuantity.get(item.id) as number;
      return [item.id, item.earning_basis === 'lump_sum' ? fractionToPercentInput(quantity) : formatMoneyInputValue(quantity)];
    }),
  ));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const woLabel = workOrder.wo_number ? `${workOrder.wo_number} — ${workOrder.title}` : workOrder.title;
  const docOptions = [
    { value: '', label: t('projectTabs:contractQuantities.workOrders.acceptances.form.noDocument', 'None yet') },
    ...eligibleDocs.map((d) => ({
      value: d.id,
      label: `${d.code ? `${d.code} · ` : ''}${d.title} (${d.status}${d.revision ? `, ${t('projectDetail.billing.evidence.revision', 'rev {{revision}}', { revision: d.revision })}` : ''})`,
    })),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errs.date = t('projectTabs:contractQuantities.workOrders.acceptances.form.errors.date', 'Enter the BAST date');
    }
    const lines: PrepareWorkOrderAcceptanceInput['lines'] = [];
    for (const { item } of allocated) {
      const raw = (values[item.id] ?? '').trim();
      if (raw === '') {
        if (isFinal) errs[item.id] = t('projectTabs:contractQuantities.workOrders.acceptances.form.errors.finalComplete', 'A final BAST states every ordered line. Enter a quantity, even 0');
        continue;
      }
      if (item.earning_basis === 'lump_sum') {
        const pct = parseMoneyInputAtScale(raw, 1);
        if (pct === null || pct < 0 || pct > 100) {
          errs[item.id] = t('projectTabs:contractQuantities.billing.assessment.errors.percent', 'Enter a percentage from 0 to 100 with at most 1 decimal place');
        } else {
          lines.push({ boqItemId: item.id, quantity: percentToFraction(pct) });
        }
        continue;
      }
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity < 0) {
        errs[item.id] = t('projectTabs:contractQuantities.workOrders.acceptances.form.errors.quantity', 'Each accepted quantity must be 0 or more with at most 3 decimal places');
      } else {
        lines.push({ boqItemId: item.id, quantity });
      }
    }
    if (Object.keys(errs).length === 0 && lines.length === 0) {
      errs.lines = t('projectTabs:contractQuantities.workOrders.acceptances.form.errors.noLines', 'Enter an accepted quantity for at least one line');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSaving(true);
    setSaveError(null);
    void onSave({
      acceptanceDate: date, isFinal, lines, documentId: documentId || null, note: note.trim() || null,
      ...(draft ? { acceptanceId: draft.id } : {}),
    })
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
      title={draft
        ? t('projectTabs:contractQuantities.workOrders.acceptances.form.titleEdit', 'Edit BAST: {{wo}}', { wo: woLabel })
        : t('projectTabs:contractQuantities.workOrders.acceptances.form.titleNew', 'Prepare BAST: {{wo}}', { wo: woLabel })}
      subtitle={t('projectTabs:contractQuantities.workOrders.acceptances.form.subtitle', "The client's acceptance of work, as cumulative quantities to date. Someone else confirms it; it does not create an invoice.")}
      submitLabel={draft
        ? t('projectTabs:contractQuantities.workOrders.acceptances.form.save', 'Save BAST')
        : t('projectTabs:contractQuantities.workOrders.acceptances.form.prepare', 'Prepare BAST')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={Object.values(values).some((v) => v !== '') || note !== '' || documentId !== ''}
    >
      <FormSection legend={t('projectTabs:contractQuantities.workOrders.acceptances.form.details', 'Acceptance')}>
        <FormGrid>
          <TextField id="bast-date" type="date" label={t('projectTabs:contractQuantities.workOrders.acceptances.form.date', 'BAST date')} required
            value={date} onChange={setDate} error={errors.date} />
          <SelectField id="bast-document" label={t('projectTabs:contractQuantities.workOrders.acceptances.form.document', 'Signed BAST document')}
            value={documentId} onChange={setDocumentId} options={docOptions}
            helper={eligibleDocs.length === 0
              ? t('projectTabs:contractQuantities.workOrders.acceptances.form.noEligibleDocument', 'Upload and issue the signed BAST in the project register first. It is needed to confirm.')
              : t('projectTabs:contractQuantities.workOrders.acceptances.form.documentHelp', 'From this project’s register: issued or approved, with a file. It is needed to confirm.')} />
        </FormGrid>
        <label className="mt-3 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isFinal} onChange={(e) => { setIsFinal(e.target.checked); setErrors({}); }} />
          {t('projectTabs:contractQuantities.workOrders.acceptances.form.final', 'This is the final BAST')}
        </label>
        {isFinal && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {t('projectTabs:contractQuantities.workOrders.acceptances.form.finalHelp', 'Confirming a final BAST closes the work order at the accepted quantities.')}
          </p>
        )}
      </FormSection>
      <FormSection legend={t('projectTabs:contractQuantities.workOrders.acceptances.form.quantities', 'Accepted to date')}>
        {allocated.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t('projectTabs:contractQuantities.workOrders.acceptances.form.noAllocations', 'Allocate contract lines to this work order first.')}
          </p>
        ) : (
          <FormGrid>
            {allocated.map(({ row, item }) => {
              const lump = item.earning_basis === 'lump_sum';
              return (
                <NumberField key={item.id} id={`bast-qty-${item.id}`}
                  label={lump
                    ? t('projectTabs:contractQuantities.workOrders.acceptances.form.percentLine', '{{item}}: % accepted', { item: `${item.item_code} — ${item.description}` })
                    : t('projectTabs:contractQuantities.workOrders.acceptances.form.quantityLine', '{{item}}: accepted to date ({{unit}})', { item: `${item.item_code} — ${item.description}`, unit: item.unit })}
                  value={values[item.id] ?? ''}
                  onChange={(value) => setValues((current) => ({ ...current, [item.id]: value }))}
                  helper={lump ? undefined : t('projectTabs:contractQuantities.workOrders.acceptances.form.ordered', 'Ordered {{qty}} {{unit}}', { qty: formatNumberExact(Number(row.quantity)), unit: item.unit })}
                  error={errors[item.id]}
                  localeAware />
              );
            })}
          </FormGrid>
        )}
        {allocated.map(({ row, item }) => {
          const typed = item.earning_basis === 'lump_sum' ? null : parseMoneyInputAtScale((values[item.id] ?? '').trim(), 3);
          if (typed === null || milli(typed) <= milli(Number(row.quantity))) return null;
          return (
            <p key={item.id} className="mt-1 text-[12px] font-medium text-warning-foreground" data-testid={`bast-over-${item.id}`}>
              {t('projectTabs:contractQuantities.workOrders.acceptances.form.overMeasured', 'More than ordered by {{qty}} {{unit}} ({{item}}).', {
                qty: formatNumberExact((milli(typed) - milli(Number(row.quantity))) / 1000), unit: item.unit, item: item.item_code,
              })}
            </p>
          );
        })}
        {errors.lines && <p role="alert" className="mt-1 text-[12px] text-destructive-text">{errors.lines}</p>}
      </FormSection>
      <FormSection legend={t('projectTabs:contractQuantities.workOrders.acceptances.form.noteLegend', 'Note')}>
        <TextArea id="bast-note" label={t('projectTabs:contractQuantities.workOrders.acceptances.form.note', 'Note (optional)')}
          value={note} onChange={setNote} maxLength={500} rows={2} fullWidth />
      </FormSection>
    </EntityFormModal>
  );
};

export default WorkOrderAcceptanceModal;
