import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useProject } from '@/src/hooks/useProjects';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { DeliveryPctChip } from '@/components/DeliveryPctChip';
import { pillVariantForProjectStatus } from '@/components/projects';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { AttentionList, type AttentionItem } from '@/src/components/dashboard/hub/AttentionList';
import { AreaPanel } from '@/src/components/dashboard/hub/AreaPanel';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { Icon } from '@/src/components/ui/icons';
import { projectAtRisk, projectRiskBasisKnown, projectSpendOfContractPct } from './metrics';

interface PMProjectAreaProps {
  project: PMDashboardProject;
  deliveryPct?: number;
  overdueTaskCount: number;
  procurements: ProcurementWithRefs[];
  orgCurrency: string;
}

interface FigureProps {
  label: string;
  value: React.ReactNode;
  helpLabel: string;
  help: React.ReactNode;
  exactValue?: string;
}

const HelpTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Tooltip content={children}>
    <button
      type="button"
      aria-label={label}
      className="touch-target grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
    >
      <Icon name="help" className="size-3.5" />
    </button>
  </Tooltip>
);

const MiniFigure: React.FC<FigureProps> = ({ label, value, helpLabel, help, exactValue }) => (
  <div className="min-w-0">
    <div className="flex min-h-6 items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <HelpTip label={helpLabel}>{help}</HelpTip>
    </div>
    <div className="min-w-0 break-words text-sm font-semibold tabular text-foreground" title={exactValue}>
      {value}
    </div>
  </div>
);

const metaValue = (value: string | null | undefined, unavailable: string) => (
  value ? <span>{value}</span> : <span title={unavailable} aria-label={unavailable}>—</span>
);

const statusVariant = (status: string) => {
  const variant = pillVariantForProjectStatus(status);
  return variant === 'progress' ? 'neutral' : variant;
};

