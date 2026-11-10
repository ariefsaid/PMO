import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Card, ListState, SectionHeader, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useIsOperator } from '@/src/auth/useIsOperator';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import { useOwnPlan } from '@/src/hooks/usePlans';
import {
  CORE_FEATURES,
  FEATURE_GROUPS,
  FEATURE_LABELS,
  type OrgFeatureKey,
} from '@/src/lib/features';
import type { PlanRow } from '@/src/lib/db/orgFeatures';
import { formatNumber } from '@/src/lib/format';

/**
 * "Your plan" — the org Admin's READ-ONLY view of what the plan includes (FR-PLN-014, AC-PLN-013).
 *
 * Reads the same DB projections everything else does: `resolved_org_plan()` for the plan and limits,
 * `resolved_org_features()` for the switches (via `useOrgFeatures`, so the page and the navigation
 * can never disagree). There is no control on this page by design — only the Operator changes plans
 * and switches (D7); the page says so rather than shipping a disabled-looking form.
 *
 * Usage numbers are NOT invented: seats / active projects / AI messages show the plan's limit and
 * "Not tracked yet" for consumption until S5 ships the meters (plan: "usage numbers may show 'not
 * tracked yet' until S5").
 */

const LimitFigure: React.FC<{ label: string; limit: number | null }> = ({ label, limit }) => {
  const { t } = useTranslation('plans');
  return (
    <div className="min-w-0">
      <dt className="text-control font-medium text-foreground">{label}</dt>
      <dd className="mt-1 text-[20px] font-semibold tabular-nums">
        {limit === null ? t('yourPlan.unlimited', 'Unlimited / per contract') : formatNumber(limit)}
      </dd>
    </div>
  );
};

/** Group labels as literal `t()` calls (the i18n gate's collector only sees literal keys). */
const planGroupLabel = (t: (key: string, fallback: string) => string, id: string): string => {
  switch (id) {
    case 'crm':
      return t('yourPlan.group.crm', 'CRM');
    case 'delivery':
      return t('yourPlan.group.delivery', 'Delivery');
    case 'finance':
      return t('yourPlan.group.finance', 'Finance');
    default:
      return t('yourPlan.group.platform', 'Platform');
  }
};

const PlanOnOff: React.FC<{ on: boolean }> = ({ on }) => {
  const { t } = useTranslation('plans');
  return <>{on ? t('yourPlan.on', 'On') : t('yourPlan.off', 'Off')}</>;
};

/** One feature: plain text when on, marked "Off" when off, so a plan with everything on shows no repeated status. */
const PlanFeature: React.FC<{ feature: OrgFeatureKey; on: boolean }> = ({ feature, on }) => {
  const { t } = useTranslation('plans');
  return (
    <span className={on ? 'text-control' : 'inline-flex items-center gap-1.5 text-control text-muted-foreground'}>
      {FEATURE_LABELS[feature]}
      {on ? <span className="sr-only">: {t('yourPlan.on', 'On')}</span> : <StatusPill variant="neutral"><PlanOnOff on={false} /></StatusPill>}
    </span>
  );
};

export const YourPlan: React.FC = () => {
  const { t } = useTranslation('plans');
  const may = usePermission();
  const isOperator = useIsOperator();
  const qc = useQueryClient();
  const plan = useOwnPlan();
  const { states, isLoading: featuresLoading, isError: featuresError, refetch } = useOrgFeatures();

  const canSee = may('view', 'user') || isOperator;
  if (!canSee) {
    return (
      <ListState
        variant="empty"
        title={t('yourPlan.deniedTitle', 'Your plan')}
        sub={t('yourPlan.deniedBody', 'Your plan is visible to the organisation’s administrator.')}
      />
    );
  }

  if (plan.isPending || featuresLoading) {
    return <ListState variant="loading" rows={6} testId="your-plan-loading" />;
  }

  if (plan.isError || featuresError) {
    return (
      <ListState
        variant="error"
        title={t('yourPlan.loadFailed', 'Your plan could not be loaded')}
        sub={t('yourPlan.loadFailedBody', 'Try again; if it keeps failing, ask your administrator.')}
        onRetry={() => {
          if (plan.isError) void plan.refetch();
          refetch();
          void qc.invalidateQueries({ queryKey: ['ownPlan'] });
        }}
      />
    );
  }

  const row: PlanRow = plan.data ?? {
    planId: 'enterprise',
    name: t('yourPlan.enterpriseFallback', 'Enterprise'),
    seatLimit: null,
    projectLimit: null,
    aiMonthlyMessages: null,
  };

  const grouped = FEATURE_GROUPS.map((group) => ({
    id: group.id,
    keys: group.keys.filter((key) => key !== 'feedback_surveys'),
  }));
  const feedbackOn = states?.feedback_surveys?.displayEnabled ?? true;

  return (
    <div className="min-w-0 space-y-6">
      <Card className="px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-control font-semibold text-muted-foreground">
              {t('yourPlan.currentPlan', 'Current plan')}
            </div>
            <div className="mt-1 text-[24px] font-bold tracking-[-0.02em]">{row.name}</div>
          </div>
          <p className="text-control text-muted-foreground">
            {t('yourPlan.intro', 'Read-only. The PMO operator changes plans and features.')}
          </p>
        </div>
      </Card>

      <section aria-labelledby="your-plan-limits" className="min-w-0">
        <SectionHeader title={t('yourPlan.limitsHeading', 'Limits')} />
        <Card className="px-4 py-3">
          <dl className="grid gap-4 sm:grid-cols-3">
            <LimitFigure label={t('yourPlan.seats', 'Included seats')} limit={row.seatLimit} />
            <LimitFigure label={t('yourPlan.projects', 'Active projects')} limit={row.projectLimit} />
            <LimitFigure label={t('yourPlan.aiMessages', 'AI messages per month')} limit={row.aiMonthlyMessages} />
          </dl>
          <p className="mt-3 text-control text-muted-foreground">{t('yourPlan.notTrackedYet', 'Usage not tracked yet')}</p>
        </Card>
      </section>

      <section aria-labelledby="your-plan-switches" className="min-w-0">
        <SectionHeader title={t('yourPlan.switchesHeading', 'Features on this plan')} />
        <div className="rounded-lg border border-border bg-card">
          <ul className="divide-y divide-border">
            {grouped.map((group) => (
              <li key={group.id} className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
                <span className="text-control font-semibold text-muted-foreground">{planGroupLabel(t, group.id)}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {group.keys.map((feature) => (
                    <PlanFeature key={feature} feature={feature} on={Boolean(states?.[feature]?.displayEnabled)} />
                  ))}
                </span>
              </li>
            ))}
            <li className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
              <span className="text-control font-semibold text-muted-foreground">{t('yourPlan.adminOwned', 'Your admin controls this')}</span>
              <PlanFeature feature="feedback_surveys" on={feedbackOn} />
            </li>
            <li className="grid gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
              <span className="text-control font-semibold text-muted-foreground">{t('yourPlan.coreHeading', 'Always on for every plan')}</span>
              <span className="text-control">{CORE_FEATURES.map((key) => FEATURE_LABELS[key]).join(' · ')}</span>
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
};

export default YourPlan;
