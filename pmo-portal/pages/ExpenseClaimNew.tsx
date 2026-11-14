import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, FormFooter, FormGrid, FormSection, GateNotice, NumberField, PageHeader, SelectField, TextField, UnsavedChangesDialog, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useExpenseCapture } from '@/src/hooks/useExpenseCapture';
import { useImprestFloatChoices, useImprestProcurementLimit, useSetClaimFloat } from '@/src/hooks/useImprest';
import { floatChoiceOptions } from '@/src/lib/imprest/floatDisplay';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { Input } from '@/src/components/shadcn/input';
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
  const [saving, setSaving] = useState(false);
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

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current || advancesNotReady || projectsNotReady) return;
    setSubmitted(true);
    if (!title.trim() || invalidLine) {
      setError(t('expenseClaims:new.validation', 'Enter a title and complete any expense line you start.'));
      window.scrollTo({ top: 0 });
      return;
    }
    saveInFlight.current = true;
    setError(null); setSaving(true);
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
      if (!createdClaimId) { saveInFlight.current = false; setSaving(false); }
    }
  };

  if (!canCreate) return <><BackBar label={t('expenses.title', 'Expenses')} onBack={() => navigate('/expenses')} /><GateNotice variant="blocked">{t('expenseClaims:new.noPermission', 'You do not have permission to create expense claims.')}</GateNotice></>;

  return <div className="mx-auto w-full max-w-[720px]">
    <BackBar label={t('expenses.title', 'Expenses')} onBack={() => guardLeave(() => navigate('/expenses'))} />
    <PageHeader title={t('expenses.form.claimTitle', 'New expense claim')} />
    {error && <p role="alert" className="mb-3 text-control font-medium text-destructive-text">{error}</p>}
    <form className="w-full" onSubmit={(event) => void save(event)}>
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
              options={[{ value: '', label: t('imprest:form.noFloat', 'Not charged to a float') },
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
        {lines.map((line, index) => {
          const amount = parseMoneyInputAtScale(line.amount, 2);
          return (
            <div key={index} role="group" aria-label={t('expenseClaims:new.lineGroup', 'Expense line {{number}}', { number: index + 1 })} className="mb-3 border-b border-border pb-3">
              <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 sm:grid-cols-[minmax(0,0.86fr)_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1.05fr)]">
                <TextField label={t('expenses.lines.date', 'Date')} required error={submitted && lineStarted(line) && !line.date ? t('expenseClaims:new.required', 'Required') : undefined} type="date" value={line.date} onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, date: value } : row))} />
                <SelectField label={t('expenses.lines.type', 'Type')} required error={submitted && lineStarted(line) && !line.type ? t('expenseClaims:new.required', 'Required') : undefined} value={line.type} onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, type: value } : row))} options={[{ value: '', label: t('uxs29.expenseCapture.expenseTypePlaceholder', 'Choose a type') }, ...Constants.public.Enums.expense_type.map((value) => ({ value, label: expenseTypeLabel(value, t) }))]} />
                <TextField label={t('expenses.lines.description', 'Description')} required error={submitted && lineStarted(line) && !line.description.trim() ? t('expenseClaims:new.required', 'Required') : undefined} value={line.description} onChange={(value) => { setLines((rows) => rows.map((row, i) => i === index ? { ...row, description: value } : row)); if (index === 0 && !titleEdited) setTitle(value); }} />
                <NumberField
                  label={t('expenses.lines.amount', 'Amount')}
                  prefix={orgCurrency.isResolved ? currency : unknownCurrency}
                  required
                  error={submitted && lineStarted(line) && !(amount !== null && amount > 0)
                    ? line.amount.trim()
                      ? t('expenseClaims:new.amountInvalid', 'Enter an amount greater than zero.')
                      : t('expenseClaims:new.required', 'Required')
                    : undefined}
                  value={line.amount}
                  onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, amount: value } : row))}
                />
              </div>
              {lines.length > 1 && <Button type="button" variant="ghost" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>{t('expenses.lines.remove', 'Remove')}</Button>}
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((rows) => [...rows, blankLine()])}>{t('expenses.lines.add', 'Add line')}</Button>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-control font-medium">
          <span>{t('expenseClaims:new.total', 'Total')}</span>
          <span className="tabular-nums">{orgCurrency.isResolved ? formatCurrency(totalCents / 100, currency, { precision: 'minor' }) : unknownCurrency}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-sm font-medium" htmlFor="new-expense-receipt">{t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}</label><Input id="new-expense-receipt" type="file" accept={RECEIPT_INPUT_ACCEPT} className="w-auto" onChange={(event) => { const file = event.target.files?.[0] ?? null; setReceipt(file); if (file && !titleEdited && !lines[0]?.description.trim()) setTitle(file.name.replace(/\.[^.]+$/, '')); }} />{receipt && <span className="text-sm text-muted-foreground">{receipt.name}</span>}</div>
      </FormSection>
      <FormFooter
        submitLabel={saving ? t('expenseClaims:new.saving', 'Saving…') : t('expenseClaims:new.saveDraft', 'Save draft')}
        cancelLabel={t('expenses.actions.cancel', 'Cancel')}
        onCancel={() => guardLeave(() => navigate('/expenses'))}
        disabled={saving || advancesNotReady || projectsNotReady}
      />
    </form>
    <UnsavedChangesDialog open={blockedLeave !== null} onKeepEditing={() => setBlockedLeave(null)} onDiscard={() => { const leave = blockedLeave; setBlockedLeave(null); leave?.(); }} />
  </div>;
};
export default ExpenseClaimNew;
