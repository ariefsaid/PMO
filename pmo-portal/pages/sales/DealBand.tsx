import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, StatusPill } from '@/src/components/ui';
import { LifecycleStepper } from '@/src/components/ui';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { listReturnNavigation } from '@/src/lib/listReturnContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { dealJourneySteps, pillVariantForStatus } from '../../components/salesPipeline';
import StageHistory from '../project-detail/StageHistory';
import { NEXT_STAGE_LABEL, useDealActions } from './useDealActions';
import { DealActionButtons, DealActionsZone, DealDialogs, DealFigures } from './DealParts';

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
 * message, and the figures beside it. The tabs follow in ProjectDetail. On phone the stage and the one
 * next action lead, and everything else sits behind "More project details".
 */
const DealBand: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const d = useDealActions(project);
  const stageLabel = useProjectStatusLabel();
  const { state } = useLocation();
  const back = listReturnNavigation(state, 'sales');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pill = <StatusPill variant={pillVariantForStatus(project.status as never)}>{project.status}</StatusPill>;
  const stepper = (
    <LifecycleStepper variant="bar" steps={dealJourneySteps(d.status as never)} aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')} className="[&_span]:text-xs" />
  );
  const backLink = (
    <Link to={back.path} state={back.state} className="inline-flex text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1">
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
  if (!d.isDesktop) {
    return (
      <>
        <div className="mb-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('projectDetail.pipeline.currentStage', 'Current stage')}</p>
            <h2 className="text-base font-semibold text-foreground">{stageLabel(project.status as never)}</h2>
          </div>
          {!d.canTransition ? (
            <p className="line-clamp-1 text-sm text-muted-foreground">{t('projectDetail.pipeline.readOnlyShort', 'Project manager manages this pipeline.')}</p>
          ) : !d.isTerminal && d.nextStage ? (
            <Button variant="primary" disabled={d.pending} onClick={() => void d.runTransition(d.nextStage!)}>
              {`${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${NEXT_STAGE_LABEL[d.status] ?? d.nextStage}`}
            </Button>
          ) : !d.isTerminal && d.canWin ? (
            <Button variant="primary" disabled={d.pending} onClick={() => { d.setShowWonPanel(true); setDetailsOpen(true); }}>
              {t('projectDetail.pipeline.markWon', 'Mark won')}
            </Button>
          ) : null}
        </div>
        <div className="mb-4">{journey}</div>
        <details className="min-w-0" open={detailsOpen} onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
          <summary className="mb-4 cursor-pointer text-sm font-semibold text-foreground">{t('projectDetail.pipeline.moreAboutDeal', 'More project details')}</summary>
          {detailsOpen && <div className="space-y-4">
            <DealActionsZone d={d}>{!d.isTerminal && <DealActionButtons d={d} secondaryOnly />}</DealActionsZone>
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
            <span className="text-xs font-medium text-muted-foreground">{t('projectDetail.pipeline.currentStage', 'Current stage')}</span>
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
