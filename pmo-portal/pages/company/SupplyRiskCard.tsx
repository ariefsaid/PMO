/**
 * #2583 — the supplier's supply-risk panel on the company page: the stored status (a human decision), the payables-age
 * SUGGESTION beside it with a one-click "Set to suggested", and the work orders exposed to the supplier. The status is
 * saved only through `set_vendor_supply_status` (Admin/Finance, audited); `can('set', 'supplyRisk')` mirrors that gate
 * and is UX only. The suggestion never changes the status (FR-VSR-009).
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Card, CardHead, CardPad, FieldError, SelectField, StatusPill, TextArea, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useSetSupplyRiskStatus, useSupplierExposure, useSupplyRiskSetterName, useSupplyRiskSuggestion } from '@/src/hooks/useSupplyRisk';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import { supplyRiskLabel, supplyRiskPillVariant } from '@/src/lib/supplyRiskLabels';
import type { SupplyRiskStatus, SupplyRiskSuggestion } from '@/src/lib/supplyRisk';
import type { CompanyRow } from '@/src/lib/db/companies';

const STATUSES: SupplyRiskStatus[] = ['active', 'at_risk', 'inactive'];
const REASON_MAX = 500;

export const SupplyRiskCard: React.FC<{ company: CompanyRow }> = ({ company }) => {
  const { t } = useTranslation('supplyRisk');
  const may = usePermission();
  const canView = may('view', 'supplyRisk');
  const canSet = may('set', 'supplyRisk');
  const { toast } = useToast();
  const stored = (company.supply_risk_status ?? 'active') as SupplyRiskStatus;
  const [status, setStatus] = useState<SupplyRiskStatus>(stored);
  const [reason, setReason] = useState(company.supply_risk_reason ?? '');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();
  const suggestion = useSupplyRiskSuggestion(company.id, canView);
  const exposure = useSupplierExposure(company.id, canView);
  const setter = useSupplyRiskSetterName(company.supply_risk_set_by);
  const mutation = useSetSupplyRiskStatus(company.id);

  if (!canView) return null;

  const label = (s: SupplyRiskStatus) => supplyRiskLabel(t as never, s);
  const needsReason = status !== 'active';
  const reasonMissing = needsReason && reason.trim() === '';
  const tooLong = reason.trim().length > REASON_MAX;
  const suggested = suggestion.data?.suggestedStatus ?? null;
  const differs = suggested !== null && suggested !== stored;

  const save = () => {
    setError(undefined);
    setTouched(true);
    if (reasonMissing || tooLong) return;
    mutation.mutate(
      { status, reason: reason.trim() === '' ? null : reason.trim() },
      {
        onSuccess: () => toast(t('saved', 'Supplier status saved'), undefined, 'success'),
        onError: (err) => {
          const classified = classifyMutationError(err);
          setError(classified.detail || classified.headline);
        },
      },
    );
  };

  const workOrders = (exposure.data ?? []).filter((r) => r.kind === 'work_order');
  const projectLevel = (exposure.data ?? []).filter((r) => r.kind === 'project');

  return (
    <div data-testid="supply-risk">
      <Card variant="bare" className="mb-4">
        <CardHead>{t('title', 'Supply risk')}</CardHead>
        <CardPad>
          <p className="mb-3 text-control text-muted-foreground">
            {t('hint', 'Whether we can rely on this supplier. A person sets it; the age of unpaid invoices only suggests.')}
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="supply-risk-current">
            <StatusPill variant={supplyRiskPillVariant(stored)}>{label(stored)}</StatusPill>
            {company.supply_risk_set_at && (
              <span className="text-control text-muted-foreground">
                {setter.data
                  ? t('setBy', 'Set by {{name}} on {{date}}', { name: setter.data, date: formatInstantDate(company.supply_risk_set_at) })
                  : t('setOn', 'Set on {{date}}', { date: formatInstantDate(company.supply_risk_set_at) })}
              </span>
            )}
          </div>
          {stored !== 'active' && company.supply_risk_reason && (
            <p className="mb-3 text-control" data-testid="supply-risk-reason">
              {t('reasonShown', 'Reason: {{reason}}', { reason: company.supply_risk_reason })}
            </p>
          )}

          <p className="mb-1 text-control" data-testid="supply-risk-suggestion">
            {suggestion.isPending ? t('suggestion.loading', 'Reading unpaid invoices…') : suggestionSentence(t, suggestion.data ?? null)}
          </p>
          {suggestion.data && suggestion.data.unknownCount > 0 && (
            <p className="mb-1 text-control text-muted-foreground">
              {t('suggestion.unknown', { count: suggestion.data.unknownCount, defaultValue_one: '{{count}} purchase has an unpaid amount that is not known and is not counted.', defaultValue_other: '{{count}} purchases have an unpaid amount that is not known and are not counted.' })}
            </p>
          )}
          {differs && (
            <p className="mb-2 text-control text-muted-foreground" data-testid="supply-risk-differs">
              {t('suggestion.differs', 'The stored status is {{status}}; it differs from the suggestion.', { status: label(stored).toLowerCase() })}
            </p>
          )}

          {canSet ? (
            <form
              className="mt-3 grid max-w-xl grid-cols-1 gap-3"
              onSubmit={(event) => { event.preventDefault(); save(); }}
            >
              <SelectField
                label={t('form.status', 'Status')}
                value={status}
                onChange={(v) => setStatus(v as SupplyRiskStatus)}
                disabled={mutation.isPending}
                options={STATUSES.map((s) => ({ value: s, label: label(s) }))}
              />
              {needsReason && (
                <TextArea
                  label={t('form.reason', 'Reason')}
                  required
                  rows={2}
                  maxLength={REASON_MAX}
                  value={reason}
                  onChange={(next) => { setTouched(true); setReason(next); }}
                  helper={t('form.reasonHelper', 'Say why. Required for At risk and Inactive.')}
                  disabled={mutation.isPending}
                  error={touched && reasonMissing ? t('form.reasonError', 'Say why') : undefined}
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <FieldError>{error}</FieldError>
                <Button type="submit" variant="primary" disabled={mutation.isPending || (status === stored && reason.trim() === (company.supply_risk_reason ?? ''))}>
                  {t('form.save', 'Save status')}
                </Button>
                {differs && suggested && status !== suggested && (
                  <Button type="button" variant="outline" onClick={() => { setStatus(suggested); setTouched(false); }} data-testid="supply-risk-set-suggested">
                    {t('setToSuggested', 'Set to suggested')}
                  </Button>
                )}
              </div>
            </form>
          ) : (
            <p className="mt-2 text-control text-muted-foreground">{t('onlyRoles', 'Only Admin or Finance can change this.')}</p>
          )}
        </CardPad>
      </Card>

      <Card variant="bare" className="mb-4" data-testid="supply-risk-exposure">
        <CardHead>{t('exposure.title', 'Work orders with open orders from this supplier')}</CardHead>
        <CardPad>
          {exposure.isPending ? (
            <p className="text-control text-muted-foreground">{t('exposure.loading', 'Loading…')}</p>
          ) : workOrders.length === 0 ? (
            <p className="text-control text-muted-foreground">{t('exposure.empty', 'No work order has an open order from this supplier.')}</p>
          ) : (
            <ul className="space-y-2">
              {workOrders.map((r) => (
                <li key={`${r.workOrderId}-${r.currency}`} className="flex flex-wrap items-baseline justify-between gap-2 text-control" data-testid="supply-risk-exposed-wo">
                  <span>
                    <Link to={`/work-orders/${r.workOrderId}`} className="font-medium underline-offset-2 hover:underline">
                      {r.woNumber ? `${r.woNumber} · ${r.title}` : r.title}
                    </Link>
                    <span className="ml-2 text-muted-foreground">{r.projectName}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {t('exposure.orders', { count: r.openOrderCount, defaultValue_one: '{{count}} open order', defaultValue_other: '{{count}} open orders' })}
                    {r.orderTotal != null && r.currency ? ` · ${formatCurrency(r.orderTotal, r.currency)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {projectLevel.length > 0 && (
            <div className="mt-4" data-testid="supply-risk-project-level">
              <p className="mb-1 text-control font-medium">{t('exposure.projectLevel', 'Project-level orders (no work order named)')}</p>
              <ul className="space-y-1">
                {projectLevel.map((r) => (
                  <li key={`${r.projectId}-${r.currency}`} className="text-control text-muted-foreground">
                    {r.projectName}
                    {' · '}
                    {t('exposure.orders', { count: r.openOrderCount, defaultValue_one: '{{count}} open order', defaultValue_other: '{{count}} open orders' })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardPad>
      </Card>
    </div>
  );
};

type T = ReturnType<typeof useTranslation>['t'];

/** The plain sentence the basis supports (FR-VSR-010): the ERP basis has no invoice count, so none is claimed. */
function suggestionSentence(t: T, s: SupplyRiskSuggestion | null): string {
  if (!s) return t('suggestion.unavailable', 'No suggestion is available.');
  if (s.noAgingData) return t('suggestion.noData', 'No aging data for this supplier in the accounting system.');
  const over = s.currencies.filter((c) => c.over60Amount > 0);
  if (s.suggestedStatus === 'at_risk') {
    const amount = over.map((c) => formatCurrency(c.over60Amount, c.currency)).join(' + ');
    if (s.basis === 'erp') {
      return t('suggestion.atRiskErp', 'Suggested: at risk, {{amount}} over 60 days', { amount });
    }
    const count = over.reduce((n, c) => n + (c.invoiceCount ?? 0), 0);
    return t('suggestion.atRiskPmo', {
      count, amount,
      defaultValue_one: 'Suggested: at risk, {{count}} invoice over 60 days, {{amount}}',
      defaultValue_other: 'Suggested: at risk, {{count}} invoices over 60 days, {{amount}}',
    });
  }
  return t('suggestion.active', 'Suggested: active, no unpaid balance is over 60 days old');
}
