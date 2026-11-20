import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CanWrite } from '@/src/auth/usePermission';
import { AppError } from '@/src/lib/appError';
import { repositories } from '@/src/lib/repositories';
import type { ConnectTier } from '@/src/lib/repositories/types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { Button, EntityFormModal, FormGrid, SelectField, TextField } from '@/src/components/ui';
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
  const [accepted, setAccepted] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const groups = useQuery({
    queryKey: ['integrations', 'account-send-groups', tier],
    queryFn: () => repositories.integrations.listAccountSendGroups(tier),
    enabled: open,
    retry: false,
  });
  const labels = categories.map((category) => [category, budgetCategoryLabel(category, t)] as const);
  const start = () => {
    setGroup('');
    setNames((current) => Object.fromEntries(labels.map(([category, label]) => [category, accepted.includes(category) ? current[category] ?? label : label])));
    setErrors([]);
    setOpen(true);
  };
  const reasonOf = (err: unknown) => (err instanceof AppError && /bad_request/i.test(err.code ?? '') && err.message
    ? err.message
    : t('administration:integrations.accounts.failed', 'PMO could not ask for this account. Try again.'));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    const failed: string[] = [];
    // one request per category: a refusal for one never holds back the others
    for (const [category, label] of labels.filter(([category]) => !accepted.includes(category))) {
      try {
        await repositories.integrations.requestAccountSend(tier, { category, parentAccount: group, accountName: (names[category] ?? '').trim() });
        setAccepted((current) => [...current, category]);
      } catch (err) {
        failed.push(`${label}: ${reasonOf(err)}`);
      }
    }
    setBusy(false);
    void qc.invalidateQueries({ queryKey: ['integrations'] });
    if (failed.length === 0) setOpen(false);
    else setErrors(failed);
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
          submitDisabled={!complete || busy}
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
