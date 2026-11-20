import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, DataTable, EntityFormModal, FormGrid, Icon, ListPage, ListState, SelectField, StatusPill, Tabs, TextField, tabId, tabPanelId, useToast,
  useUrlFilters, type Column, type SubmitError,
} from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCertificateMutations, useCertificates, useRateLines, useSubcontractPos } from '@/src/hooks/useSubcontractCertificates';
import { repositories } from '@/src/lib/repositories';
import { useQuery } from '@tanstack/react-query';
import { formatCurrency, formatMonthYearShort } from '@/src/lib/format';
import { certificateErrorMessage, type CertificateErrorKey } from '@/src/lib/subcontracts/certificateErrors';
import type { CertificateRow, CertificateStatus, RateLineRow } from '@/src/lib/db/subcontractCertificates';
import { STATUSES, STATUS_VARIANT, monthStart } from './certificateUi';

type View = 'certificates' | 'rates';

export function useCertificateErrorText() {
  const { t } = useTranslation('subcontractCertificates');
  return (err: unknown) => certificateErrorMessage(err, (key: CertificateErrorKey) => t(`subcontractCertificates:errors.${key}`, errorDefaults[key]));
}

const errorDefaults: Record<CertificateErrorKey, string> = {
  needsDifferentApprover: 'A certificate needs a different approver than the person who prepared and submitted it.',
  overCap: 'This is more than the signed acceptance and the purchase order allow.',
  alreadyCertified: 'Some of this work or backcharge is already in another live certificate.',
  alreadyBilled: 'This certificate is already submitted or billed.',
  netNegative: 'The backcharges are more than the certified work, so the net would be negative.',
  unrated: 'Some measured work has no usable rate. Rate it or set it aside first.',
  empty: 'Nothing measured and rated to certify in this period.',
  notAllowed: 'You are not allowed to do this.',
  periodExists: 'A certificate already exists for this purchase order and month.',
  rateWindow: 'This rate window overlaps another rate line for the same vendor and item.',
  rateMonthStart: 'A rate takes effect on the first day of a month and ends on the last day of a month.',
  erpDeduction: 'This organisation records bills in its ERP; a certificate with backcharges waits for the ERP route.',
  other: 'Not saved.',
};

/** New certificate: a subcontract purchase order and a calendar month. The server derives everything else. */
const NewCertificateModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('subcontractCertificates');
  const { toast } = useToast();
  const navigate = useNavigate();
  const pos = useSubcontractPos();
  const { prepare } = useCertificateMutations();
  const errorText = useCertificateErrorText();
  const [poId, setPoId] = useState('');
  const [month, setMonth] = useState('');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const start = monthStart(month);
    if (!poId || !start) return;
    prepare.mutate({ poId, periodStart: start }, {
      onSuccess: (id) => { toast(t('subcontractCertificates:created', 'Certificate prepared'), undefined, 'success'); onClose(); navigate(`/subcontract-certificates/${id}`); },
      onError: (err) => setSubmitError({ headline: t('subcontractCertificates:notSaved', 'Not saved'), detail: errorText(err) }),
    });
  };
  return (
    <EntityFormModal open title={t('subcontractCertificates:newTitle', 'New certificate')} submitLabel={t('subcontractCertificates:prepare', 'Prepare certificate')}
      onSubmit={submit} onClose={onClose} loading={prepare.isPending} dirty={Boolean(poId || month)} submitDisabled={!poId || !monthStart(month)} submitError={submitError}>
      <FormGrid>
        <SelectField label={t('subcontractCertificates:po', 'Subcontract purchase order')} required value={poId} onChange={setPoId}
          options={[{ value: '', label: t('subcontractCertificates:choosePo', 'Choose a purchase order') },
            ...(pos.data ?? []).map((p) => ({ value: p.po_id, label: `${p.po_number ?? p.po_id.slice(0, 8)} · ${p.title}` }))]} />
        <TextField label={t('subcontractCertificates:month', 'Month')} required type="month" value={month} onChange={setMonth} />
      </FormGrid>
    </EntityFormModal>
  );
};

