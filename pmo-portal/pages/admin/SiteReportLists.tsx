import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useSiteReportList, useSiteReportListMutations } from '@/src/hooks/useSiteReportLists';
import type { DsrListKind } from '@/src/lib/db/dailySiteReports';

/**
 * Administration › Projects › Site report lists (#2621, FR-DSR-003/004, migration 1040): the idle reasons and weather
 * conditions offered on a site report. An Admin adds, renames and archives/restores; everyone else reads nothing here.
 * Admin-only via `can('manage', 'siteReportLists')` (UX); the Admin-only row rules are the authority (ADR-0016).
 */
function ListEditor({ kind, title }: { kind: DsrListKind; title: string }) {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const query = useSiteReportList(kind);
  const m = useSiteReportListMutations(kind);
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string>();

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(undefined);
    try { await work(); after?.(); toast(t('admin.siteReportLists.saved', 'List saved'), undefined, 'success'); }
    catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail?.includes('duplicate') || headline.toLowerCase().includes('already') ? t('admin.siteReportLists.duplicate', 'That name is already in the list') : (detail || headline));
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {error && <FieldError id={`srl-error-${kind}`}>{error}</FieldError>}
      {query.isError && !query.data ? (
        <ListState variant="error" title={t('admin.siteReportLists.loadError', "Couldn't load the list")} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListState variant="loading" rows={2} />
      ) : query.data.length === 0 ? (
        <p className="text-control text-muted-foreground">{t('admin.siteReportLists.empty', 'Nothing listed yet')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {query.data.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              {editing?.id === item.id ? (
                <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.rename.mutateAsync({ id: item.id, label: editing.label }), () => setEditing(null)); }}>
                  <TextField label={t('admin.siteReportLists.renameFor', 'Name for {{name}}', { name: item.label })} hideLabel value={editing.label} onChange={(v) => setEditing({ id: item.id, label: v })} />
                  <Button type="submit" variant="primary" disabled={!editing.label.trim() || m.rename.isPending}>{t('admin.siteReportLists.save', 'Save')}</Button>
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('admin.siteReportLists.cancel', 'Cancel')}</Button>
                </form>
              ) : (
                <>
                  <span className={item.archived_at ? 'text-muted-foreground' : 'text-foreground'}>
                    {item.label}{item.archived_at ? ` · ${t('admin.siteReportLists.archived', 'Archived')}` : ''}
                  </span>
                  <span className="flex gap-2">
                    <Button variant="outline" size="sm" aria-label={`${t('admin.siteReportLists.rename', 'Rename')} ${item.label}`} onClick={() => setEditing({ id: item.id, label: item.label })}>{t('admin.siteReportLists.rename', 'Rename')}</Button>
                    <Button variant="outline" size="sm" disabled={m.archive.isPending}
                      aria-label={`${item.archived_at ? t('admin.siteReportLists.restore', 'Restore') : t('admin.siteReportLists.archive', 'Archive')} ${item.label}`}
                      onClick={() => void run(() => m.archive.mutateAsync({ id: item.id, archived: !item.archived_at }))}>
                      {item.archived_at ? t('admin.siteReportLists.restore', 'Restore') : t('admin.siteReportLists.archive', 'Archive')}
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.add.mutateAsync(newLabel), () => setNewLabel('')); }}>
        <TextField label={t('admin.siteReportLists.addLabel', 'New {{list}} entry', { list: title.toLowerCase() })} value={newLabel} onChange={setNewLabel} />
        <Button type="submit" variant="primary" disabled={!newLabel.trim() || m.add.isPending}>{t('admin.siteReportLists.add', 'Add')}</Button>
      </form>
    </div>
  );
}

const SiteReportLists: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  if (!may('manage', 'siteReportLists')) return null;
  return (
    <section id="site-report-lists" tabIndex={-1} className="scroll-mt-4" aria-labelledby="site-report-lists-heading">
      <h2 id="site-report-lists-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.siteReportLists.title', 'Site report lists')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.siteReportLists.helper', 'The choices offered on a site report. Archiving hides a choice from new reports; reports that already use it keep it.')}</p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ListEditor kind="idle" title={t('admin.siteReportLists.idle', 'Idle reasons')} />
        <ListEditor kind="weather" title={t('admin.siteReportLists.weather', 'Weather conditions')} />
      </div>
    </section>
  );
};
export default SiteReportLists;
