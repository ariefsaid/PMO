import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, ListState, SelectField, StatusPill, TextArea, TextField, useToast } from '@/src/components/ui';
import { CanWrite } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import {
  useCreatePlan, useDeletePlanLine, useImprestPlanLines, useImprestPlans, useSavePlanLine, useTransitionPlan,
} from '@/src/hooks/useImprest';
import { availablePlanActions, type ImprestAction } from '@/src/lib/imprest/imprestRules';
import type { BudgetCategory, ImprestPlanRow } from '@/src/lib/db/imprest';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyAuto, parseMoneyInputAtScale } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { imprestStatusLabel } from './imprestLabels';

type PlanTo = 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Cancelled';
const TO: Partial<Record<ImprestAction, PlanTo>> = {
  submitPlan: 'Submitted', reopenPlan: 'Draft', cancelPlan: 'Cancelled', approvePlan: 'Approved', rejectPlan: 'Rejected',
};
const nextMonth = (m: string): string => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
};
const monthLabel = (m: string): string => m.slice(0, 7);

/** Lines of one plan; editable only while the viewer authored it and it is Draft/Rejected (RLS decides; this hides). */
const PlanLines: React.FC<{ plan: ImprestPlanRow; currency: string; editable: boolean }> = ({ plan, currency, editable }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const lines = useImprestPlanLines(plan.id);
  const save = useSavePlanLine();
  const remove = useDeletePlanLine();
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const parsed = parseMoneyInputAtScale(amount, 2);
  const run = async (work: () => Promise<unknown>) => {
    try { await work(); } catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };
  if (lines.isPending) return <ListState variant="loading" rows={2} />;
  if (lines.isError) return <p role="alert" className="text-sm text-destructive-text">{t('imprest:plan.linesError', "Couldn't load the plan lines")}</p>;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border text-sm">
        {(lines.data ?? []).map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-1.5">
            <span className="flex-1">{budgetCategoryLabel(l.budget_category, t)}</span>
            <span className="tabular-nums">{formatCurrencyAuto(Number(l.planned_amount), currency)}</span>
            {editable && <Button variant="ghost" size="sm" aria-label={t('imprest:plan.removeLine', 'Remove {{category}}', { category: budgetCategoryLabel(l.budget_category, t) })}
              disabled={remove.isPending} onClick={() => void run(() => remove.mutateAsync(l.id))}>{t('imprest:plan.remove', 'Remove')}</Button>}
          </li>
        ))}
        {(lines.data ?? []).length === 0 && <li className="py-1.5 text-muted-foreground">{t('imprest:plan.noLines', 'No lines yet.')}</li>}
      </ul>
      {editable && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t('imprest:plan.category', 'Budget category')} value={category} onChange={setCategory}
            options={[{ value: '', label: t('imprest:plan.chooseCategory', 'Choose a category') },
              ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) }))]} />
          <TextField label={t('imprest:plan.plannedAmount', 'Planned amount')} inputMode="decimal" value={amount} onChange={setAmount} />
          <Button variant="outline" disabled={!category || parsed === null || !(parsed > 0) || save.isPending}
            onClick={() => void run(async () => { await save.mutateAsync({ planId: plan.id, category: category as BudgetCategory, amount: parsed as number }); setCategory(''); setAmount(''); })}>
            {t('imprest:plan.saveLine', 'Save line')}
          </Button>
        </div>
      )}
    </div>
  );
};

