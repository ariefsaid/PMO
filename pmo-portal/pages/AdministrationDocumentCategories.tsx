import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Checkbox, ConfirmDialog, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { can } from '@/src/auth/policy';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { categoryDisplay } from '@/src/lib/documentCategories';
import type { CategoryRole, DocumentCategory } from '@/src/lib/db/documentCategories';
import { useDocumentCategories, useDocumentCategoryMutations } from '@/src/hooks/useDocumentCategories';
import { useRoleLabels } from './admin-users/roleLabels';
import { useJobRoleOptions } from '@/src/hooks/useJobRoleOptions';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';

/**
 * Administration › Document categories (#2579). An Admin names the categories documents are filed under and says which roles may see
 * each one. The database enforces the rule (a restrictive policy on the register and its files); this screen only edits it. Admin is
 * always a viewer and its box is locked on. Archiving keeps a category's rules for the documents already in it.
 */

const ROLE_ORDER: CategoryRole[] = ['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin'];

/** One checkbox per role; Admin is locked on (the database refuses a set without it). */
const RoleBoxes: React.FC<{
  idPrefix: string;
  legend: string;
  roles: ReadonlySet<CategoryRole>;
  disabled?: boolean;
  onToggle: (role: CategoryRole, next: boolean) => void;
}> = ({ idPrefix, legend, roles, disabled = false, onToggle }) => {
  const { label } = useRoleLabels();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-medium text-text-secondary">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {ROLE_ORDER.map((role) => (
          <span key={role} className="inline-flex items-center gap-2 text-sm" id={`${idPrefix}-${role.replace(/\s/g, '')}-label`}>
            <Checkbox
              checked={roles.has(role)}
              onChange={(next) => onToggle(role, next)}
              label={`${legend}: ${label(role)}`}
              disabled={disabled || !can('toggleRole', 'documentCategory', { realRole: 'Admin', record: { role } })}
            >
              {label(role)}
            </Checkbox>
          </span>
        ))}
      </div>
    </fieldset>
  );
};

