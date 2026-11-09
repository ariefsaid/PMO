import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  ConfirmDialog,
  ListState,
  SectionHeader,
  SelectField,
  StatusPill,
  Switch,
  TextField,
  useToast,
} from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useOrgFeatures, invalidateFeatureState } from '@/src/hooks/useOrgFeatures';
import { useOperatorOrgs, useOperatorOrgOverrides, useOperatorResolvedFeatures, useOrgPlan, usePlanCatalogue } from '@/src/hooks/usePlans';
import {
  CORE_FEATURES,
  FEATURE_GROUPS,
  FEATURE_LABELS,
  type FeatureSource,
  type OrgFeatureKey,
} from '@/src/lib/features';
import type { FeatureResolution } from '@/src/lib/features';
import type { PlanRow } from '@/src/lib/db/orgFeatures';

/**
 * Administration › Features — the Operator console (FR-PLN-013, AC-PLN-012).
 *
 * What it answers, per organisation, from ONE catalogue read + ONE resolved read:
 *   - which plan the org is on, and change it;
 *   - every switch's EFFECTIVE state and WHERE it comes from (global / override / plan / core), so
 *     "turning it on did nothing" is self-explaining instead of a support ticket;
 *   - the per-org override (set / clear) and the all-orgs switch, which outranks every org;
 *   - each plan's default set and limits, the values every un-overridden org inherits.
 *
 * Authority: `isOperator` is the settled `useOperatorMembership()` projection (real JWT, never the
 * preview role) and every write goes through a guarded Operator RPC that re-asserts it server-side.
 * The console is a clarity projection only (ADR-0016).
 *
 * Read integrity: while a read is pending or failed the controls are NOT rendered — a console that
 * offers a toggle over an unknown state is how an Operator flips the wrong thing. Every mutation
 * invalidates the feature/plan prefixes, so the rail and the Admin page follow immediately.
 */

const SOURCE_TONE: Record<FeatureSource, 'won' | 'neutral' | 'progress'> = {
  core: 'won',
  override: 'progress',
  plan: 'neutral',
  global: 'neutral',
  unknown: 'neutral',
};

const sourceLabel = (
  t: (key: string, fallback: string) => string,
  source: FeatureSource): string => {
  switch (source) {
    case 'global':
      return t('console.sourceGlobal', 'All organisations');
    case 'override':
      return t('console.sourceOverride', 'Override');
    case 'plan':
      return t('console.sourcePlan', 'Plan');
    case 'core':
      return t('console.sourceCore', 'Always on');
    default:
      return t('console.sourceUnknown', 'Unknown');
  }
};

/**
 * Group labels as literal `t()` calls. A computed `t(`console.group.${id}`)` would be invisible to
 * the i18n gate's reference collector, and every key it names would read as orphaned.
 */
const groupLabel = (t: (key: string, fallback: string) => string, id: string): string => {
  switch (id) {
    case 'crm':
      return t('console.group.crm', 'CRM');
    case 'delivery':
      return t('console.group.delivery', 'Delivery');
    case 'finance':
      return t('console.group.finance', 'Finance');
    default:
      return t('console.group.platform', 'Platform');
  }
};

const OnOff: React.FC<{ on: boolean }> = ({ on }) => {
  const { t } = useTranslation('plans');
  return <>{on ? t('console.on', 'On') : t('console.off', 'Off')}</>;
};

/** Format a limit: null = unlimited / per contract (spec limits table). */
const limitText = (value: number | null): string => (value === null ? '' : String(value));

interface ConsoleProps {
  /** The Operator's own org — the picker's initial selection. */
  defaultOrgId: string;
}

