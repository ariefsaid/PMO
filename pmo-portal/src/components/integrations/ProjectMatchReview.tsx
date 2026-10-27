import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { INTERNAL_STATUSES, ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { repositories } from '@/src/lib/repositories';
import type {
  ErpProjectOption,
  IntegrationBinding,
} from '@/src/lib/repositories/types';
import {
  Button,
  Combobox,
  type ComboboxOption,
  ConfirmDialog,
  ListState,
  TextField,
} from '@/src/components/ui';
import {
  proposeProjectMatches,
  type ProjectMatchProposal,
} from '@/src/lib/repositories/projectMatchReview';

type ReviewProject = { id: string; name: string; code: string | null };
type SelectedTargets = Record<string, string>;
type ChosenOptions = Record<string, ComboboxOption>;

const REVIEWABLE_PROJECT_STATUSES = new Set<string>([
  ...ON_HAND_STATUSES,
  ...INTERNAL_STATUSES,
]);

function projectMap(binding: IntegrationBinding | null | undefined) {
  const value = binding?.config.project_map;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function projectTarget(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function candidateOption(project: ErpProjectOption): ComboboxOption {
  return {
    value: project.name,
    label: `${project.project_name} (${project.name})`,
  };
}

function projectHref(siteUrl: string | undefined, projectName: string) {
  if (!siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    return url.protocol === 'https:'
      ? `${url.origin}/app/project/${encodeURIComponent(projectName)}`
      : null;
  } catch {
    return null;
  }
}

export function ProjectMatchReview({
  projectId,
  orgId,
  projects: queueProjects,
}: {
  projectId?: string;
  orgId?: string;
  projects?: ReviewProject[];
}) {
  const { t } = useTranslation();
  const may = usePermission();
  const canManage = may('manage', 'integration');
  // Same gate Administration uses to let a role in; a link to a page they cannot open is a dead end.
  const canOpenAdministration = may('view', 'user');
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedTargets, setSelectedTargets] = useState<SelectedTargets>({});
  // Every chosen option, kept apart from the (search-replaced) candidate list so a queued
  // choice keeps its label after a later search.
  const [chosenOptions, setChosenOptions] = useState<ChosenOptions>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const bindingKey = projectId
    ? ['integrations', 'project-erp', orgId, projectId] as const
    : ['integrations', 'project-match-binding', orgId] as const;
  const binding = useQuery({
    queryKey: bindingKey,
    queryFn: () => repositories.integrations.getBinding(orgId!, 'erpnext'),
    enabled: Boolean(orgId),
    retry: false,
  });
  const setup = useQuery({
    queryKey: ['integrations', 'setup', orgId],
    queryFn: () => repositories.integrations.getErpSetup(),
    enabled: Boolean(orgId && !projectId && queueProjects === undefined),
    retry: false,
  });
  const project = useQuery({
    queryKey: ['opportunity', orgId, projectId],
    queryFn: () => repositories.project.get(projectId!),
    enabled: Boolean(orgId && projectId),
    retry: false,
  });
  const connected = binding.data?.status === 'active' &&
    Boolean(binding.data.config.company);
  const candidates = useQuery({
    queryKey: ['integrations', 'project-match-candidates', orgId, candidateSearch],
    queryFn: () => repositories.integrations.listErpProjects(candidateSearch),
    // On a project page the list loads only once the review is opened (the ERP bench is small).
    enabled: Boolean(orgId && canManage && connected && (!projectId || reviewOpen)),
    retry: false,
  });

  const rows: ReviewProject[] = useMemo(() => {
    if (projectId) {
      const detailProject = project.data;
      if (!detailProject?.status ||
        !REVIEWABLE_PROJECT_STATUSES.has(detailProject.status)) return [];
      return [{
        id: detailProject.id,
        name: detailProject.name,
        code: detailProject.code,
      }];
    }
    return queueProjects ?? setup.data?.unmappedProjects ?? [];
  }, [project.data, projectId, queueProjects, setup.data?.unmappedProjects]);
  const candidateRows = useMemo(() => candidates.data ?? [], [candidates.data]);
  // The unfiltered endpoint is complete only below its 100-row cap. Search responses use
  // capped substring queries, so they remain manual choices and never produce a unique proposal.
  const complete = candidateSearch === '' && candidateRows.length < 100;
  const proposals = useMemo(
    () => proposeProjectMatches(rows, candidateRows, complete),
    [rows, candidateRows, complete],
  );
  const proposalByProject = new Map<string, ProjectMatchProposal>(
    proposals.map((proposal) => [proposal.projectId, proposal]),
  );
  const currentMappings = projectMap(binding.data);
  const selectedRows = rows.filter((row) => Boolean(selectedTargets[row.id]));
  const confirmationDescription = (
    <ul className='space-y-2 text-sm'>
      {selectedRows.map((row) => {
        const current = projectTarget(currentMappings[row.id]) ??
          t('uxs09.noCurrentLink', 'No current ERP Project');
        return (
          <li key={row.id} className='break-words'>
            <span className='font-medium text-foreground'>{row.name}</span>
            <span className='text-muted-foreground'>: {current} → </span>
            <span className='font-medium text-foreground'>
              {selectedTargets[row.id]}
            </span>
          </li>
        );
      })}
    </ul>
  );

  const retryCandidates = () => void candidates.refetch();
  const runSearch = () => {
    const next = searchText.trim();
    if (next === candidateSearch) retryCandidates();
    else setCandidateSearch(next);
    setOutcome(null);
  };

  const chooseTarget = (rowId: string, value: string, option: ComboboxOption) => {
    setSelectedTargets((previous) => ({ ...previous, [rowId]: value }));
    setChosenOptions((previous) => ({ ...previous, [rowId]: option }));
    setRowErrors((previous) => {
      const next = { ...previous };
      delete next[rowId];
      return next;
    });
    setOutcome(null);
  };

  const clearTarget = (rowId: string) => {
    setSelectedTargets((previous) => {
      const next = { ...previous };
      delete next[rowId];
      return next;
    });
    setChosenOptions((previous) => {
      const next = { ...previous };
      delete next[rowId];
      return next;
    });
    setOutcome(null);
  };

  const failureCopy = (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'external-unreachable') {
      return t('uxs09.upstreamUnavailable', 'ERPNext could not be reached. Retry when the connection is available.');
    }
    if (code === 'config-rejected' || code === 'NOT_FOUND') {
      return t('uxs09.connectionChanged', 'The project or ERP connection changed. Refresh the review and choose again.');
    }
    return t('uxs09.saveFailed', 'This project link was not saved. Your selection is kept so you can retry.');
  };

  const confirmLinks = async () => {
    setSaving(true);
    setRowErrors({});
    let saved = 0;
    let failed = 0;
    const savedIds: string[] = [];
    const errors: Record<string, string> = {};
    for (const row of selectedRows) {
      const target = selectedTargets[row.id];
      if (!target) continue;
      try {
        await repositories.integrations.linkErpProject(
          row.id,
          target,
          projectTarget(currentMappings[row.id]),
        );
        saved++;
        savedIds.push(row.id);
      } catch (error) {
        failed++;
        errors[row.id] = failureCopy(error);
      }
    }
    setSelectedTargets((previous) => {
      const next = { ...previous };
      savedIds.forEach((id) => delete next[id]);
      return next;
    });
    setRowErrors(errors);
    setOutcome([
      t('uxs09.savedCount', { count: saved, defaultValue_one: '{{count}} link saved', defaultValue_other: '{{count}} links saved' }),
      failed > 0
        ? t('uxs09.attentionCount', { count: failed, defaultValue_one: '{{count}} needs attention', defaultValue_other: '{{count}} need attention' })
        : null,
    ].filter(Boolean).join('; ') + '.');
    setConfirmationOpen(false);
    setSaving(false);
    if (saved) {
      void queryClient.invalidateQueries({ queryKey: ['integrations', 'project-erp', orgId] });
      void queryClient.invalidateQueries({ queryKey: bindingKey });
      void queryClient.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      void queryClient.invalidateQueries({ queryKey: ['integrations', 'setup', orgId] });
    }
  };

  const retryAll = () => {
    if (projectId) void project.refetch();
    else void setup.refetch();
    void binding.refetch();
  };

  if (!orgId) return null;
  if (binding.isPending) {
    return (
      <p role='status' className='text-sm text-muted-foreground'>
        {t('uxs09.loading', 'Loading ERP project links…')}
      </p>
    );
  }
  if (binding.isError) {
    return (
      <ListState
        variant='error'
        title={t('uxs09.unavailable', 'ERP project review is unavailable')}
        sub={t('uxs09.retryHelp', 'Readiness is unknown. Retry the check or ask an administrator to review the ERP connection.')}
        onRetry={retryAll}
      />
    );
  }
  if (!connected) return null;
  if (projectId && project.isPending) {
    return <ListState variant='loading' rows={2} />;
  }
  if (projectId && project.isError) {
    return (
      <ListState
        variant='error'
        title={t('uxs09.unavailable', 'ERP project review is unavailable')}
        sub={t('uxs09.projectRetryHelp', 'The PMO project could not be refreshed. Retry before reviewing a link.')}
        onRetry={() => void project.refetch()}
      />
    );
  }
  if (!projectId && queueProjects === undefined && setup.isPending) return <ListState variant='loading' rows={3} />;
  if (!projectId && queueProjects === undefined && setup.isError) {
    return (
      <ListState
        variant='error'
        title={t('uxs09.unavailable', 'ERP project review is unavailable')}
        sub={t('uxs09.retryHelp', 'Readiness is unknown. Retry the check or ask an administrator to review the ERP connection.')}
        onRetry={() => void setup.refetch()}
      />
    );
  }

  const currentTarget = projectId && typeof currentMappings[projectId] === 'string'
    ? String(currentMappings[projectId])
    : null;
  const currentTargetHref = currentTarget
    ? projectHref(binding.data?.site_url, currentTarget)
    : null;
  const projectCanReview = rows.length > 0;
  // A pre-win project has nothing to link: render no empty heading.
  if (projectId && !projectCanReview && !currentTarget) return null;
  const headingId = projectId ? 'project-erp-match-heading' : 'erp-project-review-heading';
  const openReview = () => {
    setSelectedTargets({});
    setChosenOptions({});
    setRowErrors({});
    setOutcome(null);
    setSearchText('');
    setCandidateSearch('');
    setReviewOpen(true);
  };

  return (
    <section
      aria-labelledby={headingId}
      className='min-w-0 space-y-3'
    >
      <h3 id={headingId} className='text-sm font-semibold text-foreground'>
        {projectId
          ? t('uxs09.projectLinkTitle', 'ERPNext Project')
          : t('uxs09.reviewTitle', 'Review existing ERP project matches')}
      </h3>

      {projectId && currentTarget && (
        currentTargetHref
          ? (
            <a
              className='block break-words text-sm font-medium text-foreground underline underline-offset-4'
              href={currentTargetHref}
              target='_blank'
              rel='noopener noreferrer'
            >
              {currentTarget}
            </a>
          )
          : <p className='break-words text-sm text-foreground'>{currentTarget}</p>
      )}
      {projectId && projectCanReview && !currentTarget && (
        <p className='text-sm text-muted-foreground'>
          {t('uxs09.notLinked', 'Not linked yet')}
        </p>
      )}
      {projectId && projectCanReview && canManage && !reviewOpen && (
        <Button variant='outline' size='sm' onClick={openReview}>
          {t('uxs09.reviewAction', 'Review project match')}
        </Button>
      )}
      {projectId && projectCanReview && !canManage && (
        <p className='text-sm text-muted-foreground'>
          {currentTarget
            ? t('uxs09.readOnlyLinked', 'Ask an administrator to review changes to this ERP project link.')
            : t('uxs09.readOnlyHandoff', 'Ask an administrator to review the ERP project match.')}{' '}
          {canOpenAdministration && (
            <a className='font-medium text-foreground underline underline-offset-4' href='/administration/integrations'>
              {t('uxs09.openSetup', 'Open organization ERP setup')}
            </a>
          )}
        </p>
      )}

      {(!projectId || reviewOpen) && (
        <div className='space-y-4'>
          {!projectId && (
            <p className='max-w-[65ch] text-sm text-muted-foreground'>
              {t('uxs09.reviewDescription', 'Review existing ERP projects and confirm only the links you choose. The review never creates ERP projects.')}
            </p>
          )}

          {canManage && (
            <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end'>
              <TextField
                label={t('uxs09.searchLabel', 'Search existing ERP projects')}
                value={searchText}
                onChange={setSearchText}
                placeholder={t('uxs09.searchPlaceholder', 'Search by ERP project name or ID')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    runSearch();
                  }
                }}
              />
              <Button variant='outline' size='sm' onClick={runSearch} loading={candidates.isFetching}>
                {t('uxs09.searchAction', 'Search')}
              </Button>
            </div>
          )}

          {candidates.isError && !candidates.data
            ? (
              <ListState
                variant='error'
                title={t('uxs09.candidatesUnavailable', 'Existing ERP project choices are unavailable')}
                sub={t('uxs09.candidatesRetryHelp', 'No match is assumed. Retry the search or ask an administrator to check the connection.')}
                onRetry={retryCandidates}
              />
            )
            : candidateRows.length === 0 && candidates.isSuccess
            ? (
              <p className='rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground' role='status'>
                {t('uxs09.noCandidates', 'No existing ERP projects were returned for this search. Search again or ask an administrator to review the connection.')}
              </p>
            )
            : !candidates.data
            ? <ListState variant='loading' rows={2} />
            : null}

          {!complete && candidates.data && candidates.data.length > 0 && (
            <p role='status' className='rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground'>
              {t('uxs09.incompleteCandidates', 'The loaded results may be incomplete. No absence or unique match is assumed; search and choose an existing project explicitly.')}
            </p>
          )}

          {rows.length === 0 && candidates.data && (
            <p role='status' className='py-3 text-sm text-muted-foreground'>
              {projectId
                ? t('uxs09.projectNotEligible', 'Project match review is available for delivery or Internal Project records.')
                : t('uxs09.queueEmpty', 'No delivery or Internal Project matches need review.')}
            </p>
          )}

          {rows.length > 0 && (
            <ul className='divide-y divide-border rounded-md border border-border'>
              {rows.map((row) => {
                const proposal = proposalByProject.get(row.id);
                const suggestedCandidate = proposal?.candidateId
                  ? candidateRows.find((candidate) => candidate.name.trim() === proposal.candidateId)
                  : undefined;
                const selectedOption = chosenOptions[row.id] ?? null;
                return (
                  <li key={row.id} className='min-w-0 space-y-3 p-3 sm:p-4'>
                    <div className='min-w-0'>
                      <p className='break-words text-sm font-semibold text-foreground'>
                        {row.name}
                      </p>
                      <p className='mt-1 break-words text-sm text-muted-foreground'>
                        {row.code
                          ? t('uxs09.projectCode', 'Client project code: {{code}}', { code: row.code })
                          : t('uxs09.noProjectCode', 'No client project code recorded')}
                      </p>
                      {projectId && currentTarget && (
                        <p className='mt-1 break-words text-sm text-muted-foreground'>
                          {t('uxs09.currentTarget', 'Current ERP project: {{name}}', { name: currentTarget })}
                        </p>
                      )}
                    </div>

                    {proposal?.state === 'proposed' && suggestedCandidate &&
                      suggestedCandidate.name !== currentTarget && (
                        <div className='rounded-md border border-border bg-muted/30 p-3'>
                          <p className='text-sm text-foreground'>
                            {t('uxs09.suggestedMatch', 'Suggested exact match: {{name}} ({{id}})', {
                              name: suggestedCandidate.project_name,
                              id: suggestedCandidate.name,
                            })}
                          </p>
                          <Button
                            variant='outline'
                            size='sm'
                            className='mt-2'
                            disabled={saving}
                            aria-label={t('uxs09.useSuggestion', 'Use suggested match for {{name}}', { name: row.name })}
                            onClick={() => chooseTarget(row.id, suggestedCandidate.name, candidateOption(suggestedCandidate))}
                          >
                            {t('uxs09.useSuggestionShort', 'Use this match')}
                          </Button>
                        </div>
                      )}

                    {proposal?.state === 'ambiguous' && (
                      <p role='status' className='break-words text-sm text-muted-foreground'>
                        {t('uxs09.ambiguousMatch', 'More than one exact match is loaded. Choose the intended ERP project below.')}{' '}
                        {proposal.candidateIds.join(', ')}
                      </p>
                    )}
                    {proposal?.state === 'unresolved' && (
                      <p role='status' className='break-words text-sm text-muted-foreground'>
                        {proposal.candidateIds.length
                          ? t('uxs09.possibleMatch', 'Possible loaded match: {{ids}}. Choose an ERP project explicitly.', { ids: proposal.candidateIds.join(', ') })
                          : t('uxs09.noExactMatch', 'No exact match is loaded. Search ERPNext or choose an existing project.')}
                      </p>
                    )}

                    {canManage && candidateRows.length > 0 && (
                      <Combobox
                        label={t('uxs09.candidateLabel', 'ERP project for {{name}}', { name: row.name })}
                        value={selectedTargets[row.id] ?? null}
                        selectedOption={selectedOption}
                        onChange={(value, option) => chooseTarget(row.id, value, option)}
                        clearable
                        onClear={() => clearTarget(row.id)}
                        loadOptions={async () => candidateRows.map(candidateOption)}
                        placeholder={t('uxs09.pickerPlaceholder', 'Select ERP project')}
                        noun={t('uxs09.projectNoun', 'ERP project')}
                        searchPlaceholder={t('uxs09.pickerSearch', 'Search loaded ERP projects')}
                      />
                    )}
                    {rowErrors[row.id] && (
                      <p role='alert' className='break-words text-sm text-destructive-text'>
                        {rowErrors[row.id]}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && selectedRows.length > 0 && (
            <Button
              variant='primary'
              size='sm'
              disabled={saving}
              onClick={() => setConfirmationOpen(true)}
            >
              {t('uxs09.reviewSelected', 'Review selected links')}
            </Button>
          )}
          {outcome && <p role='status' className='text-sm text-muted-foreground'>{outcome}</p>}
          {projectId && reviewOpen && (
            <Button variant='ghost' size='sm' onClick={() => setReviewOpen(false)}>
              {t('uxs09.closeReview', 'Close review')}
            </Button>
          )}
          {projectId && canManage && (
            <a className='block w-fit text-sm font-medium text-foreground underline underline-offset-4' href='/administration/integrations'>
              {t('uxs09.operatorRecovery', 'Open organization ERP setup')}
            </a>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmationOpen}
        title={t('uxs09.confirmTitle', 'Confirm ERP project matches')}
        description={confirmationDescription}
        confirmLabel={t('uxs09.confirmAction', 'Confirm links')}
        loading={saving}
        confirmDisabled={selectedRows.length === 0}
        onConfirm={() => void confirmLinks()}
        onCancel={() => setConfirmationOpen(false)}
      />
    </section>
  );
}
