import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, DataTable, EntityFormModal, FormGrid, Icon, ListPage, ListState, SelectField, StatusPill, Tabs, TextField, tabId, tabPanelId, useToast,
  useUrlFilters, type Column, type SubmitError,
} from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { can } from '@/src/auth/policy';
import { usePermission } from '@/src/auth/usePermission';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useCertificateMutations, useCertificates, useRateLines, useSubcontractPos } from '@/src/hooks/useSubcontractCertificates';
import { repositories } from '@/src/lib/repositories';
import { useQuery } from '@tanstack/react-query';
import { formatCurrencyCents, formatMonthYearShort } from '@/src/lib/format';
import { useCertificateErrorText } from './useCertificateErrorText';
import type { CertificateRow, CertificateStatus, RateLineRow, SubcontractPoOption } from '@/src/lib/db/subcontractCertificates';
import { STATUSES, STATUS_DEFAULT, STATUS_VARIANT, monthStart } from './certificateUi';

type View = 'certificates' | 'rates';

/** New certificate: a subcontract purchase order and a calendar month. The server derives everything else. */
const NewCertificateModal: React.FC<{
  onClose: () => void;
  eligiblePos: SubcontractPoOption[];
  canPreparePo: (po: SubcontractPoOption) => boolean;
  isLoading?: boolean;
  isError?: boolean;
}> = ({ onClose, eligiblePos, canPreparePo, isLoading, isError }) => {
  const { t } = useTranslation('subcontractCertificates');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { prepare } = useCertificateMutations();
  const errorText = useCertificateErrorText();
  const [poId, setPoId] = useState('');
  const [month, setMonth] = useState('');
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const chosenPo = eligiblePos.find((p) => p.po_id === poId);
  const lawfulChoice = Boolean(chosenPo && canPreparePo(chosenPo));
  const valid = Boolean(poId && monthStart(month) && lawfulChoice && !isLoading && !isError);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const start = monthStart(month);
    if (!poId || !start || !lawfulChoice || isLoading || isError) return;
    prepare.mutate({ poId, periodStart: start }, {
      onSuccess: (id) => { toast(t('subcontractCertificates:created', 'Certificate prepared'), undefined, 'success'); onClose(); navigate(`/subcontract-certificates/${id}`); },
      onError: (err) => setSubmitError({ headline: t('subcontractCertificates:notSaved', 'Not saved'), detail: errorText(err) }),
    });
  };
  return (
    <EntityFormModal open title={t('subcontractCertificates:newTitle', 'New certificate')} submitLabel={t('subcontractCertificates:prepare', 'Prepare certificate')}
      onSubmit={submit} onClose={onClose} loading={prepare.isPending || isLoading} dirty={Boolean(poId || month)} submitDisabled={!valid} submitError={submitError}>
      <FormGrid>
        <SelectField label={t('subcontractCertificates:po', 'Subcontract purchase order')} required value={poId} onChange={setPoId}
          options={[{ value: '', label: t('subcontractCertificates:choosePo', 'Choose a purchase order') },
            ...eligiblePos.map((p) => ({ value: p.po_id, label: `${p.po_number ?? p.po_id.slice(0, 8)} · ${p.title}` }))]} />
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
  const navigate = useNavigate();
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
      <StatusPill variant={STATUS_VARIANT[r.status]}>{t(`subcontractCertificates:status.${r.status}`, STATUS_DEFAULT[r.status])}</StatusPill>) },
    { key: 'gross', header: t('subcontractCertificates:col.gross', 'Certified'), align: 'num', kind: 'money', cell: (r) => (r.gross === null ? '—' : formatCurrencyCents(r.gross, r.currency)) },
    { key: 'backcharge', header: t('subcontractCertificates:col.backcharge', 'Backcharges'), align: 'num', kind: 'money', cell: (r) => (r.backcharge_total === null ? '—' : formatCurrencyCents(r.backcharge_total, r.currency)) },
    { key: 'net', header: t('subcontractCertificates:col.net', 'Payable'), align: 'num', kind: 'money', cell: (r) => (r.net === null ? '—' : formatCurrencyCents(r.net, r.currency)) },
  ];
  if (query.isPending) return <ListState variant="loading" rows={5} />;
  if (query.isError) return <ListState variant="error" title={t('subcontractCertificates:error', "Couldn't load certificates")} onRetry={() => void query.refetch()} />;
  const { rows, hasMore } = query.data;
  return (
    <div>
      {/* The one filter is a toolbar control above the table, not a form field. */}
      <div className="mb-3 flex items-center">
        <SelectField compact inline hideLabel label={t('subcontractCertificates:filter.status', 'Status')} value={status} onChange={(v) => { setOffset(0); setFilter('status', v); }}
          options={[{ value: '', label: t('subcontractCertificates:filter.allStatuses', 'All statuses') }, ...STATUSES.map((s) => ({ value: s, label: t(`subcontractCertificates:status.${s}`, STATUS_DEFAULT[s]) }))]} />
      </div>
      {rows.length === 0 && status ? (
        <ListState variant="empty" icon="reports" title={t('subcontractCertificates:emptyFiltered', 'No certificates in this status')}
          action={{ label: t('subcontractCertificates:clearFilter', 'Show all'), onClick: () => { setOffset(0); setFilter('status', ''); } }} />
      ) : rows.length === 0 ? (
        <ListState variant="empty" icon="reports" title={t('subcontractCertificates:empty', 'No certificates yet')}
          action={canPrepare ? { label: t('subcontractCertificates:new', 'New certificate'), onClick: onNew } : { label: t('subcontractCertificates:openProcurement', 'Open subcontract purchase orders'), onClick: () => navigate('/procurement') }} sub={!canPrepare ? t('subcontractCertificates:prepareRemedy', 'Certificates are prepared from subcontract purchase orders by Finance or the project manager.') : undefined} />
      ) : (
        <DataTable accessibleName={t('subcontractCertificates:title', 'Progress certificates')} columns={columns} rows={rows} rowKey={(r) => r.id} tableId="subcontract-certificates-table" />
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
    { key: 'rate', header: t('subcontractCertificates:rate', 'Rate'), align: 'num', kind: 'money', cell: (r) => `${formatCurrencyCents(r.rate, r.currency)} / ${r.unit}` },
    { key: 'from', header: t('subcontractCertificates:effectiveFrom', 'From month'), cell: (r) => formatMonthYearShort(r.effective_from) },
    { key: 'to', header: t('subcontractCertificates:effectiveTo', 'Until'), cell: (r) => (r.effective_to ? formatMonthYearShort(r.effective_to) : t('subcontractCertificates:open', 'Open')) },
  ];
  if (rates.isPending) return <ListState variant="loading" rows={4} />;
  if (rates.isError) return <ListState variant="error" title={t('subcontractCertificates:rateError', "Couldn't load the rate card")} onRetry={() => void rates.refetch()} />;
  if (rates.data.length === 0) {
    return <ListState variant="empty" icon="reports" title={t('subcontractCertificates:rateEmpty', 'No rates set yet')}
      action={canManage ? { label: t('subcontractCertificates:addRate', 'Set a rate'), onClick: onNew } : undefined} />;
  }
  return <DataTable accessibleName={t('subcontractCertificates:rateCard', 'Rate card')} columns={columns} rows={rates.data} rowKey={(r) => r.id} tableId="subcontract-rate-card-table" />;
};

/** `/subcontract-certificates` (#2584): the certificates, and the subcontractor rate card the server prices them from. */
const SubcontractCertificatesPage: React.FC = () => {
  const { t } = useTranslation('subcontractCertificates');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const { currentUser } = useAuth();
  const userId = currentUser?.id ?? null;
  const viewOnly = realRole !== effectiveRole;

  const posQuery = useSubcontractPos();
  const projectsQuery = useProjectPickerOptions();

  const projectManagerByProjectId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of projectsQuery.data ?? []) {
      map.set(p.id, p.project_manager_id);
    }
    return map;
  }, [projectsQuery.data]);

  const canPrepareRole = can('prepare', 'subcontractCertificate', {
    realRole,
    currentUserId: userId,
    record: { viewOnly },
  });

  const canPrepareForProject = useCallback((projectManagerId: string | null | undefined): boolean => {
    return can('prepare', 'subcontractCertificate', {
      realRole,
      currentUserId: userId,
      record: { viewOnly, project_manager_id: projectManagerId ?? null },
    });
  }, [realRole, userId, viewOnly]);

  const canPreparePo = useCallback((po: SubcontractPoOption): boolean => {
    if (canPrepareRole) return true;
    if (!po.project_id) return false;
    const pmId = projectManagerByProjectId.get(po.project_id);
    return canPrepareForProject(pmId);
  }, [canPrepareRole, projectManagerByProjectId, canPrepareForProject]);

  const isPosPendingOrError = posQuery.isPending || posQuery.isError;
  const isProjectsPendingOrError = projectsQuery.isPending || projectsQuery.isError;
  const isPendingOrError = canPrepareRole ? isPosPendingOrError : (isPosPendingOrError || isProjectsPendingOrError);

  const eligiblePos = useMemo(() => {
    if (isPendingOrError) return [];
    return (posQuery.data ?? []).filter(canPreparePo);
  }, [isPendingOrError, posQuery.data, canPreparePo]);

  // Certificate offer: Admin/Finance retain existing behavior (canPrepareRole, unless viewOnly).
  // A Project Manager is offered New certificate only when managing an eligible project with lawful PO selection,
  // and never during pending or error states.
  const canPrepare = canPrepareRole || (!isPendingOrError && eligiblePos.length > 0);

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
      {dialog === 'certificate' && (
        <NewCertificateModal
          onClose={() => setDialog(null)}
          eligiblePos={eligiblePos}
          canPreparePo={canPreparePo}
          isLoading={canPrepareRole ? posQuery.isPending : (posQuery.isPending || projectsQuery.isPending)}
          isError={canPrepareRole ? posQuery.isError : (posQuery.isError || projectsQuery.isError)}
        />
      )}
      {dialog === 'rate' && <RateModal onClose={() => setDialog(null)} />}
    </ListPage>
  );
};
export default SubcontractCertificatesPage;
