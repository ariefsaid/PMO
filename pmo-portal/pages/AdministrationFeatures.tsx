import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DisclosureSummary, ListState, StatusPill, Switch, useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import {
  FEATURE_KEYS,
  FEATURE_KEYS_TOGGLEABLE,
  FEATURE_LABELS,
  FEATURE_ENV_DEFAULT,
  CORE_FEATURES,
  type OrgFeatureKey,
  type EntitleableKey,
} from '@/src/lib/features';

/**
 * Administration › Features section (ops-admin-surface S6, FR-ENT-008, AC-ENT-004).
 *
 * Lists the gatable per-org entitlement keys (`FEATURE_KEYS`) plus the always-on core set
 * (`CORE_FEATURES`). The Operator sees real `<button role="switch" aria-checked>` controls that
 * call `operator_toggle_feature` via the repository seam; a non-Operator org-Admin sees the same
 * list as read-only text + a status pill ("Included in your plan" / "Hidden"). Core modules are
 * always-on and never toggleable by anyone (FR-ENT-007, AC-ENT-002) — rendered as locked-on.
 *
 * UX-only (ADR-0049): a toggle hides a module's affordances/routes (`useFeature`/`<FeatureGate>`);
 * it does NOT server-enforce the module's tables/RPCs yet. A stored row overrides the env default;
 * absence falls back to the env default (FR-ENT-004 absence = included).
 *
 * Error mapping: a `core_not_gated` rejection (errcode `P0001`) → "Core modules can't be disabled"
 * toast; a non-Operator denial (`42501`) → the shared permission toast.
 */

export interface AdministrationFeaturesProps {
  /** Clarity projection only (ADR-0016/0019) — the RPC re-asserts Operator server-side. */
  isOperator: boolean;
  /** The org whose features are being managed (the Operator's selected org or the caller's own). */
  orgId: string;
}

