/**
 * My Views list page — /views (I4, FR-VB-010..016).
 * Lists the current user's non-archived views; open / edit / archive affordances.
 * Follows Companies.tsx CRUD/RBAC pattern (ADR-0016/0017/0018).
 */
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ListPage,
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

const MyViewsPage: React.FC = () => {
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const { data, isPending, isError, refetch } = useUserViews();
  const { archive } = useUserViewMutations();

  const [archiveTarget, setArchiveTarget] = useState<UserViewRow | null>(null);

  const canArchive = may('archive', 'userView');

  const columns: Column<UserViewRow>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => (
        <Link to={`/views/${row.id}`} className="font-medium text-foreground hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      cell: (row) => (
        <span className="text-muted-foreground">{row.description ?? '—'}</span>
      ),
    },
    {
      key: 'updated_at',
      header: 'Updated',
      cell: (row) => (
        <span className="text-muted-foreground">{timeAgo(row.updated_at)}</span>
      ),
    },
  ];

  const rowMenu = (row: UserViewRow): RowMenuItem[] => [
    {
      label: 'Edit',
      onClick: () => navigate(`/views/${row.id}/edit`),
    },
    ...(canArchive
      ? [{ label: 'Archive', onClick: () => setArchiveTarget(row) }]
      : []),
  ];

  const handleArchiveConfirm = async () => {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync(archiveTarget.id);
      toast('View archived', archiveTarget.name, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    } finally {
      setArchiveTarget(null);
    }
  };

  const rows = data ?? [];

  return (
    <ListPage
      title="My Views"
      primaryAction={
        <Button variant="primary" onClick={() => navigate('/views/new')}>
          New View
        </Button>
      }
    >
      {isError ? (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/[0.07] px-4 py-3.5 text-[13px] text-destructive"
        >
          Could not load views. A network or server error occurred.
          <Button variant="outline" size="sm" onClick={() => refetch?.()}>
            Retry
          </Button>
        </div>
      ) : isPending ? (
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          state="loading"
        />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <div className="text-[15px] font-semibold">No views yet.</div>
          <Link
            to="/views/new"
            className="font-medium text-primary hover:underline"
          >
            Create your first view
          </Link>
        </div>
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
        title="Archive this view?"
        description={`"${archiveTarget?.name}" will be archived and removed from your list.`}
        confirmLabel="Archive"
        cancelLabel="Keep"
        onConfirm={handleArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
        loading={archive.isPending}
      />
    </ListPage>
  );
};

export default MyViewsPage;
