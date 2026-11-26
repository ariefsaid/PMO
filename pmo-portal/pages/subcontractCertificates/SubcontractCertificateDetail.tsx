import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, buttonClasses, ConfirmDialog, DataTable, DateField, EntityFormModal, ErrBanner, FormGrid, ListState, ReasonDialog, RecordHeader, RecordSection, RecordStack,
  SelectField, StatusPill, TextField, useToast, type Column, type RecordMenuItem, type SubmitError,
} from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { can } from '@/src/auth/policy';
import { useProject } from '@/src/hooks/useProjects';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCertificateMutations, useCertificateView, useOpenBackcharges } from '@/src/hooks/useSubcontractCertificates';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { formatCurrencyCents, formatDay, formatMonthYearShort } from '@/src/lib/format';
import { waitingForText, waitingRoleLabel } from '@/src/lib/approvals/waitingFor';
import type { CertificateView, ExcludedSource, MeasuredDay } from '@/src/lib/db/subcontractCertificates';
import { BACKCHARGE_REASON_DEFAULT, REASON_CODES, STATUS_DEFAULT, STATUS_VARIANT } from './certificateUi';
import { useCertificateErrorText } from './useCertificateErrorText';

type Dialog = 'return' | 'cancel' | 'bill' | 'backcharge' | { setAside: MeasuredDay } | null;

const REASON_DEFAULTS: Record<string, string> = {
  unrated_no_rate: 'No agreed rate for this month',
  unrated_currency: 'The agreed rate is in another currency than the purchase order',
  unrated_unit: 'The agreed rate is for another unit than the purchase order',
  unrated_above_po_rate: 'The agreed rate is above the purchase order rate',
  not_vendor_crew: 'Not this subcontractor\'s crew',
  report_not_validated: 'The daily report is not validated yet',
  report_superseded: 'The daily report was replaced by a correction',
  item_not_on_po: 'The item is not on the purchase order',
  already_certified: 'Already in another certificate',
  deselected: 'Set aside by the preparer',
};

const SubcontractCertificateDetail: React.FC = () => {
  const { certificateId } = useParams<{ certificateId: string }>();
  const query = useCertificateView(certificateId);
  const { t } = useTranslation('subcontractCertificates');
  const navigate = useNavigate();
  const back = <div className="hidden max-[920px]:block"><BackBar label={t('subcontractCertificates:title', 'Progress certificates')} onBack={() => navigate('/subcontract-certificates')} /></div>;
  if (query.isPending) return (<>{back}<ListState variant="loading" rows={6} /></>);
  if (query.isError) return (<>{back}<ListState variant="error" title={t('subcontractCertificates:detail.error', "Couldn't load this certificate")} onRetry={() => void query.refetch()} /></>);
  if (!query.data?.certificate) return (<>{back}<ListState variant="empty" icon="reports" title={t('subcontractCertificates:detail.notFound', 'Certificate not found')} /></>);
  return (<>{back}<CertificateRecord view={query.data} /></>);
};