/** Monthly plans of one float (FR-IMP-071): create a Draft, edit lines, submit, and the approver's decision. */
export const PlansSection: React.FC<{ floatId: string; custodianId: string; currency: string; currentMonth: string }> = ({ floatId, custodianId, currency, currentMonth }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const plans = useImprestPlans(floatId);
  const create = useCreatePlan();
  const transition = useTransitionPlan();
  const [open, setOpen] = useState<string | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [dialog, setDialog] = useState<{ plan: ImprestPlanRow; action: 'approvePlan' | 'rejectPlan' | 'cancelPlan' } | null>(null);
  const [notes, setNotes] = useState('');
  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, undefined, 'success'); setDialog(null); setNotes(''); }
    catch (err) { const { headline, detail } = classifyMutationError(err); toast(headline, detail, 'warning'); }
  };
  const move = (plan: ImprestPlanRow, action: ImprestAction, extra: { notes?: string } = {}) =>
    run(() => transition.mutateAsync({ id: plan.id, to: TO[action] as PlanTo, ...extra }), t('imprest:plan.toast.updated', 'Plan updated'));

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>{t('imprest:plan.sectionTitle', 'Plans')}</CardHead>
      <CardPad>
        <CanWrite entity="imprestPlan" action="create">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <SelectField label={t('imprest:plan.month', 'Month')} value={month} onChange={setMonth}
              options={[{ value: currentMonth, label: t('imprest:plan.thisMonth', 'This month ({{month}})', { month: monthLabel(currentMonth) }) },
                { value: nextMonth(currentMonth), label: t('imprest:plan.nextMonth', 'Next month ({{month}})', { month: monthLabel(nextMonth(currentMonth)) }) }]} />
            <Button variant="outline" disabled={create.isPending}
              onClick={() => void run(() => create.mutateAsync({ floatId, month }), t('imprest:plan.toast.created', 'Draft plan created'))}>
              {t('imprest:plan.new', 'New plan')}
            </Button>
          </div>
        </CanWrite>
        {plans.isPending && <ListState variant="loading" rows={2} />}
        {!plans.isPending && (plans.isError || !plans.data) && (
          <ListState variant="error" title={t('imprest:plan.error', "Couldn't load plans")} onRetry={() => void plans.refetch()} />
        )}
        {!plans.isPending && !plans.isError && plans.data && (plans.data.rows.length === 0
          ? <p className="text-sm text-muted-foreground">{t('imprest:plan.noPlans', 'No plans yet. The custodian drafts one per month.')}</p>
          : <ul className="divide-y divide-border">
            {plans.data.rows.map((plan) => {
              const actions = availablePlanActions({ userId, realRole, custodianId, plan });
              const editable = userId === plan.author_id && (plan.status === 'Draft' || plan.status === 'Rejected');
              return (
                <li key={plan.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="font-medium">{monthLabel(plan.month)}</span>
                    <span className="text-muted-foreground">{plan.number ?? t('imprest:plan.draftNumber', 'Draft')}</span>
                    <StatusPill variant={workflowVariant(plan.status)}>{imprestStatusLabel(plan.status, t)}</StatusPill>
                    {plan.is_late && <span className="text-muted-foreground">{t('imprest:plan.late', 'Late')}</span>}
                    <span className="flex-1 text-right tabular-nums">{formatCurrencyAuto(Number(plan.total), currency)}</span>
                    <Button variant="ghost" size="sm" aria-expanded={open === plan.id} onClick={() => setOpen((c) => (c === plan.id ? null : plan.id))}>
                      {open === plan.id ? t('imprest:plan.hideLines', 'Hide lines') : t('imprest:plan.showLines', 'Show lines')}
                    </Button>
                    {actions.includes('submitPlan') && <Button variant="primary" size="sm" disabled={transition.isPending} onClick={() => void move(plan, 'submitPlan')}>{t('imprest:actions.submitPlan', 'Submit plan')}</Button>}
                    {actions.includes('reopenPlan') && <Button variant="outline" size="sm" disabled={transition.isPending} onClick={() => void move(plan, 'reopenPlan')}>{t('imprest:actions.reopenPlan', 'Edit and resubmit')}</Button>}
                    {actions.includes('approvePlan') && <Button variant="primary" size="sm" onClick={() => setDialog({ plan, action: 'approvePlan' })}>{t('imprest:actions.approve', 'Approve')}</Button>}
                    {actions.includes('rejectPlan') && <Button variant="outline" size="sm" onClick={() => setDialog({ plan, action: 'rejectPlan' })}>{t('imprest:actions.reject', 'Reject')}</Button>}
                    {actions.includes('cancelPlan') && <Button variant="ghost" size="sm" onClick={() => setDialog({ plan, action: 'cancelPlan' })}>{t('imprest:actions.cancel', 'Cancel')}</Button>}
                  </div>
                  {plan.decision_notes && plan.status === 'Rejected' && <p role="note" className="mt-1 text-muted-foreground">{t('imprest:plan.rejectionNote', 'Rejected: {{note}}', { note: plan.decision_notes })}</p>}
                  {open === plan.id && <div className="mt-2 border-t border-border pt-2"><PlanLines plan={plan} currency={currency} editable={editable} /></div>}
                </li>
              );
            })}
          </ul>)}
      </CardPad>
      <ConfirmDialog
        open={dialog !== null}
        tone={dialog && dialog.action !== 'approvePlan' ? 'destructive' : 'default'}
        title={dialog?.action === 'approvePlan' ? t('imprest:plan.confirm.approveTitle', 'Approve the {{month}} plan?', { month: monthLabel(dialog.plan.month) })
          : dialog?.action === 'rejectPlan' ? t('imprest:plan.confirm.rejectTitle', 'Reject the {{month}} plan?', { month: monthLabel(dialog.plan.month) })
          : t('imprest:plan.confirm.cancelTitle', 'Cancel the {{month}} plan?', { month: dialog ? monthLabel(dialog.plan.month) : '' })}
        description={<div className="space-y-3">
          <p>{dialog ? formatCurrencyAuto(Number(dialog.plan.total), currency) : ''}</p>
          {dialog?.action === 'rejectPlan' && <TextArea label={t('imprest:plan.confirm.notes', 'Note to the author (optional)')} value={notes} onChange={setNotes} />}
        </div>}
        confirmLabel={dialog?.action === 'approvePlan' ? t('imprest:actions.approve', 'Approve') : dialog?.action === 'rejectPlan' ? t('imprest:actions.reject', 'Reject') : t('imprest:actions.cancel', 'Cancel')}
        loading={transition.isPending}
        onConfirm={() => { if (dialog) void move(dialog.plan, dialog.action, notes.trim() ? { notes: notes.trim() } : {}); }}
        onCancel={() => { setDialog(null); setNotes(''); }}
      />
    </Card>
  );
};
