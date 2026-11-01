import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repositories } from '@/src/lib/repositories';
import { StatusPill } from '@/src/components/ui';

const TIER = 'erpnext';
const POLL_MS = 10_000;

/**
 * The state of records going to the ERP (ECA-3, NFR-ECA-004), inside the setup checklist: waiting sends are "Sending to the
 * ERP" until the ERP confirms, a refused or unconfirmed send is "Needs a decision" with its plain reason, and people the ERP
 * cannot take are listed to add there by hand (PMO never invents the personal details the ERP asks for). Shown only when there is
 * something to say; a status that cannot be read says nothing rather than a wrong number.
 */
export function ErpSendStates({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const status = useQuery({
    queryKey: ['integrations', 'connect-status', TIER],
    queryFn: () => repositories.integrations.getConnectStatus(TIER),
    enabled,
    retry: false,
    refetchInterval: (q) => (q.state.data?.waitingForSend ? POLL_MS : false),
  });
  const reviews = useQuery({
    queryKey: ['integrations', 'send-reviews', TIER, status.data?.waitingForSend ?? 0],
    queryFn: () => repositories.integrations.listConnectProposals(TIER, null, 'review', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const people = useQuery({
    queryKey: ['integrations', 'send-people', TIER],
    queryFn: () => repositories.integrations.listConnectProposals(TIER, 'employee', 'send', null),
    enabled: enabled && status.isSuccess,
    retry: false,
  });
  const waiting = status.data?.waitingForSend ?? 0;
  // a send's review row names no ERP record; a matcher review row always does
  const refused = (reviews.data?.proposals ?? []).filter((p) => p.external_ids.length === 0 && p.reason_text);
  const toAdd = people.data?.proposals ?? [];
  if (waiting === 0 && refused.length === 0 && toAdd.length === 0) return null;
  return (
    <li id='erp-setup-sends' className='py-3'>
      <p className='font-medium'>{t('administration:integrations.send.title', 'Records going to the ERP')}</p>
      {waiting > 0 && (
        <p className='mt-1 flex flex-wrap items-center gap-2 text-muted-foreground' role='status'>
          <StatusPill variant='progress'>{t('administration:integrations.send.sending', 'Sending to the ERP')}</StatusPill>
          <span className='tabular-nums'>{t('administration:integrations.send.waiting', '{{count}} waiting for the ERP to confirm.', { count: waiting })}</span>
        </p>
      )}
      {refused.length > 0 && (
        <ul className='mt-2 space-y-2'>
          {refused.map((p) => (
            <li key={p.id} className='min-w-0'>
              <span className='break-words font-medium'>{p.snapshot.name ?? t('administration:integrations.send.unnamed', 'A record')}</span>{' '}
              <StatusPill variant='warn'>{t('administration:integrations.send.needsDecision', 'Needs a decision')}</StatusPill>
              <p className='mt-1 break-words text-muted-foreground'>{p.reason_text}</p>
            </li>
          ))}
        </ul>
      )}
      {toAdd.length > 0 && (
        <div className='mt-2'>
          <p className='text-muted-foreground'>
            {t('administration:integrations.send.addPeople', 'Add these people in the ERP. It asks for a birth date and gender, which PMO does not hold.')}
          </p>
          <ul className='mt-1 list-disc pl-5'>
            {toAdd.map((p) => <li key={p.id} className='break-words'>{p.snapshot.name ?? t('administration:integrations.send.unnamed', 'A record')}</li>)}
          </ul>
        </div>
      )}
    </li>
  );
}
