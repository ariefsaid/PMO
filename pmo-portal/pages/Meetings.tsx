import React, { useDeferredValue, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ListPage,
  SearchMini,
  ListState,
  DataTable,
  ConfirmDialog,
  EntityFormModal,
  TextField,
  SelectField,
  FormSection,
  FormGrid,
  useEntityForm,
  useToast,
  Button,
  Icon,
  type SubmitError,
  type Column,
  type RowMenuItem,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useMeetings, useMeetingMutations } from '@/src/hooks/useMeetings';
import { useProjects } from '@/src/hooks/useProjects';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { trackFilterApplied } from '@/src/lib/analytics';
import { formatDateTime } from '@/src/lib/format';
import { toDatetimeLocalValue } from '@/src/lib/datetimeLocal';
import type { MeetingWithRefs, MeetingInput } from '@/src/lib/db/meetings';

/**
 * Meetings — the reverse-chronological list (#526, FR-MTG-028..030).
 *
 * Reads are RLS-scoped (attendance ∪ author ∪ grant ∪ Admin — FR-MTG-031): this list shows only
 * the meetings the caller may read, so an empty list is a normal state for a member who attends
 * few meetings, not an error. EVERY role may create a meeting (OD-MTG-1, Engineer included).
 * Search runs server-side over the `notes_search` projection (DD-MTG-5 — notes are the primary
 * find mechanism, so a client-side title filter would fail the ticket).
 */

interface FormValues {
  title: string;
  occurredAt: string; // datetime-local input value
  location: string;
  projectId: string; // '' = no project
}

const makeValidate =
  (t: TFunction) =>
  (v: FormValues): Partial<Record<keyof FormValues, string>> => {
    const errors: Partial<Record<keyof FormValues, string>> = {};
    if (!v.title.trim())
      errors.title = t('meetings.form.errors.titleRequired', 'Meeting title is required.');
    return errors;
  };

