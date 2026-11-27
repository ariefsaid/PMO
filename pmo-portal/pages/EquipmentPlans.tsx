import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, Combobox, ConfirmDialog, DateField, HelpPopover, ListPage, ListState, buttonClasses, NumberField, ReasonDialog, RecordSection, RecordStack, SelectField, StatusPill, TextField, cn, useIsNarrow, useToast,
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

import { orgDayDate } from '@/src/hooks/useOrgToday';

/** A line while it is being typed: numbers stay text until saved. */
interface LineDraft {
  id: string; description: string; workOrderId: string; categoryId: string; vendorId: string; vendorHidden: boolean;
  rateHidden: boolean;
  quantity: string; rate: string; dateFrom: string; dateTo: string; procurementId: string | null;
}

const newLine = (month: string): LineDraft => ({
  id: crypto.randomUUID(), description: '', workOrderId: '', categoryId: '', vendorId: '', vendorHidden: false, rateHidden: false,
  quantity: '1', rate: '', dateFrom: month, dateTo: monthEnd(month), procurementId: null,
});
const fromPlan = (plan: EquipmentPlan): LineDraft[] => plan.lines.map((l) => ({
  id: l.id, description: l.description ?? '', workOrderId: l.workOrderId ?? '', categoryId: l.categoryId ?? '', vendorId: l.vendorId ?? '',
  vendorHidden: l.vendorId == null, rateHidden: l.rate == null,
  quantity: String(l.quantity), rate: l.rate == null ? '' : String(l.rate), dateFrom: l.dateFrom, dateTo: l.dateTo, procurementId: l.procurementId,
}));

