import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, FormFooter, FormGrid, FormSection, GateNotice, Icon, NumberField, PageHeader, SelectField, TextField, UnsavedChangesDialog, useToast } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseClaimMutations, useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useExpenseCapture } from '@/src/hooks/useExpenseCapture';
import { useImprestFloatChoices, useImprestProcurementLimit, useSetClaimFloat } from '@/src/hooks/useImprest';
import { floatChoiceOptions } from '@/src/lib/imprest/floatDisplay';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { isPlanException, toCents } from '@/src/lib/imprest/imprestRules';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { RECEIPT_INPUT_ACCEPT } from '@/src/lib/db/expenseReceipts';
import { BackBar } from '@/src/components/shell';
import { expenseTypeLabel } from './expenses/expenseLabels';
import { PostingReadinessNote } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { AdvanceLoadNotice } from './expenses/AdvanceLoadNotice';
import { ProjectLoadNotice } from './expenses/ProjectLoadNotice';
import { useProjectChoices } from './expenses/useProjectChoices';
import { BudgetCategoryHelp } from './procurement/BudgetCategoryHelp';

type DraftLine = { date: string; type: string; description: string; amount: string };
const blankLine = (): DraftLine => ({ date: '', type: '', description: '', amount: '' });
const lineStarted = (line: DraftLine) => Boolean(line.date || line.type || line.description || line.amount);
// Date · type · description · amount · remove: one small grid inside the 720px form.
const LINE_GRID = 'grid grid-cols-[9rem_11.5rem_minmax(0,1fr)_8.5rem_2.75rem] gap-x-2';