const Meetings: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole } = useEffectiveRole();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('All');
  // Defer the search term so keystrokes don't thrash the server query.
  const deferredSearch = useDeferredValue(search);

  const { data, isPending, isError, refetch } = useMeetings({
    projectId: projectFilter === 'All' ? undefined : projectFilter,
    search: deferredSearch.trim() || undefined,
  });
  const { data: projects } = useProjects();
  const { create, archive, remove } = useMeetingMutations();

  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<MeetingWithRefs | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingWithRefs | null>(null);

  const canCreate = may('create', 'meeting');

  const rows = useMemo(() => data ?? [], [data]);

  const projectOptions = useMemo(
    () => [
      { value: 'All', label: t('meetings.filters.allProjects', 'All projects') },
      ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
    ],
    [projects, t],
  );

  // Filter/search state changes keep the previous rows on screen (placeholderData in the hook),
  // so 'loading' is only the true first load.
  const state: 'loading' | 'empty' | 'error' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : rows.length === 0 && !search.trim() && projectFilter === 'All'
        ? 'empty'
        : undefined;

  const columns: Column<MeetingWithRefs>[] = [
    {
      key: 'title',
      header: t('meetings.columns.title', 'Meeting'),
      cell: (m) => (
        <span className="truncate font-semibold" title={m.title}>
          {m.title}
        </span>
      ),
      exportValue: (m) => m.title,
    },
    {
      key: 'occurred_at',
      header: t('meetings.columns.when', 'When'),
      cell: (m) => <span className="whitespace-nowrap">{formatDateTime(new Date(m.occurred_at))}</span>,
      exportValue: (m) => m.occurred_at,
    },
    {
      key: 'project',
      header: t('meetings.columns.project', 'Project'),
      cell: (m) => <span className="truncate">{m.project?.name ?? '—'}</span>,
      exportValue: (m) => m.project?.name ?? '',
    },
    {
      key: 'location',
      header: t('meetings.columns.location', 'Location'),
      cell: (m) => <span className="truncate">{m.location ?? '—'}</span>,
      exportValue: (m) => m.location ?? '',
    },
  ];

  const rowMenu = (m: MeetingWithRefs): RowMenuItem[] => {
    const items: RowMenuItem[] = [];
    // M13: Open is NAVIGATION, not a write — every viewer who can see the row may open it
    // (RLS already scoped the row set to what they can read). Never gate it on edit rights.
    items.push({
      label: t('meetings.actions.open', 'Open'),
      onClick: () => navigate(`/meetings/${m.id}`),
    });
    if (may('archive', 'meeting'))
      items.push({
        label: t('meetings.actions.archive', 'Archive'),
        onClick: () => setArchiveTarget(m),
      });
    if (may('delete', 'meeting'))
      items.push({
        label: t('meetings.actions.delete', 'Delete'),
        onClick: () => setDeleteTarget(m),
        danger: true,
      });
    return items;
  };

  const onArchiveConfirm = async () => {
    if (!archiveTarget) return;
    const target = archiveTarget;
    try {
      await archive.mutateAsync(target.id);
      toast(t('meetings.toast.archived', 'Meeting archived'), target.title, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync(target.id);
      toast(t('meetings.toast.deleted', 'Meeting deleted'), target.title, 'success');
      setDeleteTarget(null);
    } catch (err) {
      // 23503 (FR-MTG-016): tasks minuted out of this meeting FK-block the hard delete —
      // classifyMutationError surfaces it as "in use"; archiving is the recovery path.
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setDeleteTarget(null);
    }
  };

  return (
    <ListPage
      title={t('meetings.title', 'Meetings')}
      description={t(
        'meetings.description',
        'Minuted meetings with attendees and action items. You see the meetings you attended, wrote, or were invited to read.',
      )}
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" />
            {t('meetings.actions.new', 'New meeting')}
          </Button>
        )
      }
      filters={
        state !== 'loading' && (
          <SelectField
            label={t('meetings.filters.projectLabel', 'Filter by project')}
            hideLabel
            value={projectFilter}
            onChange={(v) => {
              setProjectFilter(v);
              trackFilterApplied('project', projectOptions.length, 'meetings');
            }}
            options={projectOptions}
          />
        )
      }
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('meetings.search.placeholder', 'Search notes and titles…')}
            aria-label={t('meetings.search.ariaLabel', 'Search meetings')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            searchSurface="meetings-list"
            module="meetings"
            resultCount={rows.length}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0 sm:ml-auto"
          />
        )
      }
    >
      {state === 'loading' && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={6} />
        </div>
      )}

      {state === 'error' && (
        <ListState
          variant="error"
          title={t('meetings.states.errorTitle', "Couldn't load meetings")}
          sub={t('meetings.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => refetch()}
        />
      )}

      {state === 'empty' && (
        <ListState
          variant="empty"
          icon="cal"
          title={t('meetings.states.emptyTitle', 'No meetings yet')}
          sub={t(
            'meetings.states.emptySub',
            'Minute your first meeting to capture notes, attendees and action items in one place.',
          )}
          stateId="meetings-empty"
          role={realRole ?? undefined}
          module="meetings"
          action={
            canCreate
              ? {
                  label: t('meetings.actions.new', 'New meeting'),
                  onClick: () => setCreateOpen(true),
                }
              : undefined
          }
        />
      )}

      {state === undefined && (
        <DataTable<MeetingWithRefs>
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          onActivate={(m) => navigate(`/meetings/${m.id}`)}
          // M12: interpolated key — safe now that test/setup.ts initialises i18next, so the
          // options bag interpolates in unit tests exactly as it does at runtime.
          rowLabel={(m) => t('meetings.table.rowLabel', 'Open {{title}}', { title: m.title })}
          rowMenu={rowMenu}
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('meetings.table.emptyTitle', 'No meetings match')}
          emptySub={t('meetings.table.emptySub', 'Try a different project or clear the search.')}
        />
      )}

      {createOpen && (
        <MeetingFormModal
          projectOptions={projectOptions.filter((o) => o.value !== 'All')}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const row = await create.mutateAsync(input);
            toast(t('meetings.toast.created', 'Meeting created'), input.title, 'success');
            setCreateOpen(false);
            navigate(`/meetings/${row.id}`);
          }}
          onError={(err) => {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        title={
          archiveTarget
            ? t('meetings.confirm.archiveTitleNamed', 'Archive {{title}}?', {
                title: archiveTarget.title,
              })
            : t('meetings.confirm.archiveTitle', 'Archive meeting?')
        }
        description={t(
          'meetings.confirm.archiveDescription',
          "It will be hidden from the default list. Its minutes, attendees and action items stay intact. You can restore it any time.",
        )}
        confirmLabel={t('meetings.confirm.archiveConfirm', 'Archive meeting')}
        loading={archive.isPending}
        onConfirm={onArchiveConfirm}
        onCancel={() => setArchiveTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        tone="destructive"
        title={
          deleteTarget
            ? t('meetings.confirm.deleteTitleNamed', 'Delete {{title}}?', {
                title: deleteTarget.title,
              })
            : t('meetings.confirm.deleteTitle', 'Delete meeting?')
        }
        description={t(
          'meetings.confirm.deleteDescription',
          'This permanently removes the meeting and its minutes. A meeting whose action items still exist as tasks cannot be deleted; archive it instead.',
        )}
        confirmLabel={t('meetings.confirm.deleteConfirm', 'Delete meeting')}
        loading={remove.isPending}
        onConfirm={onDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </ListPage>
  );
};

// ── Create form modal ───────────────────────────────────────────────────────

interface MeetingFormModalProps {
  projectOptions: { value: string; label: string }[];
  onClose: () => void;
  onCreate: (input: MeetingInput) => Promise<void>;
  onError: (err: unknown) => void;
}

const MeetingFormModal: React.FC<MeetingFormModalProps> = ({
  projectOptions,
  onClose,
  onCreate,
  onError,
}) => {
  const { t } = useTranslation();
  const validate = useMemo(() => makeValidate(t), [t]);
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: '',
      occurredAt: toDatetimeLocalValue(new Date()),
      location: '',
      projectId: '',
    },
    validate,
    idPrefix: 'meeting-form',
    requiredFields: ['title'],
    module: 'meetings',
  });

  const titleField = form.fieldProps('title');
  const occurredField = form.fieldProps('occurredAt');
  const locationField = form.fieldProps('location');
  const projectField = form.fieldProps('projectId');

  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const errorSummary = form.errors.title
    ? [{ fieldId: titleField.id, message: form.errors.title }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: MeetingInput = {
        title: values.title.trim(),
        occurred_at: values.occurredAt ? new Date(values.occurredAt).toISOString() : undefined,
        location: values.location.trim() || null,
        project_id: values.projectId || null,
      };
      try {
        await onCreate(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err, undefined, {
          module: 'meetings',
          operation: 'create',
          suppressCapture: true,
        });
        setSaveError({ headline, detail });
        onError(err);
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={t('meetings.form.newTitle', 'New meeting')}
      subtitle={t('meetings.form.newSubtitle', 'Record when it happened and start the minutes')}
      submitLabel={t('meetings.form.newSubmit', 'Create meeting')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      <FormSection legend={t('meetings.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField
            id={titleField.id}
            label={t('meetings.form.title.label', 'Title')}
            required
            value={titleField.value}
            onChange={titleField.onChange}
            onBlur={titleField.onBlur}
            error={titleField.error}
            placeholder={t('meetings.form.title.placeholder', 'e.g. Weekly site coordination')}
            fullWidth
          />
          <TextField
            id={occurredField.id}
            label={t('meetings.form.when.label', 'When')}
            type="datetime-local"
            value={occurredField.value}
            onChange={occurredField.onChange}
            onBlur={occurredField.onBlur}
          />
          <TextField
            id={locationField.id}
            label={t('meetings.form.location.label', 'Location')}
            value={locationField.value}
            onChange={locationField.onChange}
            onBlur={locationField.onBlur}
            placeholder={t('meetings.form.location.placeholder', 'e.g. Site office, Teams call')}
          />
          <SelectField
            id={projectField.id}
            label={t('meetings.form.project.label', 'Project')}
            value={projectField.value}
            onChange={(v) => projectField.onChange(v)}
            onBlur={projectField.onBlur}
            options={[
              { value: '', label: t('meetings.form.project.none', 'No project') },
              ...projectOptions,
            ]}
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default Meetings;