const CategoryCard: React.FC<{
  category: DocumentCategory;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onSaveRoles: (roles: CategoryRole[], hiddenJobRoles: string[]) => void;
  onRename: (name: string) => void;
  onArchive: () => void;
  onRestore: () => void;
  onMove: (delta: -1 | 1) => void;
}> = ({ category, canManage, isFirst, isLast, busy, onSaveRoles, onRename, onArchive, onRestore, onMove }) => {
  const { t } = useTranslation();
  const display = categoryDisplay((key, fallback) => t(key, fallback), category);
  const saved = useMemo(() => new Set(category.roles), [category.roles]);
  const [roles, setRoles] = useState<Set<CategoryRole>>(() => new Set(saved));
  const [name, setName] = useState(category.name);
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { setRoles(new Set(saved)); }, [saved]);
  useEffect(() => { setName(category.name); }, [category.name]);
  // Job roles hidden from the category whatever their access level (2047); the Administrator is never hidden.
  const [hidden, setHidden] = useState<string[]>(category.hidden_job_roles ?? []);
  useEffect(() => { setHidden(category.hidden_job_roles ?? []); }, [category.hidden_job_roles]);
  const roleName = useBuiltInRoleName();
  const jobRoleOptions = useJobRoleOptions(t('administration:documentCategories.hideChoose', 'Hide from a job role…'));
  const hideOptions = jobRoleOptions.filter((o) => o.value !== 'administrator' && !hidden.includes(o.value));

  const hiddenDirty = hidden.join() !== (category.hidden_job_roles ?? []).join();
  const dirty = ROLE_ORDER.some((r) => roles.has(r) !== saved.has(r)) || hiddenDirty;
  const archived = category.archived_at !== null;
  return (
    <Card className="space-y-3 p-4" data-testid={`document-category-${category.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
            <TextField
              label={t('administration:documentCategories.name', 'Category name')}
              value={name}
              maxLength={120}
              onChange={setName}
              fullWidth
            />
            <Button
              variant="primary"
              disabled={busy || name.trim() === '' || name.trim() === category.name}
              onClick={() => { onRename(name); setRenaming(false); }}
            >
              {t('administration:documentCategories.saveName', 'Save name')}
            </Button>
            <Button variant="outline" onClick={() => { setName(category.name); setRenaming(false); }}>
              {t('administration:documentCategories.cancel', 'Cancel')}
            </Button>
          </div>
        ) : (
          <h3 className="min-w-0 flex-1 break-words text-base font-semibold">{display}</h3>
        )}
        {category.is_system && <Badge>{t('administration:documentCategories.system', 'System')}</Badge>}
        {archived && <Badge>{t('administration:documentCategories.archived', 'Archived')}</Badge>}
      </div>

      <RoleBoxes
        idPrefix={`cat-${category.id}`}
        legend={t('administration:documentCategories.viewers', 'Who can see documents in this category')}
        roles={roles}
        disabled={!canManage}
        onToggle={(role, next) => setRoles((prev) => { const s = new Set(prev); if (next) s.add(role); else s.delete(role); return s; })}
      />

      <div className="space-y-2">
        <p className="text-sm font-semibold">{t('administration:documentCategories.hiddenFrom', 'Hidden from these job roles')}</p>
        {hidden.length === 0
          ? <p className="text-sm text-text-secondary">{t('administration:documentCategories.hiddenNone', 'No job role is hidden from it.')}</p>
          : <ul className="flex flex-wrap gap-2">{hidden.map((key) => (
            <li key={key}><Badge>{roleName(key)}</Badge>{canManage && (
              <Button variant="ghost" size="sm" aria-label={t('administration:documentCategories.unhide', 'Show it to {{role}} again', { role: roleName(key) })}
                onClick={() => setHidden((h) => h.filter((k) => k !== key))}>{t('administration:documentCategories.unhideShort', 'Remove')}</Button>)}</li>))}</ul>}
        {canManage && (
          <SelectField label={t('administration:documentCategories.hideFrom', 'Hide from a job role')} value="" options={hideOptions} compact
            onChange={(key) => { if (key) setHidden((h) => [...h, key]); }} />
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={!dirty || busy} onClick={() => onSaveRoles(ROLE_ORDER.filter((r) => roles.has(r)), hidden)}>
            {t('administration:documentCategories.saveRoles', 'Save who can see it')}
          </Button>
          {!category.is_system && !renaming && (
            <Button variant="outline" disabled={busy} onClick={() => setRenaming(true)}>
              {t('administration:documentCategories.rename', 'Rename')}
            </Button>
          )}
          {!category.is_system && (archived
            ? <Button variant="outline" disabled={busy} onClick={onRestore}>{t('administration:documentCategories.restore', 'Restore')}</Button>
            : <Button variant="outline" disabled={busy} onClick={onArchive}>{t('administration:documentCategories.archive', 'Archive')}</Button>)}
          <Button variant="ghost" aria-label={t('administration:documentCategories.moveUp', 'Move up')} disabled={busy || isFirst} onClick={() => onMove(-1)}>
            {t('administration:documentCategories.moveUp', 'Move up')}
          </Button>
          <Button variant="ghost" aria-label={t('administration:documentCategories.moveDown', 'Move down')} disabled={busy || isLast} onClick={() => onMove(1)}>
            {t('administration:documentCategories.moveDown', 'Move down')}
          </Button>
        </div>
      )}
    </Card>
  );
};

const NewCategory: React.FC<{ busy: boolean; onCreate: (name: string, roles: CategoryRole[]) => Promise<void> }> = ({ busy, onCreate }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Set<CategoryRole>>(() => new Set<CategoryRole>(['Admin']));
  return (
    <Card className="space-y-3 p-4" data-testid="document-category-new">
      <h3 className="text-base font-semibold">{t('administration:documentCategories.newTitle', 'New category')}</h3>
      <TextField
        label={t('administration:documentCategories.name', 'Category name')}
        value={name}
        maxLength={120}
        onChange={setName}
        placeholder={t('administration:documentCategories.namePlaceholder', 'e.g. Commercial approval')}
        fullWidth
      />
      <RoleBoxes
        idPrefix="cat-new"
        legend={t('administration:documentCategories.viewers', 'Who can see documents in this category')}
        roles={roles}
        onToggle={(role, next) => setRoles((prev) => { const s = new Set(prev); if (next) s.add(role); else s.delete(role); return s; })}
      />
      <p className="text-sm text-text-secondary">
        {t('administration:documentCategories.newHint', 'Choose the roles on purpose: a new category starts with Admin only, so nobody else sees its documents until you add them.')}
      </p>
      <Button
        variant="primary"
        disabled={busy || name.trim() === ''}
        onClick={async () => {
          await onCreate(name, ROLE_ORDER.filter((r) => roles.has(r)));
          setName('');
          setRoles(new Set<CategoryRole>(['Admin']));
        }}
      >
        {t('administration:documentCategories.create', 'Create category')}
      </Button>
    </Card>
  );
};

const AdministrationDocumentCategories: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canManage = usePermission()('manage', 'documentCategory');
  const { data, isPending, isError, refetch } = useDocumentCategories();
  const m = useDocumentCategoryMutations();
  const [archiveTarget, setArchiveTarget] = useState<DocumentCategory | null>(null);
  const busy = Object.values(m).some((x) => x.isPending);

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast(done, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const live = (data ?? []).filter((c) => c.archived_at === null);
  const archived = (data ?? []).filter((c) => c.archived_at !== null);
  const move = (id: string, delta: -1 | 1) => {
    const ids = live.map((c) => c.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(() => m.reorder.mutateAsync(ids), t('administration:documentCategories.reordered', 'Order saved'));
  };

  return (
    <div data-testid="administration-panel-document-categories" className="min-w-0 space-y-4">
      <p className="text-sm text-text-secondary">
        {t('administration:documentCategories.intro', 'Every document is filed under one category. Choose which roles can see the documents in each category; people in other roles will not see them or their files. Admin always sees every category.')}
      </p>
      <p className="text-sm text-text-secondary">
        {t('administration:documentCategories.m365Note', 'Files linked from Microsoft 365 keep Microsoft’s own permissions. These settings control only the register entry, preview and open link in PMO.')}
      </p>
      {isPending ? <ListState variant="loading" /> : null}
      {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
      {!isPending && !isError ? (
        <>
          {canManage && (
            <NewCategory
              busy={busy}
              onCreate={(name, roles) => run(() => m.create.mutateAsync({ name, roles }), t('administration:documentCategories.created', 'Category created'))}
            />
          )}
          {live.map((c, i) => (
            <CategoryCard
              key={c.id}
              category={c}
              canManage={canManage}
              isFirst={i === 0}
              isLast={i === live.length - 1}
              busy={busy}
              onSaveRoles={(roles, keys) => void run(async () => { await m.setRoles.mutateAsync({ id: c.id, roles }); if (keys.join() !== (c.hidden_job_roles ?? []).join()) await m.setHiddenJobRoles.mutateAsync({ id: c.id, keys }); }, t('administration:documentCategories.rolesSaved', 'Saved'))}
              onRename={(name) => void run(() => m.rename.mutateAsync({ id: c.id, name }), t('administration:documentCategories.renamed', 'Category renamed'))}
              onArchive={() => setArchiveTarget(c)}
              onRestore={() => void run(() => m.restore.mutateAsync(c.id), t('administration:documentCategories.restored', 'Category restored'))}
              onMove={(delta) => move(c.id, delta)}
            />
          ))}
          {archived.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-text-secondary">{t('administration:documentCategories.archivedHeading', 'Archived categories')}</h3>
              {archived.map((c) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  canManage={canManage}
                  isFirst
                  isLast
                  busy={busy}
                  onSaveRoles={(roles, keys) => void run(async () => { await m.setRoles.mutateAsync({ id: c.id, roles }); if (keys.join() !== (c.hidden_job_roles ?? []).join()) await m.setHiddenJobRoles.mutateAsync({ id: c.id, keys }); }, t('administration:documentCategories.rolesSaved', 'Saved'))}
                  onRename={() => undefined}
                  onArchive={() => undefined}
                  onRestore={() => void run(() => m.restore.mutateAsync(c.id), t('administration:documentCategories.restored', 'Category restored'))}
                  onMove={() => undefined}
                />
              ))}
            </>
          )}
        </>
      ) : null}
      <ConfirmDialog
        open={archiveTarget !== null}
        title={t('administration:documentCategories.archiveTitle', 'Archive this category?')}
        description={t('administration:documentCategories.archiveBody', 'No new document can be filed in it. Documents already in it stay visible to the same roles.')}
        confirmLabel={t('administration:documentCategories.archive', 'Archive')}
        loading={m.archive.isPending}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (target) void run(() => m.archive.mutateAsync(target.id), t('administration:documentCategories.archivedDone', 'Category archived'));
        }}
      />
    </div>
  );
};

export default AdministrationDocumentCategories;
