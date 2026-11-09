import { buttonClasses } from '@/src/components/ui/buttonClasses';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon, StatusPill, Button, type StatusVariant } from '@/src/components/ui';
import { tierLabel } from './integrationLabels';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { formatInstantDate } from '@/src/lib/format';
import type { ErpSetupReadiness, ExternalTier, IntegrationBinding } from '@/src/lib/repositories/types';
import { getErpSetupIncompleteness } from './erpSetupIncompleteness';
import { ErpSetupChecklist } from './ErpSetupChecklist';
import { IntegrationHealthPanel } from './IntegrationHealthPanel';
import type { TierHealthState } from './useIntegrationsHealth';

/**
 * The per-tier connection card of the organization integrations surface (extracted from
 * IntegrationsView, #1941). Pure presentation + permission-gated actions: every mutation and every
 * org-scoped read stays in the view, which passes resolved data and action callbacks down.
 *
 * The card renders the connection state pill (AC-IRUX-001: unknown on a failed binding read),
 * the connector identity line (#680), the ERPNext activation picker affordance (OD-INT-6), the
 * health panel (AC-IRUX-003/004), the setup checklist (Admin) and the Connect/Disconnect actions.
 */
interface TierConnectionCardProps {
  tier: Exclude<ExternalTier, 'odoo'>;
  /** Resolved binding, or undefined when the binding read failed (the state is then UNKNOWN). */
  binding: IntegrationBinding | undefined;
  /** True when the org binding read failed (AC-IRUX-001). */
  bindingReadFailed: boolean;
  healthState: TierHealthState;
  onHealthRetry: () => void;
  /** ERPNext setup readiness; always undefined for ClickUp (the setup query is ERPNext-scoped). */
  erpSetup: ErpSetupReadiness | undefined;
  /** True when the ERPNext setup read failed (the pill says so instead of "Checking setup"). */
  erpSetupUnavailable: boolean;
  /** #680: resolved same-org display names keyed by the stored `connected_by` actor value. */
  connectorNamesById: Map<string, string>;
  orgId: string | undefined;
  onConnect: (tier: ExternalTier) => void;
  onDisconnect: (tier: ExternalTier) => void;
  /** OD-INT-6: open the ERPNext Company picker (activation). */
  onSelectCompany: (tier: ExternalTier) => void;
  onRetryStatus: () => void;
}

