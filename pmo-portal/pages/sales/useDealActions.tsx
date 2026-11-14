import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useSalesPipeline } from '@/src/hooks/useDashboard';
import { useProjectWinEligibility } from '@/src/hooks/useProjectTransitions';
import { invalidateProjectProjections } from '@/src/hooks/projectQueryKeys';
import { repositories } from '@/src/lib/repositories';
import { synchronizeErpProject } from '@/src/lib/repositories/projectErpSetup';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import {
  LEGAL_PROJECT_TRANSITIONS, PIPELINE_STATUSES, projectStatusGroup, type TransitionProjectOpts,
} from '@/src/lib/db/projectTransitions';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { LostReasonValue } from '@/components/project-status/LostReasonFields';
import type { DealJourneyStage } from '../../components/salesPipeline';

export const NEXT_STAGE_LABEL: Record<string, string> = {
  Leads: 'Quotation',
  'Quotation Submitted': 'Pre-Qualification',
  'PQ Submitted': 'Tender',
  'Tender Submitted': 'Negotiation',
};

export const NEXT_STAGE_KEY: Record<string, string> = {
  Leads: 'quotation',
  'Quotation Submitted': 'preQualification',
  'PQ Submitted': 'tender',
  'Tender Submitted': 'negotiation',
};

export function useStageJourneyStepLabel(): (step: DealJourneyStage) => string {
  const { t } = useTranslation('project');
  return (step) => {
    switch (step) {
      case 'Leads':
        return t('projectDetail.pipeline.journey.leads', 'Leads');
      case 'Quotation':
        return t('projectDetail.pipeline.journey.quotation', 'Quotation');
      case 'Pre-Qualification':
        return t('projectDetail.pipeline.journey.preQualification', 'Pre-Qualification');
      case 'Tender':
        return t('projectDetail.pipeline.journey.tender', 'Tender');
      case 'Negotiation':
        return t('projectDetail.pipeline.journey.negotiation', 'Negotiation');
      case 'Won':
        return t('projectDetail.pipeline.journey.won', 'Won');
      case 'Lost':
        return t('projectDetail.pipeline.journey.lost', 'Lost');
      default:
        return step;
    }
  };
}

