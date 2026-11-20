import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import { parseErpSendRefusal } from '@/src/lib/integrations/erpSendRefusal';
import { Button, StatusPill } from '@/src/components/ui';
import type { ConnectTier } from '@/src/lib/repositories/types';

/** The sentence the send drain stores when the ERP account answering a request cannot hold direct costs (`accountMismatch` in connectSendsCore.ts). */
const ACCOUNT_UNUSABLE_TEXT = 'The ERP account with this name cannot be used for direct costs. Ask again with a different account name.';

const POLL_MS = 10_000;

/**
 * The state of records going to the connected ERP (ERPNext or Odoo) (ECA-3, NFR-ECA-004), inside the setup checklist: waiting sends are "Sending to the
 * ERP" until the ERP confirms, a refused or unconfirmed send is "Needs a decision" with its plain reason, and people the ERP
 * cannot take are listed to add there by hand (PMO never invents the personal details the ERP asks for). Shown only when there is
 * something to say; a status that cannot be read says nothing rather than a wrong number.
 */
export function ErpSendStates({ enabled, tier = 'erpnext' }: { enabled: boolean; tier?: ConnectTier }) {
  const { t, i18n } = useTranslation();
  const english = (i18n.language ?? 'en').toLowerCase().startsWith('en');
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => repositories.integrations.retryConnectSend(tier, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
  const status = useQuery({
    queryKey: ['integrations', 'connect-status', tier],
    queryFn: () => repositories.integrations.getConnectStatus(tier),
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data?.waitingForSend ? POLL_MS : false),
  });
  const reviews = useQuery({
    queryKey: ['integrations', 'send-reviews', tier, status.data?.waitingForSend ?? 0],
    queryFn: () => repositories.integrations.listConnectProposals(tier, null, 'review', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  // Finance can list account proposals but cannot list all kinds. Read that set separately so account holds remain visible.
  const accountReviews = useQuery({
    queryKey: ['integrations', 'account-send-reviews', tier, status.data?.waitingForSend ?? 0],
    queryFn: () => repositories.integrations.listConnectProposals(tier, 'account', 'review', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const people = useQuery({
    queryKey: ['integrations', 'send-people', tier],
    queryFn: () => repositories.integrations.listConnectProposals(tier, 'employee', 'send', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const waiting = status.data?.waitingForSend ?? 0;
  const previousWaiting = useRef(0);
  useEffect(() => {
    if (previousWaiting.current > waiting) {
      void qc.invalidateQueries({ queryKey: ['integrations', 'account-link-notes', tier] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'setup'] });
    }
    previousWaiting.current = waiting;
  }, [waiting, qc, tier]);
  // Indexed by tier, never branched on (AC-ECA-043); literal t() calls so the i18n gate sees every key.
  const words = {
    erpnext: {
      title: t('administration:integrations.send.title', 'Records going to the ERP'),
      sending: t('administration:integrations.send.sending', 'Sending to the ERP'),
      waiting: t('administration:integrations.send.waiting', '{{count}} waiting for the ERP to confirm.', { count: waiting }),
      addPeople: t('administration:integrations.send.addPeople', 'Add these people in the ERP. It asks for a birth date and gender, which PMO does not hold.'),
    },
    odoo: {
      title: t('administration:odoo.send.title', 'Records going to Odoo'),
      sending: t('administration:odoo.send.sending', 'Sending to Odoo'),
      waiting: t('administration:odoo.send.waiting', '{{count}} waiting for Odoo to confirm.', { count: waiting }),
      addPeople: t('administration:odoo.send.addPeople', 'Add these people in Odoo. PMO does not send people to Odoo yet.'),
    },
  }[tier];
  // only a refused or unconfirmed send leaves one of these (a matcher review row has another reason)
  // The server stores each refusal as one English sentence. Known ones are said from the catalogue; an unknown one
  // is shown as stored in English and as one plain line in any other language.
  const refusalText = (text: string): string => {
    const r = parseErpSendRefusal(text);
    if (!r) return english ? text : t('administration:integrations.send.refusal.unknown', 'We could not send this record. Check it in the ERP, then try again.');
    const noun = {
      company: t('administration:integrations.send.refusal.noun.company', 'company'),
      project: t('administration:integrations.send.refusal.noun.project', 'project'),
      item: t('administration:integrations.send.refusal.noun.item', 'item'),
      person: t('administration:integrations.send.refusal.noun.person', 'person'),
      record: t('administration:integrations.send.refusal.noun.record', 'record'),
    }[r.noun];
    switch (r.id) {
      case 'gone': return t('administration:integrations.send.refusal.gone', 'This record is no longer in PMO, or (an item) no longer on an open purchase.');
      case 'person': return t('administration:integrations.send.refusal.person', 'This ERP asks for a birth date and gender for each person, which PMO does not hold. Add this person in the ERP.');
      case 'personOdoo': return t('administration:integrations.send.refusal.personOdoo', 'Odoo people are not sent from PMO yet. Add this person in Odoo.');
      case 'actor': return t('administration:integrations.send.refusal.actor', 'The Admin who accepted this is no longer an Admin. Accept it again.');
      case 'ambiguous': return t('administration:integrations.send.refusal.ambiguous', 'Two ERP records match this {{noun}}. Link the right one by hand.', { noun });
      case 'linked': return t('administration:integrations.send.refusal.linked', 'This record is already linked to another ERP record.');
      case 'stuck': return t('administration:integrations.send.refusal.stuck', 'We could not finish sending this record. Check it in the ERP, then try again.');
      case 'refused':
        return english && r.reason
          ? t('administration:integrations.send.refusal.refusedReason', 'The ERP refused this {{noun}}: {{reason}}', { noun, reason: r.reason })
          : t('administration:integrations.send.refusal.refused', 'The ERP refused this {{noun}}. Check it in the ERP, then try again.', { noun });
      case 'held': return r.erp === 'Odoo'
        ? t('administration:integrations.send.refusal.heldOdoo', 'We could not confirm whether Odoo created this record. Look for it in Odoo by name and tax id; if it is not there, send it again.')
        : t('administration:integrations.send.refusal.held', 'We could not confirm whether the ERP created this record. Look for it in the ERP by name and tax id; if it is not there, send it again.');
      case 'planFirst': return t('administration:integrations.send.refusal.planFirst', 'Choose the cost-account plan for projects first, then send this project again.');
      case 'projectNumber': return t('administration:integrations.send.refusal.projectNumber', 'This project has no project number yet, so its cost account cannot be named. Give it one, then send it again.');
      case 'unitUnmapped': return t('administration:integrations.send.refusal.unitUnmapped', 'The ERP refused this {{noun}}: its unit has no match in Odoo yet.', { noun });
      case 'notApplied': return t('administration:integrations.send.refusal.notApplied', 'This row could not be applied.');
      case 'companyGone': return t('administration:integrations.send.refusal.companyGone', 'This company is no longer in PMO.');
      case 'projectGone': return t('administration:integrations.send.refusal.projectGone', 'This project is no longer in PMO.');
      case 'internalCompany': return t('administration:integrations.send.refusal.internalCompany', 'An internal company cannot take an ERP link.');
      case 'changedSince': return t('administration:integrations.send.refusal.changedSince', 'The ERP record changed since this was proposed.');
      case 'personGone': return t('administration:integrations.send.refusal.personGone', 'This person is no longer in PMO.');
      case 'itemLinked': return t('administration:integrations.send.refusal.itemLinked', 'This item is already linked.');
    }
  };
  // Under another language the ERP's own reason is kept verbatim (untranslated) after the translated sentence.
  const erpWords = (text: string): string | null => {
    const r = parseErpSendRefusal(text);
    return r?.id === 'refused' ? r.reason : null;
  };
  const accountMessage = (text: string, held: boolean) => held
    ? t('administration:integrations.accounts.held', 'PMO could not confirm whether the account was created. Contact your administrator.')
    : text === ACCOUNT_UNUSABLE_TEXT ? t('administration:integrations.accounts.unusable', ACCOUNT_UNUSABLE_TEXT)
      : english && !text.includes('your administrator has been told') ? text : t('administration:integrations.accounts.failedDetails', 'PMO could not complete this account request. Check the details or contact your administrator.');
  const refused = [...new Map([...(reviews.data?.proposals ?? []), ...(accountReviews.data?.proposals ?? [])]
    .filter((p) => (p.reason === 'rejected' || p.reason === 'held' || p.reason === 'unresolved') && p.reason_text)
    .map((p) => [p.id, p])).values()];
  const toAdd = people.data?.proposals ?? [];
  if (waiting === 0 && refused.length === 0 && toAdd.length === 0) return null;
  return (
    <li id='erp-setup-sends' className='py-3'>
      <p className='font-medium'>{words.title}</p>
      {waiting > 0 && (
        <p className='mt-1 flex flex-wrap items-center gap-2 text-muted-foreground' role='status'>
          <StatusPill variant='progress'>{words.sending}</StatusPill>
          <span className='tabular-nums'>{words.waiting}</span>
        </p>
      )}
      {refused.length > 0 && (
        <ul className='mt-2 space-y-2'>
          {refused.map((p) => (
            <li key={p.id} className='min-w-0'>
              <span className='break-words font-medium'>{(p.kind === 'account' ? p.snapshot.accountName ?? p.snapshot.name ?? p.pmo_ids.join(', ') : p.snapshot.name) || t('administration:integrations.send.unnamed', 'A record')}</span>{' '}
              <StatusPill variant='warn'>{t('administration:integrations.send.needsDecision', 'Needs a decision')}</StatusPill>
              <p className='mt-1 break-words text-muted-foreground'>{p.kind === 'account' ? accountMessage(p.reason_text ?? '', (p.reason === 'held' || p.reason === 'unresolved')) : refusalText(p.reason_text ?? '')}</p>
              {p.kind !== 'account' && !english && erpWords(p.reason_text ?? '') && (
                <p lang='en' data-erp-reason className='mt-1 break-words text-muted-foreground'>{t('administration:integrations.send.refusal.erpReason', 'ERP: {{reason}}', { reason: erpWords(p.reason_text ?? ''), interpolation: { escapeValue: false } })}</p>
              )}
              {p.reason === 'held' && p.kind !== 'account' && (
                <div className='mt-2'>
                  <Button variant='outline' size='sm' disabled={retry.isPending} onClick={() => retry.mutate(p.id)}>
                    {t('administration:integrations.send.retry', 'It is not there: send it again')}
                  </Button>
                  {retry.isError && retry.variables === p.id && (
                    <p role='alert' className='mt-1 break-words text-muted-foreground'>{t('administration:integrations.send.retryFailed', 'We could not send it again. Try again in a moment.')}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {toAdd.length > 0 && (
        <div className='mt-2'>
          <p className='text-muted-foreground'>
            {words.addPeople}
          </p>
          <ul className='mt-1 list-disc pl-5'>
            {toAdd.map((p) => <li key={p.id} className='break-words'>{p.snapshot.name ?? t('administration:integrations.send.unnamed', 'A record')}</li>)}
          </ul>
        </div>
      )}
    </li>
  );
}
