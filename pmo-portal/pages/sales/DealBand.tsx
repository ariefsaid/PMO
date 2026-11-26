import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, RecordMenu, StatusPill, type RecordMenuItem } from '@/src/components/ui';
import { LifecycleStepper } from '@/src/components/ui';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { dealJourneySteps, pillVariantForStatus } from '../../components/salesPipeline';
import StageHistory from '../project-detail/StageHistory';
import { useDealActions, useStageJourneyStepLabel } from './useDealActions';
import { DealActionsZone, DealDialogs, DealFigures } from './DealParts';

/** Stage history opens on demand: closed, it costs no read. */
const History: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useTranslation('project');
  const [opened, setOpened] = useState(false);
  return (
    <details className="min-w-0" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpened(true); }}>
      <summary className="cursor-pointer text-sm font-semibold">{t('projectDetail.stageHistory.salesHistory', 'Sales history')}</summary>
      <div className="pt-2">{opened && <StageHistory projectId={projectId} hideHeading />}</div>
    </details>
  );
};

/**
 * The deal page's lead band (#1426): where the deal stands and what to do next, with the win-gate
 * message, and the figures beside it. The tabs follow in ProjectDetail. On phone the header's status pill is the one stage and the one
 * next action leads, and everything else sits behind "More project details".
 */
const DealBand: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const d = useDealActions(project);
  const stageLabel = useProjectStatusLabel();
  const journeyStepLabel = useStageJourneyStepLabel();
  const { state } = useLocation();
  const back = listReturnNavigation(state, 'sales');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pill = <StatusPill variant={pillVariantForStatus(project.status as never)}>{stageLabel(project.status as never)}</StatusPill>;
  const stepper = (
    <LifecycleStepper variant="bar" steps={dealJourneySteps(d.status as never, journeyStepLabel)} aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')} className="[&_span]:text-control [&_[role=list]]:grid! [&_[role=list]]:grid-cols-3 [&_.jstep]:min-w-0 [&_[data-testid=stepper-fade]]:hidden" />
  );
  const backLink = (
    <Link to={back.path} state={back.state} className="inline-flex text-control font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
      {t('projectDetail.pipeline.backToSalesPipeline', '← Back to Sales Pipeline')}
    </Link>
  );
  const journey = (
    <section className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.pipeline.journeyHeading', 'Project journey')}</h2>
      {stepper}
    </section>
  );
  const figures = <DealFigures d={d} className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3" />;
  const outcomeItems: RecordMenuItem[] = d.isTerminal || !d.canTransition ? [] : [
    ...(d.nextStage && d.canWin ? [{ key: 'won', label: t('projectDetail.pipeline.markWon', 'Mark won'), onSelect: () => { d.setShowWonPanel(true); setDetailsOpen(true); } }] : []),
    ...(d.canLose ? [{ key: 'lost', label: t('projectDetail.pipeline.markLost', 'Mark lost'), danger: true, onSelect: () => { d.setConfirmAction('lost'); setDetailsOpen(true); } }] : []),
    ...(d.canDecline ? [{ key: 'declined', label: t('projectDetail.pipeline.markDeclined', 'Decline to bid'), danger: true, onSelect: () => { d.setConfirmAction('declined'); setDetailsOpen(true); } }] : []),
  ];
  if (!d.isDesktop) {
    return (
      <>
        <div className="mb-4 space-y-3">
          {!d.canTransition ? (
            <p className="line-clamp-1 text-sm text-muted-foreground">{t('projectDetail.pipeline.readOnlyShort', 'Project manager manages this pipeline.')}</p>
          ) : (
            <div className="flex items-center gap-2">
              {!d.isTerminal && d.nextStage ? (
                <Button variant="primary" className="min-w-0 flex-1" disabled={d.pending} onClick={() => void d.runTransition(d.nextStage!)}>
                  {`${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${d.nextStageLabel}`}
                </Button>
              ) : !d.isTerminal && d.canWin ? (
                <Button variant={d.showWonPanel ? 'outline' : 'primary'} className="min-w-0 flex-1" disabled={d.pending} onClick={() => { d.setShowWonPanel(true); setDetailsOpen(true); }}>
                  {t('projectDetail.pipeline.markWon', 'Mark won')}
                </Button>
              ) : null}
              {outcomeItems.length > 0 && (
                <RecordMenu items={outcomeItems} ariaLabel={t('projectDetail.pipeline.moreActions', 'More actions')} />
              )}
            </div>
          )}
        </div>
        <div className="mb-4">{journey}</div>
        <details className="min-w-0" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
          <summary className="mb-4 cursor-pointer text-sm font-semibold text-foreground">{t('projectDetail.pipeline.moreAboutDeal', 'More project details')}</summary>
          {detailsOpen && <div className="space-y-4">
            <DealActionsZone d={d}>{false}</DealActionsZone>
            {figures}
            <History projectId={project.id} />
            {backLink}
          </div>}
        </details>
        <DealDialogs d={d} />
      </>
    );
  }
  return (
    <>
      <section aria-label={t('sales:options.decisionBand', 'Where this stands')} className="panel-card grid gap-6 p-[var(--panel-inset)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-control font-medium text-muted-foreground">{t('projectDetail.pipeline.currentStage', 'Current stage')}</span>
            {pill}
          </div>
          <DealActionsZone d={d} />
          {backLink}
        </div>
        <div className="min-w-0 space-y-4">{figures}{journey}<History projectId={project.id} /></div>
      </section>
      <DealDialogs d={d} />
    </>
  );
};

export default DealBand;
