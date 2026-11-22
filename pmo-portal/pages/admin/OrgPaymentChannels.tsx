import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, ConfirmDialog, FieldError, ListState, TextField } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { usePaymentChannelList, usePaymentChannelMutations, usePaymentChannelsOn } from '@/src/hooks/usePaymentChannels';
import type { PaymentChannel } from '@/src/lib/repositories/paymentChannels';

/**
 * #2698 — Administration: the organisation's list of payment channels. Payment channels are on for everyone (#2746), start from a
 * starter list the Admin then edits, and are hidden with the Purchasing extras module. UX gate only: the RPCs are the authority.
 */
export default function OrgPaymentChannels() {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'orgAccounting');
  const { on, query: onQuery } = usePaymentChannelsOn();
  const list = usePaymentChannelList(on);
  const m = usePaymentChannelMutations();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<PaymentChannel | null>(null);
  const lastError = [m.save, m.archive].find((x) => x.isError);
  const error = lastError ? classifyMutationError(lastError.error) : null;
  const busy = m.save.isPending || m.archive.isPending;

  return (
    <section aria-labelledby="payment-channels-heading">
      <h2 id="payment-channels-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">{t('procurement:paymentChannel.heading', 'Payment channels')}</h2>
      <div className="mt-3 max-w-md">
        <p className="mb-2 text-control text-muted-foreground">{t('procurement:paymentChannel.intro', 'Record how each purchase request will be paid. Edit the list of channels here.')}</p>
        {onQuery.isPending && <ListState variant="loading" rows={2} />}
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
