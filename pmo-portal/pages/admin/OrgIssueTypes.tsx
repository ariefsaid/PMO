import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useIncidentTypes, useIncidentTypeMutations } from '@/src/hooks/useIncidentTypes';

/**
 * Administration › Projects › Issue types: the organisation's kept list of issue types, which the issue form picks from
 * and the closing-time report groups by (migrations 1820/1821). An Admin adds, renames and archives/restores. A rename
 * carries to the issues of that type; archiving hides a type from new issues and keeps it on old ones. UX gate only:
 * the Admin-only row rules are the authority (ADR-0016).
 */
const OrgIssueTypes: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const query = useIncidentTypes();
  const m = useIncidentTypeMutations();
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string>();
  if (!may('manage', 'incidentTypes')) return null;

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    setError(undefined);
    try { await work(); after?.(); toast(t('admin.issueTypes.saved', 'Issue types saved'), undefined, 'success'); }
    catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail?.includes('duplicate') || headline.toLowerCase().includes('already') ? t('admin.issueTypes.duplicate', 'That type is already in the list') : (detail || headline));
    }
  };
  const live = (query.data ?? []).filter((x) => !x.archived_at);

  return (
    <section id="issue-types" tabIndex={-1} className="scroll-mt-4" aria-labelledby="issue-types-heading">
      <h2 id="issue-types-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.issueTypes.title', 'Issue types')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.issueTypes.helper', 'The types people choose when they raise an issue, and the groups the closing-time report uses. Renaming a type renames it on every issue that has it. Archiving hides a type from new issues; issues that already have it keep it.')}</p>
      <div className="mt-4 space-y-3">
        {error && <FieldError id="issue-types-error">{error}</FieldError>}
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.issueTypes.loadError', "Couldn't load the issue types")} onRetry={() => void query.refetch()} />
        ) : !query.data ? (
          <ListState variant="loading" rows={2} />
        ) : (
          <>
            {live.length <= 1 && (
              <p className="text-control text-foreground" data-testid="issue-types-near-empty">
                {live.length === 0
                  ? t('admin.issueTypes.empty', 'No issue types yet, so nobody can raise an issue. Add your organisation\'s types below.')
                  : t('admin.issueTypes.nearEmpty', 'Only one type is listed. Add your organisation\'s own types below so issues can be grouped and timed by type.')}
              </p>
            )}
            <ul className="divide-y divide-border">
              {query.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  {editing?.id === item.id ? (
                    <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.rename.mutateAsync({ id: item.id, label: editing.label }), () => setEditing(null)); }}>
                      <TextField label={t('admin.issueTypes.renameFor', 'Name for {{name}}', { name: item.label })} hideLabel value={editing.label} onChange={(v) => setEditing({ id: item.id, label: v })} />
                      <Button type="submit" variant="primary" disabled={!editing.label.trim() || m.rename.isPending}>{t('admin.issueTypes.save', 'Save')}</Button>
                      <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('admin.issueTypes.cancel', 'Cancel')}</Button>
                    </form>
                  ) : (
                    <>
                      <span className={item.archived_at ? 'text-muted-foreground' : 'text-foreground'}>
                        {item.label}{item.archived_at ? ` · ${t('admin.issueTypes.archived', 'Archived')}` : ''}
                      </span>
                      <span className="flex gap-2">
                        <Button variant="outline" size="sm" aria-label={`${t('admin.issueTypes.rename', 'Rename')} ${item.label}`} onClick={() => setEditing({ id: item.id, label: item.label })}>{t('admin.issueTypes.rename', 'Rename')}</Button>
                        <Button variant="outline" size="sm" disabled={m.archive.isPending}
                          aria-label={`${item.archived_at ? t('admin.issueTypes.restore', 'Restore') : t('admin.issueTypes.archive', 'Archive')} ${item.label}`}
                          onClick={() => void run(() => m.archive.mutateAsync({ id: item.id, archived: !item.archived_at }))}>
                          {item.archived_at ? t('admin.issueTypes.restore', 'Restore') : t('admin.issueTypes.archive', 'Archive')}
                        </Button>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => m.add.mutateAsync(newLabel), () => setNewLabel('')); }}>
          <TextField label={t('admin.issueTypes.addLabel', 'New issue type')} value={newLabel} onChange={setNewLabel} />
          <Button type="submit" variant="primary" disabled={!newLabel.trim() || m.add.isPending}>{t('admin.issueTypes.add', 'Add')}</Button>
        </form>
      </div>
    </section>
  );
};
export default OrgIssueTypes;