const CertificateRecord: React.FC<{ view: CertificateView }> = ({ view }) => {
  const { t } = useTranslation(['subcontractCertificates', 'status', 'waitingList']);
  const { toast } = useToast();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole, effectiveRole } = useEffectiveRole();
  const { certificate: c, derived: d } = view;
  const project = useProject(c.project_id).data ?? null;
  const vendors = useVendorOptions();
  const errorText = useCertificateErrorText();
  const m = useCertificateMutations();
  const open = useOpenBackcharges(c.vendor_company_id, c.project_id);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [include, setInclude] = useState('');
  const viewOnly = realRole !== effectiveRole;
  const ctx = { realRole, currentUserId: userId, record: { viewOnly, project_manager_id: project?.project_manager_id ?? null, prepared_by: c.prepared_by, submitted_by: c.submitted_by } };
  const editable = (c.status === 'draft' || c.status === 'returned') && can('prepare', 'subcontractCertificate', ctx);
  const mayPrepare = can('prepare', 'subcontractCertificate', ctx);
  const mayApprove = c.status === 'submitted' && can('approve', 'subcontractCertificate', ctx);
  const mayReturn = c.status === 'submitted' && can('return', 'subcontractCertificate', ctx);
  const mayBill = c.status === 'approved' && can('bill', 'subcontractCertificate', ctx);
  const sameApprover = c.status === 'submitted' && can('return', 'subcontractCertificate', { realRole }) && (userId === c.prepared_by || userId === c.submitted_by);
  const vendor = (vendors.data ?? []).find((v) => v.value === c.vendor_company_id)?.label ?? '—';
  const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatCurrencyCents(v, c.currency));
  const itemCode = useMemo(() => new Map(d.lines.map((l) => [l.boq_item_id, l.item_code])), [d.lines]);

  // fix-waiting item 3: who the submitted certificate waits for (1186: Admin, Executive or Finance; preparer/submitter excluded).
  const waitingLine = c.status === 'submitted'
    ? waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t) }, t)
    : null;

  const run = async (work: () => Promise<unknown>, success: string) => {
    try { await work(); toast(success, vendor, 'success'); setDialogError(null); return true; } catch (err) {
      const text = errorText(err);
      toast(t('subcontractCertificates:notSaved', 'Not saved'), text, 'warning');
      setDialogError(text);
      return false;
    }
  };
  const bill = async (date: string, reference: string) => {
    try {
      const result = await m.bill.mutateAsync({ certificateId: c.id, invoiceDate: date, referenceNumber: reference || null });
      if (result.status === 'refused') { setDialogError(result.message ?? t('subcontractCertificates:errors.other', 'Not saved')); return false; }
      toast(t('subcontractCertificates:toast.billed', 'Bill created'), vendor, 'success');
      return true;
    } catch (err) { setDialogError(errorText(err)); return false; }
  };

  const lineColumns: Column<CertificateView['derived']['lines'][number]>[] = [
    { key: 'item', header: t('subcontractCertificates:col.item', 'Item'), rowHeader: true, cell: (l) => l.item_code },
    { key: 'qty', header: t('subcontractCertificates:col.measured', 'Measured'), align: 'num', kind: 'number', cell: (l) => `${l.measured_quantity} ${l.unit}` },
    { key: 'rate', header: t('subcontractCertificates:col.rate', 'Rate'), align: 'num', kind: 'money', cell: (l) => money(l.rate) },
    { key: 'amount', header: t('subcontractCertificates:col.amount', 'Amount'), align: 'num', kind: 'money', cell: (l) => money(l.amount) },
    ...(editable || c.status === 'submitted' ? [{
      key: 'cap', header: t('subcontractCertificates:col.cap', 'Signed acceptance'), cell: (l: CertificateView['derived']['lines'][number]) => (l.verified === undefined ? '—' : l.cap_ok
        ? t('subcontractCertificates:cap.ok', 'Covered')
        : t('subcontractCertificates:cap.short', { defaultValue: 'Verified {{verified}} of {{needed}} needed', verified: l.verified, needed: (l.certified_to_date ?? 0) })),
    }] : []),
  ];
  const excludedColumns: Column<ExcludedSource>[] = [
    { key: 'item', header: t('subcontractCertificates:col.item', 'Item'), rowHeader: true, cell: (x) => x.item_code },
    { key: 'day', header: t('subcontractCertificates:col.day', 'Day'), cell: (x) => formatDay(x.work_date) },
    { key: 'qty', header: t('subcontractCertificates:col.measured', 'Measured'), align: 'num', kind: 'number', cell: (x) => x.quantity },
    { key: 'reason', header: t('subcontractCertificates:col.reason', 'Why it is left out'), cell: (x) => (
      <span>{t(`subcontractCertificates:reason.${x.reason}`, REASON_DEFAULTS[x.reason] ?? x.reason)}
        {x.reason === 'already_certified' && x.certificate_id && x.period_start
          ? <> · <Link className="text-primary-text hover:underline" to={`/subcontract-certificates/${x.certificate_id}`}>{formatMonthYearShort(x.period_start)}</Link></>
          : null}</span>) },
    ...(editable ? [{ key: 'back', header: '', cell: (x: ExcludedSource) => (x.reason === 'deselected' && x.crew_id
      ? <Button size="sm" variant="ghost" onClick={() => void run(() => m.setDeselection.mutateAsync({ certificateId: c.id, workDate: x.work_date, workOrderLineId: x.work_order_line_id, crewId: x.crew_id as string, deselect: false }), t('subcontractCertificates:toast.putBack', 'Put back'))}>{t('subcontractCertificates:putBack', 'Put back')}</Button>
      : null) }] : []),
  ];
  const dayColumns: Column<MeasuredDay>[] = [
    { key: 'item', header: t('subcontractCertificates:col.item', 'Item'), rowHeader: true, cell: (x) => itemCode.get(x.boq_item_id) ?? '—' },
    { key: 'day', header: t('subcontractCertificates:col.day', 'Day'), cell: (x) => formatDay(x.work_date) },
    { key: 'qty', header: t('subcontractCertificates:col.measured', 'Measured'), align: 'num', kind: 'number', cell: (x) => x.quantity },
    { key: 'aside', header: '', cell: (x) => <Button size="sm" variant="ghost" onClick={() => { setDialogError(null); setDialog({ setAside: x }); }}>{t('subcontractCertificates:setAside', 'Set aside')}</Button> },
  ];

  const submitAction = () => void run(() => m.submit.mutateAsync(c.id), t('subcontractCertificates:toast.submitted', 'Submitted for approval'));
  const approveAction = () => void run(() => m.approve.mutateAsync(c.id), t('subcontractCertificates:toast.approved', 'Approved'));
  const primaryAction = editable
    ? <Button variant="primary" size="sm" onClick={submitAction} loading={m.submit.isPending}>{t('subcontractCertificates:actions.submit', 'Submit')}</Button>
    : mayApprove
      ? <div className="flex items-center gap-2">
          {mayReturn && <Button variant="outline" size="sm" onClick={() => { setDialogError(null); setDialog('return'); }}>{t('subcontractCertificates:actions.return', 'Return')}</Button>}
          <Button variant="primary" size="sm" onClick={approveAction} loading={m.approve.isPending}>{t('subcontractCertificates:actions.approve', 'Approve')}</Button>
        </div>
      : mayReturn
        ? <Button variant="outline" size="sm" onClick={() => { setDialogError(null); setDialog('return'); }}>{t('subcontractCertificates:actions.return', 'Return')}</Button>
        : mayBill
          ? <Button variant="primary" size="sm" onClick={() => { setDialogError(null); setDialog('bill'); }}>{t('subcontractCertificates:actions.bill', 'Create bill')}</Button>
          : c.status === 'billed' && c.invoice_id
            // The bill lives in the purchase's ledger (its Files tab).
            ? <Link className={buttonClasses('primary', 'sm')} to={`/procurement/${c.procurement_id}/files`}>{t('subcontractCertificates:actions.openBill', 'Open bill')}</Link>
            : undefined;
  const live = mayPrepare && c.status !== 'cancelled' && c.status !== 'billed';
  const menuItems: RecordMenuItem[] = [
    ...(live ? [{ key: 'acceptance', label: t('subcontractCertificates:actions.acceptance', 'Prepare acceptance'), onSelect: () => void run(() => m.prepareAcceptance.mutateAsync(c.id), t('subcontractCertificates:toast.acceptance', 'Draft acceptance prepared')) }] : []),
    { key: 'print', label: t('subcontractCertificates:actions.print', 'Print'), onSelect: () => window.print() },
    ...(live ? [{ key: 'cancel', danger: true, label: t('subcontractCertificates:actions.cancel', 'Cancel certificate'), onSelect: () => { setDialogError(null); setDialog('cancel'); } }] : []),
  ];

  // Backcharges are rows with an amount: one table, the amount in a right-aligned money column.
  const backchargeColumns: Column<CertificateView['derived']['backcharges'][number]>[] = [
    { key: 'reason', header: t('subcontractCertificates:reasonLabel', 'Reason'), rowHeader: true,
      cell: (b) => <span>{t(`subcontractCertificates:backchargeReason.${b.reason_code}`, BACKCHARGE_REASON_DEFAULT[b.reason_code] ?? b.reason_code)}{b.reason_text && <span className="block text-muted-foreground">{b.reason_text}</span>}</span> },
    { key: 'amount', header: t('subcontractCertificates:col.amount', 'Amount'), align: 'num', kind: 'money', cell: (b) => money(b.amount) },
    ...(editable ? [{ key: 'remove', header: <span className="sr-only">{t('subcontractCertificates:remove', 'Remove')}</span>, kind: 'actions' as const,
      cell: (b: CertificateView['derived']['backcharges'][number]) => <Button size="sm" variant="ghost" onClick={() => void run(() => m.setBackcharge.mutateAsync({ certificateId: c.id, backchargeId: b.id, include: false }), t('subcontractCertificates:toast.removed', 'Backcharge removed'))}>{t('subcontractCertificates:remove', 'Remove')}</Button> }] : []),
  ];

  const includedIds = new Set(d.backcharges.map((b) => b.id));
  const freeBackcharges = (open.data ?? []).filter((b) => !includedIds.has(b.id) && (b.claimed_by_certificate_id === null) && b.currency === c.currency);

  return (
    <div className="max-sm:pb-[var(--mobile-action-bar-height,0px)]">
      <RecordHeader
        panelInset
        name={`${vendor} · ${formatMonthYearShort(c.period_start)}`}
        status={<span data-testid="spc-status" data-status={c.status}><StatusPill variant={STATUS_VARIANT[c.status]}>{t(`subcontractCertificates:status.${c.status}`, STATUS_DEFAULT[c.status])}</StatusPill></span>}
        meta={project ? <Link to={`/projects/${project.id}`} className="text-primary-text hover:underline">{project.name}</Link> : undefined}
        stats={[
          { label: t('subcontractCertificates:stat.gross', 'Certified work'), value: <span data-testid="spc-gross">{money(d.gross)}</span> },
          { label: t('subcontractCertificates:stat.backcharge', 'Backcharges'), value: <span data-testid="spc-backcharge">{money(d.backcharge_total)}</span> },
          { label: t('subcontractCertificates:stat.net', 'Payable'), value: <span data-testid="spc-net" className="text-metric">{money(d.net)}</span> },
        ]}
        // One filled action for the state the certificate is in; the rest in the menu (screen rules: record pages).
        primaryAction={primaryAction}
        menuItems={menuItems}
        menuLabel={t('subcontractCertificates:moreActions', 'More certificate actions')}
      >
        {waitingLine || sameApprover ? <>
          {waitingLine && <p className="font-medium text-foreground" role="status" data-testid="spc-waiting-for">{waitingLine}</p>}
          {sameApprover && <p role="status">{t('subcontractCertificates:errors.needsDifferentApprover', 'A certificate needs a different approver than the person who prepared and submitted it.')}</p>}
        </> : null}
      </RecordHeader>
      {c.status === 'returned' && c.returned_reason && <ErrBanner title={t('subcontractCertificates:returned', 'Returned for changes')} sub={c.returned_reason} />}
      {c.bill_refusal && <ErrBanner title={t('subcontractCertificates:billRefused', 'The bill was refused')} sub={c.bill_refusal} />}
      <RecordStack>
        <RecordSection flush={d.lines.length > 0} title={t('subcontractCertificates:section.lines', 'Measured work at the agreed rates')}>
          {d.lines.length === 0
            ? <p className="text-sm text-muted-foreground">{t('subcontractCertificates:noLines', 'Nothing measured and rated this month.')}</p>
            : <DataTable embedded accessibleName={t('subcontractCertificates:section.lines', 'Measured work at the agreed rates')} columns={lineColumns} rows={d.lines} rowKey={(l) => l.boq_item_id} tableId="subcontract-certificate-lines" />}
        </RecordSection>
        {editable && (d.tuples?.length ?? 0) > 0 && (
          <RecordSection flush title={t('subcontractCertificates:section.days', 'Measured days')}>
            <DataTable embedded accessibleName={t('subcontractCertificates:section.days', 'Measured days')} columns={dayColumns} rows={d.tuples ?? []} rowKey={(x) => `${x.work_date}:${x.work_order_line_id}:${x.crew_id}`} tableId="subcontract-certificate-days" />
          </RecordSection>
        )}
        <RecordSection flush={d.excluded.length > 0} title={t('subcontractCertificates:section.excluded', 'Left out')}>
          {d.excluded.length === 0
            ? <p className="text-sm text-muted-foreground">{t('subcontractCertificates:noExcluded', 'Nothing is left out.')}</p>
            : <DataTable embedded accessibleName={t('subcontractCertificates:section.excluded', 'Left out')} columns={excludedColumns} rows={d.excluded} rowKey={(x) => `${x.work_date}:${x.work_order_line_id}:${x.reason}:${x.crew_id ?? ''}`} tableId="subcontract-certificate-excluded" />}
        </RecordSection>
        <RecordSection title={t('subcontractCertificates:section.backcharges', 'Backcharges')}
          actions={editable ? <Button size="sm" variant="outline" onClick={() => { setDialogError(null); setDialog('backcharge'); }}>{t('subcontractCertificates:recordBackcharge', 'Record a backcharge')}</Button> : undefined}>
          {d.backcharges.length === 0
            ? <p className="text-sm text-muted-foreground">{t('subcontractCertificates:noBackcharges', 'No backcharges in this certificate.')}</p>
            : <DataTable embedded accessibleName={t('subcontractCertificates:section.backcharges', 'Backcharges')} columns={backchargeColumns} rows={d.backcharges} rowKey={(b) => b.id} tableId="subcontract-certificate-backcharges" />}
          {editable && freeBackcharges.length > 0 && (
            <div className="mt-3 flex items-end gap-2 print:hidden">
              <SelectField label={t('subcontractCertificates:includeBackcharge', 'Include a recorded backcharge')} value={include} onChange={setInclude}
                options={[{ value: '', label: t('subcontractCertificates:chooseBackcharge', 'Choose one') },
                  ...freeBackcharges.map((b) => ({ value: b.id, label: `${t(`subcontractCertificates:backchargeReason.${b.reason_code}`, BACKCHARGE_REASON_DEFAULT[b.reason_code] ?? b.reason_code)} · ${money(b.amount)}` }))]} />
              <Button variant="outline" disabled={!include} onClick={() => void run(() => m.setBackcharge.mutateAsync({ certificateId: c.id, backchargeId: include, include: true }), t('subcontractCertificates:toast.included', 'Backcharge included')).then((ok) => { if (ok) setInclude(''); })}>{t('subcontractCertificates:include', 'Include')}</Button>
            </div>
          )}
        </RecordSection>
      </RecordStack>

      <ReasonDialog open={dialog === 'return'} kind="return" subject={t('subcontractCertificates:subject', 'certificate')} error={dialogError} loading={m.returnToPreparer.isPending}
        onCancel={() => setDialog(null)} onConfirm={(reason) => void run(() => m.returnToPreparer.mutateAsync({ id: c.id, reason }), t('subcontractCertificates:toast.returned', 'Returned')).then((ok) => { if (ok) setDialog(null); })} />
      <ReasonDialog open={dialog === 'cancel'} kind="reject" subject={t('subcontractCertificates:subject', 'certificate')} title={t('subcontractCertificates:cancelTitle', 'Cancel this certificate?')}
        confirmLabel={t('subcontractCertificates:actions.cancel', 'Cancel certificate')} error={dialogError} loading={m.cancel.isPending}
        onCancel={() => setDialog(null)} onConfirm={(reason) => void run(() => m.cancel.mutateAsync({ id: c.id, reason }), t('subcontractCertificates:toast.cancelled', 'Cancelled')).then((ok) => { if (ok) setDialog(null); })} />
      <ReasonDialog open={typeof dialog === 'object' && dialog !== null && 'setAside' in dialog} kind="return" title={t('subcontractCertificates:setAsideTitle', 'Set this day aside?')}
        label={t('subcontractCertificates:setAsideReason', 'Why')} confirmLabel={t('subcontractCertificates:setAside', 'Set aside')} error={dialogError}
        onCancel={() => setDialog(null)} onConfirm={(reason) => {
          const day = typeof dialog === 'object' && dialog !== null && 'setAside' in dialog ? dialog.setAside : null;
          if (!day) return;
          void run(() => m.setDeselection.mutateAsync({ certificateId: c.id, workDate: day.work_date, workOrderLineId: day.work_order_line_id, crewId: day.crew_id, deselect: true, reason }),
            t('subcontractCertificates:toast.setAside', 'Set aside')).then((ok) => { if (ok) setDialog(null); });
        }} />
      {dialog === 'bill' && <BillDialog loading={m.bill.isPending} error={dialogError} net={money(d.net)} onClose={() => setDialog(null)}
        onConfirm={(date, ref) => void bill(date, ref).then((ok) => { if (ok) setDialog(null); })} />}
      {dialog === 'backcharge' && <BackchargeModal certificateId={c.id} vendorId={c.vendor_company_id} projectId={c.project_id} workOrderId={c.work_order_id} currency={c.currency} onClose={() => setDialog(null)} />}
    </div>
  );
};

