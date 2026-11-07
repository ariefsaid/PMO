import React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, GateNotice, Icon, LifecycleStepper, RecordActionZone, TaxBasisLabel } from '@/src/components/ui';
import { LostReasonFields } from '@/components/project-status/LostReasonFields';
import { lostReasonLabel, lostReasonValid } from '@/src/lib/lostReasons';
import { formatCurrency, formatDecisionDateNumeric } from '@/src/lib/format';
import { formatPercent, dealJourneySteps, weightedValue } from '../../../components/salesPipeline';
import StageHistory from '../../project-detail/StageHistory';
import { NEXT_STAGE_LABEL, type DealActions } from './useDealActions';

type Fig = { key: string; label: string; value: React.ReactNode; sub?: React.ReactNode };

/** The deal's figures, one list: open deals show what is in play, decided deals show the decision. */
function useDealFigures(d: DealActions): Fig[] {
  const { t } = useTranslation('project');
  const p = d.project;
  const unavailable = (
    <span className="inline-flex items-center gap-1.5 text-sm font-normal text-muted-foreground">
      {t('projectDetail.pipeline.statUnavailable', 'Unavailable')}
      <Button variant="ghost" size="sm" onClick={() => void d.refetchPipeline()}>{t('projectDetail.pipeline.retry', 'Retry')}</Button>
    </span>
  );
  const loading = <span className="text-sm font-normal text-muted-foreground">{t('projectDetail.pipeline.statLoading', 'Loading…')}</span>;
  const gate = (node: React.ReactNode) => (d.pipelinePending ? loading : d.pipelineError || !d.cached ? unavailable : node);
  const prob = (kind: 'go' | 'get') => {
    const input = kind === 'go' ? d.goInput : d.getInput;
    const set = kind === 'go' ? d.setGoInput : d.setGetInput;
    const err = d.probError[kind];
    const label = kind === 'go'
      ? t('projectDetail.pipeline.goInputLabel', 'Chance the project proceeds (%)')
      : t('projectDetail.pipeline.getInputLabel', 'Chance we win if the client proceeds (%)');
    if (!d.canEditProbability) {
      return formatPercent(kind === 'go' ? (d.cached?.go_probability ?? d.cached?.win_probability ?? 0) : (d.cached?.get_probability ?? 0.25));
    }
    return (
      <form onSubmit={(e) => void d.saveProbability(e, kind)} className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`opt-${kind}-${p.id}`}>{label}</label>
        <input id={`opt-${kind}-${p.id}`} type="number" min={0} max={100} step={1} value={input} onChange={(e) => set(e.target.value)} disabled={d.saving !== null}
          className="h-9 w-20 rounded-[var(--radius-control)] border border-input bg-background px-2 text-sm tabular focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" />
        <Button type="submit" variant="outline" size="sm" disabled={d.saving !== null}>
          {d.saving === kind ? t('projectDetail.pipeline.statLoading', 'Loading…') : t('projectDetail.pipeline.saveProbability', 'Save')}
        </Button>
        {err && <span role="alert" className="w-full text-xs text-destructive-text">{err}</span>}
      </form>
    );
  };
  const value: Fig = {
    key: 'value', label: t('projectDetail.pipeline.stat.value', 'Value'), value: formatCurrency(p.contract_value ?? d.cached?.contract_value ?? 0, p.currency),
    sub: <TaxBasisLabel treatment={p.tax_treatment} taxRate={p.tax_rate} taxBaseNumerator={p.tax_base_numerator} taxBaseDenominator={p.tax_base_denominator} />,
  };
  const owner: Fig = { key: 'owner', label: t('projectDetail.pipeline.stat.owner', 'Owner'), value: p.pm?.full_name ?? t('projectDetail.pipeline.notSet', 'Not set') };
  const isLost = p.status === 'Loss Tender' || p.status === 'Declined';
  if (d.isTerminal) {
    return [
      ...(d.canSeeMoney ? [value] : []),
      owner,
      {
        key: 'decision', label: t('projectDetail.pipeline.stat.decision', 'Decision'),
        value: p.contract_date || (isLost && p.decided_at) ? formatDecisionDateNumeric(p) : t('projectDetail.pipeline.pending', 'Pending'),
      },
      ...(isLost ? [{ key: 'reason', label: t('lostReason:deal.label', 'Lost reason'), value: lostReasonLabel((k, def) => String(t(k, def)), p.lost_reason) }] : []),
    ];
  }
  return [
    ...(d.canSeeMoney ? [value] : []),
    { key: 'go', label: t('projectDetail.pipeline.goProbability', '% Go'), value: gate(prob('go')) },
    { key: 'get', label: t('projectDetail.pipeline.getProbability', '% Get'), value: gate(prob('get')) },
    ...(d.canSeeMoney ? [{ key: 'weighted', label: t('projectDetail.pipeline.stat.weighted', 'Weighted'), value: gate(d.cached ? formatCurrency(weightedValue(d.cached), p.currency) : null) }] : []),
    owner,
  ];
}

