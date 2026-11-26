import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EntityFormModal, Checkbox, ConfirmDialog, ListState, SelectField, TextField, useToast } from '@/src/components/ui';
import { RowMenu } from '@/src/components/ui/RowMenu';
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

/** One checkbox per role; Admin is locked on (the database refuses a set without it). `cells`: one box per table column on a wide
 *  screen (the header names the role; each box keeps its full accessible name), wrapping with visible names below that width. */
const RoleBoxes: React.FC<{
  idPrefix: string;
  legend: string;
  roles: ReadonlySet<CategoryRole>;
  disabled?: boolean;
  cells?: boolean;
  onToggle: (role: CategoryRole, next: boolean) => void;
}> = ({ idPrefix, legend, roles, disabled = false, cells = false, onToggle }) => {
  const { label } = useRoleLabels();
  return (
    <fieldset className={cells ? 'min-w-0 xl:contents' : 'min-w-0'}>
      <legend className={cells ? 'mb-1 text-control font-medium text-muted-foreground xl:sr-only' : 'mb-1 text-control font-medium text-muted-foreground'}>{legend}</legend>
      <div className={cells ? 'flex flex-wrap gap-x-4 gap-y-1 xl:contents' : 'flex flex-wrap gap-x-4 gap-y-1'}>
        {ROLE_ORDER.map((role) => (
          <span key={role} className={cells ? 'inline-flex min-h-9 items-center gap-2 text-control xl:justify-center' : 'inline-flex items-center gap-2 text-control'} id={`${idPrefix}-${role.replace(/\s/g, '')}-label`}>
            <Checkbox
              checked={roles.has(role)}
              onChange={(next) => onToggle(role, next)}
              label={`${legend}: ${label(role)}`}
              disabled={disabled || !can('toggleRole', 'documentCategory', { realRole: 'Admin', record: { role } })}
            >
              <span className={cells ? 'xl:sr-only' : undefined}>{label(role)}</span>
            </Checkbox>
          </span>
        ))}
      </div>
    </fieldset>
  );
};

/** Wide screens: Category · one column per role · hidden job roles · actions. */
const CATEGORY_GRID = 'xl:grid xl:grid-cols-[minmax(8rem,1fr)_repeat(5,4.75rem)_minmax(13rem,1.2fr)_6.5rem] xl:items-start xl:gap-x-2';

