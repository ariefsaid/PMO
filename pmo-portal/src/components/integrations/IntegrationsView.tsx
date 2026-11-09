import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog, ListState } from '@/src/components/ui';
import { useIntegrations } from '@/src/hooks/useIntegrations';
import { useAssignableProfiles } from '@/src/hooks/useTasks';
import { useProjects } from '@/src/hooks/useProjects';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { tierLabel } from './integrationLabels';
import { usePermission } from '@/src/auth/usePermission';
import { formatList } from '@/src/lib/format';
import type { ExternalTier } from '@/src/lib/repositories/types';
import { integrationsRepository } from '@/src/lib/repositories/integrations';
import { M365OrgApprovalCard } from './M365OrgApprovalCard';
import { M365DefaultLibraryCard } from './M365DefaultLibraryCard';
import { OdooIntegrationSection } from './odoo/OdooIntegrationSection';
import { erpActivationRefusalOf, type ErpActivationRefusal } from '@/src/lib/repositories/erpActivationRefusal';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useIntegrationsHealth } from './useIntegrationsHealth';
import { TierConnectionCard } from './TierConnectionCard';
import { OwnershipDomainsPanel } from './OwnershipDomainsPanel';
import { ConnectCredentialsModal, type ConnectFormValues } from './ConnectCredentialsModal';
import { ErpCompanyModal } from './ErpCompanyModal';
import { ClickUpBindingMap } from './ClickUpBindingMap';
import type { LinkClickUpProjectInput } from '@/src/lib/repositories/types';

// Odoo has its own card (OdooIntegrationSection), so this list stays the two generic tiers.
const TIERS: Array<Exclude<ExternalTier, 'odoo'>> = ['clickup', 'erpnext'];