/** One-page, unsaved claim capture. The parent + initial child use the recoverable capture repository. */
const ExpenseClaimNew: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const canCreate = may('create', 'expenseClaim');
  const currentUserId = useAuth().currentUser?.id;
  const projectChoices = useProjectChoices();
  const { data: claims } = useExpenseClaims({ kind: 'claim' });
  const { data: advances } = useExpenseClaims({ kind: 'advance' });
  const capture = useExpenseCapture();
  const { transition } = useExpenseClaimMutations();
  const isDesktop = useIsDesktop();
  const receiptInput = useRef<HTMLInputElement>(null);
  const saveInFlight = useRef(false);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('');
  const [categoryEdited, setCategoryEdited] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const [floatId, setFloatId] = useState('');
  const ownAdvances = useOwnAdvanceOptions();
  // An unloaded list is "unknown", never "no advance": a new claim is not saved until it has loaded.
  const advancesNotReady = ownAdvances.isPending || ownAdvances.isError;
  // Likewise the project list: an unloaded one must not let the claim save as "Overhead (no project)".
  const projectsNotReady = projectChoices.isPending || projectChoices.isError;
  const orgCurrency = useOrgCurrencyState();
  const currency = orgCurrency.currency;
  const setClaimFloat = useSetClaimFloat();
  const floatChoices = useImprestFloatChoices(projectId || undefined, (category || null) as BudgetCategory | null).data ?? [];
  const procurementLimit = useImprestProcurementLimit().data ?? null;
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [receipt, setReceipt] = useState<File | null>(null);
  // Which footer action is in flight: a draft save, or save-then-submit.
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [blockedLeave, setBlockedLeave] = useState<(() => void) | null>(null);
  const dirty = Boolean(title || advanceId || floatId || projectId || category || purpose || receipt || lines.some((line) => line.date || line.type || line.description || line.amount));
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: (leave) => setBlockedLeave(() => leave) });
  const options = projectChoices.options;
  const categoryPrecedents = useMemo(() => {
    const newestByProject = new Map<string, { budgetCategory: BudgetCategory; sourceTitle: string }>();
    const ordered = [...(claims?.rows ?? [])].sort((left, right) =>
      right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
    );
    for (const row of ordered) {
      if (row.claimant_id !== currentUserId || !row.project_id || !row.budget_category || newestByProject.has(row.project_id)) continue;
      newestByProject.set(row.project_id, { budgetCategory: row.budget_category, sourceTitle: row.title });
    }
    return newestByProject;
  }, [claims?.rows, currentUserId]);
  const categories = [{ value: '', label: t('expenses.form.category.none', 'No category') }, ...Constants.public.Enums.budget_category.map((value) => ({ value, label: budgetCategoryLabel(value, t) }))];
  const lineInputs: ExpenseLineInput[] = lines.filter((line) => line.date || line.type || line.description || line.amount).map((line) => ({
    expenseDate: line.date, expenseType: line.type as ExpenseType, description: line.description.trim(), amount: parseMoneyInputAtScale(line.amount, 2) ?? 0,
  }));
  const chosenFloat = floatChoices.find((choice) => choice.float_id === floatId);
  const chargedFloatId = chosenFloat ? floatId : '';
  const unknownCurrency = t('imprest:form.unknownCurrency', 'Unknown');
  // PQ-7: a claim settles only an advance on its own float (or an off-float advance when it is off-float).
  const advanceFloat = new Map((advances?.rows ?? []).map((row) => [row.id, row.imprest_float_id ?? '']));
  const advanceOptions = ownAdvances.options.filter((option) => (advanceFloat.get(option.value) ?? '') === chargedFloatId);
  const totalCents = toCents(lineInputs.reduce((sum, line) => sum + line.amount, 0));
  const floatHint = chosenFloat && totalCents > 0 ? {
    remaining: category && chosenFloat.remaining != null
      ? chosenFloat.currency
        ? formatCurrency(Number(chosenFloat.remaining), chosenFloat.currency)
        : orgCurrency.isResolved ? formatCurrency(Number(chosenFloat.remaining), currency) : unknownCurrency
      : null,
    exception: Boolean(category) && isPlanException(totalCents / 100, chosenFloat.remaining),
    overLimit: procurementLimit !== null && totalCents > toCents(procurementLimit),
  } : null;
  const invalidLine = lineInputs.some((line) => !line.expenseDate || !line.expenseType || !line.description || !(line.amount > 0));

  const busy = saving !== null || advancesNotReady || projectsNotReady;

  const save = async (event: React.FormEvent | React.MouseEvent, mode: 'draft' | 'submit' = 'draft') => {
    event.preventDefault();
    if (saveInFlight.current || advancesNotReady || projectsNotReady) return;
    setSubmitted(true);
    if (!title.trim() || invalidLine) {
      setError(t('expenseClaims:new.validation', 'Enter a title and complete any expense line you start.'));
      window.scrollTo({ top: 0 });
      return;
    }
    saveInFlight.current = true;
    setError(null); setSaving(mode);
    const header = { kind: 'claim' as const, title: title.trim(), projectId: projectId || null, budgetCategory: (category || null) as BudgetCategory | null, purpose: purpose.trim() || null, advanceId: advanceId || null };
    let createdClaimId: string | null = null;
    try {
      const firstLine = lineInputs[0] ?? null;
      const claimId = await capture.capture({
        header,
        firstLine,
        additionalLines: firstLine ? lineInputs.slice(1) : lineInputs,
        receiptFile: receipt,
      });
      createdClaimId = claimId;
      if (chargedFloatId) {
        // The capture RPC does not carry the float; link it now. A refusal leaves the saved draft (the same recovery as a later line failure).
        try { await setClaimFloat.mutateAsync({ claimId, floatId: chargedFloatId }); } catch (reason) {
          const { headline, detail } = classifyMutationError(reason);
          toast(t('imprest:form.linkFailed', 'Saved, but not charged to the site float'), `${headline}: ${detail}`, 'warning');
          navigate(`/expenses/${claimId}`, { replace: true });
          return;
        }
      }
      if (mode === 'submit') {
        // The same transition the saved claim's Submit button runs; a refusal leaves the saved draft open with the reason.
        try { await transition.mutateAsync({ id: claimId, to: 'Submitted' }); } catch (reason) {
          const { headline, detail } = classifyMutationError(reason);
          toast(t('expenseClaims:new.submitFailed', 'Saved as a draft, not submitted'), `${headline}: ${detail}`, 'warning');
          navigate(`/expenses/${claimId}`, { replace: true });
          return;
        }
        toast(t('expenses.toast.submitted', 'Submitted for approval'), title.trim(), 'success');
        navigate(`/expenses/${claimId}`, { replace: true });
        return;
      }
      toast(t('expenses.toast.created', 'Created'), title.trim(), 'success');
      navigate(`/expenses/${claimId}`, { replace: true });
    } catch (reason) {
      const failure = reason as { claimId?: string; draftSaved?: boolean };
      const savedId = failure.claimId ?? createdClaimId ?? capture.recovery?.claimId;
      const { headline, detail } = classifyMutationError(reason);
      if (savedId && (failure.draftSaved || createdClaimId || capture.recovery?.draftSaved)) {
        createdClaimId = savedId;
        if (receipt) {
          void capture.cleanupUnlinkedAttachment({ beforeConfirmationOnly: true }).catch(() => undefined);
        }
        toast(headline, detail, 'warning');
        navigate(`/expenses/${savedId}`, { replace: true });
      } else setError(`${headline}: ${detail}`);
    } finally {
      if (!createdClaimId) { saveInFlight.current = false; setSaving(null); }
    }
  };

  if (!canCreate) return <><BackBar label={t('expenses.title', 'Expenses')} onBack={() => navigate('/expenses')} /><GateNotice variant="blocked">{t('expenseClaims:new.noPermission', 'You do not have permission to create expense claims.')}</GateNotice></>;

  return <div className="mx-auto w-full max-w-[720px]">
    <BackBar label={t('expenses.title', 'Expenses')} onBack={() => guardLeave(() => navigate('/expenses'))} />
    <PageHeader title={t('expenses.form.claimTitle', 'New expense claim')} />
    {error && <p role="alert" className="mb-3 text-control font-medium text-destructive-text">{error}</p>}
    <form className="w-full" onSubmit={(event) => void save(event, 'draft')}>
      <PostingReadinessNote />
      <FormSection legend={t('expenses.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField label={t('expenses.form.title.label', 'Title')} required error={submitted && !title.trim() ? t('expenseClaims:new.required', 'Required') : undefined} value={title} onChange={(value) => { setTitle(value); setTitleEdited(true); }} fullWidth />
          <div className="col-span-full grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            <SelectField label={t('expenses.form.project.label', 'Project')} value={projectId} onChange={(value) => { setProjectId(value); if (floatId) setAdvanceId(''); setFloatId(''); if (!categoryEdited) setCategory(value ? categoryPrecedents.get(value)?.budgetCategory ?? '' : ''); }} options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...options]} />
            <SelectField label={t('expenses.form.category.label', 'Budget category')} value={category} onChange={(value) => { setCategory(value); setCategoryEdited(true); }} options={categories} helper={<BudgetCategoryHelp />} />
          </div>
          {!categoryEdited && categoryPrecedents.get(projectId) && <p className="col-span-full text-control text-muted-foreground" role="note">{t('uxs29.expenseCapture.categorySource', 'Suggested from your most recent same-project claim: {{title}}.', { title: categoryPrecedents.get(projectId)?.sourceTitle })}</p>}
          <TextField label={t('expenses.form.purpose.label', 'Purpose')} value={purpose} onChange={setPurpose} fullWidth />
          {floatChoices.length > 0 && <>
            <SelectField label={t('imprest:form.chargeToFloat', 'Charge to site float')} value={floatId} onChange={(value) => { setFloatId(value); setAdvanceId(''); }}
              fullWidth options={[{ value: '', label: t('imprest:form.noFloat', 'Not charged to a float') },
                ...floatChoiceOptions(floatChoices)]}
              helper={t('imprest:form.helper', 'Cash paid out of site cash held by the custodian.')} />
            {floatHint && <div className="col-span-full space-y-1 text-control text-muted-foreground" role="note">
              {floatHint.remaining && <p>{t('imprest:form.remainingHint', 'Remaining this month for this category: {{amount}}.', { amount: floatHint.remaining })}</p>}
              {floatHint.exception && <p>{t('imprest:form.exceptionHint', "This is above this month's plan: it goes to a senior approver as an out-of-plan item.")}</p>}
              {floatHint.overLimit && <p>{t('imprest:form.limitHint', 'Above the procurement limit ({{limit}}): site cash will refuse this. Raise it as a procurement request.', { limit: orgCurrency.isResolved ? formatCurrency(procurementLimit as number, currency) : unknownCurrency })}</p>}
            </div>}
          </>}
          <ProjectLoadNotice projects={projectChoices} />
          <AdvanceLoadNotice advances={ownAdvances} />
          {advanceOptions.length > 0 && <SelectField label={t('expenses.form.advance.label', 'Settle against advance')} value={advanceId} onChange={setAdvanceId} options={[{ value: '', label: t('expenses.form.advance.none', 'No advance') }, ...advanceOptions]} />}
        </FormGrid>
      </FormSection>
      <FormSection legend={t('expenses.lines.title', 'Lines')}>
        {/* One header row over the line grid on wide screens; each phone line carries its own labels. */}
        {isDesktop && <div aria-hidden className={`${LINE_GRID} items-end mb-1 text-control font-medium text-foreground`}>
          <span>{t('expenses.lines.date', 'Date')}</span>
          <span>{t('expenses.lines.type', 'Type')}</span>
          <span>{t('expenses.lines.description', 'Description')}</span>
          <span className="text-right">{t('expenses.lines.amount', 'Amount')}</span>
          <span />
        </div>}
        {lines.map((line, index) => {
          const amount = parseMoneyInputAtScale(line.amount, 2);
          const setLine = (patch: Partial<DraftLine>) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
          const removeLabel = t('expenseClaims:new.removeLine', 'Remove line {{number}}', { number: index + 1 });
          return (
            <div key={index} role="group" aria-label={t('expenseClaims:new.lineGroup', 'Expense line {{number}}', { number: index + 1 })}
              className={isDesktop ? `${LINE_GRID} items-center py-1.5` : 'grid grid-cols-2 gap-x-3 gap-y-3 border-b border-border py-3'}>
              <TextField label={t('expenses.lines.date', 'Date')} hideLabel={isDesktop} required error={submitted && lineStarted(line) && !line.date ? t('expenseClaims:new.required', 'Required') : undefined} type="date" value={line.date} onChange={(value) => setLine({ date: value })} />
              <SelectField label={t('expenses.lines.type', 'Type')} hideLabel={isDesktop} required error={submitted && lineStarted(line) && !line.type ? t('expenseClaims:new.required', 'Required') : undefined} value={line.type} onChange={(value) => setLine({ type: value })} options={[{ value: '', label: t('uxs29.expenseCapture.expenseTypePlaceholder', 'Choose a type') }, ...Constants.public.Enums.expense_type.map((value) => ({ value, label: expenseTypeLabel(value, t) }))]} />
              <TextField label={t('expenses.lines.description', 'Description')} hideLabel={isDesktop} wrapperClassName={isDesktop ? undefined : 'col-span-2'} required error={submitted && lineStarted(line) && !line.description.trim() ? t('expenseClaims:new.required', 'Required') : undefined} value={line.description} onChange={(value) => { setLine({ description: value }); if (index === 0 && !titleEdited) setTitle(value); }} />
              <div className={isDesktop ? 'contents' : 'col-span-2 flex items-end gap-2'}>
                <div className={isDesktop ? undefined : 'min-w-0 flex-1'}>
                  <NumberField
                    label={t('expenses.lines.amount', 'Amount')}
                    hideLabel={isDesktop}
                    prefix={orgCurrency.isResolved ? currency : unknownCurrency}
                    required
                    error={submitted && lineStarted(line) && !(amount !== null && amount > 0)
                      ? line.amount.trim()
                        ? t('expenseClaims:new.amountInvalid', 'Enter an amount greater than zero.')
                        : t('expenseClaims:new.required', 'Required')
                      : undefined}
                    value={line.amount}
                    onChange={(value) => setLine({ amount: value })}
                  />
                </div>
                {lines.length > 1
                  ? <Button type="button" variant="ghost" size="icon" className="touch-target shrink-0" aria-label={removeLabel} title={removeLabel} onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}><Icon name="x" aria-hidden /></Button>
                  : isDesktop && <span />}
              </div>
            </div>
          );
        })}
        <div className={isDesktop ? `${LINE_GRID} mt-2 items-center border-t border-border pt-3` : 'mt-3 flex flex-wrap items-center justify-between gap-3'}>
          <Button type="button" variant="outline" className={isDesktop ? 'col-span-2 justify-self-start' : 'touch-target'} onClick={() => setLines((rows) => [...rows, blankLine()])}><Icon name="plus" aria-hidden />{t('expenses.lines.add', 'Add line')}</Button>
          <span className={isDesktop ? 'text-right text-control font-medium' : 'ml-auto text-control font-medium'}>{t('expenseClaims:new.total', 'Total')}</span>
          <span className="text-right text-lg font-semibold tabular-nums text-foreground">{orgCurrency.isResolved ? formatCurrency(totalCents / 100, currency, { precision: 'minor' }) : unknownCurrency}</span>
          {isDesktop && <span />}
        </div>
      </FormSection>
      <FormSection legend={t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}>
        {/* The app's attach pattern (as on the saved claim): a labelled hidden chooser behind one Attach button. */}
        <FileInput ref={receiptInput} id="new-expense-receipt" accept={RECEIPT_INPUT_ACCEPT} className="sr-only" tabIndex={-1}
          aria-label={t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}
          onChange={(event) => { const file = event.target.files?.[0] ?? null; setReceipt(file); if (file && !titleEdited && !lines[0]?.description.trim()) setTitle(file.name.replace(/\.[^.]+$/, '')); }} />
        {receipt
          ? <div className="flex min-w-0 items-center gap-2 text-control">
              <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate" title={receipt.name}>{receipt.name}</span>
              <Button type="button" variant="ghost" size="icon" className="touch-target shrink-0"
                aria-label={t('expenses.receipts.remove', 'Remove {{name}}', { name: receipt.name })}
                onClick={() => { setReceipt(null); if (receiptInput.current) receiptInput.current.value = ''; }}><Icon name="x" aria-hidden /></Button>
            </div>
          : <Button type="button" variant="outline" className="touch-target" onClick={() => receiptInput.current?.click()}><Icon name="upload" aria-hidden />{t('expenses.receipts.attach', 'Attach receipt')}</Button>}
      </FormSection>
      <FormFooter>
        {/* On a phone Back to Expenses (top) is the one way out; the thumb bar keeps the two saves. */}
        {isDesktop && <Button type="button" variant="outline" onClick={() => guardLeave(() => navigate('/expenses'))}>{t('expenses.actions.cancel', 'Cancel')}</Button>}
        <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none">
          <Button type="submit" variant="outline" className="touch-target w-full sm:w-auto" disabled={busy}>{saving === 'draft' ? t('expenseClaims:new.saving', 'Saving…') : t('expenseClaims:new.saveDraft', 'Save draft')}</Button>
          <Button type="button" variant="primary" className="touch-target w-full sm:w-auto" disabled={busy} onClick={(event) => void save(event, 'submit')}>{saving === 'submit' ? t('expenseClaims:new.submitting', 'Submitting…') : t('expenseClaims:new.submit', 'Submit claim')}</Button>
        </div>
      </FormFooter>
    </form>
    <UnsavedChangesDialog open={blockedLeave !== null} onKeepEditing={() => setBlockedLeave(null)} onDiscard={() => { const leave = blockedLeave; setBlockedLeave(null); leave?.(); }} />
  </div>;
};
export default ExpenseClaimNew;