const OperatorConsole: React.FC<ConsoleProps> = ({ defaultOrgId }) => {
  const { t } = useTranslation('plans');
  const { toast } = useToast();
  const qc = useQueryClient();

  const orgs = useOperatorOrgs();
  const [selectedOrgId, setSelectedOrgId] = useState(defaultOrgId);
  const selectedOrg = orgs.data?.find((org) => org.id === selectedOrgId);

  const catalogue = usePlanCatalogue();
  const resolved = useOperatorResolvedFeatures(selectedOrgId);
  const orgPlan = useOrgPlan(selectedOrgId);
  const orgOverrides = useOperatorOrgOverrides(selectedOrgId);

  const [planEditorId, setPlanEditorId] = useState<string | null>(null);
  /** Global switch awaiting confirmation (turning an all-orgs switch OFF). */
  const [pendingGlobalOff, setPendingGlobalOff] = useState<OrgFeatureKey | null>(null);

  const plans = useMemo(() => catalogue.data?.plans ?? [], [catalogue.data?.plans]);
  const planEditor: PlanRow | undefined =
    plans.find((plan) => plan.planId === planEditorId) ?? plans.find((plan) => plan.planId === orgPlan.data) ?? plans[0];

  /**
   * The limit draft belongs to the plan it was typed against. A draft made while inspecting one
   * organisation must never be saved onto another plan after the organisation (and with it the
   * editor's fallback plan) changes — the inputs fall back to the new plan's own values instead.
   */
  const [limitDraft, setLimitDraft] = useState<{
    planId: string;
    seats: string;
    projects: string;
    aiMessages: string;
  } | null>(null);
  const activeDraft = limitDraft && limitDraft.planId === planEditor?.planId ? limitDraft : null;

  // The limit inputs mirror the selected plan until the Operator edits them. Derived, not synced in
  // an effect: a plan switch re-seeds the fields, and a saved value arrives through the catalogue.
  const limits = activeDraft ?? {
    seats: limitText(planEditor?.seatLimit ?? null),
    projects: limitText(planEditor?.projectLimit ?? null),
    aiMessages: limitText(planEditor?.aiMonthlyMessages ?? null),
  };

  const updateDraft = (patch: Partial<{ seats: string; projects: string; aiMessages: string }>) => {
    if (!planEditor) return;
    setLimitDraft({ planId: planEditor.planId, ...limits, ...patch });
  };

  const refresh = () => invalidateFeatureState(qc);
  const onError = (err: unknown, coreMessageKey = 'console.coreRefused') => {
    const { headline, detail } = classifyMutationError(err, {
      P0001: t(coreMessageKey, "Core modules and the Admin-owned switch can't be changed here."),
      '23503': t('console.unknownRef', 'That organisation or plan no longer exists.'),
    });
    toast(headline, detail, 'warning');
  };

  const planMutation = useMutation({
    mutationFn: (args: { orgId: string; planId: string }) => repositories.orgFeature.setOrgPlan(args),
    onSuccess: () => {
      void refresh();
      toast(t('console.planSaved', 'Plan assigned'), t('console.planSavedBody', 'The organisation now resolves that plan’s switches.'), 'success');
    },
    onError: (err) => onError(err),
  });

  const overrideMutation = useMutation({
    mutationFn: (args: { orgId: string; key: OrgFeatureKey; enabled: boolean }) =>
      repositories.orgFeature.toggle(args),
    onSuccess: () => void refresh(),
    onError: (err) => onError(err),
  });

  const clearMutation = useMutation({
    mutationFn: (args: { orgId: string; key: OrgFeatureKey }) => repositories.orgFeature.clearOverride(args),
    onSuccess: () => {
      void refresh();
      toast(t('console.cleared', 'Override cleared'), t('console.clearedBody', 'The switch follows the plan again.'), 'success');
    },
    onError: (err) => onError(err),
  });

  const globalMutation = useMutation({
    mutationFn: (args: { key: OrgFeatureKey; enabled: boolean }) => repositories.orgFeature.setGlobal(args),
    onSuccess: (_data, args) => {
      setPendingGlobalOff(null);
      void refresh();
      toast(
        t('console.globalSaved', 'All-organisations switch updated'),
        args.enabled
          ? t('console.globalOnBody', 'Every organisation can use this switch again.')
          : t('console.globalOffBody', 'Every organisation loses it, whatever its plan or override.'),
        'success',
      );
    },
    onError: (err) => {
      setPendingGlobalOff(null);
      onError(err);
    },
  });

  const planFeatureMutation = useMutation({
    mutationFn: (args: { planId: string; key: OrgFeatureKey; enabled: boolean }) =>
      repositories.orgFeature.setPlanFeature(args),
    onSuccess: () => void refresh(),
    onError: (err) => onError(err),
  });

  const planLimitsMutation = useMutation({
    mutationFn: (args: {
      planId: string;
      seatLimit: number | null;
      projectLimit: number | null;
      aiMonthlyMessages: number | null;
    }) => repositories.orgFeature.setPlanLimits(args),
    onSuccess: () => {
      setLimitDraft(null);
      void refresh();
      toast(t('console.limitsSaved', 'Limits saved'), t('console.limitsSavedBody', 'New organisations on this plan inherit them.'), 'success');
    },
    onError: (err) => onError(err, 'console.limitRefused'),
  });

  const anyPending =
    planMutation.isPending ||
    overrideMutation.isPending ||
    clearMutation.isPending ||
    globalMutation.isPending ||
    planFeatureMutation.isPending ||
    planLimitsMutation.isPending;

  const orgOptions = useMemo(
    () => (orgs.data ?? []).map((org) => ({ value: org.id, label: org.name })),
    [orgs.data],
  );
  const planOptions = useMemo(
    () => plans.map((plan) => ({ value: plan.planId, label: plan.name })),
    [plans],
  );

  const header = (
    <SectionHeader
      title={t('console.organisationHeading', 'Organisation and plan')}
      action={anyPending ? <span className="text-[12px] text-muted-foreground">{t('console.saving', 'Saving…')}</span> : undefined}
    />
  );

  if (orgs.isError || catalogue.isError || resolved.isError || orgPlan.isError || orgOverrides.isError) {
    return (
      <ListState
        variant="error"
        title={t('console.loadFailed', 'The plan registry could not be loaded')}
        sub={t('console.loadFailedBody', 'Nothing was changed. Try again; if it keeps failing, the registry read is unavailable.')}
        onRetry={() => {
          void orgs.refetch();
          void catalogue.refetch();
          void resolved.refetch();
          void orgPlan.refetch();
          void orgOverrides.refetch();
        }}
      />
    );
  }

  if (orgs.isPending || catalogue.isPending || resolved.isPending || orgPlan.isPending || orgOverrides.isPending) {
    return <ListState variant="loading" rows={8} testId="operator-console-loading" />;
  }

  const states = resolved.data?.states ?? {};
  const effectivePlanId = orgPlan.data ?? 'enterprise';
  // Every org-scoped value in the switches table describes THIS organisation's resolved plan, never
  // the plan the editor happens to be pointing at (the two are chosen independently below).
  const orgPlanDefaults = catalogue.data?.defaults[effectivePlanId] ?? {};
  // The defaults editor's own list follows the plan it is editing.
  const editorPlanDefaults = (planEditor ? catalogue.data?.defaults[planEditor.planId] : undefined) ?? {};
  const global = catalogue.data?.global ?? {};
  const orgPlanRow = plans.find((plan) => plan.planId === effectivePlanId);
  const overrideKeys = orgOverrides.data;

  return (
    <div className="min-w-0 space-y-6">
      <Card className="px-4 py-4">
        {header}
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField
            label={t('console.organisation', 'Organisation')}
            value={selectedOrgId}
            options={orgOptions}
            onChange={(value) => setSelectedOrgId(value)}
            helper={t('console.organisationHelper', 'Every switch below is this organisation’s resolved state.')}
            fullWidth
          />
          <SelectField
            label={t('console.plan', 'Plan')}
            value={effectivePlanId}
            options={planOptions}
            onChange={(value) => planMutation.mutate({ orgId: selectedOrgId, planId: value })}
            helper={
              orgPlanRow
                ? t('console.planHelper', 'Plan limits: {{seats}} seats, {{projects}} active projects, {{messages}} AI messages a month.', {
                    seats: orgPlanRow.seatLimit ?? t('console.unlimitedShort', 'unlimited'),
                    projects: orgPlanRow.projectLimit ?? t('console.unlimitedShort', 'unlimited'),
                    messages: orgPlanRow.aiMonthlyMessages ?? t('console.unlimitedShort', 'unlimited'),
                  })
                : t('console.planHelperUnassigned', 'No plan row: this organisation resolves as Enterprise.')
            }
            disabled={anyPending}
            fullWidth
          />
        </div>
      </Card>

      <section aria-labelledby="console-switches" className="min-w-0">
        <SectionHeader
          title={t('console.switchesHeading', 'Switches for {{org}}', {
            org: selectedOrg?.name ?? t('console.thisOrganisation', 'this organisation'),
          })}
        />
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <caption className="sr-only">
              {t('console.switchesCaption', 'Effective switch state, its source, the plan default, the per-organisation override and the all-organisations switch.')}
            </caption>
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colFeature', 'Feature')}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colEffective', 'Effective')}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colSource', 'Source')}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colPlanDefault', 'Plan default')}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colOverride', 'This organisation')}</th>
                <th scope="col" className="px-4 py-2 font-semibold">{t('console.colGlobal', 'All organisations')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FEATURE_GROUPS.map((group) => (
                <React.Fragment key={group.id}>
                  <tr className="bg-secondary/40">
                    <th scope="colgroup" colSpan={6} className="px-4 py-1.5 text-left text-[11px] font-semibold text-muted-foreground">
                      {groupLabel(t, group.id)}
                    </th>
                  </tr>
                  {group.keys.map((key) => {
                    const state: FeatureResolution | undefined = states[key];
                    const enabled = Boolean(state?.displayEnabled);
                    const source = state?.source ?? 'unknown';
                    // Presence comes from the override rows too: an all-orgs off reports source
                    // 'global' while a dormant override still exists and must stay clearable.
                    const hasOverride = source === 'override' || Boolean(overrideKeys?.includes(key));
                    const globalOn = global[key];
                    const globalOffWins = source === 'global' && globalOn === false;
                    const planDefault = orgPlanDefaults[key];
                    const label = FEATURE_LABELS[key];
                    const isAdminOwned = key === 'feedback_surveys';
                    return (
                      <tr key={key} data-testid={`feature-row-${key}`}>
                        <th scope="row" className="px-4 py-2 text-left font-medium">
                          {label}
                        </th>
                        <td className="px-4 py-2">
                          <span data-testid={`effective-${key}`}>
                            <StatusPill variant={enabled ? 'won' : 'neutral'}>
                              <OnOff on={enabled} />
                            </StatusPill>
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <span data-testid={`source-${key}`}>
                            <StatusPill variant={SOURCE_TONE[source]}>{sourceLabel(t, source)}</StatusPill>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground" data-testid={`plan-default-cell-${key}`}>
                          {planDefault === undefined ? '—' : <OnOff on={planDefault} />}
                        </td>
                        <td className="px-4 py-2">
                          {isAdminOwned ? (
                            <span className="text-[12px] text-muted-foreground">{t('console.adminOwnedRow', 'Admin-owned')}</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={enabled}
                                onChange={() => overrideMutation.mutate({ orgId: selectedOrgId, key, enabled: !enabled })}
                                label={t('console.overrideSwitch', '{{feature}}: override for this organisation', { feature: label })}
                                disabled={anyPending || globalOffWins}
                              />
                              {hasOverride && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={anyPending}
                                  onClick={() => clearMutation.mutate({ orgId: selectedOrgId, key })}
                                >
                                  {t('console.clearOverride', 'Clear')}
                                </Button>
                              )}
                              {globalOffWins && (
                                <span className="text-[12px] text-muted-foreground">
                                  {t('console.globalOffWins', 'All-organisations off wins')}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {globalOn === null || globalOn === undefined ? (
                            <span className="text-[12px] text-muted-foreground">
                              {key === 'feedback_surveys'
                                ? t('console.adminOwnedRow', 'Admin-owned')
                                : t('console.noGlobalRow', 'No all-organisations row')}
                            </span>
                          ) : (
                            <Switch
                              checked={globalOn}
                              onChange={() => {
                                if (globalOn) setPendingGlobalOff(key);
                                else globalMutation.mutate({ key, enabled: true });
                              }}
                              label={t('console.globalSwitch', '{{feature}}: switch for all organisations', { feature: label })}
                              disabled={anyPending}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
              <tr className="bg-secondary/25">
                <th scope="row" className="px-4 py-2 text-left font-medium">
                  {t('console.coreHeading', 'Core modules (never switchable)')}
                </th>
                <td colSpan={5} className="px-4 py-2 text-[12.5px] text-muted-foreground">
                  {CORE_FEATURES.map((key) => FEATURE_LABELS[key]).join(' · ')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="console-plan-defaults" className="min-w-0">
        <SectionHeader title={t('console.planDefaultsHeading', 'Plan defaults and limits')} />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <SelectField
                label={t('console.planToEdit', 'Plan to edit')}
                value={planEditor?.planId ?? ''}
                options={planOptions}
                onChange={(value) => {
                  setPlanEditorId(value);
                  setLimitDraft(null);
                }}
                helper={t('console.planDefaultsHelper', 'These are the values an organisation without an override inherits.')}
                fullWidth
              />
            </div>
            <ul className="divide-y divide-border">
              {FEATURE_GROUPS.map((group) => (
                <React.Fragment key={group.id}>
                  {group.keys.filter((key) => key !== 'feedback_surveys').map((key) => {
                    const on = Boolean(editorPlanDefaults[key]);
                    return (
                      <li key={key} data-testid={`plan-default-${key}`} className="flex items-center justify-between gap-3 px-4 py-2">
                        <span className="text-[13px]">{FEATURE_LABELS[key]}</span>
                        <Switch
                          checked={on}
                          onChange={() =>
                            planEditor &&
                            planFeatureMutation.mutate({ planId: planEditor.planId, key, enabled: !on })
                          }
                          label={t('console.planDefaultSwitch', '{{feature}}: default for the {{plan}} plan', {
                            feature: FEATURE_LABELS[key],
                            plan: planEditor?.name ?? t('console.thisPlan', 'selected'),
                          })}
                          disabled={anyPending || !planEditor}
                        />
                      </li>
                    );
                  })}
                </React.Fragment>
              ))}
            </ul>
          </div>

          <Card className="px-4 py-3">
            <h3 className="text-[13px] font-semibold">{t('console.limitsHeading', 'Limits')}</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {t('console.limitsHelper', 'Leave a field blank for unlimited / per contract.')}
            </p>
            <div className="mt-3 space-y-3">
              <TextField
                label={t('console.seats', 'Included seats')}
                type="number"
                min={0}
                value={limits.seats}
                onChange={(value) => updateDraft({ seats: value })}
                fullWidth
              />
              <TextField
                label={t('console.activeProjects', 'Active projects')}
                type="number"
                min={0}
                value={limits.projects}
                onChange={(value) => updateDraft({ projects: value })}
                fullWidth
              />
              <TextField
                label={t('console.aiMessages', 'AI messages per month')}
                type="number"
                min={0}
                value={limits.aiMessages}
                onChange={(value) => updateDraft({ aiMessages: value })}
                fullWidth
              />
              <Button
                variant="primary"
                disabled={anyPending || !planEditor}
                onClick={() => {
                  if (!planEditor) return;
                  const toLimit = (raw: string): number | null => (raw.trim() === '' ? null : Number(raw));
                  planLimitsMutation.mutate({
                    planId: planEditor.planId,
                    seatLimit: toLimit(limits.seats),
                    projectLimit: toLimit(limits.projects),
                    aiMonthlyMessages: toLimit(limits.aiMessages),
                  });
                }}
              >
                {t('console.saveLimits', 'Save limits')}
              </Button>
            </div>
          </Card>
        </div>
      </section>

      <ConfirmDialog
        open={pendingGlobalOff !== null}
        tone="destructive"
        title={t('console.globalConfirmTitle', 'Switch this off for every organisation?')}
        description={t(
          'console.globalConfirmBody',
          '{{feature}} will be off for every organisation, whatever its plan or override. Data is kept; switching it back on restores it.',
          { feature: pendingGlobalOff ? FEATURE_LABELS[pendingGlobalOff] : '' },
        )}
        confirmLabel={t('console.globalConfirmAction', 'Switch off for all')}
        loading={globalMutation.isPending}
        onConfirm={() => {
          if (pendingGlobalOff) globalMutation.mutate({ key: pendingGlobalOff, enabled: false });
        }}
        onCancel={() => setPendingGlobalOff(null)}
      />
    </div>
  );
};

/**
 * Non-Operator fallback: the own-org read-only list (unchanged behaviour). The Administration route
 * already blocks non-Operators from `/administration/features`; this path keeps the section honest
 * if it is ever mounted elsewhere (e.g. an Admin preview).
 */
const ReadOnlyFeatures: React.FC = () => {
  const { t } = useTranslation('plans');
  const { states } = useOrgFeatures();
  return (
    <div className="rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {FEATURE_GROUPS.map((group) => (
          <React.Fragment key={group.id}>
            {group.keys.map((key) => {
              const on = Boolean(states?.[key]?.displayEnabled);
              return (
                <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-[13.5px] font-medium">{FEATURE_LABELS[key]}</span>
                  <StatusPill variant={on ? 'won' : 'neutral'}>
                    {key === 'feedback_surveys'
                      ? t('console.adminOwnedRow', 'Admin-owned')
                      : <OnOff on={on} />}
                  </StatusPill>
                </li>
              );
            })}
          </React.Fragment>
        ))}
        {CORE_FEATURES.map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[13.5px] font-medium">{FEATURE_LABELS[key]}</span>
            <StatusPill variant="neutral">{t('console.sourceCore', 'Always on')}</StatusPill>
          </li>
        ))}
      </ul>
    </div>
  );
};

export interface AdministrationFeaturesProps {
  /** Clarity projection only (ADR-0016/0019) — the RPC re-asserts Operator server-side. */
  isOperator: boolean;
  /** The org the Operator's console starts on (their own org). */
  orgId: string;
}

export const AdministrationFeatures: React.FC<AdministrationFeaturesProps> = ({ isOperator, orgId }) =>
  isOperator ? <OperatorConsole defaultOrgId={orgId} /> : <ReadOnlyFeatures />;

export default AdministrationFeatures;