const CategoryHeader: React.FC = () => {
  const { t } = useTranslation();
  const { label } = useRoleLabels();
  return (
    <div aria-hidden className={`hidden border-b border-border px-4 py-2 text-control font-medium text-muted-foreground ${CATEGORY_GRID} xl:items-end`}>
      <span>{t('administration:documentCategories.categoryColumn', 'Category')}</span>
      {ROLE_ORDER.map((role) => <span key={role} className="text-center leading-tight">{label(role)}</span>)}
      <span>{t('administration:documentCategories.hiddenFromShort', 'Hidden from')}</span>
      <span />
    </div>
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
  const menuItems = canManage ? [
    ...(!category.is_system && !renaming ? [{ label: t('administration:documentCategories.rename', 'Rename'), onClick: () => setRenaming(true), disabled: busy }] : []),
    ...(!category.is_system ? [archived
      ? { label: t('administration:documentCategories.restore', 'Restore'), onClick: onRestore, disabled: busy }
      : { label: t('administration:documentCategories.archive', 'Archive'), onClick: onArchive, disabled: busy }] : []),
    ...(!archived ? [
      { label: t('administration:documentCategories.moveUp', 'Move up'), onClick: () => onMove(-1), disabled: busy || isFirst },
      { label: t('administration:documentCategories.moveDown', 'Move down'), onClick: () => onMove(1), disabled: busy || isLast },
    ] : []),
  ] : [];
  return (
    <div role="listitem" className={`space-y-3 border-b border-border px-4 py-3 last:border-b-0 xl:space-y-0 ${CATEGORY_GRID}`} data-testid={`document-category-${category.id}`}>
      <div className="min-w-0 xl:pt-1.5">
        {renaming ? (
          <div className="flex min-w-0 flex-col gap-2">
            <TextField
              label={t('administration:documentCategories.name', 'Category name')}
              hideLabel
              value={name}
              maxLength={120}
              onChange={setName}
              fullWidth
            />
            <div className="flex flex-wrap gap-2">
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
          </div>
        ) : (
          <h3 className="min-w-0 break-words text-control font-semibold">{display}</h3>
        )}
        {(category.is_system || archived) && (
          <div className="mt-1 flex flex-wrap gap-1">
            {category.is_system && <Badge>{t('administration:documentCategories.system', 'System')}</Badge>}
            {archived && <Badge>{t('administration:documentCategories.archived', 'Archived')}</Badge>}
          </div>
        )}
      </div>

      <RoleBoxes
        cells
        idPrefix={`cat-${category.id}`}
        legend={t('administration:documentCategories.viewers', 'Who can see documents in this category')}
        roles={roles}
        disabled={!canManage}
        onToggle={(role, next) => setRoles((prev) => { const s = new Set(prev); if (next) s.add(role); else s.delete(role); return s; })}
      />

      <div className="min-w-0 space-y-2">
        <p className="text-control font-medium text-muted-foreground xl:sr-only">{t('administration:documentCategories.hiddenFrom', 'Hidden from these job roles')}</p>
        {hidden.length === 0
          ? (canManage ? null : <p className="text-control text-muted-foreground xl:pt-1.5">{t('administration:documentCategories.hiddenNoneShort', 'None')}</p>)
          : <ul className="flex flex-wrap gap-1">{hidden.map((key) => (
            <li key={key} className="inline-flex items-center"><Badge>{roleName(key)}</Badge>{canManage && (
              <Button variant="ghost" size="sm" aria-label={t('administration:documentCategories.unhide', 'Show it to {{role}} again', { role: roleName(key) })}
                onClick={() => setHidden((h) => h.filter((k) => k !== key))}>{t('administration:documentCategories.unhideShort', 'Remove')}</Button>)}</li>))}</ul>}
        {canManage && (
          <SelectField label={t('administration:documentCategories.hideFrom', 'Hide from a job role')} hideLabel value="" options={hideOptions} compact
            onChange={(key) => { if (key) setHidden((h) => [...h, key]); }} />
        )}
      </div>

      {canManage ? (
        <div className="flex items-center gap-2 xl:justify-end">
          <Button variant={dirty ? 'primary' : 'outline'} disabled={!dirty || busy} onClick={() => onSaveRoles(ROLE_ORDER.filter((r) => roles.has(r)), hidden)}
            aria-label={t('administration:documentCategories.saveRoles', 'Save who can see it')}>
            {t('administration:documentCategories.saveShort', 'Save')}
          </Button>
          {menuItems.length > 0 && <RowMenu items={menuItems} ariaLabel={t('administration:documentCategories.moreActions', 'More actions for {{name}}', { name: display })} />}
        </div>
      ) : <span className="hidden xl:block" />}
    </div>
  );
};

const NewCategory: React.FC<{ busy: boolean; open: boolean; onClose: () => void; onCreate: (name: string, roles: CategoryRole[]) => Promise<void> }> = ({ busy, open, onClose, onCreate }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [error, setError] = useState<ReturnType<typeof classifyMutationError> | null>(null);
  const [roles, setRoles] = useState<Set<CategoryRole>>(() => new Set<CategoryRole>(['Admin']));
  return (
    <EntityFormModal open={open} title={t('administration:documentCategories.newTitle', 'New category')}
      submitLabel={t('administration:documentCategories.create', 'Create category')} onClose={onClose}
      submitDisabled={name.trim() === ''} loading={busy} submitError={error}
      onSubmit={(e) => { e.preventDefault(); setError(null); void onCreate(name, ROLE_ORDER.filter((r) => roles.has(r))).catch((err: unknown) => setError(classifyMutationError(err))); }}>
      <div className="space-y-3" data-testid="document-category-new">
      <TextField
        label={t('administration:documentCategories.name', 'Category name')}
        value={name}
        maxLength={120}
        onChange={setName}
        placeholder={t('administration:documentCategories.namePlaceholder', 'e.g. Commercial approval')}
        wrapperClassName="max-w-md"
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
      </div>
    </EntityFormModal>
  );
};

const AdministrationDocumentCategories: React.FC = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const canManage = usePermission()('manage', 'documentCategory');
  const { data, isPending, isError, refetch } = useDocumentCategories();
  const m = useDocumentCategoryMutations();
  const [newOpen, setNewOpen] = useState(false);
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
      <p className="max-w-prose text-control text-muted-foreground">
        {t('administration:documentCategories.intro', 'Each document has one category. Choose which roles can see the documents in each category; people in other roles will not see them or their files. Admin always sees every category.')}
      </p>
      <p className="max-w-prose text-control text-muted-foreground">
        {t('administration:documentCategories.m365Note', 'Files linked from Microsoft 365 keep Microsoft’s own permissions. These settings control only the register entry, preview and open link in PMO.')}
      </p>
      {isPending ? <ListState variant="loading" /> : null}
      {isError ? <ListState variant="error" onRetry={() => void refetch()} /> : null}
      {!isPending && !isError ? (
        <>
          {canManage && (
            <Button variant="outline" onClick={() => setNewOpen(true)}>
              {t('administration:documentCategories.newTitle', 'New category')}
            </Button>
          )}
          <div role="list" aria-label={t('administration:documentCategories.listLabel', 'Document categories')} className="min-w-0 rounded-lg border border-border bg-card">
          <CategoryHeader />
          {live.map((c, i) => (
            <CategoryCard
              key={c.id}
              category={c}
              canManage={canManage}
              isFirst={i === 0}
              isLast={i === live.length - 1}
              busy={busy}
              onSaveRoles={(roles, keys) => void run(() => m.setAccess.mutateAsync({ id: c.id, roles, keys }), t('administration:documentCategories.rolesSaved', 'Saved'))}
              onRename={(name) => void run(() => m.rename.mutateAsync({ id: c.id, name }), t('administration:documentCategories.renamed', 'Category renamed'))}
              onArchive={() => setArchiveTarget(c)}
              onRestore={() => void run(() => m.restore.mutateAsync(c.id), t('administration:documentCategories.restored', 'Category restored'))}
              onMove={(delta) => move(c.id, delta)}
            />
          ))}
          </div>
          {canManage && (
            <NewCategory key={newOpen ? 'open' : 'closed'} open={newOpen} onClose={() => setNewOpen(false)}
              busy={busy} onCreate={async (name, roles) => {
                await m.create.mutateAsync({ name, roles });
                toast(t('administration:documentCategories.created', 'Category created'), 'success');
                setNewOpen(false);
              }} />
          )}
          {archived.length > 0 && (
            <>
              <h3 className="pt-4 text-group font-semibold">{t('administration:documentCategories.archivedHeading', 'Archived categories')}</h3>
              <div role="list" aria-label={t('administration:documentCategories.archivedHeading', 'Archived categories')} className="min-w-0 rounded-lg border border-border bg-card">
              <CategoryHeader />
              {archived.map((c) => (
                <CategoryCard
                  key={c.id}
                  category={c}
                  canManage={canManage}
                  isFirst
                  isLast
                  busy={busy}
                  onSaveRoles={(roles, keys) => void run(() => m.setAccess.mutateAsync({ id: c.id, roles, keys }), t('administration:documentCategories.rolesSaved', 'Saved'))}
                  onRename={() => undefined}
                  onArchive={() => undefined}
                  onRestore={() => void run(() => m.restore.mutateAsync(c.id), t('administration:documentCategories.restored', 'Category restored'))}
                  onMove={() => undefined}
                />
              ))}
              </div>
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
