import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Combobox, ConfirmDialog, DateField, ListState, NumberField, ReasonDialog, RecordSection, RecordStack, SelectField, StatusPill, TextField, useToast,
} from '@/src/components/ui';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectOptions, useVendorOptions } from '@/src/hooks/useFkOptions';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { useRefusalLine } from '@/src/lib/refusals';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import { useRoleLabels } from '@/pages/admin-users/roleLabels';
import { useCanApprovePlan, useEquipmentPlanApprovalRoute, useEquipmentPlanSettings, usePlanCategories, usePlanMutations, usePlansForMonth } from '@/src/hooks/useEquipmentPlans';
import { monthEnd, monthStart, planTotal, type EquipmentPlan, type PlanLineInput } from '@/src/lib/repositories/equipmentPlans';
import { formatCurrency, formatDay, formatMonthYear, parseMoneyInputAtScale } from '@/src/lib/format';

/** A line while it is being typed: numbers stay text until saved. */
interface LineDraft {
  id: string; description: string; workOrderId: string; categoryId: string; vendorId: string;
  quantity: string; rate: string; dateFrom: string; dateTo: string; procurementId: string | null;
}

const newLine = (month: string): LineDraft => ({
  id: crypto.randomUUID(), description: '', workOrderId: '', categoryId: '', vendorId: '', quantity: '1', rate: '', dateFrom: month, dateTo: monthEnd(month), procurementId: null,
});
const fromPlan = (plan: EquipmentPlan): LineDraft[] => plan.lines.map((l) => ({
  id: l.id, description: l.description ?? '', workOrderId: l.workOrderId ?? '', categoryId: l.categoryId ?? '', vendorId: l.vendorId,
  quantity: String(l.quantity), rate: String(l.rate), dateFrom: l.dateFrom, dateTo: l.dateTo, procurementId: l.procurementId,
}));

/** Thirteen months: last month to eleven months ahead. */
const monthOptions = (): Array<{ value: string; label: string }> => {
  const now = new Date();
  return Array.from({ length: 13 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 1 + i, 1);
    return { value: monthStart(d), label: formatMonthYear(d) };
  });
};

