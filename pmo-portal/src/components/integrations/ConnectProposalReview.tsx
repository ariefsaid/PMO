import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import type {
  ConnectCensusRow,
  ConnectKind,
  ConnectProposal,
  ConnectReviewChoice,
  ConnectStagedRecord,
  ConnectTier,
} from '@/src/lib/repositories/types';
import {
  Button,
  Card,
  Checkbox,
  Combobox,
  type ComboboxOption,
  ConfirmDialog,
  Icon,
  ListState,
  StatusPill,
} from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface ConnectProposalReviewProps {
  tier?: ConnectTier;
  /** Present for call-site symmetry with the other integration panels; the tier-scoped
   *  edge actions resolve the org server-side, so the client never threads it (ADR-0017). */
  orgId?: string;
  open?: boolean;
  onClose?: () => void;
}

/** Master kinds in the fixed presentation order (FR-ECA-001): one card each, plain words only. */
const MASTER_KINDS: Array<{ kind: ConnectKind; labelKey: string; defaultLabel: string; nounKey: string; nounDefault: string }> = [
  { kind: 'party', labelKey: 'integrations.connect.clientsAndVendors', defaultLabel: 'Clients & vendors', nounKey: 'integrations.connect.nounParty', nounDefault: 'vendors' },
  { kind: 'project', labelKey: 'integrations.connect.projects', defaultLabel: 'Projects', nounKey: 'integrations.connect.nounProject', nounDefault: 'projects' },
  { kind: 'item', labelKey: 'integrations.connect.items', defaultLabel: 'Items', nounKey: 'integrations.connect.nounItem', nounDefault: 'items' },
  { kind: 'employee', labelKey: 'integrations.connect.people', defaultLabel: 'People', nounKey: 'integrations.connect.nounEmployee', nounDefault: 'people' },
  { kind: 'account', labelKey: 'integrations.connect.accounts', defaultLabel: 'Accounts', nounKey: 'integrations.connect.nounAccount', nounDefault: 'accounts' },
];

type TFunc = (key: string, defaultValue: string, options?: Record<string, unknown>) => string;

/**
 * Plain census line per kind (FR-ECA-002). With open actions the line states every outcome;
 * without them it reads "<12 vendors> in PMO, 40 in the connected system, 9 are the same".
 * A domain the connected system cannot count yet reads "Not checked in your connected system yet", never 0 (FR-ECA-042).
 */
function formatCensusLine(
  t: TFunc,
  row: ConnectCensusRow | undefined,
  kindProposals: ConnectProposal[] = [],
  counts?: { link: number; bringIn: number; send: number; review: number },
): string {
  if (!row || row.erp_count === null) {
    return t('integrations.connect.domainNotChecked', 'Not checked in your connected system yet');
  }

  const open = kindProposals.filter((p) => p.state === 'open');
  const send = counts?.send ?? open.filter((p) => p.outcome === 'send').length;
  const bringIn = counts?.bringIn ?? open.filter((p) => p.outcome === 'bring-in').length;
  const needYou = counts?.review ?? open.filter((p) => p.outcome === 'review').length;
  const same = row.linked_count;

  if (send > 0 || bringIn > 0 || needYou > 0) {
    const parts = [t('integrations.connect.censusSamePart', '{{n}} are the same', { n: same })];
    if (send > 0) parts.push(t('integrations.connect.censusSendPart', '{{n}} will be sent', { n: send }));
    if (bringIn > 0) parts.push(t('integrations.connect.censusBringInPart', '{{n}} brought in', { n: bringIn }));
    if (needYou > 0) parts.push(t('integrations.connect.censusNeedYouPart', '{{n}} need you', { n: needYou }));
    return t(
      'integrations.connect.censusWithActions',
      '{{pmo}} in PMO, {{connected}} in the connected system: {{actions}}',
      { pmo: row.pmo_count, connected: row.erp_count, actions: parts.join(', ') },
    );
  }

  if (row.kind === 'item') {
    return t(
      'integrations.connect.censusPlainItems',
      '{{pmo}} in PMO, {{connected}} in the connected system, {{same}} are the same',
      { pmo: row.pmo_count, connected: row.erp_count, same },
    );
  }

  return t(
    'integrations.connect.censusPlain',
    '{{pmo}} {{noun}} in PMO, {{connected}} in the connected system, {{same}} are the same',
    { noun: kindNoun(t, row.kind), pmo: row.pmo_count, connected: row.erp_count, same },
  );
}

/** Lower-case kind noun for census sentences (FR-ECA-002's "12 vendors in PMO, …"). */
function kindNoun(t: TFunc, kind: ConnectKind | string): string {
  const found = MASTER_KINDS.find((k) => k.kind === kind);
  return found ? t(found.nounKey, found.nounDefault) : '';
}

