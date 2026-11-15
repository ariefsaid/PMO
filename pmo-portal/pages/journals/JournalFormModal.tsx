import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Combobox, EntityFormModal, FormGrid, Icon, SelectField, TextArea, TextField, useEntityForm, useToast,
  type SubmitError,
} from '@/src/components/ui';
import { useSaveJournalDraft, useSubmitJournal } from '@/src/hooks/useJournals';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatExactDecimal } from '@/src/lib/format';
import { JOURNAL_KINDS, type JournalDetail, type JournalKind } from '@/src/lib/db/journals';
import { journalBalance, toLinePayload, type JournalLineDraft } from '@/src/lib/journals/journalBalance';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { journalErrorOverrides, journalKindLabel } from './journalWords';

const blankLine = (): JournalLineDraft => ({ account: '', debit: '', credit: '', label: '', projectId: '' });
const isBlank = (l: JournalLineDraft) => !l.account.trim() && !l.debit.trim() && !l.credit.trim() && !l.label.trim() && !l.projectId;
const amountText = (v: string | number): string => (Number(v) === 0 ? '' : String(v));

export interface JournalFormModalProps {
  /** The draft being edited; absent for a new journal. */
  draft?: JournalDetail;
  today: string;
  onClose: () => void;
  /** Called with the journal id after a save or a submit. */
  onDone: (id: string) => void;
}

/**
 * New or edit a draft journal (#895). The running difference is summed in exact cents; Submit stays disabled until the
 * lines balance. Save draft and Submit both go through `save_journal_draft`, so a failed submit retries the same draft.
 */