const PlanEditor: React.FC<{ projectId: string; month: string; plan: EquipmentPlan | null }> = ({ projectId, month, plan }) => {
  const { t } = useTranslation('equipmentPlans');
  const { t: tWaiting } = useTranslation('waitingList');
  const { label: roleLabel } = useRoleLabels();
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const { currentUser } = useAuth();
  const canCreate = usePermission()('create', 'equipmentPlan');
  const m = usePlanMutations();
  const planId = useRef(plan?.id ?? crypto.randomUUID());
  const vendors = useVendorOptions();
  const workOrders = useProjectWorkOrders(projectId);
  const categories = usePlanCategories();
  const { currency } = useOrgCurrencyState();
  const [lines, setLines] = useState<LineDraft[]>(() => (plan ? fromPlan(plan) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const status = plan?.status ?? 'Draft';
  const isAuthor = !plan || plan.createdBy === currentUser?.id;
  const editable = canCreate && status === 'Draft' && isAuthor;
  const canDecide = useCanApprovePlan(plan?.id, status === 'Submitted').data === true;
  // fix-waiting item 3: who this plan waits for, from the database's own route (1565). It decides nothing; the buttons
  // above it are still the database's answer. Only a Submitted plan is waiting, so only then is the route asked.
  const route = useEquipmentPlanApprovalRoute(plan?.id, status === 'Submitted');
  const waitingNames = (route.data?.approvers ?? []).map((a) => a.name);
  const waitingRoles = [...new Set((route.data?.approvers ?? []).map((a) => roleLabel(a.role)))];
  const waitingFor = waitingForText(waitingRoles.length === 1 ? { names: waitingNames, role: waitingRoles[0] } : { names: waitingNames }, tWaiting);
  const honestEmptyRoute = route.data !== undefined && route.data.approvers.length === 0
    && (route.data.kind === 'project' || route.data.kind === 'org' || route.data.kind === 'admin' || route.data.kind === 'senior_role');
  const busy = m.save.isPending || m.submit.isPending || m.approve.isPending || m.reject.isPending || m.reopen.isPending;

  const woOptions = [{ value: '', label: t('line.noWorkOrder', 'No work order') }, ...(workOrders.data ?? []).map((w) => ({ value: w.id, label: w.title }))];
  const categoryOptions = (current: string) => [{ value: '', label: t('line.noCategory', 'No category') },
    ...(categories.data ?? []).filter((c) => c.active || c.id === current).map((c) => ({ value: c.id, label: c.name }))];

  const patch = (id: string, next: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...next } : l)));

  const parsed = useMemo(() => lines.map((l) => ({ q: parseMoneyInputAtScale(l.quantity.trim(), 2), r: parseMoneyInputAtScale(l.rate.trim(), 2) })), [lines]);
  const total = planTotal(parsed.map((p) => ({ quantity: p.q ?? 0, rate: p.r ?? 0 })));

  /** Validates, and returns the lines the save call takes (or null when a field needs fixing). */
  const collect = (): PlanLineInput[] | null => {
    const next: Record<string, string> = {};
    const out: PlanLineInput[] = [];
    lines.forEach((l, i) => {
      const p = parsed[i]!;
      if (!l.description.trim()) next[`${l.id}.description`] = t('errors.descriptionRequired', 'Say what is needed.');
      if (!l.vendorId) next[`${l.id}.vendor`] = t('errors.vendorRequired', 'Choose a vendor.');
      if (p.q === null || p.q <= 0) next[`${l.id}.quantity`] = t('errors.quantityInvalid', 'Enter a quantity above 0.');
      if (p.r === null || p.r < 0) next[`${l.id}.rate`] = t('errors.rateInvalid', 'Enter a rate of 0 or more.');
      if (!l.dateFrom || !l.dateTo) next[`${l.id}.dates`] = t('errors.datesRequired', 'Choose the dates.');
      else if (l.dateTo < l.dateFrom) next[`${l.id}.dates`] = t('errors.dateOrder', 'The end cannot be before the start.');
      else if (l.dateFrom < month || l.dateTo > monthEnd(month)) next[`${l.id}.dates`] = t('errors.dateMonth', 'The dates must be inside the month.');
      if (!next[`${l.id}.description`] && !next[`${l.id}.vendor`] && p.q !== null && p.r !== null) {
        out.push({ id: l.id, workOrderId: l.workOrderId || null, categoryId: l.categoryId || null, description: l.description.trim(), quantity: p.q, rate: p.r, vendorId: l.vendorId, dateFrom: l.dateFrom, dateTo: l.dateTo });
      }
    });
    setErrors(next);
    return Object.keys(next).length ? null : out;
  };

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(null);
    try { await work(); toast(done, undefined, 'success'); } catch (err) { setError(refusal(err)); }
  };
  const save = async (): Promise<boolean> => {
    const out = collect();
    if (!out) return false;
    setError(null);
    try { await m.save.mutateAsync({ id: planId.current, projectId, month, lines: out }); return true; } catch (err) { setError(refusal(err)); return false; }
  };

  return (
    <RecordSection
      title={<span className="flex flex-wrap items-center gap-2">{t('lines', 'Lines')}<StatusPill variant={status === 'Approved' ? 'won' : status === 'Rejected' ? 'lost' : status === 'Submitted' ? 'warn' : 'draft'}>{t(`status.${status}`, status)}</StatusPill></span>}
      data-testid="equipment-plan"
    >
      {status === 'Submitted' && (
        <div className="text-sm text-muted-foreground" data-testid="plan-waiting-for">
          {route.isPending && <span>{t('route.loading', 'Finding who this plan waits for…')}</span>}
          {route.isError && (
            <ListState variant="error" quiet title={t('route.loadError', "Couldn't read who approves this plan")} onRetry={() => void route.refetch()} />
          )}
          {/* A failed read keeps its cached answer (TanStack holds `data` through an errored refetch), so both data
              branches are gated on the error state: an error never prints a name or a definitive "no one can approve"
              beside it. Retry restores whichever sentence is true. */}
          {!route.isError && route.data && route.data.approvers.length > 0 && <span>{waitingFor}</span>}
          {!route.isError && honestEmptyRoute && <span>{t('route.nobody', 'No one can approve this plan yet.')}</span>}
        </div>
      )}
      {plan?.status === 'Rejected' && plan.rejectReason && <FormErrorStrip>{t('rejectedWhy', 'Rejected: {{reason}}', { reason: plan.rejectReason })}</FormErrorStrip>}
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {lines.length === 0 && <p className="text-muted-foreground">{t('noLines', 'No lines yet. Add what the project needs this month.')}</p>}
      <ul className="space-y-3">
        {lines.map((l, i) => (
          <li key={l.id} className="space-y-2 rounded-md border border-border p-3" data-testid="plan-line">
            <p className="text-sm font-medium">{t('line.title', 'Line {{n}}', { n: i + 1 })}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={t('line.description', 'What is needed')} value={l.description} onChange={(v) => patch(l.id, { description: v })} error={errors[`${l.id}.description`]} disabled={!editable} fullWidth />
              <Combobox label={t('line.vendor', 'Vendor')} noun="vendor" value={l.vendorId} selectedOption={(vendors.data ?? []).find((o) => o.value === l.vendorId) ?? null}
                onChange={(v) => patch(l.id, { vendorId: v })} loadOptions={async () => vendors.data ?? []} error={errors[`${l.id}.vendor`]} disabled={!editable || vendors.isPending} />
              <SelectField label={t('line.workOrder', 'Work order')} value={l.workOrderId} onChange={(v) => patch(l.id, { workOrderId: v })} options={woOptions} disabled={!editable} fullWidth />
              <SelectField label={t('line.category', 'Category')} value={l.categoryId} onChange={(v) => patch(l.id, { categoryId: v })} options={categoryOptions(l.categoryId)} disabled={!editable} fullWidth />
              <NumberField label={t('line.quantity', 'Quantity')} value={l.quantity} onChange={(v) => patch(l.id, { quantity: v })} error={errors[`${l.id}.quantity`]} disabled={!editable} fullWidth />
              <NumberField label={t('line.rate', 'Rate')} value={l.rate} onChange={(v) => patch(l.id, { rate: v })} error={errors[`${l.id}.rate`]} disabled={!editable} fullWidth />
              <DateField label={t('line.from', 'From')} value={l.dateFrom} min={month} max={monthEnd(month)} onChange={(v) => patch(l.id, { dateFrom: v })} error={errors[`${l.id}.dates`]} disabled={!editable} fullWidth />
              <DateField label={t('line.to', 'To')} value={l.dateTo} min={l.dateFrom || month} max={monthEnd(month)} onChange={(v) => patch(l.id, { dateTo: v })} disabled={!editable} fullWidth />
            </div>
            {l.procurementId && <Link className="text-sm text-primary underline" to={`/procurement/${l.procurementId}`} data-testid="plan-line-order">{t('line.orderOpen', 'Open order')} · {formatDay(l.dateFrom)}</Link>}
            {editable && <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>{t('line.remove', 'Remove line')}</Button>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm" data-testid="plan-total">{t('total', 'Month total')}: <span className="font-medium tabular-nums">{formatCurrency(total, currency)}</span></p>
      <div className="mt-3 flex flex-wrap gap-2">
        {editable && <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, newLine(month)])}>{t('addLine', 'Add line')}</Button>}
        {editable && <Button variant="outline" size="sm" loading={m.save.isPending} disabled={busy} onClick={() => void save().then((ok) => { if (ok) toast(t('saved', 'Plan saved'), undefined, 'success'); })}>{t('save', 'Save draft')}</Button>}
        {editable && <Button variant="primary" size="sm" disabled={busy || lines.length === 0}
          onClick={() => void (async () => { if (await save()) await run(() => m.submit.mutateAsync(planId.current), t('submitted', 'Plan submitted')); })()}>{t('submit', 'Submit for approval')}</Button>}
        {status === 'Rejected' && isAuthor && plan && <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => m.reopen.mutateAsync(plan.id), t('reopened', 'Plan reopened'))}>{t('reopen', 'Reopen to edit')}</Button>}
        {status === 'Submitted' && canDecide && <Button variant="primary" size="sm" disabled={busy} onClick={() => setConfirmApprove(true)}>{t('approve', 'Approve and create orders')}</Button>}
        {status === 'Submitted' && canDecide && <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting(true)}>{t('reject', 'Reject')}</Button>}
      </div>
      <ConfirmDialog open={confirmApprove} title={t('approveTitle', 'Approve this plan?')} description={t('approveBody', 'This creates {{count}} Draft rental orders, one per line. Each goes through the normal approval. Approving again creates nothing more.', { count: lines.length })}
        confirmLabel={t('approveConfirm', 'Approve and create orders')} loading={m.approve.isPending}
        onCancel={() => setConfirmApprove(false)}
        onConfirm={() => void (async () => { await run(() => m.approve.mutateAsync(plan!.id), t('approved', 'Plan approved, orders created')); setConfirmApprove(false); })()} />
      <ReasonDialog open={rejecting} kind="reject" title={t('rejectTitle', 'Reject this plan')} label={t('rejectReason', 'Reason')} confirmLabel={t('rejectConfirm', 'Reject plan')} loading={m.reject.isPending}
        onCancel={() => setRejecting(false)}
        onConfirm={(reason) => void (async () => { await run(() => m.reject.mutateAsync({ id: plan!.id, reason }), t('rejected', 'Plan rejected')); setRejecting(false); })()} />
    </RecordSection>
  );
};

