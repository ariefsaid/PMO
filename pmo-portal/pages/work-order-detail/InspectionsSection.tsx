import { useMayOrderPurchases } from '@/src/hooks/useOrderJobRoles';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Checkbox, ConfirmDialog, DateField, ListState, ReasonDialog, RecordSection, SelectField, TextField } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import {
  useInspectionCosts, useInspectionFilesBatch, useInspectionMutations, useWorkOrderInspections,
} from '@/src/hooks/useThirdPartyInspections';
import {
  INSPECTION_FILE_ALLOWED_MIME, INSPECTION_FILE_MAX_COUNT, inspectionFileRefusal, isInspectionBlocking,
  isInspectionComplete, isInspectionOverdue,
  type InspectionCostRow, type InspectionGate, type InspectionResult, type InspectionListRow, type InspectionFileRow,
} from '@/src/lib/db/thirdPartyInspections';
import { repositories } from '@/src/lib/repositories';
import { useRefusalText } from '@/src/lib/refusals';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatDateOnly, formatTableMoney } from '@/src/lib/format';

const RESULTS: InspectionResult[] = ['pass', 'fail', 'conditional'];

interface CardProps { inspection: InspectionListRow; costs: InspectionCostRow[]; workOrderId: string; today: string; liveFiles: InspectionFileRow[] }