export const TierConnectionCard: React.FC<TierConnectionCardProps> = ({
  tier,
  binding,
  bindingReadFailed,
  healthState,
  onHealthRetry,
  erpSetup,
  erpSetupUnavailable,
  connectorNamesById,
  orgId,
  onConnect,
  onDisconnect,
  onSelectCompany,
  onRetryStatus,
}) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManageIntegrations = may('manage', 'integration');

  const isConnected = binding?.status === 'active';
  const isDisconnected = binding?.status === 'disconnected';
  const showConnect = !isConnected; // show connect when not active (disconnected or never connected)
  const showDisconnect = isConnected && !bindingReadFailed;

  // AC-IRUX-001: on a failed binding read the connection state is UNKNOWN, never inferred
  // "Disconnected"/"Not connected". We also never offer Disconnect from an unknown binding.
  let pillVariant: StatusVariant = 'neutral';
  let pillLabel = t('integrations.organization.readiness.bindUnknown', 'Connection state unavailable');
  if (!bindingReadFailed) {
    if (tier === 'erpnext' && isConnected && !binding?.config?.company) {
      pillVariant = 'warn';
      pillLabel = t('integrations.organization.readiness.erpActivation.pending', 'Awaiting activation: select a Company to activate');
    } else if (isConnected) {
      pillVariant = 'won';
      pillLabel = t('integrations.organization.readiness.connected', 'Connected');
    } else if (isDisconnected) {
      pillVariant = 'lost';
      pillLabel = t('integrations.organization.readiness.disconnected', 'Disconnected');
    } else {
      pillVariant = 'neutral';
      pillLabel = t('integrations.organization.readiness.notConnected', 'Not connected');
    }
  }

  // OD-INT-6: Check if ERPNext is connected but not activated (no company selected)
  const isConnectedButNotActivated = !bindingReadFailed && tier === 'erpnext' && isConnected && !binding?.config?.company;

  const setupIncompleteness = erpSetup ? getErpSetupIncompleteness(erpSetup) : null;
  const setupSteps = setupIncompleteness ? [
    { key: 'domains', missing: setupIncompleteness.domains },
    { key: 'company-defaults', missing: setupIncompleteness.company },
    { key: 'activity-defaults', missing: setupIncompleteness.activity },
    { key: 'budget-map', missing: setupIncompleteness.budget },
    { key: 'employee-links', missing: setupIncompleteness.employees },
    { key: 'project-links', missing: setupIncompleteness.projects },
  ] : [];
  const missingSetupSteps = setupSteps.filter((step) => step.missing);
  const setupIncomplete = Boolean(erpSetup && missingSetupSteps.length > 0);
  const firstMissingSetupStep = missingSetupSteps[0]?.key;

  return (
    <Card className="p-4" data-tier={tier}>
      {/* AC-IRUX-010: flex-wrap so the long activation status pill reflows beside/under the
          tier name instead of overflowing the card at 390px. */}
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="plug" />
        <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
        {setupIncomplete
          ? <StatusPill variant="warn" className="min-w-0 max-w-full shrink whitespace-normal break-words">{t('uxs07.notReady', 'Not ready yet: {{count}} steps left', { count: missingSetupSteps.length })}</StatusPill>
          : tier === 'erpnext' && isConnected && !isConnectedButNotActivated && !canManageIntegrations
          ? <StatusPill variant="neutral" className="min-w-0 max-w-full shrink whitespace-normal break-words">{t('uxs07.setupAdminRequired', 'Ask an administrator to check setup')}</StatusPill>
          : tier === 'erpnext' && isConnected && !isConnectedButNotActivated && !erpSetup
          ? <StatusPill variant={erpSetupUnavailable ? 'warn' : 'neutral'} className="min-w-0 max-w-full shrink whitespace-normal break-words">{erpSetupUnavailable ? t('uxs07.setupUnavailable', 'Setup status unavailable') : t('uxs07.setupChecking', 'Checking setup')}</StatusPill>
          : tier === 'erpnext' && isConnected && !isConnectedButNotActivated && erpSetup
          ? <span className="text-xs font-medium text-success-text">{t('uxs07.ready', 'Ready')}</span>
          : <StatusPill variant={pillVariant} className="min-w-0 max-w-full shrink whitespace-normal break-words">{pillLabel}</StatusPill>}
      </div>

      {setupIncomplete && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{t('integrations.organization.readiness.connected', 'Connected')}</span>
          <CanWrite entity="integration" action="manage">
            <a className={buttonClasses('primary', 'sm')} href={`#erp-setup-${firstMissingSetupStep}`}>
              {t('uxs07.finishSetup', 'Finish setup')}
            </a>
          </CanWrite>
        </div>
      )}
      {!bindingReadFailed && (isConnected || isDisconnected) && binding && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {/* AC-ICI-001/002 — always-present connector identity line: readable same-org
              profile name or a translated neutral fallback, never the raw actor value. */}
          <span className="min-w-0 break-words">
            {t('integrations.organization.readiness.connectedBy', 'Connected by')}:{' '}
            <span className="font-medium text-foreground">
              {connectorNamesById.get(binding.connected_by ?? '') ??
                t('integrations.organization.readiness.connectedByUnavailable', 'Former or unavailable user')}
            </span>
          </span>
          <span>
            {t('integrations.organization.readiness.connectedAt', 'Connected')}:{' '}
            <span className="font-medium text-foreground">
              {binding.connected_at
                ? formatInstantDate(binding.connected_at)
                : '—'}
            </span>
          </span>
          {isDisconnected && binding.disconnected_at && (
            <span>
              {t('integrations.organization.readiness.disconnectedAt', 'Disconnected')}:{' '}
              <span className="font-medium text-foreground">
                {formatInstantDate(binding.disconnected_at)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* #1941: the connect committed but its identity save failed; Connect again re-saves it. */}
      {!bindingReadFailed && isConnected && binding?.config?.identity_incomplete === true && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill variant="warn">{t('administration:integrations.identityIncomplete', 'Setup incomplete')}</StatusPill>
          <CanWrite entity="integration" action="manage">
            <Button variant="outline" size="sm" onClick={() => onConnect(tier)}>
              <Icon name="refresh" className="size-3.55" aria-hidden="true" />
              {t('administration:integrations.identityRetry', 'Retry')}
            </Button>
          </CanWrite>
        </div>
      )}

      {/* Binding-status retry when the read failed (AC-IRUX-001) */}
      {bindingReadFailed && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRetryStatus}>
            <Icon name="refresh" className="size-3.55" aria-hidden="true" />
            {t('integrations.organization.readiness.bindRetry', 'Retry status')}
          </Button>
        </div>
      )}

      {/* Health info when connected and activated (AC-IRUX-003/004) */}
      {isConnected && !isConnectedButNotActivated && (
        <IntegrationHealthPanel
          state={healthState}
          onRetry={onHealthRetry}
          t={t}
        />
      )}

      {/* OD-INT-6: ERPNext Company picker when connected but not activated */}
      {isConnectedButNotActivated && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t('integrations.organization.readiness.erpActivation.pausedNote', 'ERP sync is paused until a Company is selected.')}
          </p>
          <CanWrite entity="integration" action="manage">
            <Button variant="outline" size="sm" onClick={() => onSelectCompany(tier)}>
              <Icon name="folder" className="size-3.55" aria-hidden="true" />
              {t('integrations.organization.readiness.erpActivation.select', 'Select Company')}
            </Button>
          </CanWrite>
        </div>
      )}

      {/* Connect / Disconnect buttons (Admin only via CanWrite) */}
      {!isConnectedButNotActivated && (
        <div className="mt-3 flex items-center gap-2">
          <CanWrite entity="integration" action="manage">
            {showConnect && (
              <Button variant="outline" size="sm" onClick={() => onConnect(tier)}>
                <Icon name="plus" className="size-3.55" aria-hidden="true" />
                {t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(tier) })}
              </Button>
            )}
            {showDisconnect && (
              <details className="text-sm">
                <summary className="cursor-pointer list-none rounded-md px-2 py-1 text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t('uxs07.connectionOptions', 'Connection options')}
                </summary>
                <div className="absolute z-10 mt-1 rounded-md border border-border bg-card p-2 shadow-sm">
                  <Button variant="ghost" size="sm" onClick={() => onDisconnect(tier)}>
                    <Icon name="plug" className="size-3.55" aria-hidden="true" />
                    {t('integrations.organization.readiness.disconnectAction', 'Disconnect {{service}}', { service: tierLabel(tier) })}
                  </Button>
                </div>
              </details>
            )}
          </CanWrite>
        </div>
      )}

      {/* Tier-specific info notes */}
      {tier === 'erpnext' && isConnected && !isConnectedButNotActivated && (
        <CanWrite entity="integration" action="manage">
          <ErpSetupChecklist orgId={orgId} onRefreshCompany={() => onSelectCompany('erpnext')} />
        </CanWrite>
      )}
      {tier === 'clickup' && (
        <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
          <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
          <span>{t('integrations.organization.readiness.clickupLocation', 'ClickUp is US-hosted SaaS: task-domain data resides with ClickUp')}</span>
        </p>
      )}
      {tier === 'erpnext' && (
        <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
          <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
          <span>{t('integrations.organization.readiness.erpLocation', 'Self-hosted ERP: data resides on your ERPNext instance')}</span>
        </p>
      )}
    </Card>
  );
};
