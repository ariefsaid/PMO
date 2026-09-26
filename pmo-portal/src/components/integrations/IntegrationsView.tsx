import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  type StatusVariant,
} from '@/src/components/ui';
import { useIntegrations, integrationHealthQueryKey } from '@/src/hooks/useIntegrations';
import { useProjects } from '@/src/hooks/useProjects';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { tierLabel, domainLabel } from './integrationLabels';
import { CanWrite } from '@/src/auth/usePermission';
import { formatDate } from '@/src/lib/format';
import type { ExternalTier, IntegrationHealth } from '@/src/lib/repositories/types';
import { M365OrgApprovalCard } from './M365OrgApprovalCard';

const TIERS: ExternalTier[] = ['clickup', 'erpnext'];

/** Connect credential form values per tier */
interface ConnectFormValues {
  token: string;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

type FormFieldName = 'token' | 'siteUrl' | 'apiKey' | 'apiSecret';

const validateClickUp = (v: ConnectFormValues, required: string): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.token.trim()) errors.token = required;
  return errors;
};

const validateERPNext = (v: ConnectFormValues, required: { url: string; key: string; secret: string }): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.siteUrl.trim()) errors.siteUrl = required.url;
  if (!v.apiKey.trim()) errors.apiKey = required.key;
  if (!v.apiSecret.trim()) errors.apiSecret = required.secret;
  return errors;
};

/**
 * A per-tier, discriminated display state for a connected service's health read (AC-IRUX-003/004).
 * A success, a reject, or a still-pending read for ONE tier resolves independently, so a failed or
 * slow service never collapses a healthy sibling to a blank/negative state.
 */
type TierHealthState =
  | { kind: 'loading' }
  | { kind: 'available'; health: IntegrationHealth }
  | { kind: 'unavailable' };

/**
 * One query per service lets a fast service render while another is still loading.
 * Uses the shared `integrationHealthQueryKey` so connect/disconnect/activation mutations can
 * invalidate the whole `['integrations', 'health', orgId]` family (AC-IRUX-009).
 */
function useIntegrationsHealth(
  orgId: string | undefined,
  connectedTiers: ExternalTier[],
  getHealth: (tier: ExternalTier) => Promise<IntegrationHealth>,
) {
  const options = (tier: ExternalTier) => ({
    queryKey: integrationHealthQueryKey(orgId, tier),
    queryFn: () => getHealth(tier),
    enabled: Boolean(orgId) && connectedTiers.includes(tier),
    retry: false,
  });
  const clickup = useQuery(options('clickup'));
  const erpnext = useQuery(options('erpnext'));
  const state = (result: typeof clickup): TierHealthState => {
    if (result.isError) return { kind: 'unavailable' };
    if (result.isPending) return { kind: 'loading' };
    return result.data ? { kind: 'available', health: result.data } : { kind: 'unavailable' };
  };
  return {
    clickup: { state: state(clickup), refetch: clickup.refetch },
    erpnext: { state: state(erpnext), refetch: erpnext.refetch },
  };
}