/** One inspection: its state, its real cost beside the estimate, and the one next step the viewer may take. */
const InspectionCard: React.FC<CardProps> = ({ inspection: i, costs, workOrderId, today, liveFiles }) => {
  const { t } = useTranslation('workOrders');
  const refusal = useRefusalText();
  const can = usePermission();
  const { currentUser } = useAuth();
  const m = useInspectionMutations(workOrderId);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState<'waive' | 'cancel' | null>(null);
  const [confirmRaise, setConfirmRaise] = useState(false);
  const [on, setOn] = useState(today);
  const [who, setWho] = useState('');
  const [how, setHow] = useState('');
  const [result, setResult] = useState<InspectionResult | ''>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const ctx = { currentUserId: currentUser?.id ?? null, record: { status: i.status, required_for: i.required_for, created_by: i.created_by, waived_at: i.waived_at } };
  const mayAdvance = can('advance', 'thirdPartyInspection', ctx);
  const mayRaise = can('raise_purchase', 'thirdPartyInspection', ctx);
  const mayWaive = can('waive', 'thirdPartyInspection', ctx);
  const mayCancel = can('cancel', 'thirdPartyInspection', ctx);
  const mayOrder = useMayOrderPurchases();
  const mayOpenPurchase = can('view', 'procurement') || mayOrder;
  const mayAttach = can('create', 'thirdPartyInspection'); // the same roles; a reported inspection still takes a new file (FR-TPI-015)
  const fail = (e: unknown) => { const r = refusal(e, { context: { suppressCapture: true } }); setErr(r.detail || r.headline); };
  const run = (p: Promise<unknown>) => { setErr(null); p.catch(fail); };

  const money = costs.filter((c) => c.currency);
  const estimate = costs.find((c) => c.estimate != null);
  const overdue = isInspectionOverdue(i, today);
  const blocking = isInspectionBlocking(i);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const refusal = inspectionFileRefusal(file, liveFiles.length);
    if (refusal) { setErr(t(`inspections.fileRefused.${refusal}`, 'That file cannot be attached.')); return; }
    setErr(null);
    m.addFile.mutate({ inspection: i, file, liveCount: liveFiles.length }, { onError: fail });
  };
  const openFile = (path: string) => {
    const tab = window.open('', '_blank');
    if (!tab) return;
    tab.opener = null;
    void repositories.thirdPartyInspection.fileUrl(path).then((url) => { tab.location.href = url; }).catch((e: unknown) => { tab.close(); fail(e); });
  };

  return (
    <li className="flex flex-col gap-2 py-3" data-testid={`inspection-${i.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold">{i.title}</span>
        <span className="text-control" data-testid="inspection-status">{t(`inspections.status.${i.status}`, i.status)}</span>
        {i.status === 'reported' && <span className="text-control">{t(`inspections.result.${i.result}`, i.result)}</span>}
        {i.waived_at && <span className="text-control">{t('inspections.waived', 'Waived')}</span>}
        {overdue && <span className="text-control font-semibold text-destructive-text">{t('inspections.overdue', 'Overdue')}</span>}
        {blocking && <span className="text-control text-muted-foreground">{t('inspections.blocks', 'Required, not yet complete')}</span>}
        {isInspectionComplete(i) && i.required_for.length > 0 && <span className="text-control text-muted-foreground">{t('inspections.complete', 'Complete')}</span>}
      </div>
      <p className="text-control text-muted-foreground">
        {t('inspections.planned', 'Planned {{date}}', { date: formatDateOnly(i.planned_date) })}
        {i.test_kind ? ` · ${i.test_kind}` : ''}
        {i.required_for.length > 0 && ` · ${t('inspections.requiredFor', 'Required for {{gates}}', { gates: i.required_for.map((g) => t(`inspections.gate.${g}`, g)).join(', ') })}`}
      </p>
      {i.waiver_reason && <p className="text-control text-muted-foreground">{t('inspections.waiverReason', 'Waiver reason: {{reason}}', { reason: i.waiver_reason })}</p>}
      {i.cancel_reason && <p className="text-control text-muted-foreground">{t('inspections.cancelReason', 'Cancelled: {{reason}}', { reason: i.cancel_reason })}</p>}
      {i.procurement_id
        ? <p className="text-control" data-testid="inspection-cost">
            {(() => {
              const text = money.length === 0
                ? t('inspections.noCostYet', 'Purchase raised, no cost yet')
                : money.map((c) => t('inspections.cost', '{{committed}} committed, {{billed}} billed', {
                    committed: (formatTableMoney(c.committed ?? 0, c.currency as string) ?? '—'), billed: (formatTableMoney(c.billed ?? 0, c.currency as string) ?? '—'),
                  })).join(' · ');
              return mayOpenPurchase ? <Link className="underline" to={`/procurement/${encodeURIComponent(i.procurement_id)}`}>{text}</Link> : text;
            })()}
          </p>
        : <p className="text-control text-muted-foreground">{t('inspections.noPurchase', 'No purchase')}</p>}
      {estimate && estimate.estimate != null && estimate.estimate_currency && (
        <p className="text-control text-muted-foreground">{t('inspections.estimate', 'Estimate {{amount}} (a planning figure, not a cost)', { amount: (formatTableMoney(estimate.estimate, estimate.estimate_currency) ?? '—') })}</p>
      )}

      {liveFiles.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('inspections.files', 'Report files')}>
          {liveFiles.map((f) => (
            <li key={f.id}><button type="button" className="underline" onClick={() => openFile(f.file_path)}>{f.title ?? f.file_path.split('/').pop()}</button></li>
          ))}
        </ul>
      )}

      {/* the next step, by status */}
      {i.status === 'requested' && mayRaise && (
        <div><Button variant="primary" type="button" size="sm" disabled={m.raisePurchase.isPending}
          onClick={() => setConfirmRaise(true)}>{t('inspections.raisePurchase', 'Raise purchase')}</Button>
          <ConfirmDialog open={confirmRaise} title={t('inspections.raiseTitle', 'Raise a purchase for {{title}}', { title: i.title })}
            description={t('inspections.raiseHelp', 'Creates a draft purchase for this inspection. It opens from here once raised.')}
            confirmLabel={t('inspections.raisePurchase', 'Raise purchase')} loading={m.raisePurchase.isPending}
            onConfirm={() => { setConfirmRaise(false); run(m.raisePurchase.mutateAsync({ id: i.id })); }} onCancel={() => setConfirmRaise(false)} />
        </div>
      )}
      {i.status === 'purchase_raised' && mayAdvance && (
        <div className="flex flex-wrap items-end gap-2">
          <DateField label={t('inspections.invitedOn', 'Invitation date')} value={on} onChange={setOn} />
          <TextField label={t('inspections.invitedWho', 'Who was invited')} value={who} onChange={setWho} />
          <TextField label={t('inspections.invitedHow', 'How')} value={how} onChange={setHow} />
          <Button variant="primary" type="button" size="sm" disabled={!on || m.invite.isPending}
            onClick={() => run(m.invite.mutateAsync({ id: i.id, on, who: who || null, how: how || null }))}>{t('inspections.recordInvitation', 'Record invitation')}</Button>
        </div>
      )}
      {i.status === 'invited' && mayAdvance && (
        <div className="flex flex-wrap items-end gap-2">
          <DateField label={t('inspections.executedOn', 'Execution date')} value={on} onChange={setOn} />
          <Button variant="primary" type="button" size="sm" disabled={!on || m.execute.isPending}
            onClick={() => run(m.execute.mutateAsync({ id: i.id, on }))}>{t('inspections.recordExecution', 'Record execution')}</Button>
        </div>
      )}
      {(i.status === 'executed' || i.status === 'reported') && mayAttach && liveFiles.length < INSPECTION_FILE_MAX_COUNT && (
        <div className="flex flex-wrap items-end gap-2">
          <input ref={fileRef} type="file" accept={INSPECTION_FILE_ALLOWED_MIME.join(',')} className="sr-only"
            aria-label={t('inspections.fileInput', 'Report file')} data-testid="inspection-file-input" onChange={onPick} />
          <Button type="button" size="sm" variant="outline" disabled={m.addFile.isPending} onClick={() => fileRef.current?.click()}>
            {t('inspections.attach', 'Attach report')}
          </Button>
        </div>
      )}
      {i.status === 'executed' && mayAdvance && (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField label={t('inspections.resultLabel', 'Result')} value={result} onChange={(v) => setResult(v as InspectionResult | '')}
            options={[{ value: '', label: t('inspections.chooseResult', 'Choose a result') }, ...RESULTS.map((r) => ({ value: r, label: t(`inspections.result.${r}`, r) }))]} />
          <Button variant="primary" type="button" size="sm" disabled={!result || liveFiles.length === 0 || m.report.isPending}
            onClick={() => result && run(m.report.mutateAsync({ id: i.id, result }))}>{t('inspections.markReported', 'Mark reported')}</Button>
        </div>
      )}
      {(mayWaive || mayCancel) && (
        <div className="flex flex-wrap gap-2">
          {mayWaive && <Button type="button" size="sm" variant="outline" onClick={() => setReason('waive')}>{t('inspections.waive', 'Waive')}</Button>}
          {mayCancel && <Button type="button" size="sm" variant="ghost" onClick={() => setReason('cancel')}>{t('inspections.cancel', 'Cancel inspection')}</Button>}
        </div>
      )}
      {err && <p role="alert" className="text-control text-destructive-text">{err}</p>}
      <ReasonDialog open={reason !== null} kind="reject"
        title={reason === 'waive' ? t('inspections.waiveTitle', 'Waive this inspection') : t('inspections.cancelTitle', 'Cancel this inspection')}
        label={t('inspections.reasonLabel', 'Reason')}
        confirmLabel={reason === 'waive' ? t('inspections.waive', 'Waive') : t('inspections.cancel', 'Cancel inspection')}
        loading={m.waive.isPending || m.cancel.isPending}
        onCancel={() => setReason(null)}
        onConfirm={(text) => {
          const which = reason;
          setReason(null);
          if (which === 'waive') run(m.waive.mutateAsync({ id: i.id, reason: text }));
          else if (which === 'cancel') run(m.cancel.mutateAsync({ id: i.id, reason: text }));
        }} />
    </li>
  );
};

interface Props { workOrderId: string }

/** FR-TPI-001..017: a work order's third-party inspections, from request to report, with their real cost. */
export const InspectionsSection: React.FC<Props> = ({ workOrderId }) => {
  const { t } = useTranslation('workOrders');
  const refusal = useRefusalText();
  const can = usePermission();
  const list = useWorkOrderInspections(workOrderId);
  const files = useInspectionFilesBatch((list.data ?? []).filter(i => i.status === 'executed' || i.status === 'reported').map(i => i.id));
  const filesByInspection = new Map<string, InspectionFileRow[]>();
  for (const file of files.data ?? []) {
    const group = filesByInspection.get(file.inspection_id) ?? [];
    group.push(file);
    filesByInspection.set(file.inspection_id, group);
  }
  const costs = useInspectionCosts(workOrderId);
  const m = useInspectionMutations(workOrderId);
  const today = useOrgToday();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('');
  const [planned, setPlanned] = useState(today);
  const [gates, setGates] = useState<InspectionGate[]>([]);
  const [estimate, setEstimate] = useState('');
  const [currency, setCurrency] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const title0 = t('inspections.title', 'Third-party inspections');
  const mayCreate = can('create', 'thirdPartyInspection');
  const mayEstimate = can('raise_purchase', 'thirdPartyInspection', { record: { status: 'requested' } });

  if (list.isPending) return <RecordSection title={title0}><ListState variant="loading" rows={1} /></RecordSection>;
  if (list.isError) return <RecordSection title={title0}><ListState variant="error" title={t('inspections.error', "Couldn't load the inspections")} onRetry={() => void list.refetch()} /></RecordSection>;

  const rows = list.data ?? [];
  const blockingBilling = rows.filter((r) => isInspectionBlocking(r) && r.required_for.includes('billing')).length; // FR-TPI-017: display only
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const amount = estimate.trim() === '' ? null : Number(estimate);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || currency.trim().length !== 3)) {
      setErr(t('inspections.estimateInvalid', 'An estimate needs a valid amount and a 3-letter currency.'));
      return;
    }
    m.create.mutate({
      workOrderId, title: title.trim(), testKind: kind.trim() || null, plannedDate: planned, vendorId: null,
      estimate: amount, estimateCurrency: amount === null ? null : currency.trim().toUpperCase(), note: null, requiredFor: gates,
    }, {
      onSuccess: () => { setOpen(false); setTitle(''); setKind(''); setGates([]); setEstimate(''); setCurrency(''); },
      onError: (e2) => { const r = refusal(e2, { context: { suppressCapture: true } }); setErr(r.detail || r.headline); },
    });
  };
  const toggle = (g: InspectionGate) => setGates((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  return (
    <RecordSection title={title0} actions={mayCreate && !open
      ? <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>{t('inspections.request', 'Request inspection')}</Button> : undefined}>
      {open && (
        <form className="mb-3 flex flex-col gap-2" onSubmit={submit} aria-label={t('inspections.request', 'Request inspection')}>
          <TextField label={t('inspections.titleField', 'What is being tested')} value={title} onChange={setTitle} required />
          <TextField label={t('inspections.kind', 'Test kind')} value={kind} onChange={setKind} />
          <DateField label={t('inspections.plannedField', 'Planned date')} value={planned} onChange={setPlanned} required />
          <fieldset className="flex flex-wrap gap-3">
            <legend className="text-control font-semibold">{t('inspections.requiredLegend', 'Required before')}</legend>
            {(['readiness', 'billing'] as InspectionGate[]).map((g) => (
              <span key={g} className="flex items-center gap-1.5 text-control">
                <Checkbox checked={gates.includes(g)} onChange={() => toggle(g)} label={t(`inspections.gate.${g}`, g)} />
                {t(`inspections.gate.${g}`, g)}
              </span>
            ))}
          </fieldset>
          {mayEstimate && (
            <div className="flex flex-wrap gap-2">
              <TextField label={t('inspections.estimateField', 'Estimate (planning figure)')} value={estimate} onChange={setEstimate} inputMode="decimal" />
              <TextField label={t('inspections.currencyField', 'Currency')} value={currency} onChange={setCurrency} maxLength={3} />
            </div>
          )}
          {err && <p role="alert" className="text-control text-destructive-text">{err}</p>}
          <div className="flex gap-2">
            <Button variant="primary" type="submit" size="sm" disabled={!title.trim() || !planned || m.create.isPending}>{t('inspections.create', 'Request')}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('inspections.dismiss', 'Close')}</Button>
          </div>
        </form>
      )}
      {blockingBilling > 0 && (
        <p className="mb-2 text-control" data-testid="inspections-billing-open">
          {t('inspections.billingOpen', 'Billing is waiting on {{count}} required inspection(s)', { count: blockingBilling })}
        </p>
      )}
      {rows.length === 0
        ? <p className="text-control text-muted-foreground">{t('inspections.empty', 'No third-party inspections on this work order yet.')}</p>
        : <ul className="divide-y divide-border" data-testid="wo-inspections">
            {rows.map((r) => (
              <InspectionCard key={r.id} inspection={r} workOrderId={workOrderId} today={today}
                liveFiles={filesByInspection.get(r.id) ?? []}
                costs={(costs.data ?? []).filter((c) => c.inspection_id === r.id)} />
            ))}
          </ul>}
    </RecordSection>
  );
};