const BillDialog: React.FC<{ loading: boolean; error: string | null; net: string; onClose: () => void; onConfirm: (date: string, reference: string) => void }> = ({ loading, error, net, onClose, onConfirm }) => {
  const { t } = useTranslation('subcontractCertificates');
  const today = useOrgToday();
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState('');
  return (
    <ConfirmDialog open title={t('subcontractCertificates:billTitle', 'Create the supplier bill?')} confirmLabel={t('subcontractCertificates:actions.bill', 'Create bill')}
      description={(
        <div className="space-y-3">
          <p>{t('subcontractCertificates:billBody', { defaultValue: 'The bill is created from the approved lines. The payable is {{net}} after backcharges.', net })}</p>
          <DateField label={t('subcontractCertificates:billDate', 'Bill date')} value={date} onChange={setDate} />
          <TextField label={t('subcontractCertificates:billReference', 'Reference')} value={reference} onChange={setReference} />
        </div>
      )}
      loading={loading} error={error} confirmDisabled={!date} onConfirm={() => onConfirm(date, reference.trim())} onCancel={onClose} />
  );
};

const BackchargeModal: React.FC<{ certificateId: string; vendorId: string; projectId: string; workOrderId: string; currency: string; onClose: () => void }> = ({ certificateId, vendorId, projectId, workOrderId, currency, onClose }) => {
  const { t } = useTranslation('subcontractCertificates');
  const { toast } = useToast();
  const m = useCertificateMutations();
  const errorText = useCertificateErrorText();
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState<string>('rework');
  const [text, setText] = useState('');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const value = Number(amount);
  const valid = amount !== '' && Number.isFinite(value) && value > 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    try {
      const id = await m.recordBackcharge.mutateAsync({ vendorId, projectId, workOrderId, amount: value, currency, reasonCode: code, reasonText: text.trim() || null });
      await m.setBackcharge.mutateAsync({ certificateId, backchargeId: id, include: true });
      toast(t('subcontractCertificates:toast.included', 'Backcharge included'), undefined, 'success');
      onClose();
    } catch (err) { setSubmitError({ headline: t('subcontractCertificates:notSaved', 'Not saved'), detail: errorText(err) }); }
  };
  return (
    <EntityFormModal open title={t('subcontractCertificates:recordBackcharge', 'Record a backcharge')} submitLabel={t('subcontractCertificates:saveBackcharge', 'Record and include')}
      onSubmit={(e) => void submit(e)} onClose={onClose} loading={m.recordBackcharge.isPending || m.setBackcharge.isPending} dirty={Boolean(amount || text)} submitDisabled={!valid} submitError={submitError}>
      <FormGrid>
        <TextField label={t('subcontractCertificates:amount', { defaultValue: 'Amount ({{currency}})', currency })} required inputMode="decimal" value={amount} onChange={setAmount} />
        <SelectField label={t('subcontractCertificates:reasonLabel', 'Reason')} value={code} onChange={setCode}
          options={REASON_CODES.map((r) => ({ value: r, label: t(`subcontractCertificates:backchargeReason.${r}`, BACKCHARGE_REASON_DEFAULT[r] ?? r) }))} />
        <TextField label={t('subcontractCertificates:note', 'Note')} value={text} onChange={setText} />
      </FormGrid>
    </EntityFormModal>
  );
};

export default SubcontractCertificateDetail;
