/**
 * My Views list page — /views (I4, FR-VB-010..016).
 * Lists the current user's non-archived views; open / edit / archive affordances.
 * Follows Companies.tsx CRUD/RBAC pattern (ADR-0016/0017/0018).
 * I5: "Compose with AI" entry point (FR-AS-014, AC-AS-011/012).
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatRelativeTime } from '@/src/lib/format';
import { useNavigate, Link } from 'react-router';
import {
  ListPage,
  ListState,
  DataTable,
  ConfirmDialog,
  Button,
  useToast,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { useUserViews, useUserViewMutations } from '@/src/hooks/useUserViews';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { UserViewRow } from '@/src/lib/db/userViews';
import { isFeatureEnabled } from '@/src/lib/features';
import AIComposerModal from '@/src/components/builder/AIComposerModal';
import type { CompositionSpec } from '@/src/lib/viewspec/types';

const MyViewsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUserViews();
  const { archive } = useUserViewMutations();

  const [archiveTarget, setArchiveTarget] = useState<UserViewRow | null>(null);
  const [aiComposerOpen, setAIComposerOpen] = useState(false);

  const showAIComposer =
    isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer');

  const canArchive = may('archive', 'userView');

  const columns: Column<UserViewRow>[] = [
    {
      key: 'name',
      header: t('financeCopy.name', "Name"),
      cell: (row) => (
        <Link to={`/views/${row.id}`} className="font-medium text-foreground hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'description',
      header: t('financeCopy.description', "Description"),
      cell: (row) => (
        <span className="text-muted-foreground">{row.description ?? '—'}</span>
      ),
    },
    {
      key: 'updated_at',
      header: t('financeCopy.updated', "Updated"),
      cell: (row) => (
          <span className="text-muted-foreground">{formatRelativeTime(row.updated_at)}</span>
      ),
    },
  ];

  const rowMenu = (row: UserViewRow): RowMenuItem[] => [
    {
      label: t('financeCopy.edit', "Edit"),
      onClick: () => navigate(`/views/${row.id}/edit`),
    },
    ...(canArchive
      ? [{ label: t('financeCopy.archive', "Archive"), onClick: () => setArchiveTarget(row) }]
      : []),
  ];

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget.id);
      toast(t('financeCopy.viewArchived', 'View archived'), archiveTarget.name, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    } finally {
      setArchiveTarget(null);
    }
  };

  // AI Composer: navigate to /views/new with the composed spec in router state (FR-AS-014)
  const handleComposed = (spec: CompositionSpec) => {
    setAIComposerOpen(false);
    navigate('/views/new', { state: { composedSpec: spec } });
  };

  const rows = data ?? [];

  return (
    <ListPage
      title={t('financeCopy.myViews', "My Views")}
      primaryAction={
        <div className="flex gap-2">
          {showAIComposer && (
            <Button
              variant="outline"
              onClick={() => setAIComposerOpen(true)}
              aria-label={t('financeCopy.composeViewWithAI', "Compose view with AI")}
            >
              {t('financeCopy.composeWithAI', "Compose with AI")}</Button>
          )}
          <Button variant="primary" onClick={() => navigate('/views/new')}>
            {t('financeCopy.newView', "New View")}</Button>
        </div>
      }
    >
      {isError ? (
        <ListState
          variant="error"
          title={t('financeCopy.couldNotLoadViews', "Could not load views.")}
          sub={t('financeCopy.aNetworkOrServerErrorOccurred', "A network or server error occurred.")}
          onRetry={refetch}
        />
      ) : isPending ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          state="loading"
        />
      ) : rows.length === 0 ? (
        <ListState
          variant="empty"
          title={t('financeCopy.noViewsYet', "No views yet.")}
          sub={
            <Link to="/views/new" className="font-medium text-primary-text hover:underline">
              {t('financeCopy.createYourFirstView', "Create your first view")}</Link>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          rowMenu={rowMenu}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        tone="destructive"
        title={t('financeCopy.archiveThisView', "Archive this view?")}
        description={t('financeCopy.archiveViewDescription', '"{{name}}" will be archived and removed from your list.', { name: archiveTarget?.name ?? '' })}
        confirmLabel={t('financeCopy.archive', "Archive")}
        cancelLabel={t('financeCopy.keep', "Keep")}
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
        loading={archive.isPending}
      />

      {/* AI Composer modal — navigates to builder with composed spec on success (FR-AS-014) */}
      {showAIComposer && (
        <AIComposerModal
          open={aiComposerOpen}
          onClose={() => setAIComposerOpen(false)}
          onComposed={handleComposed}
        />
      )}
    </ListPage>
  );
};

export default MyViewsPage;