export const DealFigures: React.FC<{ d: DealActions; className?: string }> = ({ d, className }) => {
  const figs = useDealFigures(d);
  const isLost = d.project.status === 'Loss Tender' || d.project.status === 'Declined';
  return (
    <>
      <dl className={className ?? 'grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4'}>
        {figs.map((f) => (
          <div key={f.key} className="min-w-0 border-b border-border pb-2">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="mt-1 break-words text-base font-semibold tabular-nums text-foreground">{f.value}</dd>
            {f.sub && <dd className="mt-1 text-xs text-muted-foreground">{f.sub}</dd>}
          </div>
        ))}
      </dl>
      {isLost && d.project.lost_note && <p data-testid="lost-note" className="mt-2 text-xs text-muted-foreground">{d.project.lost_note}</p>}
    </>
  );
};

export const DealJourney: React.FC<{ d: DealActions; history?: boolean }> = ({ d, history = true }) => {
  const { t } = useTranslation('project');
  return (
    <section className="min-w-0 space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.pipeline.journeyHeading', 'Project journey')}</h2>
      <LifecycleStepper variant="bar" steps={dealJourneySteps(d.status as never)} aria-label={t('projectDetail.pipeline.journeyAriaLabel', 'Project stage journey')} className="[&_span]:text-xs" />
      {history && <StageHistory projectId={d.project.id} />}
    </section>
  );
};

/** The one filled action (Advance, or Mark won at the last stage), plus Won / Lost / Decline. */
export const DealActionButtons: React.FC<{ d: DealActions; primaryOnly?: boolean; secondaryOnly?: boolean }> = ({ d, primaryOnly, secondaryOnly }) => {
  const { t } = useTranslation('project');
  if (d.isTerminal) return null;
  const advanceLabel = d.nextStage ? `${t('projectDetail.pipeline.advanceTo', 'Advance to')} ${NEXT_STAGE_LABEL[d.status] ?? d.nextStage}` : null;
  return (
    <div className="flex flex-wrap gap-2">
      {!secondaryOnly && d.nextStage && (
        <Button variant="primary" disabled={d.pending} onClick={() => void d.runTransition(d.nextStage!)}>{advanceLabel}</Button>
      )}
      {!secondaryOnly && !d.nextStage && d.canWin && (
        <Button variant="primary" disabled={d.pending} onClick={() => d.setShowWonPanel(true)}>{t('projectDetail.pipeline.markWon', 'Mark won')}</Button>
      )}
      {!primaryOnly && d.nextStage && d.canWin && (
        <Button variant="outline" disabled={d.pending} onClick={() => d.setShowWonPanel((v) => !v)}>
          <span aria-hidden className="size-1.5 rounded-full bg-success" />{t('projectDetail.pipeline.markWon', 'Mark won')}
        </Button>
      )}
      {!primaryOnly && d.canLose && (
        <Button variant="outline" disabled={d.pending} onClick={() => d.setConfirmAction('lost')}>
          <span aria-hidden className="size-1.5 rounded-full bg-destructive" />{t('projectDetail.pipeline.markLost', 'Mark lost')}
        </Button>
      )}
      {!primaryOnly && d.canDecline && (
        <Button variant="outline" disabled={d.pending} onClick={() => d.setConfirmAction('declined')}>
          <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground" />{t('projectDetail.pipeline.markDeclined', 'Decline to bid')}
        </Button>
      )}
    </div>
  );
};

