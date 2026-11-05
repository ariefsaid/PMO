import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useAttachJournalLines } from '@/src/hooks/useErpJournalLines';
import { useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency } from '@/src/lib/format';
import type { ErpJournalAttachRow, ErpJournalLine } from '@/src/lib/repositories/erpJournalLines';
import { journalReasonText } from '../procurement/erpJournalReasons';

/** Never offered: closed purchases. The server re-checks project, currency and every other rule. */
const CLOSED = new Set(['Cancelled', 'Rejected']);

/** FR-JEC-010/013 — pick one of the project's purchases; a dry run shows the outcome before Confirm writes the link. */
export const AttachJournalLineDialog: React.FC<{ line: ErpJournalLine; onClose: () => void }> = ({ line, onClose }) => {
  const { t } = useTranslation('finance');
  const { data: purchases, isPending, isError, refetch } = useProjectProcurements(line.projectId);
  const attach = useAttachJournalLines();
  const [target, setTarget] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const stageLabel = useProcurementStatusLabel();

  const options = useMemo<ComboboxOption[]>(() => (purchases ?? [])
    .filter((p) => !CLOSED.has(String(p.status)))
    .map((p) => ({ value: p.id, label: p.title, sub: [p.vendor?.name, stageLabel(String(p.status))].filter(Boolean).join(' · ') })),
  [purchases, stageLabel]);

  const row = (procurementId: string): ErpJournalAttachRow => ({
    erp_doctype: line.erpDoctype, voucher_no: line.voucherNo, project_id: line.projectId, account: line.account, procurement_id: procurementId,
  });

  // FR-JEC-013: the same code path as the real attach, rolled back, tells the member what will happen before they commit.
  const dryRun = attach.mutateAsync;
  useEffect(() => {
    setVerdict(null);
    setSubmitError(null);
    if (!target) return;
    let live = true;
    dryRun({ rows: [row(target)], dryRun: true }).then((res) => {
      if (!live) return;
      const r = res.results[0];
      setVerdict(r.outcome === 'refused' || r.outcome === 'skip'
        ? { ok: false, text: journalReasonText(r.reason, t) }
        : { ok: true, text: t('erpJournal.willAttach', 'Ready to attach. Nothing is sent to the accounting system.') });
    }).catch((err) => {
      if (!live) return;
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new target re-runs the dry run; the mutation fn and row builder are stable per line
  }, [target]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    try {
      const res = await attach.mutateAsync({ rows: [row(target)] });
      const r = res.results[0];
      if (r.outcome === 'refused') {
        setSubmitError({ headline: t('erpJournal.notAttached', 'Nothing was attached.'), action: <span className="block text-muted-foreground">{journalReasonText(r.reason, t)}</span> });
        return;
      }
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    }
  };

  return (
    <EntityFormModal
      open
      title={t('erpJournal.dialogTitle', 'Attach {{name}} to a purchase', { name: line.voucherNo })}
      subtitle={t('erpJournal.dialogSub', 'The purchase’s open commitment drops by this line, and project spending does not change. Nothing is sent to the accounting system.')}
      submitLabel={t('erpJournal.attachConfirm', 'Attach')}
      cancelLabel={t('erpLinks.cancel', 'Cancel')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      loading={attach.isPending}
      submitDisabled={!target || verdict?.ok !== true}
      disabledReason={target ? t('erpJournal.cannotAttach', 'This line cannot be attached to that purchase.') : t('erpLinks.choosePurchaseFirst', 'Choose a purchase first.')}
      submitError={submitError}
    >
      <p className="mb-3 text-[13px] text-foreground tabular">
        {[line.voucherNo, line.remarks, line.currency ? formatCurrency(line.amount, line.currency) : null].filter(Boolean).join(' · ')}
      </p>
      {isPending && <p className="mb-2 text-[12.5px] text-muted-foreground">{t('erpLinks.loadingPurchases', 'Loading purchases…')}</p>}
      {isError && (
        <div role="alert" className="mb-2 flex items-center gap-2 text-[12.5px] text-destructive">
          <span>{t('erpLinks.purchasesLoadFailed', 'Could not load purchases.')}</span>
          <button type="button" className="underline" onClick={() => void refetch()}>{t('erpLinks.retry', 'Retry')}</button>
        </div>
      )}
      <Combobox
        label={t('erpLinks.purchase', 'Purchase')}
        noun={t('erpJournal.purchaseNoun', 'purchase of this project')}
        value={target}
        selectedOption={options.find((o) => o.value === target) ?? null}
        onChange={(v) => setTarget(v)}
        loadOptions={async () => options}
        placeholder={t('erpLinks.choosePurchase', 'Choose a purchase…')}
        required
      />
      {verdict && (
        <p role={verdict.ok ? 'status' : 'alert'} className={verdict.ok ? 'mt-2 text-[12.5px] text-muted-foreground' : 'mt-2 text-[12.5px] text-destructive-text'}>
          {verdict.text}
        </p>
      )}
    </EntityFormModal>
  );
};