export const PMProjectArea: React.FC<PMProjectAreaProps> = ({
  project,
  deliveryPct,
  overdueTaskCount,
  procurements,
  orgCurrency,
}) => {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  const projectQuery = useProject(project.id);
  const displayName = projectDisplayName(project);
  const projectNumber = projectQuery.data?.pmo_project_number;
  const projectCurrency = project.currency;
  const currencyCodeNeeded = projectCurrency !== orgCurrency;
  const contract = moneyFigure(
    project.contract_value,
    projectCurrency,
    t('hub.pm.contractUnavailable', 'This project contract value is unavailable.'),
    { code: currencyCodeNeeded },
  );
  const margin = moneyFigure(
    project.realized_margin ?? null,
    projectCurrency,
    t('hub.pm.marginUnavailable', 'Billed-work margin is unavailable for this project.'),
    { code: currencyCodeNeeded },
  );
  const spent = moneyFigure(
    project.spent,
    projectCurrency,
    t('hub.pm.spendingUnavailable', 'Actual spending is unavailable for this project.'),
    { code: currencyCodeNeeded },
  );
  const contractSpentPct = projectSpendOfContractPct(project);
  const riskKnown = projectRiskBasisKnown(project);
  const atRisk = riskKnown && projectAtRisk(project);
  const status = statusLabel(project.status);

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    if (atRisk) {
      items.push({
        id: 'budget-risk',
        tone: 'warn',
        count: 1,
        label: t('hub.pm.projectAtRisk', 'Budget is at least 90% spent'),
        href: `/projects/${project.id}`,
        tooltip: t('hub.pm.projectAtRiskHelp', 'Recorded actual spending is at least 90% of this project’s positive budget in the same currency.'),
      });
    }
    if (overdueTaskCount > 0) {
      items.push({
        id: 'overdue-tasks',
        tone: 'lost',
        count: overdueTaskCount,
        label: t('hub.pm.overdueTasks', overdueTaskCount === 1 ? 'overdue task' : 'overdue tasks', { count: overdueTaskCount }),
        href: `/projects/${project.id}/tasks`,
        tooltip: t('hub.pm.overdueTasksHelp', 'Tasks on this project with an end date before today.'),
      });
    }
    for (const procurement of procurements) {
      items.push({
        id: `procurement-${procurement.id}`,
        tone: 'warn',
        count: 1,
        label: t('hub.pm.procurementApproval', 'Procurement waiting for your approval'),
        sub: [procurement.title, procurement.vendor?.name].filter(Boolean).join(' · ') || undefined,
        href: `/procurement?open=${encodeURIComponent(procurement.id)}`,
        tooltip: t('hub.pm.procurementApprovalHelp', 'Open this procurement to review its approval request.'),
      });
    }
    return items;
  }, [atRisk, overdueTaskCount, procurements, project.id, t]);

  const contractHelp = (
    <>
      {t('hub.pm.projectContractHelp', 'The project contract value, shown in the project currency.')}
      {contract.unavailableReason && <><br /><br />{contract.unavailableReason}</>}
    </>
  );
  const marginHelp = (
    <>
      {t('hub.pm.projectMarginHelp', 'Profit on billed work to date: billed-work revenue less recorded actual spending.')}
      {margin.unavailableReason && <><br /><br />{margin.unavailableReason}</>}
    </>
  );
  const spendingHelp = (
    <>
      {contractSpentPct === null
        ? t('hub.pm.contractSpendUnavailable', 'The spending percentage is unavailable because the contract or actual spending basis is incomplete.')
        : t('hub.pm.contractSpendHelp', '{{spent}} spent of {{contract}} contract.', { spent: spent.exactValue ?? spent.value, contract: contract.exactValue ?? contract.value })}
    </>
  );
  const projectMeta = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{metaValue(projectNumber, projectQuery.isError
        ? t('hub.pm.projectNumberLoadError', 'Project number could not be loaded.')
        : t('hub.pm.projectNumberUnavailable', 'Project number is not available.'))}</span>
      <span aria-hidden="true">·</span>
      <span>{metaValue(project.client_name, t('hub.pm.clientUnavailable', 'Client name is not available.'))}</span>
      <span aria-hidden="true">·</span>
      <span title={t('hub.pm.projectCurrencyHelp', 'Currency used for this project’s contract and margin figures.')}>{projectCurrency}</span>
      {(project.budget == null || project.budget <= 0) && <><span aria-hidden="true">·</span><span>{t('hub.pm.budgetNotSet', 'Budget not set')}</span></>}
    </span>
  );

  const hasNoAttention = attentionItems.length === 0;
  const deliveryHelp = t('hub.pm.deliveryHelp', 'Progress from recorded project milestones.');
  const formattedStatus = status || project.status;

  return (
    <AreaPanel
      title={(
        <Link
          to={`/projects/${project.id}`}
          title={project.name}
          className="block min-w-0 break-words text-base font-semibold text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {displayName}
        </Link>
      )}
      openHref={`/projects/${project.id}`}
      openLabel={t('hub.pm.openProject', 'Open project')}
      meta={projectMeta}
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <MiniFigure
          label={t('hub.pm.contract', 'Contract')}
          value={contract.value}
          exactValue={contract.exactValue}
          helpLabel={t('hub.pm.projectContractHelpLabel', 'Help: contract value')}
          help={contractHelp}
        />
        <MiniFigure
          label={t('hub.pm.marginToDate', 'Margin to date')}
          value={margin.value}
          exactValue={margin.exactValue}
          helpLabel={t('hub.pm.projectMarginHelpLabel', 'Help: margin to date')}
          help={marginHelp}
        />
        <div className="min-w-0">
          <div className="flex min-h-6 items-center gap-1">
            <span className="text-xs text-muted-foreground">{t('hub.pm.status', 'Status')}</span>
          </div>
          <StatusPill variant={statusVariant(project.status)}>{formattedStatus}</StatusPill>
        </div>
        {deliveryPct !== undefined && Number.isFinite(deliveryPct) && (
          <MiniFigure
            label={t('hub.pm.delivery', 'Delivery')}
            value={<DeliveryPctChip pct={deliveryPct} />}
            helpLabel={t('hub.pm.deliveryHelpLabel', 'Help: delivery progress')}
            help={deliveryHelp}
          />
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-border pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground">{t('hub.pm.contractSpent', 'Contract spent')}</span>
            <HelpTip label={t('hub.pm.contractSpendHelpLabel', 'Help: percent of contract spent')}>{spendingHelp}</HelpTip>
          </div>
          {contractSpentPct === null ? (
            <span className="text-sm font-semibold tabular text-muted-foreground" aria-label={t('hub.pm.contractSpendUnavailable', 'The spending percentage is unavailable because the contract or actual spending basis is incomplete.')}>—</span>
          ) : (
            <Tooltip content={spendingHelp}>
              <span tabIndex={0} className="mt-1 inline-flex max-w-full rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                <ProgressBar
                  value={contractSpentPct}
                  showValue
                  aria-label={t('hub.pm.contractSpentAria', '{{name}}: {{percent}}% of contract spent', { name: displayName, percent: contractSpentPct })}
                  className="w-full"
                />
              </span>
            </Tooltip>
          )}
        </div>
        {spent.value !== '—' && contract.value !== '—' && (
          <span className="self-end pb-0.5 text-xs text-muted-foreground" title={spent.exactValue}>
            {spent.value} / {contract.value}
          </span>
        )}
      </div>

      <section aria-label={t('hub.pm.attentionLabel', 'What needs you on {{project}}', { project: project.name })}>
        {hasNoAttention ? (
          <p className="py-1 text-sm text-muted-foreground">{t('hub.pm.nothingNeedsYou', 'Nothing needs you here.')}</p>
        ) : (
          <AttentionList items={attentionItems} compact />
        )}
      </section>
    </AreaPanel>
  );
};