export function useDealActions(project: ProjectWithRefs) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const may = usePermission();
  const isDesktop = useIsDesktop();
  const today = useOrgToday();
  const stageLabel = useProjectStatusLabel();
  const canTransition = may('edit', 'project');
  const canSeeMoney = may('view', 'salesInvoice');
  const { data: pipeline, isPending: pipelinePending, isError: pipelineError, refetch: refetchPipeline } = useSalesPipeline();

  const status = project.status as string;
  const cached = pipeline?.projects.find((p) => p.id === project.id);
  const canEditProbability = canTransition && PIPELINE_STATUSES.includes(status);
  const legal = useMemo(() => LEGAL_PROJECT_TRANSITIONS[status] ?? [], [status]);
  const winIsLegal = legal.includes('Won, Pending KoM');
  const eligibility = useProjectWinEligibility(project.id, canTransition && winIsLegal, project.contract_value_set_at);
  const canWin = canTransition && winIsLegal && eligibility.data === 'allowed' && !eligibility.isPending && !eligibility.isFetching && !eligibility.isError;
  const winReason = canTransition && winIsLegal && (eligibility.isPending || eligibility.isFetching)
    ? t('winEligibility.checking', 'Checking win eligibility…')
    : canTransition && winIsLegal && eligibility.isError
      ? t('winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.')
      : canTransition && winIsLegal && eligibility.data && eligibility.data !== 'allowed'
        ? eligibility.data === 'unavailable'
          ? t('winEligibility.unavailable', 'Win eligibility is unavailable. Refresh this page and try again.')
          : eligibility.data === 'inactive_reviewer'
            ? t('winEligibility.inactive', 'Ask an active supervisor or a more senior reviewer to confirm the value.')
            : t('winEligibility.reviewer', 'Ask your supervisor or a more senior reviewer to confirm the value before winning this project.')
        : null;
  const canLose = legal.includes('Loss Tender');
  const canDecline = legal.includes('Declined');
  const nextStage = legal.find((s) => PIPELINE_STATUSES.includes(s));
  const nextStageKey = nextStage ? NEXT_STAGE_KEY[status] : undefined;
  const nextStageLabel = nextStageKey
    ? t(`projectDetail.pipeline.nextStage.${nextStageKey}`, NEXT_STAGE_LABEL[status])
    : (nextStage ? (NEXT_STAGE_LABEL[status] ?? stageLabel(nextStage)) : null);
  const isTerminal = projectStatusGroup(status as never) !== 'pipeline';

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'lost' | 'declined' | null>(null);
  const [lost, setLost] = useState<LostReasonValue>({ reason: '', note: '' });
  useEffect(() => { setLost({ reason: '', note: '' }); }, [confirmAction]);
  const [showWonPanel, setShowWonPanel] = useState(false);
  const [contractRef, setContractRef] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [refError, setRefError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [goInput, setGoInput] = useState('10');
  const [getInput, setGetInput] = useState('25');
  const [probError, setProbError] = useState<{ go: string | null; get: string | null }>({ go: null, get: null });
  const [saving, setSaving] = useState<'go' | 'get' | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (focusTimer.current) clearTimeout(focusTimer.current); }, []);
  useEffect(() => {
    if (cached?.go_probability !== undefined) setGoInput(String(Math.round(cached.go_probability * 100)));
    if (cached?.get_probability !== undefined) setGetInput(String(Math.round(cached.get_probability * 100)));
  }, [cached?.go_probability, cached?.get_probability, project.id]);

  const saveProbability = async (event: React.FormEvent<HTMLFormElement>, kind: 'go' | 'get') => {
    event.preventDefault();
    const percent = Number(kind === 'go' ? goInput : getInput);
    const fail = t('projectDetail.pipeline.probabilityFailed', "Couldn't save this probability. Check your access and retry.");
    const setErr = (v: string | null) => setProbError((e) => ({ ...e, [kind]: v }));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) { setErr(fail); return; }
    setErr(null);
    setSaving(kind);
    try {
      if (kind === 'go') await repositories.project.updateGoProbability(project.id, percent / 100);
      else await repositories.project.updateGetProbability(project.id, percent / 100);
      await queryClient.invalidateQueries({ queryKey: ['sales-pipeline', currentUser?.org_id] });
      await refetchPipeline();
      toast(
        t('projectDetail.pipeline.getProbabilitySaved', 'Opportunity estimate updated'),
        `${t(`projectDetail.pipeline.${kind}Probability`, kind === 'go' ? '% Go' : '% Get')}: ${percent}%`,
        'success',
      );
    } catch {
      setErr(fail);
    } finally {
      setSaving(null);
    }
  };

  const runTransition = async (to: string, opts?: TransitionProjectOpts) => {
    setError(null);
    setPending(true);
    try {
      if (opts) await repositories.project.transition(project.id, to as never, opts);
      else await repositories.project.transition(project.id, to as never);
      const erpPending = to === 'Won, Pending KoM' && (await synchronizeErpProject(project.id, currentUser?.org_id)) === 'pending';
      const org = currentUser?.org_id;
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'project-erp', org] });
      await queryClient.invalidateQueries({ queryKey: ['integrations', 'setup', org] });
      await queryClient.invalidateQueries({ queryKey: ['sales-pipeline', org] });
      await queryClient.invalidateQueries({ queryKey: ['projects', org] });
      await queryClient.invalidateQueries({ queryKey: ['project', org, project.id] });
      await queryClient.invalidateQueries({ queryKey: ['opportunity', org, project.id] });
      invalidateProjectProjections(queryClient, org);
      setShowWonPanel(false);
      setContractRef('');
      setContractDate('');
      setConfirmAction(null);
      const fromIndex = PIPELINE_STATUSES.indexOf(status);
      const toIndex = PIPELINE_STATUSES.indexOf(to);
      const movedBack = fromIndex >= 0 && toIndex >= 0 && toIndex < fromIndex;
      toast(
        t('sales:statusChange.updated', 'Project updated'),
        erpPending
          ? t('projectDetail.erpLink.movedPending', 'Moved to {{status}}. ERP linking needs attention; retry from the project page.', { status: stageLabel(to) })
          : t(
            movedBack ? 'sales:statusChange.movedBack' : 'sales:statusChange.movedForward',
            movedBack ? 'Moved back to {{status}}' : 'Moved to {{status}}',
            { status: stageLabel(to) },
          ),
        erpPending ? 'warning' : 'success',
      );
      if (to === 'Won, Pending KoM') {
        focusTimer.current = setTimeout(() => document.querySelector<HTMLElement>('h1')?.focus(), 80);
      } else {
        headingRef.current?.focus();
      }
    } catch (err) {
      setConfirmAction(null);
      setError(err instanceof Error ? err.message : t('projectDetail.pipeline.transitionFailed', 'Transition failed'));
    } finally {
      setPending(false);
    }
  };

  const submitWon = () => {
    if (!canWin) return;
    const refMissing = !contractRef.trim();
    const dateMissing = !contractDate;
    setRefError(refMissing ? t('projectDetail.pipeline.refRequired', 'Customer contract reference is required') : null);
    setDateError(dateMissing ? t('projectDetail.pipeline.dateRequired', 'Contract date is required') : null);
    if (refMissing || dateMissing) return;
    void runTransition('Won, Pending KoM', { customerContractRef: contractRef.trim(), contractDate });
  };

  return {
    project, status, cached, isDesktop, today, stageLabel,
    canTransition, canSeeMoney, canEditProbability, canWin, canLose, canDecline, nextStage, nextStageLabel, isTerminal, winReason,
    pipelinePending, pipelineError, refetchPipeline,
    error, pending, confirmAction, setConfirmAction, lost, setLost,
    showWonPanel, setShowWonPanel, contractRef, setContractRef, contractDate, setContractDate, refError, setRefError, dateError, setDateError,
    goInput, setGoInput, getInput, setGetInput, probError, saving, saveProbability,
    headingRef, runTransition, submitWon,
  };
}
export type DealActions = ReturnType<typeof useDealActions>;