export const IntegrationsView: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const canManageIntegrations = may('manage', 'integration');
  const qc = useQueryClient();
  const {
    orgId,
    isPending,
    isError,
    isSuccess,
    refetch,
    connect,
    disconnect,
    linkProject,
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

  // Grouped + rendered by OwnershipDomainsPanel (AC-IRUX-007).
  const ownershipQuery = useExternalDomainOwnership();

  // Determine connected tiers for health fetching (derived ONLY from a successful binding read).
  // AC-IRUX-009: if the binding read fails, no tier is treated as connected. A successful cached
  // binding remains usable while a background refresh is pending, but loses authority if it fails.
  const connectedTiers =
    isSuccess && !isError ? TIERS.filter((tier) => getBinding(tier)?.status === 'active') : [];

  // Fetch each connected tier independently under an organization-scoped key.
  const healthQueries = useIntegrationsHealth(orgId, connectedTiers, getHealth);
  const erpSetupQuery = useQuery({
    queryKey: ['integrations', 'setup', orgId],
    queryFn: () => integrationsRepository.getErpSetup(),
    enabled: Boolean(orgId) && canManageIntegrations && connectedTiers.includes('erpnext'),
    retry: false,
  });

  // #680 (AC-ICI-001..004): organization connector identity — resolve `connected_by` (a stored
  // audit actor) against the org-scoped profile source and show a readable same-org name, or a
  // translated neutral fallback. The read is DISPLAY-ONLY: it reuses the existing org-scoped
  // `useAssignableProfiles` hook; its pending/error state must never feed binding status, health
  // queries, or authorization. A literal `connected_by` value is never interpolated into the DOM.
  const profilesQuery = useAssignableProfiles();
  const connectorNamesById = useMemo(() => {
    const map = new Map<string, string>();
    if (profilesQuery.isSuccess && !profilesQuery.isError && profilesQuery.data) {
      for (const profileRow of profilesQuery.data) {
        const name = profileRow.full_name?.trim();
        if (name) map.set(profileRow.id, name);
      }
    }
    return map;
  }, [profilesQuery.isSuccess, profilesQuery.isError, profilesQuery.data]);

  // UI state
  const [connectTier, setConnectTier] = useState<ExternalTier | null>(null);
  const [disconnectTier, setDisconnectTier] = useState<ExternalTier | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  // OD-INT-6: Company picker state for ERPNext
  const [setCompanyTier, setSetCompanyTier] = useState<ExternalTier | null>(null);
  const [setCompanyError, setSetCompanyError] = useState<string | null>(null);
  const [taskListReview, setTaskListReview] = useState<{
    projectId: string;
    projectName: string;
    proposedListId: string | null;
  } | null>(null);
  const [taskListReviewError, setTaskListReviewError] = useState<string | null>(null);

  const handleConnectClick = (tier: ExternalTier) => {
    setConnectTier(tier);
    setConnectError(null);
  };

  // The connect dialog owns the mount-scoped form state; the view owns the mutation and its error.
  const handleConnectSubmit = async (values: ConnectFormValues) => {
    if (!connectTier) return;
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
  };

  // OD-INT-6: Handle ERPNext company selection
  const handleSetCompanyClick = (tier: ExternalTier) => {
    setSetCompanyTier(tier);
    setSetCompanyError(null);
  };

  const activationErrorMessage = (refusal: ErpActivationRefusal | null): string => {
    if (refusal?.kind === 'missing-reads') {
      return t(
        'integrations.organization.readiness.erpActivation.missingReads',
        'The ERPNext integration user cannot read: {{doctypes}}. Grant it read access to these in ERPNext, then activate again. Your selection was kept.',
        { doctypes: refusal.doctypes.join(', ') },
      );
    }
    if (refusal?.kind === 'unsupported-version') {
      return t(
        'integrations.organization.readiness.erpActivation.unsupportedVersion',
        'ERPNext {{version}} is not supported. PMO supports ERPNext {{supported}}. Nothing was activated.',
        {
          version: refusal.versionMajor,
          // The supported set is the server's; the list joins it in the viewer's language ("15 and 16" / "15 dan 16").
          supported: formatList(refusal.supportedMajors.map(String)),
        },
      );
    }
    return t('integrations.organization.readiness.erpActivation.activateFailed', 'Activation failed. Your selection was kept; you can try again.');
  };

  const handleSetCompanySubmit = async (companyId: string | null) => {
    if (!setCompanyTier) return;
    if (!companyId) {
      setSetCompanyError(t('integrations.organization.readiness.erpActivation.selectRequired', 'Select a Company to activate.'));
      return;
    }

    try {
      // Send the SELECTED Company doc name — NOT the tier. `config.company` must hold the Company
      // (OD-INT-6); the binding stays connected-but-not-activated until this is set.
      await setCompany.mutateAsync(companyId);
      void qc.invalidateQueries({ queryKey: ['integrations', 'setup', orgId] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'project-erp', orgId] });
      setSetCompanyTier(null);
    } catch (err) {
      // AC-IRUX-005: activation failure keeps the dialog open AND the selection, so the Admin can retry.
      // #656: a refusal the Admin can act on says what to fix; anything else stays generic.
      setSetCompanyError(activationErrorMessage(erpActivationRefusalOf(err)));
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

  const bindingMapVisible = isSuccess && !isError && getBinding('clickup')?.status === 'active';

  const handleTaskListLinkConfirm = async (input: LinkClickUpProjectInput) => {
    try {
      await linkProject.mutateAsync(input);
      setTaskListReviewError(null);
      setTaskListReview(null);
      void refetchBindings();
    } catch (error) {
      setTaskListReviewError(classifyMutationError(error).detail);
    }
  };

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
        {t('uxs07.organizationScope', 'Organization integrations are shared by your organization. Manage personal connections in ')}
        <a className="font-medium text-foreground underline underline-offset-4" href="/integrations">
          {t('uxs07.personalConnections', 'My integrations')}
        </a>
        {t('uxs07.scopeTail', '. Personal connections do not activate organization integrations.')}
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
        {/* Org default document library — an org setting, deliberately separate from the personal
            connection and from the org approval above (it grants no access to anything). */}
        <M365DefaultLibraryCard />
        {TIERS.map((tier) => (
          <TierConnectionCard
            key={tier}
            tier={tier}
            binding={isError ? undefined : getBinding(tier)}
            bindingReadFailed={isError}
            healthState={healthQueries[tier].state}
            onHealthRetry={() => healthQueries[tier].refetch()}
            erpSetup={tier === 'erpnext' ? erpSetupQuery.data : undefined}
            erpSetupUnavailable={erpSetupQuery.isError}
            connectorNamesById={connectorNamesById}
            orgId={orgId}
            onConnect={handleConnectClick}
            onDisconnect={handleDisconnectClick}
            onSelectCompany={handleSetCompanyClick}
            onRetryStatus={() => refetch()}
          />
        ))}
        {/* #1504 S5: one ERP per org, so Odoo is offered only while no ERPNext binding is active. */}
        {isSuccess && !isError && getBinding('erpnext')?.status !== 'active' && <OdooIntegrationSection />}
      </div>

      {bindingMapVisible && (
        <ClickUpBindingMap
          projects={projects}
          projectsPending={projectsPending}
          projectsError={projectsError}
          onRetryProjects={() => projectsQuery.refetch()}
          clickupLists={clickupLists}
          isListsPending={isListsPending}
          isListsError={isListsError}
          onRetryLists={() => refetchLists()}
          projectBindings={projectBindings}
          isBindingsPending={isBindingsPending}
          isBindingsError={isBindingsError}
          onRetryBindings={() => refetchBindings()}
          canManageIntegrations={canManageIntegrations}
          linkPending={linkProject?.isPending ?? false}
          taskListReview={taskListReview}
          taskListReviewError={taskListReviewError}
          onStartReview={(review) => { setTaskListReviewError(null); setTaskListReview(review); }}
          onLinkConfirm={handleTaskListLinkConfirm}
          onCloseReview={() => setTaskListReview(null)}
        />
      )}

      {/* Employed domains section (existing read-only panel, AC-IRUX-007) */}
      <OwnershipDomainsPanel query={ownershipQuery} tiers={TIERS} />

      {/* Connect Modal */}
      {connectTier && (
        <ConnectCredentialsModal
          tier={connectTier}
          loading={connect.isPending}
          error={connectError}
          onClose={() => setConnectTier(null)}
          onSubmit={handleConnectSubmit}
        />
      )}

      {/* OD-INT-6: ERPNext Company Picker Modal (AC-IRUX-005) */}
      {setCompanyTier && (
        <ErpCompanyModal
          companies={erpnextCompanies}
          isCompaniesPending={isCompaniesPending}
          isCompaniesError={isCompaniesError}
          onRefetchCompanies={() => refetchCompanies()}
          loading={setCompany.isPending}
          error={setCompanyError}
          onSelectionChange={() => setSetCompanyError(null)}
          onSubmit={handleSetCompanySubmit}
          onClose={() => {
            setSetCompanyTier(null);
            setSetCompanyError(null);
          }}
        />
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

export default IntegrationsView;
