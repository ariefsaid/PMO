import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Icon,
  StatusPill,
  Button,
  EntityFormModal,
  ConfirmDialog,
  FormSection,
  FormGrid,
  TextField,
  FieldError,
  ListState,
  Combobox,
} from '@/src/components/ui';
import { useIntegrations } from '@/src/hooks/useIntegrations';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { tierLabel, domainLabel } from './integrationLabels';
import { CanWrite } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ExternalTier, IntegrationHealth } from '@/src/lib/repositories/types';

const TIERS: ExternalTier[] = ['clickup', 'erpnext'];

/** Connect credential form values per tier */
interface ConnectFormValues {
  token: string;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

type FormFieldName = 'token' | 'siteUrl' | 'apiKey' | 'apiSecret';

const validateClickUp = (v: ConnectFormValues): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.token.trim()) errors.token = 'Personal API token is required.';
  return errors;
};

const validateERPNext = (v: ConnectFormValues): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.siteUrl.trim()) errors.siteUrl = 'Instance URL is required.';
  if (!v.apiKey.trim()) errors.apiKey = 'API Key is required.';
  if (!v.apiSecret.trim()) errors.apiSecret = 'API Secret is required.';
  return errors;
};

/** Hook to fetch health data for all connected tiers */
function useIntegrationsHealth(connectedTiers: ExternalTier[], getHealth: (tier: ExternalTier) => Promise<IntegrationHealth>) {
  return useQuery<Record<ExternalTier, IntegrationHealth | null>>({
    queryKey: ['integrations', 'health-all', connectedTiers],
    queryFn: async () => {
      const results: Record<ExternalTier, IntegrationHealth | null> = {
        clickup: null,
        erpnext: null,
      };
      await Promise.all(
        connectedTiers.map(async (tier) => {
          try {
            results[tier] = await getHealth(tier);
          } catch {
            results[tier] = null;
          }
        })
      );
      return results;
    },
    enabled: connectedTiers.length > 0,
    retry: false,
  });
}

