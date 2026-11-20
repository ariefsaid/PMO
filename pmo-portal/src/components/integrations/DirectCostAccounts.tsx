import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CanWrite } from '@/src/auth/usePermission';
import { AppError } from '@/src/lib/appError';
import { repositories } from '@/src/lib/repositories';
import type { ConnectProposal, ConnectTier } from '@/src/lib/repositories/types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, EntityFormModal, FormGrid, SelectField, TextField, type SubmitError } from '@/src/components/ui';
import { useAccountLinkNotes } from './useAccountLinkNotes';

/**
 * #1599 ECX-4 (OQ-ECX-1): budget categories with no direct-cost account, created from PMO. The Admin or Finance user picks one
 * expense group of the bound ERP company and a name per category; PMO queues one leaf account per category and the sweep creates it
 * in the ERP, reads it back and links it. PMO never creates a group, a tax or anything of the fiscal structure.
 */
export function DirectCostAccounts({ categories, tier = 'erpnext' }: { categories: string[]; tier?: ConnectTier }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [acceptedRequests, setAcceptedRequests] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const groups = useQuery({
    queryKey: ['integrations', 'account-send-groups', tier],
    queryFn: () => repositories.integrations.listAccountSendGroups(tier),
    enabled: open,
    retry: false,
  });
  // Share the setup screen's sweep status; each status refresh also refreshes actual review rows.
  const status = useQuery({
    queryKey: ['integrations', 'connect-status', tier],
    queryFn: () => repositories.integrations.getConnectStatus(tier),
    enabled: Object.keys(acceptedRequests).length > 0,
    retry: false,
    // Keep an open correction current across sessions, even after the last send settled.
    refetchInterval: open && Object.keys(acceptedRequests).length > 0 ? 10_000 : false,
  });
  const reviews = useQuery({
    queryKey: ['integrations', 'account-request-reviews', tier, status.dataUpdatedAt],
    queryFn: async () => {
      const rows: ConnectProposal[] = [];
      for (const state of ['open', 'dismissed', 'sending'] as const) {
        let afterId: string | null = null;
        const seen = new Set<string>();
        do {
          const outcome = state === 'sending' ? 'send' : 'review';
          const page: { proposals: ConnectProposal[]; nextAfterId: string | null } = state === 'open'
            ? await repositories.integrations.listConnectProposals(tier, 'account', outcome, afterId)
            : await repositories.integrations.listConnectProposals(tier, 'account', outcome, afterId, state);
          if (!Array.isArray(page.proposals)
            || page.proposals.some((p) => !p || (typeof p.id !== 'string' || !p.id) || p.kind !== 'account'
              || p.state !== state || p.outcome !== outcome
              || (state === 'sending' && p.reason !== null)
              || (p.reason !== null && !['ambiguous', 'tax-conflict', 'rejected', 'held', 'unresolved'].includes(p.reason))
              || !Array.isArray(p.pmo_ids) || p.pmo_ids.some((id) => typeof id !== 'string' || !id)
              || ((p.state === 'sending' || p.reason === 'held' || p.reason === 'unresolved' || p.reason === 'rejected') && p.pmo_ids.length === 0))
            || (page.nextAfterId !== null && (typeof page.nextAfterId !== 'string' || !page.nextAfterId || seen.has(page.nextAfterId)))) {
            throw new Error('Incomplete account request list');
          }
          rows.push(...page.proposals);
          afterId = page.nextAfterId;
          if (afterId) seen.add(afterId);
        } while (afterId);
      }
      return rows;
    },
    enabled: Object.keys(acceptedRequests).length > 0 && status.isSuccess,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const completeReviews = status.isSuccess && !status.isFetching && reviews.isSuccess && !reviews.isFetching && !reviews.isPlaceholderData;
  // Preserve the last complete view while a background refresh is in flight, so typing can continue.
  const rows = status.isSuccess && reviews.isSuccess ? reviews.data : [];
  const editableView = status.isSuccess && reviews.isSuccess;
  const rejected = rows.filter((p) => p.reason === 'rejected');
  const outstanding = new Set(rows.filter((p) => p.state === 'sending' || ((p.reason === 'held' || p.reason === 'unresolved') && (p.state === 'open' || p.state === 'dismissed'))).flatMap((p) => p.pmo_ids));
  const accepted = Object.keys(acceptedRequests).filter((category) => !editableView || outstanding.has(category) || !rejected.some((p) => p.id === acceptedRequests[category] && p.pmo_ids.includes(category)));
  const labels = categories.map((category) => [category, budgetCategoryLabel(category, t)] as const);
  const start = () => {
    if (Object.keys(acceptedRequests).length > 0) void qc.invalidateQueries({ queryKey: ['integrations', 'connect-status', tier] });
    setGroup('');
    setNames((current) => Object.fromEntries(labels.map(([category, label]) => [category, accepted.includes(category) ? current[category] ?? label : label])));
    setErrors([]);
    setSubmitError(null);
    setOpen(true);
  };
  const reasonOf = (err: unknown) => (err instanceof AppError && /bad_request/i.test(err.code ?? '') && err.message
    ? err.message
    : t('administration:integrations.accounts.failed', 'PMO could not ask for this account. Try again.'));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    setSubmitError(null);
    const failed: string[] = [];
    let lastError: unknown = null;
    let newlyAccepted = 0;
    // one request per category: a refusal for one never holds back the others
    for (const [category, label] of labels.filter(([category]) => !accepted.includes(category))) {
      try {
        const request = await repositories.integrations.requestAccountSend(tier, { category, parentAccount: group, accountName: (names[category] ?? '').trim() });
        setAcceptedRequests((current) => ({ ...current, [category]: request.id }));
        newlyAccepted += 1;
      } catch (err) {
        failed.push(`${label}: ${reasonOf(err)}`);
        lastError = err;
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['integrations'] });
    if (failed.length === 0) {
      setOpen(false);
    } else {
      setErrors(failed);
      if (newlyAccepted === 0 && accepted.length === 0) {
        const classified = classifyMutationError(lastError);
        setSubmitError({ headline: classified.headline, detail: classified.detail });
      }
    }
  };
  const complete = group !== '' && labels.every(([category]) => accepted.includes(category) || (names[category] ?? '').trim() !== '');
  const noGroups = groups.isSuccess && groups.data.length === 0;
  return (
    <div className='mt-1'>
      <p className='break-words text-muted-foreground'>
        {t('administration:integrations.accounts.missing', 'No direct-cost account for: {{categories}}', {
          categories: labels.map(([, label]) => label).join(', '),
        })}
      </p>
      <CanWrite action='manage' entity='integration' ctx={{ record: { kind: 'account' } }} fallback={null}>
        <Button variant='outline' size='sm' className='mt-2' onClick={start}>
          {t('administration:integrations.accounts.create', 'Create accounts')}
        </Button>
      </CanWrite>
      {open && (
        <EntityFormModal
          open
          title={t('administration:integrations.accounts.dialog', 'Create direct-cost accounts')}
          submitLabel={t('administration:integrations.accounts.create', 'Create accounts')}
          onSubmit={submit}
          onClose={() => setOpen(false)}
          loading={busy}
          dirty={group !== ''}
          submitDisabled={!complete || busy || (Object.keys(acceptedRequests).length > 0 && !completeReviews) || labels.every(([category]) => accepted.includes(category))}
          submitError={submitError}
        >
          {errors.length > 0 && (
            <div role='alert' className='mb-4 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3 py-3 text-control text-destructive-text'>
              {accepted.length > 0 && <p>{t('administration:integrations.accounts.accepted', 'Requests accepted: {{categories}}.', { categories: labels.filter(([category]) => accepted.includes(category)).map(([, label]) => label).join(', ') })}</p>}
              <p>{errors.join(' ')}</p>
            </div>
          )}
          <p className='mb-3 text-sm text-muted-foreground'>
            {t('administration:integrations.accounts.help', 'PMO creates one account for each category under the group you choose, then links it to the category.')}
          </p>
          {groups.isError && (
            <div role='alert' className='mb-3 text-sm'>
              <p>{t('administration:integrations.accounts.groupsError', 'Could not load expense groups. Try again.')}</p>
              <Button type='button' variant='outline' size='sm' onClick={() => void groups.refetch()}>{t('administration:integrations.accounts.groupsRetry', 'Retry')}</Button>
            </div>
          )}
          {noGroups && (
            <p className='mb-3 text-sm text-foreground' role='status'>
              {t('administration:integrations.accounts.noGroups', 'PMO has not read the expense groups yet. Try again after the next update.')}
            </p>
          )}
          <FormGrid>
            <SelectField
              id='direct-cost-group'
              label={t('administration:integrations.accounts.group', 'Expense group')}
              value={group}
              onChange={setGroup}
              placeholder={t('administration:integrations.accounts.groupPlaceholder', 'Choose a group')}
              options={(groups.data ?? []).map((g) => ({ value: g.erpName, label: g.erpName }))}
              disabled={!groups.isSuccess || noGroups}
              required
            />
            {labels.map(([category, label]) => (
              <TextField
                key={category}
                id={`direct-cost-name-${category}`}
                label={t('administration:integrations.accounts.name', 'Account name for {{category}}', { category: label })}
                value={names[category] ?? ''}
                onChange={(value) => setNames((current) => ({ ...current, [category]: value }))}
                disabled={accepted.includes(category)}
                maxLength={140}
                required
                fullWidth
              />
            ))}
          </FormGrid>
        </EntityFormModal>
      )}
    </div>
  );
}


/**
 * #1599 ECX-4 (ruling c): an account PMO linked under a different group than the one picked is said aloud where the link is made,
 * in the app's own words. A polite status region, so a screen reader announces it. Renders nothing when no account was linked elsewhere.
 */
export function AccountLinkNotes({ tier = 'erpnext', enabled = true }: { tier?: ConnectTier; enabled?: boolean }) {
  const { t } = useTranslation();
  const notes = useAccountLinkNotes(tier, enabled);
  if (notes.length === 0) return null;
  return (
    <ul className='mt-4 space-y-1 text-muted-foreground' role='status'>
      {notes.map(({ id, name, group }) => (
        <li key={id} className='break-words'>
          {t('administration:integrations.accounts.linkedElsewhere', '{{name}} was already in the ERP under {{group}}, so PMO linked it there.', { name, group })}
        </li>
      ))}
    </ul>
  );
}