/** The monthly equipment and service plan (#2700): one plan per project and month; approving it creates the rental orders. */
const EquipmentPlansPage: React.FC = () => {
  const { t } = useTranslation('equipmentPlans');
  const navigate = useNavigate();
  const isAdmin = usePermission()('manage', 'equipmentPlan');
  const settings = useEquipmentPlanSettings();
  const projects = useProjectOptions();
  const [projectId, setProjectId] = useState('');
  const [month, setMonth] = useState(monthStart(new Date()));
  const plans = usePlansForMonth(month, settings.data?.enabled === true);
  const plan = plans.data?.find((p) => p.projectId === projectId) ?? null;
  const months = monthOptions();

  return (
    <div>
      <BackBar label={t('back', 'Procurement')} onBack={() => navigate('/procurement')} />
      <h1 className="mb-2 text-xl font-semibold">{t('title', 'Monthly equipment plan')}</h1>
      {settings.isError && <ListState variant="error" title={t('loadError', "Couldn't load the plans")} onRetry={() => void settings.refetch()} />}
      {settings.data && !settings.data.enabled && (
        <p className="text-muted-foreground" data-testid="plan-off">
          {t('off', 'The monthly plan is not turned on for your organisation.')}{' '}
          {isAdmin && <Link className="text-primary underline" to="/equipment-plans/settings">{t('offAdmin', 'Turn it on in the plan settings.')}</Link>}
        </p>
      )}
      {settings.data?.enabled && (
        <RecordStack>
          <p className="text-muted-foreground">{t('intro', 'Plan the equipment and services a project needs for the month.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Combobox label={t('project', 'Project')} noun="project" placeholder={t('chooseProject', 'Choose a project')} value={projectId}
              selectedOption={(projects.data ?? []).find((o) => o.value === projectId) ?? null} onChange={setProjectId} loadOptions={async () => projects.data ?? []} disabled={projects.isPending} />
            <SelectField label={t('month', 'Month')} value={month} onChange={setMonth} options={months.some((o) => o.value === month) ? months : [...months, { value: month, label: month }]} />
          </div>
          {isAdmin && <Link className="text-sm text-primary underline" to="/equipment-plans/settings">{t('settingsLink', 'Plan settings')}</Link>}
          {plans.isPending && projectId && <ListState variant="loading" rows={3} />}
          {plans.isError && <ListState variant="error" title={t('loadError', "Couldn't load the plans")} onRetry={() => void plans.refetch()} />}
          {projectId && plans.data && (
            <>
              {!plan && <p className="text-muted-foreground">{t('noPlan', 'No plan for this project and month yet.')}</p>}
              <PlanEditor key={`${projectId}:${month}:${plan?.id ?? 'new'}:${plan?.status ?? ''}:${plan?.lines.length ?? 0}`} projectId={projectId} month={month} plan={plan} />
            </>
          )}
        </RecordStack>
      )}
    </div>
  );
};
export default EquipmentPlansPage;