/** Add or change a rate from a month (FR-SPC-001/002): the previous open line ends the day before. */
const RateModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation('subcontractCertificates');
  const { toast } = useToast();
  const pos = useSubcontractPos();
  const { setRate } = useCertificateMutations();
  const errorText = useCertificateErrorText();
  const [poId, setPoId] = useState('');
  const [itemId, setItemId] = useState('');
  const [rate, setRateValue] = useState('');
  const [month, setMonth] = useState('');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const po = (pos.data ?? []).find((p) => p.po_id === poId);
  const position = useQuery({
    queryKey: ['subcontract-certificates', 'po-items', poId],
    queryFn: () => repositories.subcontracts.getPoPosition(poId),
    enabled: Boolean(poId),
  });
  const item = (position.data ?? []).find((r) => r.boq_item_id === itemId);
  const amount = Number(rate);
  const valid = Boolean(po?.vendor_id && item && monthStart(month) && rate !== '' && Number.isFinite(amount) && amount >= 0);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const start = monthStart(month);
    if (!po?.vendor_id || !item || !start) return;
    setRate.mutate({ vendorId: po.vendor_id, boqItemId: item.boq_item_id, unit: item.unit, rate: amount, currency: po.currency, effectiveFrom: start }, {
      onSuccess: () => { toast(t('subcontractCertificates:rateSaved', 'Rate saved'), undefined, 'success'); onClose(); },
      onError: (err) => setSubmitError({ headline: t('subcontractCertificates:notSaved', 'Not saved'), detail: errorText(err) }),
    });
  };
  return (
    <EntityFormModal open title={t('subcontractCertificates:rateTitle', 'Set a rate')} submitLabel={t('subcontractCertificates:saveRate', 'Save rate')}
      onSubmit={submit} onClose={onClose} loading={setRate.isPending} dirty={Boolean(poId || itemId || rate || month)} submitDisabled={!valid} submitError={submitError}>
      <FormGrid>
        <SelectField label={t('subcontractCertificates:po', 'Subcontract purchase order')} required value={poId} onChange={(v) => { setPoId(v); setItemId(''); }}
          options={[{ value: '', label: t('subcontractCertificates:choosePo', 'Choose a purchase order') },
            ...(pos.data ?? []).map((p) => ({ value: p.po_id, label: `${p.po_number ?? p.po_id.slice(0, 8)} · ${p.title}` }))]} />
        <SelectField label={t('subcontractCertificates:item', 'Contract item')} required value={itemId} onChange={setItemId}
          options={[{ value: '', label: t('subcontractCertificates:chooseItem', 'Choose an item') },
            ...(position.data ?? []).map((r) => ({ value: r.boq_item_id, label: `${r.item_code} · ${r.description}` }))]} />
        <TextField label={t('subcontractCertificates:rate', 'Rate')} required inputMode="decimal" value={rate} onChange={setRateValue}
          helper={item ? t('subcontractCertificates:rateHelper', { defaultValue: 'Per {{unit}}, {{currency}}. The purchase order rate is {{po}}.', unit: item.unit, currency: po?.currency ?? '', po: item.rate }) : undefined} />
        <TextField label={t('subcontractCertificates:effectiveFrom', 'From month')} required type="month" value={month} onChange={setMonth} />
      </FormGrid>
    </EntityFormModal>
  );
};