/** Thirteen months: last month to eleven months ahead. */
const monthOptions = (): Array<{ value: string; label: string }> => {
  const now = orgDayDate();
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
  const { currency, isResolved } = useOrgCurrencyState();
  const money = (value: number) => isResolved ? formatCurrency(value, currency) : '—';
  const [lines, setLines] = useState<LineDraft[]>(() => (plan ? fromPlan(plan) : []));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  // Lines open as their form: a new line, one the author chose to edit; the rest read as table rows.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const narrow = useIsNarrow();
  const hasWorkOrder = lines.some((line) => Boolean(line.workOrderId));
  const cellX = 'px-[var(--table-cell-inset)] align-top [--table-cell-inset:var(--panel-inset)] first:pl-[var(--panel-inset)] last:pr-[var(--panel-inset)]';

  const status = plan?.status ?? 'Draft';
  const totalHidden = lines.some((line) => line.rateHidden && !line.rate.trim());
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
      if (!l.vendorId && !l.vendorHidden) next[`${l.id}.vendor`] = t('errors.vendorRequired', 'Choose a vendor.');
      if (p.q === null || p.q <= 0) next[`${l.id}.quantity`] = t('errors.quantityInvalid', 'Enter a quantity above 0.');
      if (!l.rateHidden && (p.r === null || p.r < 0)) next[`${l.id}.rate`] = t('errors.rateInvalid', 'Enter a rate of 0 or more.');
      if (!l.dateFrom || !l.dateTo) next[`${l.id}.dates`] = t('errors.datesRequired', 'Choose the dates.');
      else if (l.dateTo < l.dateFrom) next[`${l.id}.dates`] = t('errors.dateOrder', 'The end cannot be before the start.');
      else if (l.dateFrom < month || l.dateTo > monthEnd(month)) next[`${l.id}.dates`] = t('errors.dateMonth', 'The dates must be inside the month.');
      if (!next[`${l.id}.description`] && !next[`${l.id}.vendor`] && p.q !== null && (l.rateHidden || p.r !== null)) {
        out.push({ id: l.id, workOrderId: l.workOrderId || null, categoryId: l.categoryId || null, description: l.description.trim(), quantity: p.q,
          ...(l.rateHidden ? {} : { rate: p.r! }), ...(l.vendorHidden ? {} : { vendorId: l.vendorId }), dateFrom: l.dateFrom, dateTo: l.dateTo });
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
      actions={<div className="flex flex-wrap gap-2">
        {editable && <Button variant="outline" size="sm" onClick={() => { const line = newLine(month); setLines((ls) => [...ls, line]); setOpen(new Set([line.id])); }}>{t('addLine', 'Add line')}</Button>}
        {editable && <Button variant="outline" size="sm" loading={m.save.isPending} disabled={busy} onClick={() => void save().then((ok) => { if (ok) toast(t('saved', 'Plan saved'), undefined, 'success'); })}>{t('save', 'Save draft')}</Button>}
        {editable && <Button variant="primary" size="sm" disabled={busy || lines.length === 0}
          onClick={() => void (async () => { if (await save()) await run(() => m.submit.mutateAsync(planId.current), t('submitted', 'Plan submitted')); })()}>{t('submit', 'Submit for approval')}</Button>}
        {status === 'Rejected' && isAuthor && plan && <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => m.reopen.mutateAsync(plan.id), t('reopened', 'Plan reopened'))}>{t('reopen', 'Reopen to edit')}</Button>}
        {status === 'Submitted' && canDecide && <Button variant="primary" size="sm" disabled={busy} onClick={() => setConfirmApprove(true)}>{t('approve', 'Approve and create orders')}</Button>}
        {status === 'Submitted' && canDecide && <Button variant="outline" size="sm" disabled={busy} onClick={() => setRejecting(true)}>{t('reject', 'Reject')}</Button>}
</div>}
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
      {/* The lines are one table: a line reads as a row; a line being added or edited (or one with a field to fix) opens in place as its form. */}
      {lines.length > 0 && <div className="-mx-[var(--panel-inset)] overflow-x-auto">
        <table className="w-full border-collapse text-control" aria-label={t('lines', 'Lines')}>
          {!narrow && <thead><tr className="h-[var(--table-head-height)] whitespace-nowrap border-b border-border bg-surface-table-head text-left font-semibold">
            <th scope="col" className={cellX}>{t('line.description', 'What is needed')}</th>
            {hasWorkOrder && <th scope="col" className={cellX}>{t('line.workOrder', 'Work order')}</th>}
            <th scope="col" className={cellX}>{t('line.vendor', 'Vendor')}</th>
            <th scope="col" className={cellX}>{t('line.dates', 'Dates')}</th>
            <th scope="col" className={cn(cellX, 'text-right')}>{t('line.quantity', 'Quantity')}</th>
            <th scope="col" className={cn(cellX, 'text-right')}>{t('line.rate', 'Rate')}</th>
            <th scope="col" className={cn(cellX, 'text-right')}>{t('line.amount', 'Amount')}</th>
            <th scope="col" className={cellX}><span className="sr-only">{t('line.actions', 'Line actions')}</span></th>
          </tr></thead>}
          <tbody>
            {lines.map((l, i) => {
              const p = parsed[i]!;
              const amount = p.q != null && p.r != null ? money(p.q * p.r) : '—';
              const hasError = Object.keys(errors).some((k) => k.startsWith(`${l.id}.`));
              const wo = woOptions.find((o) => o.value === l.workOrderId && o.value !== '')?.label;
              const cat = categoryOptions(l.categoryId).find((o) => o.value === l.categoryId && o.value !== '')?.label;
              const vendor = (vendors.data ?? []).find((o) => o.value === l.vendorId)?.label;
              const orderLink = l.procurementId && <Link className="text-primary-text hover:underline" to={`/procurement/${l.procurementId}`} data-testid="plan-line-order">{t('line.orderOpen', 'Open order')} · {formatDay(l.dateFrom)}</Link>;
              if (editable && (open.has(l.id) || hasError)) return (
                <tr key={l.id} className="border-b border-border/70" data-testid="plan-line">
                  <td colSpan={narrow ? 1 : hasWorkOrder ? 8 : 7} className="px-[var(--panel-inset)] py-4">
                    <p className="mb-3 font-semibold">{t('line.title', 'Line {{n}}', { n: i + 1 })}</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="sm:col-span-2"><TextField label={t('line.description', 'What is needed')} value={l.description} onChange={(v) => patch(l.id, { description: v })} error={errors[`${l.id}.description`]} fullWidth /></div>
                      <Combobox label={t('line.vendor', 'Vendor')} noun="vendor" value={l.vendorId} selectedOption={(vendors.data ?? []).find((o) => o.value === l.vendorId) ?? null}
                        onChange={(v) => patch(l.id, { vendorId: v })} loadOptions={async () => vendors.data ?? []} error={errors[`${l.id}.vendor`]} disabled={vendors.isPending} />
                      <SelectField label={t('line.workOrder', 'Work order')} value={l.workOrderId} onChange={(v) => patch(l.id, { workOrderId: v })} options={woOptions} fullWidth />
                      <SelectField label={t('line.category', 'Category')} value={l.categoryId} onChange={(v) => patch(l.id, { categoryId: v })} options={categoryOptions(l.categoryId)} fullWidth />
                      <NumberField label={t('line.quantity', 'Quantity')} value={l.quantity} onChange={(v) => patch(l.id, { quantity: v })} error={errors[`${l.id}.quantity`]} fullWidth />
                      <NumberField label={t('line.rate', 'Rate')} value={l.rate} onChange={(v) => patch(l.id, { rate: v })} error={errors[`${l.id}.rate`]} fullWidth />
                      <DateField label={t('line.from', 'From')} value={l.dateFrom} min={month} max={monthEnd(month)} onChange={(v) => patch(l.id, { dateFrom: v })} error={errors[`${l.id}.dates`]} fullWidth />
                      <DateField label={t('line.to', 'To')} value={l.dateTo} min={l.dateFrom || month} max={monthEnd(month)} onChange={(v) => patch(l.id, { dateTo: v })} fullWidth />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setOpen((o) => { const n = new Set(o); n.delete(l.id); return n; })}>{t('line.done', 'Done')}</Button>
                      <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>{t('line.remove', 'Remove line')}</Button>
                      <span className="ml-auto tabular-nums">{t('line.amount', 'Amount')}: <span className="font-semibold">{amount}</span></span>
                    </div>
                  </td>
                </tr>
              );
              const actions = <span className="flex justify-end gap-1">
                {orderLink}
                {editable && <Button variant="ghost" size="sm" aria-label={t('line.editLabel', 'Edit line {{n}}', { n: i + 1 })} onClick={() => setOpen((o) => new Set(o).add(l.id))}>{t('line.edit', 'Edit')}</Button>}
                {editable && <Button variant="ghost" size="sm" aria-label={t('line.removeLabel', 'Remove line {{n}}', { n: i + 1 })} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>{t('line.removeShort', 'Remove')}</Button>}
              </span>;
              const dates = `${formatDay(l.dateFrom)} – ${formatDay(l.dateTo)}`;
              if (narrow) return (
                <tr key={l.id} className="border-b border-border/70" data-testid="plan-line">
                  <td className="px-[var(--panel-inset)] py-3">
                    <p className="font-semibold">{l.description || '—'}</p>
                    <p className="text-muted-foreground">{[vendor, wo, cat].filter(Boolean).join(' · ')}</p>
                    <p className="text-muted-foreground">{dates}</p>
                    <p className="mt-1 flex justify-between tabular-nums"><span>{l.quantity} × {p.r != null ? money(p.r) : '—'}</span><span className="font-semibold">{amount}</span></p>
                    <div className="mt-1">{actions}</div>
                  </td>
                </tr>
              );
              return (
                <tr key={l.id} className="border-b border-border/70" data-testid="plan-line">
                  <th scope="row" className={cn(cellX, 'py-3 text-left font-semibold')}>{l.description || '—'}{cat && <span className="block font-normal text-muted-foreground">{cat}</span>}</th>
                  {hasWorkOrder && <td className={cn(cellX, 'py-3')}>{wo ?? '—'}</td>}
                  <td className={cn(cellX, 'py-3')}>{vendor ?? '—'}</td>
                  <td className={cn(cellX, 'whitespace-nowrap py-3')}>{dates}</td>
                  <td className={cn(cellX, 'py-3 text-right tabular-nums')}>{p.q != null ? p.q : '—'}</td>
                  <td className={cn(cellX, 'whitespace-nowrap py-3 text-right tabular-nums')}>{p.r != null ? money(p.r) : '—'}</td>
                  <td className={cn(cellX, 'whitespace-nowrap py-3 text-right tabular-nums')}>{amount}</td>
                  <td className={cn(cellX, 'py-2')}>{actions}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            {!narrow && <td colSpan={hasWorkOrder ? 6 : 5} className={cn(cellX, 'py-3 text-right font-semibold')}>{t('total', 'Month total')}</td>}
            <td colSpan={narrow ? 1 : 1} className={cn(cellX, 'whitespace-nowrap py-3 text-right font-semibold tabular-nums')} data-testid="plan-total">
              {narrow && <span className="mr-2">{t('total', 'Month total')}</span>}{totalHidden ? '—' : money(total)}</td>
            {!narrow && <td />}
          </tr></tfoot>
        </table>
      </div>}
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
  const [month, setMonth] = useState(monthStart(orgDayDate()));
  const plans = usePlansForMonth(month, settings.data?.enabled === true);
  const plan = plans.data?.find((p) => p.projectId === projectId) ?? null;
  const months = monthOptions();

  return (
    <div>
      <BackBar label={t('back', 'Procurement')} onBack={() => navigate('/procurement')} />
      <ListPage title={t('title', 'Monthly equipment plan')}
        help={settings.data?.enabled ? <HelpPopover subject={t('title', 'Monthly equipment plan')}><p>{t('intro', 'Plan the equipment and services a project needs for the month.')}</p></HelpPopover> : undefined}
        filters={settings.data?.enabled ? <div className="flex flex-wrap items-end gap-3">
          <div className="w-72"><Combobox label={t('project', 'Project')} noun="project" placeholder={t('chooseProject', 'Choose a project')} value={projectId}
            selectedOption={(projects.data ?? []).find((o) => o.value === projectId) ?? null} onChange={setProjectId} loadOptions={async () => projects.data ?? []} disabled={projects.isPending} /></div>
          <div className="w-44"><SelectField label={t('month', 'Month')} value={month} onChange={setMonth} options={months.some((o) => o.value === month) ? months : [...months, { value: month, label: month }]} /></div>
        </div> : undefined}
        view={settings.data?.enabled && isAdmin ? <Link className={buttonClasses('outline', 'sm')} to="/equipment-plans/settings">{t('settingsLink', 'Plan settings')}</Link> : undefined}>
        {settings.isError && <ListState variant="error" title={t('loadError', "Couldn't load the plans")} onRetry={() => void settings.refetch()} />}
        {settings.data && !settings.data.enabled && (
          <p className="text-muted-foreground" data-testid="plan-off">
            {t('off', 'The monthly plan is not turned on for your organisation.')}{' '}
            {isAdmin && <Link className="text-primary-text underline" to="/equipment-plans/settings">{t('offAdmin', 'Turn it on in the plan settings.')}</Link>}
          </p>
        )}
        {settings.data?.enabled && (
          <RecordStack>
            {!projectId && <p className="text-muted-foreground">{t('pickProject', 'Choose a project to see its plan for the month.')}</p>}
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
      </ListPage>
    </div>
  );
};
export default EquipmentPlansPage;
