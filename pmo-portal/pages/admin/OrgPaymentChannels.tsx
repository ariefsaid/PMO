import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, ConfirmDialog, FieldError, ListState, Switch, TextField } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePaymentChannelList, usePaymentChannelMutations, usePaymentChannelsOn } from '@/src/hooks/usePaymentChannels';
import type { PaymentChannel } from '@/src/lib/repositories/paymentChannels';

/**
 * #2698 — Administration: the organisation's payment channel switch and its list of channels. Off until an Admin turns it
 * on (the first switch-on seeds a starter list the Admin then edits). UX gate only: the RPCs are the authority.
 */
export default function OrgPaymentChannels() {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'orgAccounting');
  const labelId = useId();
  const { on, query: onQuery } = usePaymentChannelsOn();
  const list = usePaymentChannelList(on);
  const m = usePaymentChannelMutations();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<PaymentChannel | null>(null);
  const lastError = [m.setEnabled, m.save, m.archive].find((x) => x.isError);
  const error = lastError ? classifyMutationError(lastError.error) : null;
  const busy = m.setEnabled.isPending || m.save.isPending || m.archive.isPending;

  return (
    <section aria-labelledby="payment-channels-heading">
      <h2 id="payment-channels-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">{t('procurement:paymentChannel.heading', 'Payment channels')}</h2>
      <div className="mt-3 max-w-md">
        <p className="mb-2 text-control text-muted-foreground">{t('procurement:paymentChannel.intro', 'Record how each purchase request will be paid. Off until you turn it on.')}</p>
        {onQuery.isPending ? <ListState variant="loading" rows={2} /> : (
          <label className={cn('flex min-h-11 items-start gap-3 py-1.5 text-control', canManage ? 'cursor-pointer' : 'cursor-default')}>
            <Switch checked={on} onChange={(next) => { m.setEnabled.reset(); m.setEnabled.mutate(next); }} labelledBy={labelId} disabled={!canManage || busy} className="mt-0.5" />
            <span id={labelId} className="font-medium">{t('procurement:paymentChannel.switchLabel', 'Record a payment channel on purchase requests')}</span>
          </label>
        )}
        {!canManage && <p className="mt-2 text-control text-muted-foreground">{t('procurement:paymentChannel.onlyAdmin', 'Only an Admin can change this.')}</p>}
        {on && (list.isError ? <ListState variant="error" title={t('procurement:paymentChannel.loadError', 'Couldn’t load payment channels')} onRetry={() => void list.refetch()} />
          : list.isPending ? <ListState variant="loading" rows={4} />
          : (
            <>
              {list.data.length === 0 && <p className="mt-2 text-control text-muted-foreground">{t('procurement:paymentChannel.empty', 'No channels yet.')}</p>}
              <ul aria-label={t('procurement:paymentChannel.listLabel', 'Channels')} className="mt-2 divide-y divide-border">
                {list.data.map((c) => (
                  <li key={c.id} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5">
                    {editing?.id === c.id ? (
                      <form className="flex w-full items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.save.mutate({ id: c.id, name: editing.name }, { onSuccess: () => setEditing(null) }); }}>
                        <TextField label={t('procurement:paymentChannel.nameLabel', 'Channel name')} value={editing.name} onChange={(v) => setEditing({ id: c.id, name: v })} maxLength={60} fullWidth />
                        <Button type="submit" variant="outline" loading={m.save.isPending}>{t('procurement:paymentChannel.renameSave', 'Save name')}</Button>
                        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t('procurement:paymentChannel.cancel', 'Cancel')}</Button>
                      </form>
                    ) : (
                      <>
                        <span className={cn('min-w-0 flex-1 truncate', c.archived && 'text-muted-foreground')}>{c.name}{c.archived && <span className="ml-2 text-support">{t('procurement:paymentChannel.archivedTag', 'Archived')}</span>}</span>
                        {canManage && !c.archived && <Button variant="ghost" size="sm" aria-label={`${t('procurement:paymentChannel.rename', 'Rename')} ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}>{t('procurement:paymentChannel.rename', 'Rename')}</Button>}
                        {canManage && (c.archived
                          ? <Button variant="ghost" size="sm" aria-label={`${t('procurement:paymentChannel.restore', 'Restore')} ${c.name}`} onClick={() => m.archive.mutate({ id: c.id, archived: false })}>{t('procurement:paymentChannel.restore', 'Restore')}</Button>
                          : <Button variant="ghost" size="sm" aria-label={`${t('procurement:paymentChannel.archive', 'Archive')} ${c.name}`} onClick={() => setArchiving(c)}>{t('procurement:paymentChannel.archive', 'Archive')}</Button>)}
                      </>
                    )}
                  </li>
                ))}
              </ul>
              {canManage && (
                <form className="mt-3 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.save.mutate({ id: null, name: newName }, { onSuccess: () => setNewName('') }); }}>
                  <TextField label={t('procurement:paymentChannel.nameLabel', 'Channel name')} value={newName} onChange={setNewName} maxLength={60} fullWidth />
                  <Button type="submit" variant="outline" loading={m.save.isPending} disabled={!newName.trim()}>{t('procurement:paymentChannel.add', 'Add channel')}</Button>
                </form>
              )}
            </>
          ))}
        {error && <FieldError>{error.detail || error.headline}</FieldError>}
      </div>
      <ConfirmDialog
        open={archiving !== null}
        title={t('procurement:paymentChannel.archiveTitle', 'Archive channel')}
        description={t('procurement:paymentChannel.archiveDescription', 'Requests that already use this channel keep it. It can no longer be chosen for new ones.')}
        confirmLabel={t('procurement:paymentChannel.archiveConfirm', 'Archive channel')}
        loading={m.archive.isPending}
        onConfirm={() => { if (archiving) m.archive.mutate({ id: archiving.id, archived: true }, { onSettled: () => setArchiving(null) }); }}
        onCancel={() => setArchiving(null)}
      />
    </section>
  );
}