export const IntegrationsView: React.FC = () => {
  const { t } = useTranslation();
  const {
    orgId,
    isPending,
    isError,
    isSuccess,
    refetch,
    connect,
    disconnect,
    getBinding,
    getHealth,
    clickupLists = [],
    isListsError = false,
    isListsPending = false,
    refetchLists,
    projectBindings = [],
    isBindingsPending = false,
    isBindingsError = false,
    refetchBindings,
    // OD-INT-6: ERPNext company selection
    erpnextCompanies = [],
    isCompaniesPending = false,
    isCompaniesError = false,
    refetchCompanies,
    setCompany,
  } = useIntegrations();

  const projectsQuery = useProjects();
  const projects = projectsQuery?.data ?? [];
  const projectsPending = Boolean(projectsQuery?.isPending);
  const projectsError = Boolean(projectsQuery?.isError);

  // Group employed domains by tier (from external_domain_ownership)
  const ownershipQuery = useExternalDomainOwnership();
  const ownershipRows = ownershipQuery?.data ?? [];
  const domainsByTier: Record<ExternalTier, string[]> = {
    clickup: [],
    erpnext: [],
  };
  ownershipRows.forEach((r) => {
    if (r.externalTier === 'clickup' || r.externalTier === 'erpnext') {
      domainsByTier[r.externalTier].push(r.domain);
    }
  });

  // Determine connected tiers for health fetching (derived ONLY from a successful binding read).
  // AC-IRUX-009: if the binding read fails, no tier is treated as connected. A successful cached
  // binding remains usable while a background refresh is pending, but loses authority if it fails.
  const connectedTiers =
    isSuccess && !isError ? TIERS.filter((tier) => getBinding(tier)?.status === 'active') : [];

  // Fetch each connected tier independently under an organization-scoped key.
  const healthQueries = useIntegrationsHealth(orgId, connectedTiers, getHealth);

  // UI state
  const [connectTier, setConnectTier] = useState<ExternalTier | null>(null);
  const [disconnectTier, setDisconnectTier] = useState<ExternalTier | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // OD-INT-6: Company picker state for ERPNext
  const [setCompanyTier, setSetCompanyTier] = useState<ExternalTier | null>(null);
  const [setCompanyError, setSetCompanyError] = useState<string | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Form state (using useEntityForm)
  const connectForm = useEntityForm<ConnectFormValues>({
    initialValues: { token: '', siteUrl: '', apiKey: '', apiSecret: '' },
    validate: (v) => (connectTier === 'clickup'
      ? validateClickUp(v, t('integrations.organization.readiness.connect.tokenRequired', 'Personal API token is required.'))
      : validateERPNext(v, {
          url: t('integrations.organization.readiness.connect.urlRequired', 'Instance URL is required.'),
          key: t('integrations.organization.readiness.connect.keyRequired', 'API Key is required.'),
          secret: t('integrations.organization.readiness.connect.secretRequired', 'API Secret is required.'),
        })),
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
      } catch {
        // Fixed, generic, task-level copy — never forward transport details or credential values.
        setConnectError(t('integrations.organization.readiness.connect.connectFailed', 'Could not connect. Check the details and try again.'));
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
      setSetCompanyError(t('integrations.organization.readiness.erpActivation.selectRequired', 'Select a Company to activate.'));
      return;
    }

    try {
      // Send the SELECTED Company doc name — NOT the tier. `config.company` must hold the Company
      // (OD-INT-6); the binding stays connected-but-not-activated until this is set.
      await setCompany.mutateAsync(selectedCompany);
      setSetCompanyTier(null);
      setSelectedCompany(null);
    } catch {
      // AC-IRUX-005: activation failure keeps the dialog open AND the selection. Only the generic
      // failure message is set; selectedCompany is retained so the Admin can retry Activate.
      setSetCompanyError(t('integrations.organization.readiness.erpActivation.activateFailed', 'Activation failed. Your selection was kept; you can try again.'));
    }
  };

  const handleDisconnectClick = (tier: ExternalTier) => {
    setDisconnectTier(tier);
    setDisconnectError(null);
  };

  const handleDisconnectConfirm = async () => {
    if (!disconnectTier) return;
    try {
      await disconnect.mutateAsync(disconnectTier);
      setDisconnectTier(null);
      setDisconnectError(null);
    } catch {
      // AC-IRUX-008: keep the dialog open, show a generic failure, and stay silent on whether
      // disconnect/syncing actually stopped (it did not necessarily).
      setDisconnectError(
        t('integrations.organization.readiness.disconnect.failedSub', 'The service could not be disconnected. Existing synced data is retained; connection and syncing may be unchanged. Try again.'),
      );
    }
  };

  const activeClickUpBinding = isSuccess && !isError && getBinding('clickup')?.status === 'active';
  const activeProjectIds = new Set(
    projects.filter((project) => !project.archived_at).map((project) => project.id),
  );
  const clickUpBindings = projectBindings.filter(
    (binding) => binding.external_tier === 'clickup' && activeProjectIds.has(binding.project_id),
  );
  const bindingByProjectId = new Map(clickUpBindings.map((binding) => [binding.project_id, binding]));
  const boundListIds = new Set(clickUpBindings.map((binding) => binding.external_container_id));
  const clickUpListById = new Map(clickupLists.map((list) => [list.id, list]));
  const bindingMapVisible = activeClickUpBinding;
  const clickUpListsUnavailable = isListsError || isListsPending;
  // AC-IRUX-006: a PMO-native/bound conclusion needs EVERY map input (lists, bindings, projects).
  const bindingMapDataUnavailable =
    clickUpListsUnavailable ||
    isBindingsPending ||
    isBindingsError ||
    projectsPending ||
    projectsError;

  // Loading state (AC-IRUX-001): the binding read is loading.
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={3} />
      </div>
    );
  }

  return (
    <div>
      {/* AC-ADMIA-006: organization-owned surface. States scope explicitly and separates it from the
          PERSONAL route at /integrations — a personal Microsoft 365 connection never implies that the
          organization integration is ready. The panel also names its next permitted action. */}
      <p className="mb-4 text-sm text-muted-foreground" data-testid="integrations-owner-scope">
        {t(
          'integrations.organization.scope',
          'Organization integrations connect your team\u2019s external services. They are separate from your personal connections in My integrations \u2014 a personal connection does not activate an organization integration. Use the controls beside each service to connect, activate, or disconnect it.',
        )}
      </p>
      {/* A failed status load must NOT hide the Connect affordance — surface it as a scoped banner and
          still render the tier cards. Each card additionally labels its own connection state as
          unknown rather than "Disconnected"/"Not connected" (AC-IRUX-001). */}
      {isError && (
        <div className="mb-3.5" data-testid="integrations-status-error">
          <ListState
            variant="error"
            title={t('integrations.organization.readiness.bindUnavailableTitle', "Couldn't read connection status")}
            sub={t('integrations.organization.readiness.bindUnavailableSub', 'Connection state is unknown right now. Try reading it again, or connect if you have not yet.')}
            onRetry={refetch}
            retryLabel={t('integrations.organization.readiness.retry', 'Retry')}
          />
        </div>
      )}
      {/* Connect/Disconnect cards for each tier */}
      <div className="flex flex-col gap-3.5" data-testid="integrations-connect-cards">
        {/* M365 organisation approval (step 2) — its OWN block on this admin surface, NOT a TIERS
            entry (⚠️ do NOT add 'm365' to TIERS). M365 has no external_org_bindings row, no health
            probe, and no source-of-truth domains; forcing it into that array would hand it a
            credential-and-health model it does not have. The card self-gates Admin-only on the FE;
            the edge fn re-enforces Admin-of-org OR Operator (FR-M365SEP-004/009). */}
        <M365OrgApprovalCard />
        {TIERS.map((tier) => {
          const binding = isError ? undefined : getBinding(tier);
          const isConnected = binding?.status === 'active';
          const isDisconnected = binding?.status === 'disconnected';
          const showConnect = !isConnected; // show connect when not active (disconnected or never connected)
          const showDisconnect = isConnected && !isError;

          // AC-IRUX-001: on a failed binding read the connection state is UNKNOWN, never inferred
          // "Disconnected"/"Not connected". We also never offer Disconnect from an unknown binding.
          let pillVariant: StatusVariant = 'neutral';
          let pillLabel = t('integrations.organization.readiness.bindUnknown', 'Connection state unavailable');
          if (!isError) {
            if (tier === 'erpnext' && isConnected && !binding?.config?.company) {
              pillVariant = 'warn';
              pillLabel = t('integrations.organization.readiness.erpActivation.pending', 'Awaiting activation — select a Company to activate');
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
          const isConnectedButNotActivated = !isError && tier === 'erpnext' && isConnected && !binding?.config?.company;

          const healthState = healthQueries[tier].state;

          return (
            <Card key={tier} className="p-4" data-tier={tier}>
              {/* AC-IRUX-010: flex-wrap so the long activation status pill reflows beside/under the
                  tier name instead of overflowing the card at 390px. */}
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="plug" />
                <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
                <StatusPill variant={pillVariant} className="min-w-0 max-w-full shrink whitespace-normal break-words">{pillLabel}</StatusPill>
              </div>

              {/* Metadata when connected */}
              {!isError && (isConnected || isDisconnected) && binding && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  {binding.connected_by && (
                    <span>
                      {t('integrations.organization.readiness.connectedBy', 'Connected by')}: <span className="font-medium text-foreground">{binding.connected_by}</span>
                    </span>
                  )}
                  <span>
                    {t('integrations.organization.readiness.connectedAt', 'Connected')}:{' '}
                    <span className="font-medium text-foreground">
                      {binding.connected_at
                        ? formatDate(binding.connected_at)
                        : '—'}
                    </span>
                  </span>
                  {isDisconnected && binding.disconnected_at && (
                    <span>
                      {t('integrations.organization.readiness.disconnectedAt', 'Disconnected')}:{' '}
                      <span className="font-medium text-foreground">
                        {formatDate(binding.disconnected_at)}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {/* Binding-status retry when the read failed (AC-IRUX-001) */}
              {isError && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    <Icon name="refresh" className="size-3.55" aria-hidden="true" />
                    {t('integrations.organization.readiness.bindRetry', 'Retry status')}
                  </Button>
                </div>
              )}

              {/* Health info when connected and activated (AC-IRUX-003/004) */}
              {isConnected && !isConnectedButNotActivated && (
                <HealthPanel
                  state={healthState}
                  onRetry={() => healthQueries[tier].refetch()}
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
                    <Button variant="outline" size="sm" onClick={() => handleSetCompanyClick(tier)}>
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
                      <Button variant="outline" size="sm" onClick={() => handleConnectClick(tier)}>
                        <Icon name="plus" className="size-3.55" aria-hidden="true" />
                        {t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(tier) })}
                      </Button>
                    )}
                    {showDisconnect && (
                      <Button variant="destructive" size="sm" onClick={() => handleDisconnectClick(tier)}>
                        <Icon name="plug" className="size-3.55" aria-hidden="true" />
                        {t('integrations.organization.readiness.disconnectAction', 'Disconnect {{service}}', { service: tierLabel(tier) })}
                      </Button>
                    )}
                  </CanWrite>
                </div>
              )}

              {/* Tier-specific info notes */}
              {tier === 'clickup' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                  <span>{t('integrations.organization.readiness.clickupLocation', 'ClickUp is US-hosted SaaS — task-domain data resides with ClickUp')}</span>
                </p>
              )}
              {tier === 'erpnext' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                  <span>{t('integrations.organization.readiness.erpLocation', 'Self-hosted ERP — data resides on your ERPNext instance')}</span>
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {bindingMapVisible && (
        <section className="mt-6" aria-labelledby="clickup-binding-map-title" data-testid="clickup-binding-map">
          <div className="mb-3 flex items-center gap-2">
            <Icon name="plug" aria-hidden="true" />
            <h4 id="clickup-binding-map-title" className="text-sm font-semibold text-foreground">
              {t('integrations.organization.readiness.map.title', 'ClickUp binding map')}
            </h4>
          </div>

          {/* AC-IRUX-006: source-specific load and unavailability notices + retries */}
          {isListsPending && !isListsError && (
            <p className="mb-2 text-sm text-muted-foreground" role="status">
              {t('integrations.organization.readiness.map.listsLoading', 'Loading ClickUp lists…')}
            </p>
          )}
          {isListsError && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
              <span>{t('integrations.organization.readiness.map.listsUnavailable', 'ClickUp lists are unavailable, so project-to-List bindings cannot be determined.')}</span>
              <Button variant="outline" size="sm" onClick={() => refetchLists()}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.listsRetry', 'Retry lists')}
              </Button>
            </div>
          )}
          {isBindingsPending && (
            <p className="mb-2 text-sm text-muted-foreground" role="status">
              {t('integrations.organization.readiness.map.bindingsLoading', 'Loading project bindings…')}
            </p>
          )}
          {isBindingsError && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
              <span>{t('integrations.organization.readiness.map.bindingsUnavailable', 'Project bindings are unavailable, so ClickUp connections cannot be determined.')}</span>
              <Button variant="outline" size="sm" onClick={() => refetchBindings()}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.bindingsRetry', 'Retry bindings')}
              </Button>
            </div>
          )}
          {projectsPending && (
            <p className="mb-2 text-sm text-muted-foreground" role="status">
              {t('integrations.organization.readiness.map.projectsLoading', 'Loading projects…')}
            </p>
          )}
          {projectsError && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
              <span>{t('integrations.organization.readiness.map.projectsUnavailable', 'Projects are unavailable, so the project breakdown cannot be determined.')}</span>
              <Button variant="outline" size="sm" onClick={() => projectsQuery.refetch()}>
                <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.map.projectsRetry', 'Retry projects')}
              </Button>
            </div>
          )}

          {!clickUpListsUnavailable && !isBindingsPending && !isBindingsError && !projectsPending && !projectsError && clickUpBindings.length === 0 && (
            <p className="mb-3 rounded-md border border-border bg-card p-3 text-sm text-muted-foreground" data-testid="clickup-binding-map-empty">
              {t('integrations.organization.readiness.map.empty', 'No PMO projects are bound to ClickUp yet. Projects remain PMO-native until an admin links them.')}
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-full text-left text-sm">
              <caption className="sr-only">{t('integrations.organization.readiness.map.caption', 'PMO projects and their ClickUp List bindings')}</caption>
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">{t('integrations.organization.readiness.map.projectColumn', 'PMO project')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t('integrations.organization.readiness.map.listColumn', 'ClickUp List')}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t('integrations.organization.readiness.map.statusColumn', 'Status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projects.filter((project) => !project.archived_at).map((project) => {
                  const binding = bindingByProjectId.get(project.id);
                  const list = binding ? clickUpListById.get(binding.external_container_id) : undefined;
                  return (
                    <tr key={project.id}>
                      <th scope="row" className="px-3 py-2 font-medium text-foreground">{project.name}</th>
                      <td className="px-3 py-2 text-muted-foreground">
                        {bindingMapDataUnavailable
                          ? t('integrations.organization.readiness.map.unknown', 'Unknown')
                          : list?.name ??
                          (binding
                            ? t('integrations.organization.readiness.map.listUnavailable', 'List unavailable')
                            : '—')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {bindingMapDataUnavailable ? t('integrations.organization.readiness.map.unknown', 'Unknown') : binding ? t('integrations.organization.readiness.map.bound', 'Bound') : t('integrations.organization.readiness.map.pmoNative', 'PMO-native')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!clickUpListsUnavailable && !isBindingsPending && !isBindingsError && !projectsPending && !projectsError && (
            <>
              <h5 className="mb-2 mt-5 text-sm font-semibold text-foreground">{t('integrations.organization.readiness.map.untrackedTitle', 'ClickUp Lists PMO does not track')}</h5>
              <ul className="rounded-lg border border-border" aria-label={t('integrations.organization.readiness.map.untrackedAria', 'Untracked ClickUp Lists')}>
                {clickupLists.filter((list) => !boundListIds.has(list.id)).map((list) => (
                  <li key={list.id} className="border-b border-border px-3 py-2 text-sm last:border-b-0">
                    <span className="font-medium text-foreground">{list.name}</span>
                    <span className="ml-2 text-muted-foreground">({list.space_name}{list.folder_name ? ` / ${list.folder_name}` : ''}) — {t('integrations.organization.readiness.map.untrackedNote', 'PMO does not track')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* Employed domains section (existing read-only panel, AC-IRUX-007) */}
      <div className="mt-6">
        <h4 className="mb-3 text-sm font-semibold text-foreground">
          {t('integrations.organization.readiness.ownership.title', 'Employed domains (source of truth)')}
        </h4>
        <div data-testid="integrations-tier-list">
        {ownershipQuery?.isPending ? (
          <div className="rounded-lg border border-border bg-card">
            <p className="px-4 pt-4 text-sm text-muted-foreground" role="status">
              {t('integrations.organization.readiness.ownership.loading', 'Checking employed domains…')}
            </p>
            <ListState variant="loading" rows={2} />
          </div>
        ) : ownershipQuery?.isError ? (
          <div data-testid="ownership-error">
            <ListState
              variant="error"
              title={t('integrations.organization.readiness.ownership.unavailableTitle', 'Employed domains unavailable')}
              sub={t('integrations.organization.readiness.ownership.unavailableSub', 'Your source-of-truth domains could not be read. Try again.')}
              onRetry={ownershipQuery.refetch}
              retryLabel={t('integrations.organization.readiness.retry', 'Retry')}
            />
          </div>
        ) : ownershipRows.length === 0 ? (
          <div className="flex flex-col gap-3.5">
            <div className="rounded-lg border border-border bg-card" data-testid="ownership-empty">
              <ListState
                variant="empty"
                title={t('integrations.organization.readiness.ownership.emptyTitle', 'No employed domains set')}
                sub={t('integrations.organization.readiness.ownership.emptySub', 'Add your source-of-truth domains to connect data provenance.')}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
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
                      {t('integrations.organization.readiness.ownership.ownsDomains', 'Owns {{count}} domains as source of truth.', { count: domains.length })}
                  </p>
                  {tier === 'clickup' && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                      <span>{t('integrations.organization.readiness.clickupLocation', 'ClickUp is US-hosted SaaS — task-domain data resides with ClickUp')}</span>
                    </p>
                  )}
                  {tier === 'erpnext' && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                      <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                      <span>{t('integrations.organization.readiness.erpLocation', 'Self-hosted ERP — data resides on your ERPNext instance')}</span>
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Connect Modal */}
      {connectTier && (
        <EntityFormModal
          open
          title={t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(connectTier) })}
          subtitle={t('integrations.organization.readiness.connect.subtitle', 'Enter your {{service}} credentials to establish the connection', { service: tierLabel(connectTier) })}
          submitLabel={t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(connectTier) })}
          onSubmit={handleConnectSubmit}
          onClose={() => setConnectTier(null)}
          loading={connect.isPending}
          dirty={connectForm.isDirty}
          submitDisabled={!connectForm.isComplete}
          errorSummary={connectError ? [{ fieldId: connectForm.fieldProps('token').id, message: connectError }] : undefined}
        >
          <FormSection legend={t('integrations.organization.readiness.connect.credentials', 'Credentials')}>
            <FormGrid>
              {connectTier === 'clickup' ? (
                <TextField
                  {...connectForm.fieldProps('token')}
                  label={t('integrations.organization.readiness.connect.tokenLabel', 'Personal API token')}
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
                    label={t('integrations.organization.readiness.connect.urlLabel', 'Instance URL')}
                    required
                    placeholder="https://your-instance.erpnext.com"
                    autoComplete="url"
                    fullWidth
                  />
                  <TextField
                    {...connectForm.fieldProps('apiKey')}
                    label={t('integrations.organization.readiness.connect.keyLabel', 'API Key')}
                    required
                    placeholder="your-api-key"
                    autoComplete="off"
                  />
                  <TextField
                    {...connectForm.fieldProps('apiSecret')}
                    label={t('integrations.organization.readiness.connect.secretLabel', 'API Secret')}
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

      {/* OD-INT-6: ERPNext Company Picker Modal (AC-IRUX-005) */}
      {setCompanyTier && (
        <EntityFormModal
          open
          title={t('integrations.organization.readiness.erpActivation.title', 'Select ERPNext Company')}
          subtitle={t('integrations.organization.readiness.erpActivation.subtitle', 'Choose the Company from your ERPNext instance to activate the integration')}
          submitLabel={t('integrations.organization.readiness.erpActivation.activate', 'Activate')}
          onSubmit={handleSetCompanySubmit}
          onClose={() => {
            setSetCompanyTier(null);
            setSetCompanyError(null);
          }}
          loading={setCompany.isPending}
          dirty={true}
          submitDisabled={
            !selectedCompany ||
            isCompaniesPending ||
            isCompaniesError ||
            erpnextCompanies.length === 0
          }
          errorSummary={setCompanyError ? [{ fieldId: 'company-select', message: setCompanyError }] : undefined}
        >
          <FormSection legend={t('integrations.organization.readiness.erpActivation.companyLabel', 'Company')}>
            {isCompaniesPending ? (
              <div className="rounded-lg border border-border bg-card" data-testid="companies-loading">
                <p className="px-4 pt-4 text-sm text-muted-foreground" role="status">
                  {t('integrations.organization.readiness.erpActivation.loading', 'Loading Companies…')}
                </p>
                <ListState variant="loading" rows={1} />
              </div>
            ) : isCompaniesError ? (
              <div data-testid="companies-error">
                <ListState
                  variant="error"
                  title={t('integrations.organization.readiness.erpActivation.unavailableTitle', 'Companies unavailable')}
                  sub={t('integrations.organization.readiness.erpActivation.unavailableSub', 'Your ERPNext Companies could not be read. Try again to activate the integration.')}
                  onRetry={refetchCompanies}
                  retryLabel={t('integrations.organization.readiness.retry', 'Retry')}
                />
              </div>
            ) : erpnextCompanies.length === 0 ? (
              <div className="rounded-lg border border-border bg-card" data-testid="companies-empty">
                <ListState
                  variant="empty"
                  title={t('integrations.organization.readiness.erpActivation.emptyTitle', 'No Companies found')}
                  sub={t('integrations.organization.readiness.erpActivation.emptySub', 'Create a Company in ERPNext before activating this integration.')}
                />
              </div>
            ) : (
              <Combobox
                label={t('integrations.organization.readiness.erpActivation.companyLabel', 'Company')}
                value={selectedCompany}
                onChange={(value) => {
                  setSelectedCompany(value as string | null);
                  setSetCompanyError(null);
                }}
                loadOptions={async () => {
                  return erpnextCompanies.map((c) => ({ value: c.name, label: c.name }));
                }}
                placeholder={isCompaniesPending ? t('integrations.organization.readiness.erpActivation.loading', 'Loading Companies…') : t('integrations.organization.readiness.erpActivation.placeholder', 'Select a Company...')}
                disabled={isCompaniesPending}
                noun={t('integrations.organization.readiness.erpActivation.companyNoun', 'company')}
              />
            )}
          </FormSection>
          {setCompanyError && (
            <FieldError id="company-select-error">
              {setCompanyError}
            </FieldError>
          )}
        </EntityFormModal>
      )}

      {/* Disconnect ConfirmDialog (AC-IRUX-008) */}
      <ConfirmDialog
        open={!!disconnectTier}
        tone="destructive"
        title={disconnectTier
          ? t('integrations.organization.readiness.disconnect.titleService', 'Disconnect {{service}}?', { service: tierLabel(disconnectTier) })
          : t('integrations.organization.readiness.disconnect.title', 'Disconnect?')}
        description={
          disconnectError
            ? `${t('integrations.organization.readiness.disconnect.failedTitle', 'Disconnect did not complete')}. ${disconnectError}`
            : t('integrations.organization.readiness.disconnect.description', 'Existing synced data is retained; syncing stops. You can reconnect later with the same or different credentials.')
        }
        confirmLabel={
          disconnectTier
            ? disconnectError
              ? t('integrations.organization.readiness.disconnect.retryConfirm', 'Try disconnect again')
              : t('integrations.organization.readiness.disconnectAction', 'Disconnect {{service}}', { service: tierLabel(disconnectTier) })
            : t('integrations.organization.readiness.disconnect.action', 'Disconnect')
        }
        loading={disconnect.isPending}
        onConfirm={handleDisconnectConfirm}
        onCancel={() => {
          setDisconnectTier(null);
          setDisconnectError(null);
        }}
      />
    </div>
  );
};

interface HealthPanelProps {
  state: TierHealthState;
  onRetry: () => void;
  t: (key: string, def: string, options?: Record<string, number>) => string;
}

/** The per-tier health read: loading / unavailable / available (AC-IRUX-003/004). */
const HealthPanel: React.FC<HealthPanelProps> = ({ state, onRetry, t }) => {
  if (state.kind === 'loading') {
    return (
      <p className="mt-3 text-sm text-muted-foreground" role="status">
        {t('integrations.organization.readiness.health.loading', 'Checking outbound work status…')}
      </p>
    );
  }
  if (state.kind === 'unavailable') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground" role="status">
        <span>
          {t('integrations.organization.readiness.health.unavailableTitle', 'Outbound work status unavailable')} — {t('integrations.organization.readiness.health.unavailableSub', 'Outstanding outbound work could not be read. Try again.')}
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <Icon name="refresh" className="size-3.55" aria-hidden="true" />{t('integrations.organization.readiness.health.retry', 'Retry outbound status')}
        </Button>
      </div>
    );
  }
  const outstanding = state.health.error_count;
  const outstandingLabel =
    outstanding === 0
      ? t('integrations.organization.readiness.health.outstandingZero', '0 outbound items pending or need attention')
      : outstanding === 1
      ? t('integrations.organization.readiness.health.outstandingOne', '{{count}} outbound item pending or needs attention', { count: outstanding })
      : t('integrations.organization.readiness.health.outstandingMany', '{{count}} outbound items pending or need attention', { count: outstanding });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <span className="flex items-center gap-1 text-muted-foreground">
        <Icon name="alert" className="size-3.55 shrink-0" aria-hidden="true" />
        <span className="tabular-nums">{outstandingLabel}</span>
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
        <span>{t('integrations.organization.readiness.health.liveRecordCheck', 'To confirm data is usable, check an actual transferred record, not the connection alone.')}</span>
      </span>
    </div>
  );
};

export default IntegrationsView;