/** Everything an action needs to say: read-only notice, terminal notice, win gate, errors, the won form. */
export const DealActionsZone: React.FC<{ d: DealActions; children?: React.ReactNode }> = ({ d, children }) => {
  const { t } = useTranslation('project');
  const p = d.project;
  const wonForm = d.showWonPanel && d.canWin && (
    <section className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="text-xs font-semibold text-muted-foreground">{t('projectDetail.pipeline.recordWonHeading', 'Record the won project')}</div>
      <div className="text-[13px] text-foreground">
        <Trans i18nKey="projectDetail.pipeline.bookingOnWin" t={t} defaults="Booking <1>{{amount}}</1> <3></3> to contract value on win"
          values={{ amount: formatCurrency(p.contract_value ?? 0, p.currency) }}
          components={{ 1: <strong className="font-semibold tabular" />, 3: <TaxBasisLabel treatment={p.tax_treatment} taxRate={p.tax_rate} taxBaseNumerator={p.tax_base_numerator} taxBaseDenominator={p.tax_base_denominator} /> }} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="won-ref" className="text-xs font-semibold">{t('projectDetail.pipeline.contractRefLabel', 'Customer contract reference')}</label>
        <input id="won-ref" value={d.contractRef} onChange={(e) => { d.setContractRef(e.target.value); d.setRefError(null); }} aria-invalid={!!d.refError} aria-describedby={d.refError ? 'won-ref-err' : undefined}
          placeholder={t('projectDetail.pipeline.contractRefPlaceholder', 'e.g. CPO-2026-0042')}
          className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none placeholder:text-muted-foreground ${d.refError ? 'border-destructive' : 'border-input'}`} />
        {d.refError && <span id="won-ref-err" className="text-xs text-destructive">{d.refError}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="won-date" className="text-xs font-semibold">{t('projectDetail.pipeline.contractDateLabel', 'Contract date')}</label>
        <input id="won-date" type="date" max={d.today} value={d.contractDate} onChange={(e) => { d.setContractDate(e.target.value); d.setDateError(null); }} aria-invalid={!!d.dateError} aria-describedby={d.dateError ? 'won-date-err' : undefined}
          className={`h-8 rounded-md border bg-background px-2.5 text-[13.5px] outline-none ${d.dateError ? 'border-destructive' : 'border-input'}`} />
        {d.dateError && <span id="won-date-err" className="text-xs text-destructive">{d.dateError}</span>}
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={d.pending} onClick={d.submitWon}>{t('projectDetail.pipeline.confirmWon', 'Confirm won')}</Button>
        <Button variant="ghost" size="sm" onClick={() => d.setShowWonPanel(false)}>{t('projectDetail.pipeline.cancel', 'Cancel')}</Button>
      </div>
    </section>
  );
  return (
    <div className="min-w-0 space-y-3">
      <div ref={d.headingRef} tabIndex={-1} className="outline-none focus-visible:ring-0">
        <h2 className="text-sm font-semibold text-foreground">{t('projectDetail.pipeline.nextActionsHeading', 'Next actions')}</h2>
      </div>
      {!d.canTransition ? (
        <GateNotice variant="ready">
          {t('projectDetail.pipeline.readOnlyNotice', 'Pipeline managed by the project owner. You can review this project’s stage and journey here; lifecycle changes are made by the project manager.')}
        </GateNotice>
      ) : (
        <>
          {d.isTerminal && (
            <GateNotice variant="ready">
              {p.status === 'Loss Tender' || p.status === 'Declined'
                ? t('projectDetail.pipeline.lostNotice', 'This project is marked lost. It has left the active pipeline.')
                : t('projectDetail.pipeline.terminalNotice', 'This project has reached a terminal stage. No further pipeline actions.')}
            </GateNotice>
          )}
          {!d.isTerminal && d.winReason && <p role="status" className="text-sm text-muted-foreground">{d.winReason}</p>}
          {children ?? (!d.isTerminal && <RecordActionZone sticky={false}><DealActionButtons d={d} /></RecordActionZone>)}
          {wonForm}
          {d.error && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-destructive">
              <Icon name="alert" className="mt-px size-4 shrink-0" /><span>{d.error}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** Mark lost / Decline confirm dialogs. Mount once per page. */
export const DealDialogs: React.FC<{ d: DealActions }> = ({ d }) => {
  const { t } = useTranslation('project');
  const name = d.project.name;
  const mk = (kind: 'lost' | 'declined') => (
    <ConfirmDialog
      open={d.canTransition && d.confirmAction === kind}
      tone="destructive"
      title={kind === 'lost' ? t('projectDetail.pipeline.lostConfirm.title', 'Mark project as lost') : t('projectDetail.pipeline.declinedConfirm.title', 'Decline to bid')}
      description={
        <>
          <p>
            {kind === 'lost'
              ? t('projectDetail.pipeline.lostConfirm.body', 'This moves {{project}} to a terminal lost stage. You can still review it, but it will leave the active pipeline.', { project: name })
              : t('projectDetail.pipeline.declinedConfirm.body', 'This records {{project}} as declined: we chose not to bid. It leaves the active pipeline and is not counted against the win rate.', { project: name })}
          </p>
          <LostReasonFields idPrefix="opt" value={d.lost} onChange={d.setLost} />
        </>
      }
      confirmLabel={kind === 'lost' ? t('projectDetail.pipeline.lostConfirm.confirm', 'Mark lost') : t('projectDetail.pipeline.declinedConfirm.confirm', 'Decline to bid')}
      confirmDisabled={!lostReasonValid(d.lost.reason, d.lost.note)}
      loading={d.pending}
      onCancel={() => d.setConfirmAction(null)}
      onConfirm={() => void d.runTransition(kind === 'lost' ? 'Loss Tender' : 'Declined', { lostReason: d.lost.reason, lostNote: d.lost.note.trim() || undefined })}
    />
  );
  return <>{mk('lost')}{mk('declined')}</>;
};