/** Confirm copy stating the counts (FR-ECA-012 / AC-ECA-003). */
function formatConfirmDescription(
  t: TFunc,
  counts: { link: number; bringIn: number; send: number; review: number },
): string {
  const parts: string[] = [];
  if (counts.link > 0) parts.push(t('integrations.connect.confirmLink', 'Link {{n}} records', { n: counts.link }));
  if (counts.send > 0) parts.push(t('integrations.connect.confirmSend', 'send {{n}}', { n: counts.send }));
  if (counts.bringIn > 0) parts.push(t('integrations.connect.confirmBringIn', 'bring {{n}} into PMO', { n: counts.bringIn }));

  if (!parts.length) {
    return t('integrations.connect.confirmAcceptAllQuestion', 'Accept all pending records?');
  }

  const joiner = t('integrations.connect.confirmJoiner', 'and');
  const actions = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} ${joiner} ${parts[parts.length - 1]}`;

  const question = `${actions}?`;
  if (counts.review > 0) {
    const left = counts.review === 1
      ? t('integrations.connect.confirmReviewLeftOne', '1 needs a decision and is left as it is.')
      : t('integrations.connect.confirmReviewLeft', '{{n}} need a decision and are left as they are.', { n: counts.review });
    return `${question} ${left}`;
  }
  return question;
}

export function ConnectProposalReview({ tier = 'erpnext', open = true, onClose }: ConnectProposalReviewProps) {
  const { t } = useTranslation('administration');
  const queryClient = useQueryClient();
  const may = usePermission();

  const [acceptingTarget, setAcceptingTarget] = useState<ConnectKind | 'all' | null>(null);
  const [acceptingSelected, setAcceptingSelected] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const [choosingRowId, setChoosingRowId] = useState<string | null>(null);
  const [reviewListKind, setReviewListKind] = useState<ConnectKind | null>(null);
  const [excludedByKind, setExcludedByKind] = useState<Partial<Record<ConnectKind, Set<string>>>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRecords, setSearchRecords] = useState<ConnectStagedRecord[]>([]);
  const [searchStatus, setSearchStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchToken = useRef(0);

  const statusQuery = useQuery({
    queryKey: ['integrations', 'connect-status', tier],
    queryFn: () => repositories.integrations.getConnectStatus(tier),
    refetchInterval: (query) => {
      const state = query.state.data?.run?.state;
      return state === 'staging' || state === 'proposing' ? 5000 : false;
    },
  });

  const proposalsQuery = useQuery({
    queryKey: ['integrations', 'connect-proposals', tier],
    queryFn: async () => {
      const r = await repositories.integrations.listConnectProposals(tier, null, null, null);
      return r.proposals ?? [];
    },
  });

  const openReviewListQuery = useInfiniteQuery({
    queryKey: ['integrations', 'connect-review-list', tier, reviewListKind, 'open'],
    enabled: reviewListKind !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => repositories.integrations.listConnectProposals(tier, reviewListKind!, null, pageParam, 'open'),
    getNextPageParam: (lastPage) => lastPage.nextAfterId ?? undefined,
  });
  const appliedReviewListQuery = useInfiniteQuery({
    queryKey: ['integrations', 'connect-review-list', tier, reviewListKind, 'applied-link'],
    enabled: reviewListKind !== null,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => repositories.integrations.listConnectProposals(tier, reviewListKind!, 'link', pageParam, 'applied'),
    getNextPageParam: (lastPage) => lastPage.nextAfterId ?? undefined,
  });

  const status = statusQuery.data;
  const proposals = useMemo(() => proposalsQuery.data ?? [], [proposalsQuery.data]);
  const openReviewRows = useMemo(
    () => openReviewListQuery.data?.pages.flatMap((page) => page.proposals).filter((proposal) => proposal.state === 'open') ?? [],
    [openReviewListQuery.data],
  );
  const appliedReviewRows = useMemo(
    () => appliedReviewListQuery.data?.pages.flatMap((page) => page.proposals)
      .filter((proposal) => proposal.state === 'applied' && proposal.outcome === 'link') ?? [],
    [appliedReviewListQuery.data],
  );

  const censusMap = useMemo(() => {
    const map = new Map<string, ConnectCensusRow>();
    for (const row of status?.census ?? []) {
      map.set(row.kind, row);
    }
    return map;
  }, [status?.census]);

  const purchaseRow = censusMap.get('purchase');

  // People the ERP cannot take (PQ-ECA-1): listed for a hand-add in the ERP, never silently dropped.
  const peopleByHand = useMemo(() => {
    return proposals
      .filter(
        (p) =>
          p.kind === 'employee' &&
          (p.outcome === 'send' || Boolean(p.reason_text?.toLowerCase().includes('by hand'))),
      )
      .map((p) => p.snapshot?.name ?? p.snapshot?.code ?? p.pmo_ids[0])
      .filter(Boolean);
  }, [proposals]);

  const countsForKind = (kind: ConnectKind | null) => {
    if (kind && status?.proposalCounts?.[kind]) {
      const counts = status.proposalCounts[kind];
      return { link: counts.link, bringIn: counts.bring_in, send: counts.send, review: counts.review };
    }
    if (!kind && status?.proposalCounts) {
      return Object.values(status.proposalCounts).reduce(
        (total, counts) => ({
          link: total.link + counts.link,
          bringIn: total.bringIn + counts.bring_in,
          send: total.send + counts.send,
          review: total.review + counts.review,
        }),
        { link: 0, bringIn: 0, send: 0, review: 0 },
      );
    }
    const target = kind ? proposals.filter((p) => p.kind === kind) : proposals;
    const openProps = target.filter((p) => p.state === 'open');
    return {
      link: openProps.filter((p) => p.outcome === 'link').length,
      bringIn: openProps.filter((p) => p.outcome === 'bring-in').length,
      send: openProps.filter((p) => p.outcome === 'send').length,
      review: openProps.filter((p) => p.outcome === 'review').length,
    };
  };

  const totalCounts = countsForKind(null);
  const excludedIds = reviewListKind ? excludedByKind[reviewListKind] ?? new Set<string>() : new Set<string>();
  const selectedCount = reviewListKind
    ? Math.max(countsForKind(reviewListKind).link + countsForKind(reviewListKind).bringIn + countsForKind(reviewListKind).send - excludedIds.size, 0)
    : 0;
  const activeListPageRows = useMemo(() => [...openReviewRows, ...appliedReviewRows], [openReviewRows, appliedReviewRows]);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchToken.current += 1;
  }, []);

  useEffect(() => {
    setExcludedByKind({});
  }, [status?.run?.id]);

  const loadSearchRecords = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const token = ++searchToken.current;
    if (query.trim().length < 2) {
      setSearchRecords([]);
      setSearchStatus('ready');
      return;
    }
    setSearchRecords([]);
    setSearchStatus('loading');
    searchTimer.current = setTimeout(async () => {
      try {
        const records = await repositories.integrations.searchConnectStaged(tier, reviewListKind ?? 'party', query.trim());
        if (token === searchToken.current) {
          setSearchRecords(records.slice(0, 20));
          setSearchStatus('ready');
        }
      } catch {
        if (token === searchToken.current) setSearchStatus('error');
      }
    }, 250);
  }, [reviewListKind, tier]);

  const handleAcceptConfirm = async () => {
    if (!acceptingTarget) return;
    setAcceptLoading(true);
    setErrorMessage(null);
    const kind = acceptingTarget === 'all' ? null : acceptingTarget;
    try {
      // The repository loops the batched accept until nothing remains (FR-ECA-012/013).
      const excludeIds = acceptingSelected && kind ? [...(excludedByKind[kind] ?? [])] : null;
      if (excludeIds) await repositories.integrations.acceptConnectProposals(tier, kind, null, excludeIds);
      else await repositories.integrations.acceptConnectProposals(tier, kind, null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-status', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-proposals', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-review-list', tier] }),
      ]);
      if (kind) setExcludedByKind((current) => ({ ...current, [kind]: new Set() }));
      setAcceptingTarget(null);
      setAcceptingSelected(false);
    } catch (err) {
      setErrorMessage(classifyMutationError(err).headline);
    } finally {
      setAcceptLoading(false);
    }
  };

  const handleDecision = async (id: string, choice: ConnectReviewChoice) => {
    setErrorMessage(null);
    try {
      await repositories.integrations.decideConnectReview(tier, id, choice);
      setChoosingRowId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-status', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-proposals', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-review-list', tier] }),
      ]);
      setExcludedByKind((current) => {
        if (!reviewListKind) return current;
        const next = new Set(current[reviewListKind] ?? []);
        next.delete(id);
        return { ...current, [reviewListKind]: next };
      });
      searchToken.current += 1;
      setSearchRecords([]);
      setSearchQuery('');
    } catch (err) {
      setErrorMessage(classifyMutationError(err).headline);
    }
  };

  const handleUnlink = async (id: string) => {
    setErrorMessage(null);
    try {
      await repositories.integrations.unlinkConnectMatch(tier, id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-status', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-review-list', tier] }),
      ]);
    } catch (err) {
      setErrorMessage(classifyMutationError(err).headline);
    }
  };

  // Start (or re-run) the read-only census, then refetch status. Used by the auto-start,
  // the error retry and Re-check (FR-ECA-001). Errors land in the existing error state.
  const runCensus = async () => {
    setErrorMessage(null);
    setStartFailed(false);
    setStarting(true);
    try {
      await repositories.integrations.startConnectCensus(tier);
      await statusQuery.refetch();
    } catch (err) {
      setStartFailed(true);
      setErrorMessage(classifyMutationError(err).headline);
    } finally {
      setStarting(false);
    }
  };

  // First open on a tier with no run: start the census once. The ref survives StrictMode's
  // double effect and re-renders, so there is one start per tier per mounted review.
  const autoStarted = useRef<string | null>(null);
  const canRunCensus = may('manage', 'integration');
  const needsFirstRun = open && canRunCensus && statusQuery.isSuccess && !statusQuery.data.run;
  useEffect(() => {
    if (!needsFirstRun || autoStarted.current === tier) return;
    autoStarted.current = tier;
    void runCensus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runCensus is recreated each render; the ref is the guard
  }, [needsFirstRun, tier]);

  const recheck = (
    <CanWrite action='manage' entity='integration' fallback={null}>
      <Button variant='outline' size='sm' onClick={() => void runCensus()}>
        {t('integrations.connect.recheck', 'Check again')}
      </Button>
    </CanWrite>
  );

  if (!open) return null;

  // 1. Loading / staging — the run is reading both sides; polls every 5 s until ready.
  const isStaging = starting || (needsFirstRun && !startFailed) || statusQuery.isPending || proposalsQuery.isPending || status?.run?.state === 'staging' || status?.run?.state === 'proposing';
  if (isStaging) {
    return (
      <div className='space-y-3' data-testid='connect-proposal-review'>
        <p role='status' className='text-sm font-medium text-foreground animate-pulse'>
          {t('integrations.connect.readingRecords', 'Reading records from your connected system…')}
        </p>
        <ListState variant='loading' rows={3} />
      </div>
    );
  }

  // 2. Error — plain words + retry (the census can be re-run).
  if (statusQuery.isError || startFailed || status?.run?.state === 'failed') {
    return (
      <div data-testid='connect-proposal-review'>
        <ListState
          variant='error'
          title={t('integrations.connect.errorTitle', 'Could not read records')}
          sub={errorMessage ?? t(
            'integrations.connect.errorDescription',
            'Could not read records from your connected system. Check the connection and try again.',
          )}
          onRetry={() => void runCensus()}
          retryLabel={t('integrations.connect.retry', 'Try again')}
        />
      </div>
    );
  }

  // 3. Empty — no masters on either side, no proposals, no money-domain rows at all.
  const census = status?.census ?? [];
  const masterCensus = census.filter((c) => MASTER_KINDS.some((k) => k.kind === c.kind));
  const domainCensus = census.filter((c) => !MASTER_KINDS.some((k) => k.kind === c.kind));
  const masterEmpty = masterCensus.every(
    (c) => c.pmo_count === 0 && (c.erp_count === 0 || c.erp_count === null),
  );
  if (!census.length || (masterEmpty && !domainCensus.length && proposals.length === 0)) {
    return (
      <div data-testid='connect-proposal-review'>
        <ListState
          variant='empty'
          title={t('integrations.connect.emptyTitle', 'Nothing to set up')}
          sub={t('integrations.connect.emptyDescription', 'No records to set up. All records are connected.')}
        />
        <div className='mt-3 flex justify-center'>{recheck}</div>
      </div>
    );
  }

  // 4. Ready — cards per kind, unclear rows, sending progress.
  const nothingToAccept = totalCounts.link + totalCounts.bringIn + totalCounts.send === 0;
  // Sending progress from real state only (NFR-ECA-004): total = every send row not yet
  // applied; remaining = the ERP has not confirmed them yet (waitingForSend). Never shown as done.
  const sendRowsPending = proposals.filter(
    (p) => p.outcome === 'send' && (p.state === 'open' || p.state === 'sending'),
  ).length;
  const sendingTotal = Math.max(status?.waitingForSend ?? 0, sendRowsPending);
  const sendingRemaining = status?.waitingForSend ?? 0;
  const isWaitingSend = sendingTotal > 0 && sendingRemaining > 0;

  const allOpenCount = totalCounts.link + totalCounts.bringIn + totalCounts.send + totalCounts.review;
  const isAllClear = allOpenCount === 0 && !isWaitingSend;
  const targetCounts = acceptingTarget && acceptingTarget !== 'all'
    ? countsForKind(acceptingTarget)
    : totalCounts;
  const selectedTargetCounts = { ...targetCounts };
  if (acceptingSelected && acceptingTarget && acceptingTarget !== 'all') {
    for (const row of openReviewRows) {
      if (!excludedByKind[acceptingTarget]?.has(row.id)) continue;
      if (row.outcome === 'link') selectedTargetCounts.link = Math.max(0, selectedTargetCounts.link - 1);
      if (row.outcome === 'bring-in') selectedTargetCounts.bringIn = Math.max(0, selectedTargetCounts.bringIn - 1);
      if (row.outcome === 'send') selectedTargetCounts.send = Math.max(0, selectedTargetCounts.send - 1);
    }
  }
  const chooserProposal = activeListPageRows.find((proposal) => proposal.id === choosingRowId) ?? null;
  const reviewListDefinition = reviewListKind ? MASTER_KINDS.find((entry) => entry.kind === reviewListKind) : null;
  const chooserOptions: ComboboxOption[] = chooserProposal
    ? searchRecords.flatMap((record) => {
        const pmoIds = chooserProposal.pmo_ids ?? [];
        if (pmoIds.length === 0) {
          return [{
            value: JSON.stringify({ action: 'bring-in', externalId: record.external_id }),
            label: t('integrations.connect.addStagedAsNew', 'Add {{name}} as new', { name: record.name }),
            sub: record.code,
            wrapLabel: true,
          }];
        }
        return pmoIds.map((pmoId) => ({
          value: JSON.stringify({ action: 'link', pmoId, externalId: record.external_id }),
          label: t('integrations.connect.linkPair', '{{pmo}} → {{connected}}', {
            pmo: chooserProposal.pmo_name ?? pmoId,
            connected: record.name,
          }),
          sub: record.code,
          wrapLabel: true,
        }));
      })
    : [];
  if (chooserProposal?.kind === 'party' && chooserProposal.pmo_ids.length === 0 && chooserProposal.external_ids[0]) {
    chooserOptions.push({
      value: JSON.stringify({ action: 'bring-in', externalId: chooserProposal.external_ids[0] }),
      label: t('integrations.connect.addAsNew', 'Add as new in PMO'),
      sub: chooserProposal.erp_name ?? chooserProposal.snapshot.name ?? chooserProposal.external_ids[0],
    });
  }
  if (chooserProposal && chooserProposal.pmo_ids.length > 0) {
    chooserOptions.push({
      value: JSON.stringify({ action: 'send', pmoId: chooserProposal.pmo_ids[0] }),
      label: t('integrations.connect.createAsNew', 'Create as new in the connected system'),
      sub: chooserProposal.pmo_name ?? chooserProposal.pmo_ids[0],
    });
  }
  if (chooserProposal?.outcome === 'review') {
    chooserOptions.push({ value: JSON.stringify({ action: 'dismiss' }), label: t('integrations.connect.dismiss', 'Dismiss') });
  }

  const pmoName = (proposal: ConnectProposal) => proposal.pmo_name
    ?? (proposal.pmo_ids.length ? proposal.snapshot.name ?? proposal.pmo_ids.join(', ') : t('integrations.connect.notInPmo', 'Not in PMO yet'));
  const connectedName = (proposal: ConnectProposal) => proposal.erp_name
    ?? (proposal.outcome === 'send'
      ? t('integrations.connect.willBeCreated', 'Will be created')
      : proposal.snapshot.employeeName ?? proposal.snapshot.accountName ?? proposal.snapshot.itemName ?? proposal.snapshot.item_name
        ?? proposal.snapshot.name ?? proposal.snapshot.code ?? proposal.external_ids.join(', '));
  const actionName = (proposal: ConnectProposal) => {
    if (proposal.state === 'applied') return t('integrations.connect.connected', 'Connected');
    if (proposal.outcome === 'link') return t('integrations.connect.actionLink', 'Link these records');
    if (proposal.outcome === 'bring-in') return t('integrations.connect.actionBringIn', 'Bring into PMO');
    if (proposal.outcome === 'send') return t('integrations.connect.actionSend', 'Create in the connected system');
    return t('integrations.connect.needsDecision', 'Needs a decision');
  };

  return (
    <div className='space-y-6' data-testid='connect-proposal-review'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-4 border-b border-panel-border pb-4'>
        <div>
          <h2 className='text-xl font-semibold text-foreground'>
            {t('integrations.connect.title', 'Match records')}
          </h2>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {t('integrations.connect.subtitle', 'Review and connect records between PMO and your connected system.')}
          </p>
        </div>

        <div className='flex items-center gap-3'>
          {recheck}
          {isWaitingSend && (
            <div
              className='flex items-center gap-2 rounded-md border border-panel-border px-3 py-1.5 text-sm font-medium text-foreground'
              role='status'
            >
              <Icon name='refresh' className='h-4 w-4 animate-spin text-primary' aria-hidden />
              <span>
                {t('integrations.connect.sendingProgress', 'Sending {{remaining}} of {{total}}', {
                  remaining: sendingRemaining,
                  total: sendingTotal,
                })}
              </span>
            </div>
          )}

          <CanWrite
            action='manage'
            entity='integration'
            fallback={
              <span className='text-control text-muted-foreground'>
                {t(
                  'integrations.connect.readOnlyNotice',
                  'Read only. Only administrators can accept all record matches.',
                )}
              </span>
            }
          >
            <Button
              variant='primary'
              size='sm'
              disabled={nothingToAccept || isWaitingSend || isAllClear}
              onClick={() => { setAcceptingSelected(false); setAcceptingTarget('all'); }}
            >
              {t('integrations.connect.acceptAll', 'Accept all')}
            </Button>
          </CanWrite>

          {onClose && (
            <Button variant='ghost' size='sm' onClick={onClose} aria-label={t('ux.close', 'Close')}>
              <Icon name='x' className='h-4 w-4' aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {errorMessage && (
        <div role='alert' className='rounded-md border border-destructive/20 bg-status-danger-surface p-3 text-sm text-destructive-text'>
          {errorMessage}
        </div>
      )}

      {/* All clear */}
      {isAllClear && (
        <div className='rounded-md border border-panel-border bg-status-success-surface p-4 text-success-text'>
          <p className='font-semibold'>
            {t('integrations.connect.allClearTitle', 'All records connected')}
          </p>
          <p className='text-sm mt-0.5 text-muted-foreground'>
            {t('integrations.connect.allClearDescription', 'All records are connected. Everything is up to date.')}
          </p>
        </div>
      )}

      {/* One card per kind (approved layout) */}
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {MASTER_KINDS.map(({ kind, labelKey, defaultLabel }) => {
          const row = censusMap.get(kind);
          const kindProposals = proposals.filter((p) => p.kind === kind);
          const counts = countsForKind(kind);
          const censusText = formatCensusLine(t, row, kindProposals, counts);
          const canAcceptKind = counts.link + counts.bringIn + counts.send > 0;
          return (
            <Card key={kind} className='flex flex-col justify-between p-4' data-testid={`connect-kind-${kind}`}>
              <div>
                <div className='flex items-center justify-between'>
                  <h3 className='font-semibold text-foreground'>{t(labelKey, defaultLabel)}</h3>
                  {counts.review > 0 && (
                    <StatusPill variant='warn'>
                      {t('integrations.connect.needsDecision', 'Needs a decision')}
                    </StatusPill>
                  )}
                </div>
                <p className='mt-2 text-sm text-muted-foreground leading-relaxed'>{censusText}</p>
              </div>

              <div className='mt-4 pt-3 border-t border-panel-border/60 flex flex-wrap items-center justify-between gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  aria-expanded={reviewListKind === kind}
                  onClick={() => {
                    searchToken.current += 1;
                    setChoosingRowId(null);
                    setReviewListKind((current) => current === kind ? null : kind);
                  }}
                >
                  {reviewListKind === kind
                    ? t('integrations.connect.closeReviewList', 'Close list')
                    : t('integrations.connect.reviewList', 'Review list')}
                </Button>
                <CanWrite
                  action='manage'
                  entity='integration'
                  ctx={{ record: { kind } }}
                  fallback={
                    <span className='text-control text-muted-foreground'>
                      {may('manage', 'integration', { record: { kind } })
                        ? ''
                        : t('ux.readOnly', 'Read only')}
                    </span>
                  }
                >
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={!canAcceptKind || isWaitingSend}
                    onClick={() => { setAcceptingSelected(false); setAcceptingTarget(kind); }}
                  >
                    {t('integrations.connect.acceptAll', 'Accept all')}
                  </Button>
                </CanWrite>
              </div>
            </Card>
          );
        })}
      </div>

      {reviewListKind && (
        <section className='space-y-3 rounded-lg border border-panel-border bg-card p-3 sm:p-4' data-testid='connect-review-list'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b border-panel-border pb-3'>
            <div>
              <h3 className='font-semibold text-foreground'>
                {reviewListDefinition ? t(reviewListDefinition.labelKey, reviewListDefinition.defaultLabel) : ''}
              </h3>
              <p className='text-sm text-muted-foreground'>
                {t('integrations.connect.reviewListHelp', 'Review each record before accepting the selected suggestions.')}
              </p>
            </div>
            <CanWrite action='manage' entity='integration' ctx={{ record: { kind: reviewListKind } }} fallback={null}>
              <Button
                variant='primary'
                size='sm'
                disabled={selectedCount === 0 || isWaitingSend}
                onClick={() => { setAcceptingSelected(true); setAcceptingTarget(reviewListKind); }}
              >
                {t('integrations.connect.acceptSelected', 'Accept {{n}} selected', { n: selectedCount })}
              </Button>
            </CanWrite>
          </div>

          {(openReviewListQuery.isPending || appliedReviewListQuery.isPending) && activeListPageRows.length === 0 && (
            <ListState variant='loading' rows={3} />
          )}
          {(openReviewListQuery.isError || appliedReviewListQuery.isError) && (
            <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/20 bg-status-danger-surface p-3 text-sm text-destructive-text' role='alert'>
              <span>{t('integrations.connect.reviewListError', 'Could not load this list. Try again.')}</span>
              <Button variant='outline' size='sm' onClick={() => {
                void openReviewListQuery.refetch();
                void appliedReviewListQuery.refetch();
              }}>{t('integrations.connect.retry', 'Try again')}</Button>
            </div>
          )}

          <div className='divide-y divide-panel-border/60'>
            {activeListPageRows.map((proposal) => {
              const isApplied = proposal.state === 'applied';
              const isSelected = !excludedIds.has(proposal.id);
              const isChoosing = choosingRowId === proposal.id;
              const label = pmoName(proposal);
              return (
                <article
                  key={proposal.id}
                  data-testid={`connect-review-list-row-${proposal.id}`}
                  className='flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between'
                >
                  <div className='flex min-w-0 items-start gap-3'>
                    {!isApplied && proposal.outcome !== 'review' && (
                      <CanWrite action='manage' entity='integration' ctx={{ record: { kind: proposal.kind } }} fallback={null}>
                        {/* Avoid showing the previous blue fill after the tick disappears on uncheck. */}
                        <Checkbox
                          checked={isSelected}
                          label={t('integrations.connect.selectRow', 'Select {{name}}', { name: label })}
                          className={isSelected
                            ? 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
                            : 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:bg-background focus-visible:bg-background transition-none'}
                          onChange={(checked) => setExcludedByKind((current) => {
                            const next = new Set(current[reviewListKind] ?? []);
                            if (checked) next.delete(proposal.id);
                            else next.add(proposal.id);
                            return { ...current, [reviewListKind]: next };
                          })}
                        />
                      </CanWrite>
                    )}
                    <div className='min-w-0 space-y-1'>
                      <p className='break-words text-sm font-medium text-foreground'>
                        <span>{label}</span>
                        <span className='px-2 text-muted-foreground' aria-hidden>→</span>
                        <span>{connectedName(proposal) || t('integrations.connect.notAvailable', 'Not available')}</span>
                      </p>
                      {['item', 'account', 'employee'].includes(proposal.kind) && (
                        <p className='flex flex-wrap gap-x-3 text-control text-muted-foreground'>
                          {proposal.pmo_ids.length > 0 && (
                            <span>
                              {t('integrations.connect.pmoRecordId', 'PMO ID')}: {' '}
                              <code className='font-mono'>{proposal.pmo_ids.join(', ')}</code>
                            </span>
                          )}
                          {proposal.external_ids.length > 0 && (
                            <span>
                              {t('integrations.connect.connectedRecordId', 'Connected ID')}: {' '}
                              <code className='font-mono'>{proposal.external_ids.join(', ')}</code>
                            </span>
                          )}
                        </p>
                      )}
                      <p className='text-control text-muted-foreground'>
                        {actionName(proposal)}
                        {proposal.outcome === 'review' && proposal.reason_text ? ` · ${proposal.reason_text}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className='flex shrink-0 flex-wrap items-center gap-2 sm:justify-end'>
                    {isApplied && proposal.can_unlink && (
                      <CanWrite action='manage' entity='integration' fallback={null}>
                        <Button variant='outline' size='sm' onClick={() => void handleUnlink(proposal.id)}>
                          {t('integrations.connect.undo', 'Undo')}
                        </Button>
                      </CanWrite>
                    )}
                    {!isApplied && (
                      <CanWrite action='manage' entity='integration' ctx={{ record: { kind: proposal.kind } }} fallback={null}>
                        {isChoosing ? (
                          <div className='flex w-full min-w-0 items-center gap-2 sm:w-auto sm:min-w-[360px]'>
                            <Combobox
                              label={t('integrations.connect.searchRecords', 'Search records')}
                              className='min-w-0 flex-1'
                              value={null}
                              onChange={(value) => {
                                try {
                                  void handleDecision(proposal.id, JSON.parse(value) as ConnectReviewChoice);
                                } catch {
                                  setErrorMessage(t('integrations.connect.reviewListError', 'Could not apply this choice. Try again.'));
                                }
                              }}
                              serverSearch={{
                                options: chooserOptions,
                                status: searchStatus,
                                onQueryChange: loadSearchRecords,
                                onRetry: () => loadSearchRecords(searchQuery),
                              }}
                              placeholder={t('integrations.connect.searchRecords', 'Search records')}
                              searchPlaceholder={t('integrations.connect.searchNameOrCode', 'Search by name or code')}
                              noun={t('integrations.connect.recordNoun', 'record')}
                            />
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => {
                                searchToken.current += 1;
                                setChoosingRowId(null);
                                setSearchRecords([]);
                                setSearchQuery('');
                              }}
                              aria-label={t('ux.close', 'Close')}
                            >
                              <Icon name='x' className='h-4 w-4' aria-hidden />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            variant='outline'
                            size='sm'
                            onClick={() => {
                              searchToken.current += 1;
                              setSearchRecords([]);
                              setSearchQuery('');
                              setChoosingRowId(proposal.id);
                            }}
                          >
                            {t('integrations.connect.change', 'Change')}
                          </Button>
                        )}
                      </CanWrite>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {activeListPageRows.length === 0 && !openReviewListQuery.isPending && !appliedReviewListQuery.isPending && (
            <p className='py-4 text-sm text-muted-foreground'>
              {t('integrations.connect.reviewListEmpty', 'There are no records in this list yet.')}
            </p>
          )}

          {(openReviewListQuery.hasNextPage || appliedReviewListQuery.hasNextPage) && (
            <div className='flex flex-wrap gap-2 border-t border-panel-border pt-3'>
              {openReviewListQuery.hasNextPage && (
                <Button variant='ghost' size='sm' disabled={openReviewListQuery.isFetchingNextPage} onClick={() => void openReviewListQuery.fetchNextPage()}>
                  {t('integrations.connect.loadMoreSuggestions', 'Load more suggestions')}
                </Button>
              )}
              {appliedReviewListQuery.hasNextPage && (
                <Button variant='ghost' size='sm' disabled={appliedReviewListQuery.isFetchingNextPage} onClick={() => void appliedReviewListQuery.fetchNextPage()}>
                  {t('integrations.connect.loadMoreConnected', 'Load more connected records')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      {/* People the connected system cannot take (PQ-ECA-1) */}
      {peopleByHand.length > 0 && (
        <div className='rounded-lg border border-panel-border bg-surface-panel p-4'>
          <h4 className='font-medium text-foreground text-sm'>
            {t('integrations.connect.peopleByHandTitle', 'Add these in the connected system by hand')}
          </h4>
          <ul className='mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1'>
            {peopleByHand.map((name, idx) => (
              <li key={idx}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Purchase documents in the connected system (FR-ECA-042) */}
      {purchaseRow && (
        <div className='rounded-lg border border-panel-border bg-surface-panel p-4 text-sm text-muted-foreground' data-testid='connect-purchase-note'>
          {purchaseRow.erp_count === null ? (
            <span>{t('integrations.connect.domainNotChecked', 'Not checked in your connected system yet')}</span>
          ) : (
            <span>
              {t('integrations.connect.purchaseDocs', '{{n}} purchase documents are in your connected system.', { n: purchaseRow.erp_count })}{' '}
              <a
                href='/procurement#erp-documents'
                className='font-medium text-primary underline underline-offset-4 hover:text-primary/80'
              >
                {t('integrations.connect.purchaseLink', 'Link them to PMO purchases')}
              </a>
            </span>
          )}
        </div>
      )}

      {/* One confirm stating the counts (FR-ECA-012) */}
      <ConfirmDialog
        open={Boolean(acceptingTarget)}
        title={t('integrations.connect.confirmAcceptTitle', 'Accept record matches?')}
        description={acceptingSelected
          ? t('integrations.connect.confirmAcceptSelected', 'Accept {{n}} selected records?', {
            n: selectedTargetCounts.link + selectedTargetCounts.bringIn + selectedTargetCounts.send,
          })
          : formatConfirmDescription(t, targetCounts)}
        confirmLabel={acceptingSelected
          ? t('integrations.connect.acceptSelectedConfirm', 'Accept selected')
          : t('integrations.connect.acceptAll', 'Accept all')}
        loading={acceptLoading}
        onConfirm={() => void handleAcceptConfirm()}
        onCancel={() => { setAcceptingTarget(null); setAcceptingSelected(false); }}
      />
    </div>
  );
}
