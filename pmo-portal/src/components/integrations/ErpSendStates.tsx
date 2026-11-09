import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { integrationsRepository } from '@/src/lib/repositories/integrations';
import { Button, StatusPill } from '@/src/components/ui';
import type { ConnectTier } from '@/src/lib/repositories/types';

const POLL_MS = 10_000;

/**
 * The state of records going to the connected ERP (ERPNext or Odoo) (ECA-3, NFR-ECA-004), inside the setup checklist: waiting sends are "Sending to the
 * ERP" until the ERP confirms, a refused or unconfirmed send is "Needs a decision" with its plain reason, and people the ERP
 * cannot take are listed to add there by hand (PMO never invents the personal details the ERP asks for). Shown only when there is
 * something to say; a status that cannot be read says nothing rather than a wrong number.
 */
export function ErpSendStates({ enabled, tier = 'erpnext' }: { enabled: boolean; tier?: ConnectTier }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => integrationsRepository.retryConnectSend(tier, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
  const status = useQuery({
    queryKey: ['integrations', 'connect-status', tier],
    queryFn: () => integrationsRepository.getConnectStatus(tier),
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data?.waitingForSend ? POLL_MS : false),
  });
  const reviews = useQuery({
    queryKey: ['integrations', 'send-reviews', tier, status.data?.waitingForSend ?? 0],
    queryFn: () => integrationsRepository.listConnectProposals(tier, null, 'review', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const people = useQuery({
    queryKey: ['integrations', 'send-people', tier],
    queryFn: () => integrationsRepository.listConnectProposals(tier, 'employee', 'send', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const waiting = status.data?.waitingForSend ?? 0;
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
  const refused = (reviews.data?.proposals ?? []).filter((p) => (p.reason === 'rejected' || p.reason === 'held') && p.reason_text);
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
              <span className='break-words font-medium'>{p.snapshot.name ?? t('administration:integrations.send.unnamed', 'A record')}</span>{' '}
              <StatusPill variant='warn'>{t('administration:integrations.send.needsDecision', 'Needs a decision')}</StatusPill>
              <p className='mt-1 break-words text-muted-foreground'>{p.reason_text}</p>
              {p.reason === 'held' && (
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
