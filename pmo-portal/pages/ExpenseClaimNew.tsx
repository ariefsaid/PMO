import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, FormGrid, FormSection, GateNotice, SelectField, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useExpenseCapture } from '@/src/hooks/useExpenseCapture';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { RECEIPT_INPUT_ACCEPT } from '@/src/lib/db/expenseReceipts';
import { BackBar } from '@/src/components/shell';
import { expenseTypeLabel } from './expenses/expenseLabels';
import { PostingReadinessNote } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';

type DraftLine = { date: string; type: string; description: string; amount: string };
const blankLine = (): DraftLine => ({ date: '', type: '', description: '', amount: '' });

/** One-page, unsaved claim capture. The parent + initial child use the recoverable capture repository. */
const ExpenseClaimNew: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const canCreate = may('create', 'expenseClaim');
  const currentUserId = useAuth().currentUser?.id;
  const { data: projects } = useProjects();
  const { data: claims } = useExpenseClaims({ kind: 'claim' });
  const capture = useExpenseCapture();
  const saveInFlight = useRef(false);
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [projectId, setProjectId] = useState('');
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
  const dirty = Boolean(title || advanceId || projectId || category || purpose || receipt || lines.some((line) => line.date || line.type || line.description || line.amount));
  const guardLeave = useUnsavedChangesGuard({ dirty, onBlocked: (leave) => setBlockedLeave(() => leave) });
  const options = (projects ?? []).map((project) => ({ value: project.id, label: projectDisplayName(project) }));
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
  const invalidLine = lineInputs.some((line) => !line.expenseDate || !line.expenseType || !line.description || !(line.amount > 0));

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

  return <div>
    <BackBar label={t('expenses.title', 'Expenses')} onBack={() => guardLeave(() => navigate('/expenses'))} />
    <header className="mb-4"><h1 className="text-xl font-semibold">{t('expenses.form.claimTitle', 'New expense claim')}</h1><p className="text-sm text-muted-foreground">{t('expenseClaims:new.subtitle', 'Enter the claim details and expense lines. Nothing is saved until you select Save.')}</p></header>
    <form onSubmit={(event) => void save(event)}>
      <PostingReadinessNote />
      <FormSection legend={t('expenses.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField label={t('expenses.form.title.label', 'Title')} required value={title} onChange={(value) => { setTitle(value); setTitleEdited(true); }} fullWidth />
          <SelectField label={t('expenses.form.project.label', 'Project')} value={projectId} onChange={(value) => { setProjectId(value); if (!categoryEdited) setCategory(value ? categoryPrecedents.get(value)?.budgetCategory ?? '' : ''); }} options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...options]} />
          <SelectField label={t('expenses.form.category.label', 'Budget category')} value={category} onChange={(value) => { setCategory(value); setCategoryEdited(true); }} options={categories} helper={t('expenses.form.category.helper', "Decides who approves: spend within the project's budget for this category goes to the project's approver.")} />
          {!categoryEdited && categoryPrecedents.get(projectId) && <p className="col-span-full text-xs text-muted-foreground" role="note">{t('uxs29.expenseCapture.categorySource', 'Suggested from your most recent same-project claim: {{title}}.', { title: categoryPrecedents.get(projectId)?.sourceTitle })}</p>}
          <TextField label={t('expenses.form.purpose.label', 'Purpose')} value={purpose} onChange={setPurpose} fullWidth />
          {advanceOptions.length > 0 && <SelectField label={t('expenses.form.advance.label', 'Settle against advance')} value={advanceId} onChange={setAdvanceId} options={[{ value: '', label: t('expenses.form.advance.none', 'No advance') }, ...advanceOptions]} />}
        </FormGrid>
      </FormSection>
      <FormSection legend={t('expenses.lines.title', 'Lines')}>
        {lines.map((line, index) => <div key={index} className="mb-3 border-b border-border pb-3">
          <FormGrid>
            <TextField label={t('expenses.lines.date', 'Date')} type="date" value={line.date} onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, date: value } : row))} />
            <SelectField label={t('expenses.lines.type', 'Type')} value={line.type} onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, type: value } : row))} options={[{ value: '', label: t('uxs29.expenseCapture.expenseTypePlaceholder', 'Choose a type') }, ...Constants.public.Enums.expense_type.map((value) => ({ value, label: expenseTypeLabel(value, t) }))]} />
            <TextField label={t('expenses.lines.description', 'Description')} value={line.description} onChange={(value) => { setLines((rows) => rows.map((row, i) => i === index ? { ...row, description: value } : row)); if (index === 0 && !titleEdited) setTitle(value); }} fullWidth />
            <TextField label={t('expenses.lines.amount', 'Amount')} inputMode="decimal" value={line.amount} onChange={(value) => setLines((rows) => rows.map((row, i) => i === index ? { ...row, amount: value } : row))} />
          </FormGrid>
          {lines.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setLines((rows) => rows.filter((_, i) => i !== index))}>{t('expenses.lines.remove', 'Remove')}</Button>}
        </div>)}
        <Button type="button" variant="outline" onClick={() => setLines((rows) => [...rows, blankLine()])}>{t('expenses.lines.add', 'Add line')}</Button>
        <div className="mt-3 flex flex-wrap items-center gap-2"><label className="text-sm font-medium" htmlFor="new-expense-receipt">{t('uxs29.expenseCapture.receipt', 'Receipt (optional)')}</label><input id="new-expense-receipt" type="file" accept={RECEIPT_INPUT_ACCEPT} onChange={(event) => { const file = event.target.files?.[0] ?? null; setReceipt(file); if (file && !titleEdited && !lines[0]?.description.trim()) setTitle(file.name.replace(/\.[^.]+$/, '')); }} />{receipt && <span className="text-sm text-muted-foreground">{receipt.name}</span>}</div>
      </FormSection>
      {error && <p role="alert" className="mb-3 text-sm text-destructive-text">{error}</p>}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-background py-3"><Button type="button" variant="outline" onClick={() => guardLeave(() => navigate('/expenses'))}>{t('expenses.actions.cancel', 'Cancel')}</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? t('expenseClaims:new.saving', 'Saving…') : t('expenses.form.submitSave', 'Save')}</Button></div>
    </form>
    <ConfirmDialog open={blockedLeave !== null} tone="default" title={t('expenseClaims:new.discardTitle', 'Discard unsaved claim?')} description={t('expenseClaims:new.discardBody', 'Your claim details and lines have not been saved. Leave and discard them?')} confirmLabel={t('expenseClaims:new.discardLeave', 'Leave')} cancelLabel={t('expenseClaims:new.discardStay', 'Stay')} onCancel={() => setBlockedLeave(null)} onConfirm={() => { const leave = blockedLeave; setBlockedLeave(null); leave?.(); }} />
  </div>;
};
export default ExpenseClaimNew;
