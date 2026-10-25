import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, FormGrid, FormSection, GateNotice, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useExpenseCapture } from '@/src/hooks/useExpenseCapture';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { RECEIPT_INPUT_ACCEPT } from '@/src/lib/db/expenseReceipts';
import { expenseTypeLabel } from './expenses/expenseLabels';
import { PostingReadinessNote } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { MoneyOutPageHeader } from './procurement/MoneyOutHeader';

type DraftLine = { date: string; type: string; description: string; amount: string };
const blankLine = (): DraftLine => ({ date: '', type: '', description: '', amount: '' });

/** Evidence-first unsaved claim capture. The capture repository owns partial-save recovery. */
const ExpenseClaimNew: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const may = usePermission();
  const canCreate = may('create', 'expenseClaim');
  const currentUserId = useAuth().currentUser?.id;
  const { data: projects } = useProjects();
  const { data: claims } = useExpenseClaims({ kind: 'claim' });
  const capture = useExpenseCapture();
  const orgCurrency = useOrgCurrencyState();
  const saveInFlight = useRef(false);
  const inheritedProjectId = useMemo(() => new URLSearchParams(location.search).get('project') ?? '', [location.search]);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [titleSuggestionSource, setTitleSuggestionSource] = useState<'receipt' | 'line' | null>(null);
  const [projectId, setProjectId] = useState(() => new URLSearchParams(location.search).get('project') ?? '');
  const [category, setCategory] = useState('');
  const [categoryEdited, setCategoryEdited] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [advanceId, setAdvanceId] = useState('');
  const advanceOptions = useOwnAdvanceOptions();
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedLeave, setBlockedLeave] = useState<(() => void) | null>(null);
  const dirty = Boolean(title || advanceId || (projectId && projectId !== inheritedProjectId) || categoryEdited || purpose || receipt || lines.some((line) => line.date || line.type || line.description || line.amount));
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: (leave) => setBlockedLeave(() => leave) });
  const projectOptions = useMemo(() => (projects ?? []).map((project) => ({ value: project.id, label: projectDisplayName(project) })), [projects]);
  const selectedProject = projects?.find((project) => project.id === projectId);
  const currency = selectedProject?.currency ?? (!projectId && orgCurrency.isResolved ? orgCurrency.currency : null);
  const scopeProject = selectedProject ? projectDisplayName(selectedProject)
    : projectId ? t('expenseClaims:new.projectLoading', 'Project scope loading') : t('expenses.form.project.none', 'Overhead (no project)');
  const scopeCurrency = currency ?? t('expenseClaims:new.currencyUnavailable', 'Currency not available; check the project or organization currency settings.');
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
  useEffect(() => {
    if (!categoryEdited && projectId) setCategory(categoryPrecedents.get(projectId)?.budgetCategory ?? '');
  }, [categoryEdited, categoryPrecedents, projectId]);
  const categories = [{ value: '', label: t('expenses.form.category.none', 'No category') }, ...Constants.public.Enums.budget_category.map((value) => ({ value, label: budgetCategoryLabel(value, t) }))];
  const lineInputs: ExpenseLineInput[] = lines.filter((line) => line.date || line.type || line.description || line.amount).map((line) => ({
    expenseDate: line.date, expenseType: line.type as ExpenseType, description: line.description.trim(), amount: parseMoneyInputAtScale(line.amount, 2) ?? 0,
  }));
  const invalidLine = lineInputs.some((line) => !line.expenseDate || !line.expenseType || !line.description || !(line.amount > 0));

  const suggestTitle = (value: string, source: 'receipt' | 'line') => {
    if (titleEdited) return;
    setTitle(value);
    setTitleSuggestionSource(value ? source : null);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    if (!title.trim() || invalidLine) {
      setError(t('expenseClaims:new.validation', 'Enter a title and complete any expense line you start.')); return;
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
      toast(t('expenses.toast.created', 'Created'), title.trim(), 'success');
      navigate(`/expenses/${claimId}`, { replace: true });
    } catch (reason) {
      const failure = reason as { claimId?: string; draftSaved?: boolean };
      const savedId = failure.claimId ?? createdClaimId ?? capture.recovery?.claimId;
      const { headline, detail } = classifyMutationError(reason);
      if (savedId && (failure.draftSaved || createdClaimId || capture.recovery?.draftSaved)) {
        createdClaimId = savedId;
        if (receipt) void capture.cleanupUnlinkedAttachment({ beforeConfirmationOnly: true }).catch(() => undefined);
        toast(headline, detail, 'warning');
        navigate(`/expenses/${savedId}`, { replace: true });
      } else setError(`${headline}: ${detail}`);
    } finally {
      if (!createdClaimId) { saveInFlight.current = false; setSaving(false); }
    }
  };

  const returnToExpenses = () => guardLeave(() => navigate(`/expenses${location.search}`));
  const renderLine = (line: DraftLine, index: number, removable: boolean) => (
    <div key={index} className="mb-3 border-b border-border pb-3 last:mb-0">
      <FormGrid>
        <TextField label={t('expenses.lines.date', 'Date')} type="date" value={line.date} className="min-h-11" onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, date: value } : row))} />
        <SelectField label={t('expenses.lines.type', 'Type')} value={line.type} className="min-h-11" onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, type: value } : row))} options={[{ value: '', label: t('uxs29.expenseCapture.expenseTypePlaceholder', 'Choose a type') }, ...Constants.public.Enums.expense_type.map((value) => ({ value, label: expenseTypeLabel(value, t) }))]} />
        <TextField label={t('expenses.lines.description', 'Description')} value={line.description} className="min-h-11" onChange={(value) => { setLines((rows) => rows.map((row, i) => i === index ? { ...row, description: value } : row)); if (index === 0 && !titleEdited) suggestTitle(value, 'line'); }} fullWidth />
        <TextField label={t('expenses.lines.amount', 'Amount')} inputMode="decimal" value={line.amount} className="min-h-11" onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, amount: value } : row))} />
      </FormGrid>
      {removable && <Button type="button" variant="ghost" className="min-h-11" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>{t('expenses.lines.remove', 'Remove')}</Button>}
    </div>
  );

  if (!canCreate) return <>
    <MoneyOutPageHeader title={t('expenses.form.claimTitle', 'New expense claim')} returnAction={{ label: t('expenses.title', 'Expenses'), onReturn: () => navigate(`/expenses${location.search}`) }} />
    <GateNotice variant="blocked">{t('expenseClaims:new.noPermission', 'You do not have permission to create expense claims.')}</GateNotice>
  </>;

  return <div>
    <MoneyOutPageHeader
      title={t('expenses.form.claimTitle', 'New expense claim')}
      scope={t('expenseClaims:new.scope', '{{project}} · {{currency}}', { project: scopeProject, currency: scopeCurrency })}
      returnAction={{ label: t('expenses.title', 'Expenses'), onReturn: returnToExpenses }}
    />
    <form onSubmit={(event) => void save(event)}>
      <FormSection legend={t('expenses.form.projectScope', 'Project scope')}>
        <div className="grid min-w-0 grid-cols-1 items-end gap-3 sm:grid-cols-2">
          <SelectField label={t('expenses.form.project.label', 'Project')} value={projectId} className="min-h-11" onChange={(value) => {
            setProjectId(value);
            if (!categoryEdited) setCategory(value ? categoryPrecedents.get(value)?.budgetCategory ?? '' : '');
          }} options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...projectOptions]} />
          <p className="min-h-11 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground" aria-label={t('expenses.form.currencyScope', 'Currency')}>
            {t('expenses.form.currencyScope', 'Currency')}: <span className="font-medium text-foreground">{scopeCurrency}</span>
          </p>
        </div>
      </FormSection>
      <FormSection legend={t('uxs29.expenseCapture.firstExpense', 'First expense')}>
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-3">
          <label className="text-sm font-medium" htmlFor="new-expense-receipt">{t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}</label>
          <input id="new-expense-receipt" className="min-h-11 min-w-0 max-w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:font-medium" type="file" accept={RECEIPT_INPUT_ACCEPT} onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setReceipt(file);
            if (file && !lines[0]?.description.trim()) suggestTitle(file.name.replace(/\.[^.]+$/, ''), 'receipt');
            else if (!file && !lines[0]?.description.trim()) suggestTitle('', 'receipt');
          }} />
          {receipt && <span className="max-w-full truncate text-sm text-muted-foreground" title={receipt.name}>{receipt.name}</span>}
        </div>
        {renderLine(lines[0] ?? blankLine(), 0, false)}
      </FormSection>
      <FormSection legend={t('expenses.lines.additionalTitle', 'Additional lines')}>
        {lines.slice(1).map((line, index) => renderLine(line, index + 1, true))}
        <Button type="button" variant="outline" className="min-h-11" onClick={() => setLines((rows) => [...rows, blankLine()])}>{t('expenses.lines.add', 'Add line')}</Button>
      </FormSection>
      <details className="mb-4 rounded-lg border border-border bg-card">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('expenseClaims:new.moreDetails', 'More claim details')}
        </summary>
        <div className="border-t border-border p-4">
          <FormSection legend={t('expenses.form.sections.details', 'Claim details')}>
            <FormGrid>
              <TextField label={t('expenses.form.title.label', 'Title')} required value={title} className="min-h-11" onChange={(value) => { setTitle(value); setTitleEdited(true); setTitleSuggestionSource(null); }} fullWidth />
              {!titleEdited && title && titleSuggestionSource && <p className="col-span-full text-xs text-muted-foreground" role="note">
                {titleSuggestionSource === 'receipt'
                  ? t('expenseClaims:new.titleFromReceipt', 'Suggested from the receipt filename.')
                  : t('expenseClaims:new.titleFromLine', 'Suggested from the first line description.')}
              </p>}
              <SelectField label={t('expenses.form.category.label', 'Budget category')} value={category} className="min-h-11" onChange={(value) => { setCategory(value); setCategoryEdited(true); }} options={categories} helper={t('expenses.form.category.helper', "Decides who approves: spend within the project's budget for this category goes to the project's approver.")} />
              {!categoryEdited && categoryPrecedents.get(projectId) && <p className="col-span-full text-xs text-muted-foreground" role="note">{t('uxs29.expenseCapture.categorySource', 'Suggested from your most recent same-project claim: {{title}}.', { title: categoryPrecedents.get(projectId)?.sourceTitle })}</p>}
              <TextField label={t('expenses.form.purpose.label', 'Purpose')} value={purpose} className="min-h-11" onChange={setPurpose} fullWidth />
              {advanceOptions.length > 0 && <SelectField label={t('expenses.form.advance.label', 'Settle against advance')} value={advanceId} className="min-h-11" onChange={setAdvanceId} options={[{ value: '', label: t('expenses.form.advance.none', 'No advance') }, ...advanceOptions]} />}
            </FormGrid>
          </FormSection>
        </div>
      </details>
      <PostingReadinessNote />
      {error && <p role="alert" className="mb-3 text-sm text-destructive-text">{error}</p>}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background py-3">
        <Button type="button" variant="outline" className="min-h-11" onClick={returnToExpenses}>{t('expenses.actions.cancel', 'Cancel')}</Button>
        <Button type="submit" variant="primary" className="min-h-11" disabled={saving}>{saving ? t('expenseClaims:new.saving', 'Saving…') : t('expenseClaims:new.saveDraft', 'Save draft')}</Button>
      </div>
    </form>
    <ConfirmDialog open={blockedLeave !== null} tone="default" title={t('expenseClaims:new.discardTitle', 'Discard unsaved claim?')} description={t('expenseClaims:new.discardBody', 'Your claim details and lines have not been saved. Leave and discard them?')} confirmLabel={t('expenseClaims:new.discardLeave', 'Leave')} cancelLabel={t('expenseClaims:new.discardStay', 'Stay')} onCancel={() => setBlockedLeave(null)} onConfirm={() => { const leave = blockedLeave; setBlockedLeave(null); leave?.(); }} />
  </div>;
};
export default ExpenseClaimNew;