const CertificateList: React.FC<{ onNew: () => void; canPrepare: boolean }> = ({ onNew, canPrepare }) => {
  const { t } = useTranslation('subcontractCertificates');
  const { values, setFilter } = useUrlFilters(['status']);
  const status = (STATUSES as string[]).includes(values.status ?? '') ? (values.status as CertificateStatus) : '';
  const [offset, setOffset] = useState(0);
  const query = useCertificates({ status, offset });
  const vendors = useVendorOptions();
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.value, v.label])), [vendors.data]);
  const columns: Column<CertificateRow>[] = [
    { key: 'period', header: t('subcontractCertificates:col.period', 'Period'), rowHeader: true, cell: (r) => (
      <Link className="text-primary-text hover:underline" to={`/subcontract-certificates/${r.id}`}>{formatMonthYearShort(r.period_start)}</Link>) },
    { key: 'vendor', header: t('subcontractCertificates:col.vendor', 'Subcontractor'), cell: (r) => vendorName.get(r.vendor_company_id) ?? '—' },
    { key: 'status', header: t('subcontractCertificates:col.status', 'Status'), cell: (r) => (
      <StatusPill variant={STATUS_VARIANT[r.status]}>{t(`subcontractCertificates:status.${r.status}`, r.status)}</StatusPill>) },
    { key: 'gross', header: t('subcontractCertificates:col.gross', 'Certified'), align: 'num', kind: 'money', cell: (r) => (r.gross === null ? '—' : formatCurrency(r.gross, r.currency, { precision: 'minor' })) },
    { key: 'backcharge', header: t('subcontractCertificates:col.backcharge', 'Backcharges'), align: 'num', kind: 'money', cell: (r) => (r.backcharge_total === null ? '—' : formatCurrency(r.backcharge_total, r.currency, { precision: 'minor' })) },
    { key: 'net', header: t('subcontractCertificates:col.net', 'Payable'), align: 'num', kind: 'money', cell: (r) => (r.net === null ? '—' : formatCurrency(r.net, r.currency, { precision: 'minor' })) },
  ];
  if (query.isPending) return <ListState variant="loading" rows={5} />;
  if (query.isError) return <ListState variant="error" title={t('subcontractCertificates:error', "Couldn't load certificates")} onRetry={() => void query.refetch()} />;
  const { rows, hasMore } = query.data;
  return (
    <div>
      <div className="mb-3 max-w-xs">
        <SelectField label={t('subcontractCertificates:filter.status', 'Status')} value={status} onChange={(v) => { setOffset(0); setFilter('status', v); }}
          options={[{ value: '', label: t('subcontractCertificates:filter.all', 'All') }, ...STATUSES.map((s) => ({ value: s, label: t(`subcontractCertificates:status.${s}`, s) }))]} />
      </div>
      {rows.length === 0 ? (
        <ListState variant="empty" icon="reports" title={t('subcontractCertificates:empty', 'No certificates yet')}
          action={canPrepare ? { label: t('subcontractCertificates:new', 'New certificate'), onClick: onNew } : undefined} />
      ) : (
        <DataTable accessibleName={t('subcontractCertificates:title', 'Progress certificates')} columns={columns} rows={rows} rowKey={(r) => r.id} />
      )}
      <div className="mt-3 flex gap-2">
        {offset > 0 && <Button variant="outline" onClick={() => setOffset(Math.max(0, offset - 50))}>{t('subcontractCertificates:newer', 'Newer')}</Button>}
        {hasMore && <Button variant="outline" onClick={() => setOffset(offset + 50)}>{t('subcontractCertificates:older', 'Older')}</Button>}
      </div>
    </div>
  );
};