export const JournalFormModal: React.FC<JournalFormModalProps> = ({ draft, today, onClose, onDone }) => {
  const { t } = useTranslation('journals');
  const { toast } = useToast();
  const save = useSaveJournalDraft();
  const submit = useSubmitJournal();
  const { data: projects, isPending: projectsPending, isError: projectsError } = useProjectPickerOptions();
  const [draftId, setDraftId] = useState<string | null>(draft?.entry.id ?? null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<JournalLineDraft[]>(() =>
    draft && draft.lines.length > 0
      ? draft.lines.map((l) => ({ account: l.account, debit: amountText(l.debit), credit: amountText(l.credit), label: l.label, projectId: l.project_id ?? '' }))
      : [blankLine(), blankLine()]);
  const [linesDirty, setLinesDirty] = useState(false);
  const form = useEntityForm({
    initialValues: { kind: (draft?.entry.kind ?? 'fee') as string, date: draft?.entry.entry_date ?? today, memo: draft?.entry.memo ?? '' },
    idPrefix: 'journal-form',
    requiredFields: ['kind', 'date', 'memo'],
    validate: (v) => (v.memo.trim().length > 500 ? { memo: t('journals:form.memoTooLong', 'Keep the memo to 500 characters.') } : {}),
  });
  const filled = useMemo(() => lines.filter((l) => !isBlank(l)), [lines]);
  const balance = useMemo(() => journalBalance(filled), [filled]);
  const invalid = new Set(balance.invalidLines.map((i) => filled[i]));
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  const kindOptions = JOURNAL_KINDS.map((k) => ({ value: k, label: journalKindLabel(t, k) }));

  const setLine = (index: number, patch: Partial<JournalLineDraft>) => {
    setLinesDirty(true);
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const removeLine = (index: number) => { setLinesDirty(true); setLines((prev) => prev.filter((_, i) => i !== index)); };
  const addLine = () => { setLinesDirty(true); setLines((prev) => [...prev, blankLine()]); };

  const persist = async (): Promise<string> => {
    const id = await save.mutateAsync({
      id: draftId, kind: form.values.kind as JournalKind, date: form.values.date, memo: form.values.memo.trim(), lines: toLinePayload(filled),
    });
    setDraftId(id);
    return id;
  };
  const run = async (andSubmit: boolean) => {
    setSubmitError(null);
    setBusy(true);
    try {
      const id = await persist();
      if (andSubmit) await submit.mutateAsync(id);
      toast(andSubmit ? t('journals:form.submitted', 'Journal submitted') : t('journals:form.saved', 'Draft saved'), undefined, 'success');
      onDone(id);
    } catch (err) {
      setSubmitError(classifyMutationError(err, journalErrorOverrides(t)));
    } finally {
      setBusy(false);
    }
  };
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(() => run(true));
  };
  const canSave = form.isComplete && balance.invalidLines.length === 0;
  const canSubmit = form.isComplete && balance.submittable;
  const disabledReason = !form.isComplete
    ? undefined
    : balance.invalidLines.length > 0
      ? t('journals:form.fixLines', 'Each line needs an account and one amount.')
      : t('journals:form.balanceFirst', 'Debits and credits must be equal.');

  return (
    <EntityFormModal open width="lg"
      title={draft ? t('journals:form.editTitle', 'Edit journal') : t('journals:form.newTitle', 'New journal')}
      submitLabel={t('journals:actions.submit', 'Submit')} onSubmit={onSubmit} onClose={onClose}
      loading={busy} dirty={form.isDirty || linesDirty} submitDisabled={!canSubmit} disabledReason={canSubmit ? undefined : disabledReason}
      submitError={submitError}>
      <FormGrid>
        <SelectField label={t('journals:form.kind', 'Kind')} required options={kindOptions} {...form.fieldProps('kind')} />
        <TextField label={t('journals:form.date', 'Date')} type="date" required {...form.fieldProps('date')} />
        <TextArea label={t('journals:form.memo', 'Memo')} required fullWidth maxLength={500} {...form.fieldProps('memo')} />
      </FormGrid>
      <div className="mt-4 space-y-3">
        {lines.map((line, index) => {
          const n = index + 1;
          return (
            <fieldset key={index} aria-label={t('journals:form.lineN', 'Line {{n}}', { n })}
              className={`rounded-lg border p-3 ${invalid.has(line) ? 'border-destructive' : 'border-border'}`}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                <TextField label={t('journals:form.account', 'Account')} mono value={line.account} onChange={(v) => setLine(index, { account: v })} />
                <TextField label={t('journals:form.debit', 'Debit')} inputMode="decimal" value={line.debit} onChange={(v) => setLine(index, { debit: v })} />
                <TextField label={t('journals:form.credit', 'Credit')} inputMode="decimal" value={line.credit} onChange={(v) => setLine(index, { credit: v })} />
              </div>
              <div className="mt-2 grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Combobox id={`journal-line-${n}-project`} label={t('journals:form.project', 'Project')} noun={t('journals:form.projectNoun', 'project')}
                  value={line.projectId || null} selectedOption={projectOptions.find((o) => o.value === line.projectId) ?? null}
                  statusOverride={projectsPending ? 'loading' : projectsError ? 'error' : undefined}
                  loadOptions={() => Promise.resolve(projectOptions)} clearable onClear={() => setLine(index, { projectId: '' })}
                  onChange={(value) => setLine(index, { projectId: value })} />
                <TextField label={t('journals:form.label', 'Label')} value={line.label} onChange={(v) => setLine(index, { label: v })} />
                <Button variant="ghost" size="icon" aria-label={t('journals:form.removeLine', 'Remove line {{n}}', { n })}
                  disabled={lines.length <= 1} onClick={() => removeLine(index)}>
                  <Icon name="trash" />
                </Button>
              </div>
            </fieldset>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={addLine} disabled={lines.length >= 200}>
            <Icon name="plus" />
            {t('journals:form.addLine', 'Add line')}
          </Button>
          <p role="status" className={`tabular-nums font-medium ${balance.balanced ? 'text-foreground' : 'text-destructive-text'}`}>
            {t('journals:form.difference', 'Difference: {{amount}}', { amount: formatExactDecimal(balance.difference) })}
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="outline" disabled={!canSave || busy} onClick={() => { void run(false); }}>
            {t('journals:actions.saveDraft', 'Save draft')}
          </Button>
        </div>
      </div>
    </EntityFormModal>
  );
};