export const AdministrationFeatures: React.FC<AdministrationFeaturesProps> = ({
  isOperator,
  orgId,
}) => {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const featuresQuery = useOrgFeatures();
  const { data: orgFeatures } = featuresQuery;
  const [outcomes, setOutcomes] = React.useState<Record<string, 'saving' | 'saved' | 'error'>>({});

  // Keep these catalogue keys static so the i18n completeness guard can verify the feature copy.
  const featureNames: Record<EntitleableKey, string> = {
    incidents: t('administration:admin.features.name.incidents', FEATURE_LABELS.incidents),
    crm: t('administration:admin.features.name.crm', FEATURE_LABELS.crm),
    procurement: t('administration:admin.features.name.procurement', FEATURE_LABELS.procurement),
    timesheets: t('administration:admin.features.name.timesheets', FEATURE_LABELS.timesheets),
    import_export: t('administration:admin.features.name.import_export', FEATURE_LABELS.import_export),
    agent_assistant: t('administration:admin.features.name.agent_assistant', FEATURE_LABELS.agent_assistant),
    user_views: t('administration:admin.features.name.user_views', FEATURE_LABELS.user_views),
    m365_integration: t('administration:admin.features.name.m365_integration', FEATURE_LABELS.m365_integration),
    projects: t('administration:admin.features.name.projects', FEATURE_LABELS.projects),
    dashboard: t('administration:admin.features.name.dashboard', FEATURE_LABELS.dashboard),
    approvals: t('administration:admin.features.name.approvals', FEATURE_LABELS.approvals),
    administration: t('administration:admin.features.name.administration', FEATURE_LABELS.administration),
    revenue: t('administration:admin.features.name.revenue', FEATURE_LABELS.revenue),
  };
  const featureConsequences: Partial<Record<OrgFeatureKey, string>> = {
    incidents: t('administration:admin.features.consequence.incidents', { defaultValue: 'Track and coordinate operational incidents.' }),
    crm: t('administration:admin.features.consequence.crm', { defaultValue: 'Manage sales pipelines, companies and contacts.' }),
    procurement: t('administration:admin.features.consequence.procurement', { defaultValue: 'Manage purchase requests and orders.' }),
    timesheets: t('administration:admin.features.consequence.timesheets', { defaultValue: 'Record and review project hours.' }),
    import_export: t('administration:admin.features.consequence.import_export', { defaultValue: 'Import and export workspace records.' }),
    m365_integration: t('administration:admin.features.consequence.m365_integration', { defaultValue: 'Connect Microsoft 365 for workspace integrations.' }),
  };

  const toggleMutation = useMutation({
    mutationFn: (args: { orgId: string; key: OrgFeatureKey; enabled: boolean }) =>
      repositories.orgFeature.toggle(args),
    onSuccess: () => {
      // Invalidate the entitlement map so the rail/routes/useFeature re-resolve on next render.
      qc.invalidateQueries({ queryKey: ['orgFeatures'] });
    },
    onError: (err: unknown) => {
      const { headline, detail } = classifyMutationError(err, {
        P0001: "Core modules can't be disabled.",
      });
      toast(headline, detail, 'warning');
    },
  });

  /** Resolve a gatable key: a stored row overrides the env default (FR-ENT-004). */
  const resolve = (key: OrgFeatureKey): boolean => orgFeatures?.[key] ?? FEATURE_ENV_DEFAULT[key];
  const featureLabel = (key: EntitleableKey) => featureNames[key];

  const handleToggle = async (key: OrgFeatureKey, current: boolean) => {
    setOutcomes((previous) => ({ ...previous, [key]: 'saving' }));
    try {
      await toggleMutation.mutateAsync({ orgId, key, enabled: !current });
      setOutcomes((previous) => ({ ...previous, [key]: 'saved' }));
    } catch {
      setOutcomes((previous) => ({ ...previous, [key]: 'error' }));
    }
  };

  // Toggleable keys (take effect immediately via useFeature → Rail/FeatureRoute). The env-gated
  // keys (agent_assistant/user_views) are excluded — their effective gate is still the deployment
  // env flag (plan M5), so toggling them would look like a no-op; render them read-only instead.
  const toggleable: OrgFeatureKey[] = [...FEATURE_KEYS_TOGGLEABLE].sort((a, b) =>
    featureLabel(a).localeCompare(featureLabel(b), i18n.resolvedLanguage ?? i18n.language),
  );
  const envGated: OrgFeatureKey[] = ([...FEATURE_KEYS] as OrgFeatureKey[]).filter(
    (k) => !FEATURE_KEYS_TOGGLEABLE.includes(k),
  );
  const core: EntitleableKey[] = [...CORE_FEATURES];

  if (featuresQuery.isPending && !orgFeatures) {
    return <ListState variant="loading" rows={4} />;
  }

  if (featuresQuery.isError && !orgFeatures) {
    return (
      <ListState
        variant="error"
        title={t('administration:admin.features.loadError', "Couldn't load workspace capabilities")}
        sub={t('administration:admin.features.loadErrorHelp', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={() => void featuresQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {featuresQuery.isError && orgFeatures && (
        <ListState
          variant="error"
          title={t('administration:admin.features.refreshError', "Couldn't refresh workspace capabilities")}
          sub={t('administration:admin.features.lastConfirmed', 'The last confirmed settings are still shown. Check your connection and retry.')}
          retryLabel={t('admin.retry', 'Retry')}
          onRetry={() => void featuresQuery.refetch()}
        />
      )}
      {featuresQuery.isFetching && orgFeatures && !featuresQuery.isError && (
        <p role="status" className="text-[13px] text-muted-foreground">
          {t('administration:admin.features.refreshing', 'Refreshing capabilities…')}
        </p>
      )}
      <section aria-label={t('administration:admin.features.editable', 'Editable capabilities')}>
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {toggleable.map((key) => {
            const enabled = resolve(key);
            const label = featureLabel(key);
            const consequenceId = `feature-consequence-${key}`;
            const outcome = outcomes[key];
            return (
              <li key={key} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{label}</p>
                  <p id={consequenceId} className="mt-0.5 text-[13px] text-muted-foreground">
                    {featureConsequences[key] ?? FEATURE_LABELS[key]}
                  </p>
                  {outcome && (
                    <p role="status" className={outcome === 'error' ? 'mt-1 text-[13px] text-destructive' : 'mt-1 text-[13px] text-muted-foreground'}>
                      {outcome === 'saving'
                        ? t('administration:admin.features.saving', 'Saving…')
                        : outcome === 'saved'
                          ? t('administration:admin.features.saved', 'Saved')
                          : t('administration:admin.features.saveError', "Couldn't save this capability. Your last confirmed setting is still shown.")}
                    </p>
                  )}
                </div>
                {isOperator ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusPill variant={enabled ? 'won' : 'neutral'}>
                      {enabled ? t('administration:admin.features.on', 'On') : t('administration:admin.features.off', 'Off')}
                    </StatusPill>
                    <Switch
                      checked={enabled}
                      onChange={() => void handleToggle(key, enabled)}
                      label={label}
                      describedBy={consequenceId}
                      disabled={toggleMutation.isPending}
                      touchTarget
                      className="my-1"
                    />
                  </div>
                ) : (
                  <StatusPill variant={enabled ? 'won' : 'neutral'}>
                      {enabled
                        ? t('administration:admin.features.includedInPlan', 'Included in your plan')
                        : t('administration:admin.features.hidden', 'Hidden')}
                  </StatusPill>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <details className="group rounded-lg border border-border bg-card px-4">
        <DisclosureSummary className="py-2 text-[13.5px] font-semibold">
          {t('administration:admin.features.preview', 'Preview')}
        </DisclosureSummary>
        <ul className="divide-y divide-border border-t border-border">
          {envGated.map((key) => {
            const enabled = resolve(key);
            return (
              <li key={key} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                <span className="text-[13.5px] font-medium">{featureLabel(key)}</span>
                <StatusPill variant={enabled ? 'won' : 'neutral'}>
                  {enabled
                    ? t('administration:admin.features.previewOn', 'Preview — on')
                    : t('administration:admin.features.previewOff', 'Preview — off')}
                </StatusPill>
              </li>
            );
          })}
        </ul>
      </details>

      <details className="group rounded-lg border border-border bg-card px-4">
        <DisclosureSummary className="py-2 text-[13.5px] font-semibold">
          {t('administration:admin.features.alwaysIncluded', 'Always included')}
        </DisclosureSummary>
        <ul className="divide-y divide-border border-t border-border">
          {core.map((key) => (
            <li key={key} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
              <span className="text-[13.5px] font-medium">{featureLabel(key)}</span>
              <StatusPill variant="neutral">{t('administration:admin.features.alwaysOn', 'Always on')}</StatusPill>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};

export default AdministrationFeatures;