const RateCard: React.FC<{ canManage: boolean; onNew: () => void }> = ({ canManage, onNew }) => {
  const { t } = useTranslation('subcontractCertificates');
  const rates = useRateLines();
  const vendors = useVendorOptions();
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.value, v.label])), [vendors.data]);
  const columns: Column<RateLineRow>[] = [
    { key: 'vendor', header: t('subcontractCertificates:col.vendor', 'Subcontractor'), rowHeader: true, cell: (r) => vendorName.get(r.vendor_company_id) ?? '—' },
    { key: 'item', header: t('subcontractCertificates:item', 'Contract item'), cell: (r) => r.boq_item_id.slice(0, 8) },
    { key: 'rate', header: t('subcontractCertificates:rate', 'Rate'), align: 'num', kind: 'money', cell: (r) => `${formatCurrency(r.rate, r.currency, { precision: 'minor' })} / ${r.unit}` },
    { key: 'from', header: t('subcontractCertificates:effectiveFrom', 'From month'), cell: (r) => formatMonthYearShort(r.effective_from) },
    { key: 'to', header: t('subcontractCertificates:effectiveTo', 'Until'), cell: (r) => (r.effective_to ? formatMonthYearShort(r.effective_to) : t('subcontractCertificates:open', 'Open')) },
  ];
  if (rates.isPending) return <ListState variant="loading" rows={4} />;
  if (rates.isError) return <ListState variant="error" title={t('subcontractCertificates:rateError', "Couldn't load the rate card")} onRetry={() => void rates.refetch()} />;
  if (rates.data.length === 0) {
    return <ListState variant="empty" icon="reports" title={t('subcontractCertificates:rateEmpty', 'No rates set yet')}
      action={canManage ? { label: t('subcontractCertificates:addRate', 'Set a rate'), onClick: onNew } : undefined} />;
  }
  return <DataTable accessibleName={t('subcontractCertificates:rateCard', 'Rate card')} columns={columns} rows={rates.data} rowKey={(r) => r.id} />;
};

/** `/subcontract-certificates` (#2584): the certificates, and the subcontractor rate card the server prices them from. */
const SubcontractCertificatesPage: React.FC = () => {
  const { t } = useTranslation('subcontractCertificates');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;
  // The server decides per project; the button shows for the roles that can prepare anywhere (a PM is refused on other projects).
  const canPrepare = realRole === 'Admin' || realRole === 'Finance' || realRole === 'Project Manager' ? !viewOnly : false;
  const canManageRates = may('manage', 'subcontractRate', { record: { viewOnly } });
  const canSeeRates = may('view', 'subcontractRate');
  const { values, setFilter } = useUrlFilters(['view']);
  const view: View = values.view === 'rates' && canSeeRates ? 'rates' : 'certificates';
  const [dialog, setDialog] = useState<'certificate' | 'rate' | null>(null);
  const tabs = [
    { value: 'certificates' as View, label: t('subcontractCertificates:tabs.certificates', 'Certificates') },
    ...(canSeeRates ? [{ value: 'rates' as View, label: t('subcontractCertificates:tabs.rates', 'Rate card') }] : []),
  ];
  const primary = view === 'certificates' && canPrepare
    ? <Button variant="primary" onClick={() => setDialog('certificate')}><Icon name="plus" />{t('subcontractCertificates:new', 'New certificate')}</Button>
    : view === 'rates' && canManageRates
      ? <Button variant="primary" onClick={() => setDialog('rate')}><Icon name="plus" />{t('subcontractCertificates:addRate', 'Set a rate')}</Button>
      : undefined;
  return (
    <ListPage title={t('subcontractCertificates:title', 'Progress certificates')} primaryAction={primary}>
      {tabs.length > 1 && (
        <Tabs items={tabs} value={view} onChange={(v) => setFilter('view', v === 'certificates' ? '' : v)}
          ariaLabel={t('subcontractCertificates:tabsLabel', 'Certificate views')} idBase="spc" className="mb-4" />
      )}
      <div id={tabPanelId('spc', view)} role="tabpanel" aria-labelledby={tabId('spc', view)}>
        {view === 'certificates'
          ? <CertificateList canPrepare={canPrepare} onNew={() => setDialog('certificate')} />
          : <RateCard canManage={canManageRates} onNew={() => setDialog('rate')} />}
      </div>
      {dialog === 'certificate' && <NewCertificateModal onClose={() => setDialog(null)} />}
      {dialog === 'rate' && <RateModal onClose={() => setDialog(null)} />}
    </ListPage>
  );
};
export default SubcontractCertificatesPage;