export const IntegrationsView: React.FC = () => {
  const {
    isPending,
    isError,
    refetch,
    connect,
    disconnect,
    getBinding,
    getHealth,
    // OD-INT-6: ERPNext company selection
    erpnextCompanies,
    isCompaniesPending,
    setCompany,
  } = useIntegrations();

  // Group employed domains by tier (from external_domain_ownership)
  const { data: ownershipRows = [] } = useExternalDomainOwnership();
  const domainsByTier: Record<ExternalTier, string[]> = {
    clickup: [],
    erpnext: [],
  };
  ownershipRows.forEach((r) => {
    if (r.externalTier === 'clickup' || r.externalTier === 'erpnext') {
      domainsByTier[r.externalTier].push(r.domain);
    }
  });

  // Determine connected tiers for health fetching
  const connectedTiers = TIERS.filter((tier) => getBinding(tier)?.status === 'active');

  // Fetch health data for all connected tiers in a single query
  const { data: healthMap = { clickup: null, erpnext: null } } = useIntegrationsHealth(connectedTiers, getHealth);

  // UI state
  const [connectTier, setConnectTier] = useState<ExternalTier | null>(null);
  const [disconnectTier, setDisconnectTier] = useState<ExternalTier | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // OD-INT-6: Company picker state for ERPNext
  const [setCompanyTier, setSetCompanyTier] = useState<ExternalTier | null>(null);
  const [setCompanyError, setSetCompanyError] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Form state (using useEntityForm)
  const connectForm = useEntityForm<ConnectFormValues>({
    initialValues: { token: '', siteUrl: '', apiKey: '', apiSecret: '' },
    validate: (v) => (connectTier === 'clickup' ? validateClickUp(v) : validateERPNext(v)),
    idPrefix: 'connect-form',
    requiredFields: connectTier === 'clickup' ? ['token'] : ['siteUrl', 'apiKey', 'apiSecret'],
  });

  const handleConnectClick = (tier: ExternalTier) => {
    setConnectTier(tier);
    setConnectError(null);
    connectForm.reset({ token: '', siteUrl: '', apiKey: '', apiSecret: '' });
  };

  const handleConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectTier) return;

    await connectForm.handleSubmit(async (values) => {
      try {
        const credential =
          connectTier === 'clickup'
            ? { token: values.token }
            : {
                siteUrl: values.siteUrl,
                apiKey: values.apiKey,
                apiSecret: values.apiSecret,
              };
        await connect.mutateAsync({ tier: connectTier, credential });
        setConnectTier(null);
      } catch (err) {
        // Surface the error inline; keep the modal open (setConnectTier stays non-null on failure).
        // Do NOT re-throw — the form onSubmit is not awaited, so a throw becomes an unhandled rejection.
        const { detail } = classifyMutationError(err);
        setConnectError(detail);
      }
    });
  };

  // OD-INT-6: Handle ERPNext company selection
  const handleSetCompanyClick = (tier: ExternalTier) => {
    setSetCompanyTier(tier);
    setSetCompanyError(null);
    setSelectedCompany(null);
  };

  const handleSetCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setCompanyTier) return;
    if (!selectedCompany) {
      setSetCompanyError('Select a Company to activate.');
      return;
    }

    try {
      // Send the SELECTED Company doc name — NOT the tier. `config.company` must hold the Company
      // (OD-INT-6); the binding stays connected-but-not-activated until this is set.
      await setCompany.mutateAsync(selectedCompany);
      setSetCompanyTier(null);
      setSelectedCompany(null);
    } catch (err) {
      const { detail } = classifyMutationError(err);
      setSetCompanyError(detail);
    }
  };

  const handleDisconnectConfirm = async () => {
    if (!disconnectTier) return;
    try {
      await disconnect.mutateAsync(disconnectTier);
      setDisconnectTier(null);
    } catch (err) {
      const { detail } = classifyMutationError(err);
      // Could show error toast here
      console.error('Disconnect failed:', detail);
    }
  };

  // Loading state
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={3} />
      </div>
    );
  }

  return (
    <div>
      {/* A failed status load must NOT hide the Connect affordance — surface it as a scoped banner and
          still render the tier cards (status falls back to "Not connected" via an empty getBinding). */}
      {isError && (
        <div className="mb-3.5" data-testid="integrations-status-error">
          <ListState
            variant="error"
            title="Couldn't load integration status"
            sub="Showing available actions; connection status may be out of date."
            onRetry={refetch}
          />
        </div>
      )}
      {/* Connect/Disconnect cards for each tier */}
      <div className="flex flex-col gap-3.5" data-testid="integrations-connect-cards">
        {TIERS.map((tier) => {
          const binding = getBinding(tier);
          const isConnected = binding?.status === 'active';
          const isDisconnected = binding?.status === 'disconnected';
          const showConnect = !isConnected; // show connect when not active (disconnected or never connected)
          const showDisconnect = isConnected;

          const health = healthMap[tier] ?? null;

          // OD-INT-6: Check if ERPNext is connected but not activated (no company selected)
          const isConnectedButNotActivated = tier === 'erpnext' && isConnected && !binding?.config?.company;

          return (
            <Card key={tier} className="p-4" data-tier={tier}>
              <div className="flex items-center gap-2">
                <Icon name="plug" />
                <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
                <StatusPill
                  variant={
                    isConnectedButNotActivated
                      ? 'warn'
                      : isConnected
                      ? 'won'
                      : isDisconnected
                      ? 'lost'
                      : 'neutral'
                  }
                >
                  {isConnectedButNotActivated
                    ? 'Connected — select a Company to activate'
                    : isConnected
                    ? 'Active'
                    : isDisconnected
                    ? 'Disconnected'
                    : 'Not connected'}
                </StatusPill>
              </div>

              {/* Metadata when connected */}
              {(isConnected || isDisconnected) && binding && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>
                    Connected by: <span className="font-medium text-foreground">{binding.connected_by}</span>
                  </span>
                  <span>
                    {' '}|{' '}
                    Connected:{' '}
                    <span className="font-medium text-foreground">
                      {binding.connected_at
                        ? new Date(binding.connected_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </span>
                  </span>
                  {isDisconnected && binding.disconnected_at && (
                    <>
                      {' '}|{' '}
                      Disconnected:{' '}
                      <span className="font-medium text-foreground">
                        {new Date(binding.disconnected_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Health info when connected and activated */}
              {isConnected && !isConnectedButNotActivated && health && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Icon name="refresh" className="size-3.55" aria-hidden="true" />
                    Last sync:{' '}
                    <span className="font-medium text-foreground">
                      {health.last_sync
                        ? new Date(health.last_sync).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '—'}
                    </span>
                  </span>
                  {health.error_count > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-destructive-text">
                      <Icon name="alert" className="size-3" aria-hidden="true" />
                      {health.error_count} {health.error_count === 1 ? 'error' : 'errors'}
                    </span>
                  )}
                </div>
              )}

              {/* OD-INT-6: ERPNext Company picker when connected but not activated */}
              {isConnectedButNotActivated && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    ERP sync is paused until a Company is selected.
                  </p>
                  <CanWrite entity="integration" action="manage">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetCompanyClick(tier)}
                      disabled={isCompaniesPending}
                    >
                      <Icon name="folder" className="size-3.55" aria-hidden="true" />
                      Select Company
                    </Button>
                  </CanWrite>
                </div>
              )}

              {/* Connect / Disconnect buttons (Admin only via CanWrite) */}
              {!isConnectedButNotActivated && (
                <div className="mt-3 flex items-center gap-2">
                  <CanWrite entity="integration" action="manage">
                    {showConnect && (
                      <Button variant="outline" size="sm" onClick={() => handleConnectClick(tier)}>
                        <Icon name="plus" className="size-3.55" aria-hidden="true" />
                        Connect {tierLabel(tier)}
                      </Button>
                    )}
                    {showDisconnect && (
                      <Button variant="destructive" size="sm" onClick={() => setDisconnectTier(tier)}>
                        <Icon name="plug" className="size-3.55" aria-hidden="true" />
                        Disconnect {tierLabel(tier)}
                      </Button>
                    )}
                  </CanWrite>
                </div>
              )}

              {/* Tier-specific info notes */}
              {tier === 'clickup' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                  <span>ClickUp is US-hosted SaaS — task-domain data resides with ClickUp</span>
                </p>
              )}
              {tier === 'erpnext' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                  <span>Self-hosted ERP — data resides on your ERPNext instance</span>
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Employed domains section (existing read-only panel) */}
      {Object.keys(domainsByTier).length > 0 && (
        <div className="mt-6">
          <h4 className="mb-3 text-sm font-semibold text-foreground">Employed domains (source of truth)</h4>
          <div className="flex flex-col gap-3.5" data-testid="integrations-tier-list">
            {TIERS.map((tier) => {
              const domains = domainsByTier[tier] ?? [];
              if (domains.length === 0) return null;
              return (
                <Card key={tier} className="p-4" data-tier={tier}>
                  <div className="flex items-center gap-2">
                    <Icon name="plug" />
                    <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
                  </div>
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {domains.map((d) => (
                      <li key={d} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground">
                        {domainLabel(d)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Owns {domains.length} {domains.length === 1 ? 'domain' : 'domains'} as source of truth.
                  </p>
                  {tier === 'clickup' && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                      <span>ClickUp is US-hosted SaaS — task-domain data resides with ClickUp</span>
                    </p>
                  )}
                  {tier === 'erpnext' && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                      <span>Self-hosted ERP — data resides on your ERPNext instance</span>
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Connect Modal */}
      {connectTier && (
        <EntityFormModal
          open
          title={`Connect ${tierLabel(connectTier)}`}
          subtitle={`Enter your ${tierLabel(connectTier)} credentials to establish the connection`}
          submitLabel={`Connect ${tierLabel(connectTier)}`}
          onSubmit={handleConnectSubmit}
          onClose={() => setConnectTier(null)}
          loading={connect.isPending}
          dirty={connectForm.isDirty}
          submitDisabled={!connectForm.isComplete}
          errorSummary={connectError ? [{ fieldId: connectForm.fieldProps('token').id, message: connectError }] : undefined}
        >
          <FormSection legend="Credentials">
            <FormGrid>
              {connectTier === 'clickup' ? (
                <TextField
                  {...connectForm.fieldProps('token')}
                  label="Personal API token"
                  required
                  type="password"
                  placeholder="pk_123456789..."
                  autoComplete="off"
                  fullWidth
                />
              ) : (
                <>
                  <TextField
                    {...connectForm.fieldProps('siteUrl')}
                    label="Instance URL"
                    required
                    placeholder="https://your-instance.erpnext.com"
                    autoComplete="url"
                    fullWidth
                  />
                  <TextField
                    {...connectForm.fieldProps('apiKey')}
                    label="API Key"
                    required
                    placeholder="your-api-key"
                    autoComplete="off"
                  />
                  <TextField
                    {...connectForm.fieldProps('apiSecret')}
                    label="API Secret"
                    required
                    type="password"
                    placeholder="your-api-secret"
                    autoComplete="off"
                  />
                </>
              )}
            </FormGrid>
          </FormSection>
          {connectError && (
            <FieldError id={`${connectForm.fieldProps('token').id}-submit`}>
              {connectError}
            </FieldError>
          )}
        </EntityFormModal>
      )}

      {/* OD-INT-6: ERPNext Company Picker Modal */}
      {setCompanyTier && (
        <EntityFormModal
          open
          title="Select ERPNext Company"
          subtitle="Choose the Company from your ERPNext instance to activate the integration"
          submitLabel="Activate"
          onSubmit={handleSetCompanySubmit}
          onClose={() => {
            setSetCompanyTier(null);
            setSetCompanyError(null);
          }}
          loading={setCompany.isPending}
          dirty={true}
          submitDisabled={!selectedCompany || erpnextCompanies.length === 0 || isCompaniesPending}
          errorSummary={setCompanyError ? [{ fieldId: 'company-select', message: setCompanyError }] : undefined}
        >
          <FormSection legend="Company">
            <Combobox
              label="Company"
              value={selectedCompany}
              onChange={(value) => {
                setSelectedCompany(value as string | null);
                setSetCompanyError(null);
              }}
              loadOptions={async () => {
                return erpnextCompanies.map((c) => ({ value: c.name, label: c.name }));
              }}
              placeholder={isCompaniesPending ? 'Loading companies...' : 'Select a Company...'}
              disabled={isCompaniesPending}
              noun="company"
            />
          </FormSection>
          {setCompanyError && (
            <FieldError id="company-select-error">
              {setCompanyError}
            </FieldError>
          )}
        </EntityFormModal>
      )}

      {/* Disconnect ConfirmDialog */}
      <ConfirmDialog
        open={!!disconnectTier}
        tone="destructive"
        title={disconnectTier ? `Disconnect ${tierLabel(disconnectTier)}?` : 'Disconnect?'}
        description="Existing synced data is retained; syncing stops. You can reconnect later with the same or different credentials."
        confirmLabel={disconnectTier ? `Disconnect ${tierLabel(disconnectTier)}` : 'Disconnect'}
        loading={disconnect.isPending}
        onConfirm={handleDisconnectConfirm}
        onCancel={() => setDisconnectTier(null)}
      />
    </div>
  );
};

export default IntegrationsView;