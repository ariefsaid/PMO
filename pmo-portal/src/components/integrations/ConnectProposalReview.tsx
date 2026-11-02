import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import type {
  ConnectCensusRow,
  ConnectKind,
  ConnectProposal,
  ConnectReviewChoice,
  ConnectTier,
} from '@/src/lib/repositories/types';
import {
  Button,
  Card,
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
 * without them it reads "<12 vendors> in PMO, 40 in the ERP, 9 are the same".
 * A domain the ERP cannot count yet reads "Not checked for this ERP yet", never 0 (FR-ECA-042).
 */
function formatCensusLine(
  t: TFunc,
  row: ConnectCensusRow | undefined,
  kindProposals: ConnectProposal[] = [],
): string {
  if (!row || row.erp_count === null) {
    return t('integrations.connect.domainNotChecked', 'Not checked for this ERP yet');
  }

  const open = kindProposals.filter((p) => p.state === 'open');
  const send = open.filter((p) => p.outcome === 'send').length;
  const bringIn = open.filter((p) => p.outcome === 'bring-in').length;
  const needYou = open.filter((p) => p.outcome === 'review').length;
  const same = row.linked_count;

  if (send > 0 || bringIn > 0 || needYou > 0) {
    const parts = [t('integrations.connect.censusSamePart', '{{n}} are the same', { n: same })];
    if (send > 0) parts.push(t('integrations.connect.censusSendPart', '{{n}} will be sent', { n: send }));
    if (bringIn > 0) parts.push(t('integrations.connect.censusBringInPart', '{{n}} brought in', { n: bringIn }));
    if (needYou > 0) parts.push(t('integrations.connect.censusNeedYouPart', '{{n}} need you', { n: needYou }));
    return `${row.pmo_count} in PMO, ${row.erp_count} in the ERP: ${parts.join(', ')}`;
  }

  return t(
    'integrations.connect.censusPlain',
    '{{pmo}} {{noun}} in PMO, {{erp}} in the ERP, {{same}} are the same',
    { noun: kindNoun(t, row.kind), pmo: row.pmo_count, erp: row.erp_count, same },
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const may = usePermission();

  const [acceptingTarget, setAcceptingTarget] = useState<ConnectKind | 'all' | null>(null);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [choosingRowId, setChoosingRowId] = useState<string | null>(null);

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

  const status = statusQuery.data;
  const proposals = useMemo(() => proposalsQuery.data ?? [], [proposalsQuery.data]);

  const censusMap = useMemo(() => {
    const map = new Map<string, ConnectCensusRow>();
    for (const row of status?.census ?? []) {
      map.set(row.kind, row);
    }
    return map;
  }, [status?.census]);

  const purchaseRow = censusMap.get('purchase');

  const openReviews = useMemo(
    () => proposals.filter((p) => p.outcome === 'review' && p.state === 'open'),
    [proposals],
  );

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
    const target = kind ? proposals.filter((p) => p.kind === kind) : proposals;
    const openProps = target.filter((p) => p.state === 'open');
    return {
      link: openProps.filter((p) => p.outcome === 'link').length,
      bringIn: openProps.filter((p) => p.outcome === 'bring-in').length,
      send: openProps.filter((p) => p.outcome === 'send').length,
      review: openProps.filter((p) => p.outcome === 'review').length,
    };
  };

  const handleAcceptConfirm = async () => {
    if (!acceptingTarget) return;
    setAcceptLoading(true);
    setErrorMessage(null);
    const kind = acceptingTarget === 'all' ? null : acceptingTarget;
    try {
      // The repository loops the batched accept until nothing remains (FR-ECA-012/013).
      await repositories.integrations.acceptConnectProposals(tier, kind, null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-status', tier] }),
        queryClient.invalidateQueries({ queryKey: ['integrations', 'connect-proposals', tier] }),
      ]);
      setAcceptingTarget(null);
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
      ]);
    } catch (err) {
      setErrorMessage(classifyMutationError(err).headline);
    }
  };

  const handleRetry = async () => {
    setErrorMessage(null);
    try {
      await repositories.integrations.startConnectCensus(tier);
      await statusQuery.refetch();
    } catch (err) {
      setErrorMessage(classifyMutationError(err).headline);
    }
  };

  if (!open) return null;

  // 1. Loading / staging — the run is reading both sides; polls every 5 s until ready.
  const isStaging = statusQuery.isPending || status?.run?.state === 'staging' || status?.run?.state === 'proposing';
  if (isStaging) {
    return (
      <div className='space-y-3' data-testid='connect-proposal-review'>
        <p role='status' className='text-sm font-medium text-foreground animate-pulse'>
          {t('integrations.connect.readingRecords', 'Reading records from the ERP…')}
        </p>
        <ListState variant='loading' rows={3} />
      </div>
    );
  }

  // 2. Error — plain words + retry (the census can be re-run).
  if (statusQuery.isError || status?.run?.state === 'failed') {
    return (
      <div data-testid='connect-proposal-review'>
        <ListState
          variant='error'
          title={t('integrations.connect.errorTitle', 'Could not read records')}
          sub={errorMessage ?? t(
            'integrations.connect.errorDescription',
            'Could not read records from the ERP. Check the connection and try again.',
          )}
          onRetry={() => void handleRetry()}
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
      </div>
    );
  }

  // 4. Ready — cards per kind, unclear rows, sending progress.
  const openProposals = proposals.filter((p) => p.state === 'open');
  const totalCounts = countsForKind(null);
  const nothingToAccept = totalCounts.link + totalCounts.bringIn + totalCounts.send === 0;
  // Sending progress from real state only (NFR-ECA-004): total = every send row not yet
  // applied; remaining = the ERP has not confirmed them yet (waitingForSend). Never shown as done.
  const sendRowsPending = proposals.filter(
    (p) => p.outcome === 'send' && (p.state === 'open' || p.state === 'sending'),
  ).length;
  const sendingTotal = Math.max(status?.waitingForSend ?? 0, sendRowsPending);
  const sendingRemaining = status?.waitingForSend ?? 0;
  const isWaitingSend = sendingTotal > 0 && sendingRemaining > 0;

  const isAllClear = openProposals.length === 0 && !isWaitingSend && openReviews.length === 0;
  const targetCounts = acceptingTarget && acceptingTarget !== 'all'
    ? countsForKind(acceptingTarget)
    : totalCounts;

  return (
    <div className='space-y-6' data-testid='connect-proposal-review'>
      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-4 border-b border-panel-border pb-4'>
        <div>
          <h2 className='text-xl font-semibold text-foreground'>
            {t('integrations.connect.title', 'Match records')}
          </h2>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {t('integrations.connect.subtitle', 'Review and connect records between PMO and the ERP.')}
          </p>
        </div>

        <div className='flex items-center gap-3'>
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
              <span className='text-xs text-muted-foreground'>
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
              onClick={() => setAcceptingTarget('all')}
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
          const censusText = formatCensusLine(t, row, kindProposals);
          const counts = countsForKind(kind);
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

              <div className='mt-4 pt-3 border-t border-panel-border/60 flex items-center justify-between'>
                <CanWrite
                  action='manage'
                  entity='integration'
                  ctx={{ record: { kind } }}
                  fallback={
                    <span className='text-xs text-muted-foreground'>
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
                    onClick={() => setAcceptingTarget(kind)}
                  >
                    {t('integrations.connect.acceptAll', 'Accept all')}
                  </Button>
                </CanWrite>
              </div>
            </Card>
          );
        })}
      </div>

      {/* People the ERP cannot take (PQ-ECA-1) */}
      {peopleByHand.length > 0 && (
        <div className='rounded-lg border border-panel-border bg-surface-panel p-4'>
          <h4 className='font-medium text-foreground text-sm'>
            {t('integrations.connect.peopleByHandTitle', 'Add these in the ERP by hand')}
          </h4>
          <ul className='mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1'>
            {peopleByHand.map((name, idx) => (
              <li key={idx}>{name}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Purchase documents in the ERP (FR-ECA-042) */}
      {purchaseRow && (
        <div className='rounded-lg border border-panel-border bg-surface-panel p-4 text-sm text-muted-foreground' data-testid='connect-purchase-note'>
          {purchaseRow.erp_count === null ? (
            <span>{t('integrations.connect.domainNotChecked', 'Not checked for this ERP yet')}</span>
          ) : (
            <span>
              {t('integrations.connect.purchaseDocs', '{{n}} purchase documents are in the ERP.', { n: purchaseRow.erp_count })}{' '}
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

      {/* Unclear rows only (approved layout) */}
      {openReviews.length > 0 && (
        <div className='space-y-3 pt-2'>
          <div className='flex items-center justify-between'>
            <h3 className='font-semibold text-foreground text-base'>
              {t('integrations.connect.unclearRecords', 'Unclear records')}
            </h3>
          </div>

          <div className='space-y-2'>
            {openReviews.map((proposal) => {
              const name = proposal.snapshot?.name ?? proposal.snapshot?.code ?? proposal.pmo_ids[0] ?? proposal.id;
              const reason = proposal.reason_text
                ?? t('integrations.connect.reviewAmbiguous', 'Two or more records could be this one');
              const isChoosing = choosingRowId === proposal.id;

              const candidateOptions: ComboboxOption[] = [];
              for (const extId of proposal.external_ids) {
                candidateOptions.push({
                  value: `link:${proposal.pmo_ids[0] ?? ''}:${extId}`,
                  label: proposal.snapshot?.name ? `${proposal.snapshot.name} (${extId})` : extId,
                });
              }
              candidateOptions.push({
                value: 'dismiss',
                label: t('integrations.connect.dismiss', 'Dismiss'),
              });

              return (
                <div
                  key={proposal.id}
                  data-testid={`connect-review-row-${proposal.id}`}
                  className='rounded-lg border border-panel-border bg-card p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3'
                >
                  <div className='space-y-1'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-foreground text-sm'>{name}</span>
                      <StatusPill variant='warn'>
                        {t('integrations.connect.needsDecision', 'Needs a decision')}
                      </StatusPill>
                    </div>
                    <p className='text-xs text-muted-foreground'>{reason}</p>
                  </div>

                  <div className='flex items-center gap-2'>
                    <CanWrite
                      action='manage'
                      entity='integration'
                      ctx={{ record: { kind: proposal.kind } }}
                      fallback={
                        <span className='text-xs text-muted-foreground'>{t('ux.readOnly', 'Read only')}</span>
                      }
                    >
                      {isChoosing ? (
                        <div className='flex items-center gap-2 min-w-[240px]'>
                          <Combobox
                            label={t('integrations.connect.choose', 'Choose')}
                            value={null}
                            onChange={(val) => {
                              if (val === 'dismiss') {
                                void handleDecision(proposal.id, { action: 'dismiss' });
                              } else if (val.startsWith('link:')) {
                                const [, pmoId, externalId] = val.split(':');
                                void handleDecision(proposal.id, { action: 'link', pmoId, externalId });
                              }
                            }}
                            loadOptions={() => Promise.resolve(candidateOptions)}
                            placeholder={t('integrations.connect.choose', 'Choose')}
                            noun='record'
                          />
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => setChoosingRowId(null)}
                            aria-label={t('ux.close', 'Close')}
                          >
                            <Icon name='x' className='h-4 w-4' aria-hidden />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => setChoosingRowId(proposal.id)}
                        >
                          {t('integrations.connect.choose', 'Choose')}
                        </Button>
                      )}
                    </CanWrite>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* One confirm stating the counts (FR-ECA-012) */}
      <ConfirmDialog
        open={Boolean(acceptingTarget)}
        title={t('integrations.connect.confirmAcceptTitle', 'Accept record matches?')}
        description={formatConfirmDescription(t, targetCounts)}
        confirmLabel={t('integrations.connect.acceptAll', 'Accept all')}
        loading={acceptLoading}
        onConfirm={() => void handleAcceptConfirm()}
        onCancel={() => setAcceptingTarget(null)}
      />
    </div>
  );
}
