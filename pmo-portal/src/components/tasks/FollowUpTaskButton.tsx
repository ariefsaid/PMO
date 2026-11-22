/**
 * Create-from-record (#2587, FR-RLT-008, AC-RLT-015): on a purchase, expense claim or material request, one action
 * makes a task that follows the record. When an open task already follows it, the action opens that task instead and
 * never offers a second. The database refuses a second one anyway (migration 1070); this is the explanation.
 */
import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EntityFormModal, TextField, buttonClasses } from '@/src/components/ui';
import { useOptionalToast } from '@/src/components/ui/Toast';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { invalidateTaskProjections } from '@/src/hooks/taskQueryKeys';
import { openTaskPath } from './recordPaths';
import type { RecordLinkType } from '@/src/lib/db/tasks';

const COLUMN: Record<RecordLinkType, 'procurement_id' | 'expense_claim_id' | 'material_request_id'> = {
  procurement: 'procurement_id',
  expense_claim: 'expense_claim_id',
  material_request: 'material_request_id',
};

interface Props {
  type: RecordLinkType;
  recordId: string;
  /** The record's own project (null for a project-less one): the task is created in it. */
  projectId?: string | null;
  /** Suggested task name, e.g. the record's number. */
  defaultName: string;
  /** The record is in an end state: a task cannot be linked to a finished record, so offer nothing new. */
  finished?: boolean;
}

const FollowUpTask: React.FC<Props> = ({ type, recordId, projectId = null, defaultName, finished = false }) => {
  const { t } = useTranslation('tasks');
  const may = usePermission();
  const toast = useOptionalToast()?.toast;
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<{ headline: string; detail?: string } | null>(null);

  const existing = useQuery({
    queryKey: ['task-open-for-record', orgId, type, recordId],
    queryFn: () => repositories.task.findOpenForRecord(type, recordId),
    enabled: Boolean(orgId),
  });

  const create = useMutation({
    mutationFn: () => repositories.task.create({
      project_id: projectId,
      name: name.trim(),
      status: 'To Do',
      assignee_id: currentUser?.id ?? null,
      [COLUMN[type]]: recordId,
    }),
    onSuccess: () => {
      setOpen(false);
      toast?.(t('linkedRecord.followUp.created', 'Follow-up task created.'), undefined, 'success');
      void qc.invalidateQueries({ queryKey: ['task-open-for-record', orgId, type, recordId] });
      invalidateTaskProjections(qc, orgId, projectId);
    },
    onError: (err) => {
      const out = classifyMutationError(err, undefined, { suppressCapture: true });
      setError({ headline: out.headline, detail: out.detail });
      // A concurrent creator won: show their task instead of an error (FR-RLT-008).
      void qc.invalidateQueries({ queryKey: ['task-open-for-record', orgId, type, recordId] });
    },
  });

  if (!may('create', 'task')) return null;
  if (existing.data) {
    return (
      <Link to={openTaskPath(existing.data)} className={buttonClasses('outline', 'sm')}>
        {t('linkedRecord.followUp.open', 'Open follow-up task')}
      </Link>
    );
  }
  if (finished || existing.isPending) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setName(defaultName); setError(null); setOpen(true); }}>
        {t('linkedRecord.followUp.create', 'Create follow-up task')}
      </Button>
      {open && (
        <EntityFormModal
          open
          title={t('linkedRecord.followUp.dialogTitle', 'Follow-up task')}
          submitLabel={t('linkedRecord.followUp.save', 'Create task')}
          cancelLabel={t('linkedRecord.followUp.cancel', 'Cancel')}
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          onClose={() => setOpen(false)}
          loading={create.isPending}
          submitDisabled={!name.trim()}
          submitError={error}
        >
          <TextField
            id="follow-up-task-name"
            label={t('linkedRecord.followUp.nameLabel', 'What needs following up?')}
            required
            value={name}
            onChange={setName}
            placeholder={t('linkedRecord.followUp.namePlaceholder', 'For example: chase the supplier')}
            fullWidth
          />
        </EntityFormModal>
      )}
    </>
  );
};

export const FollowUpTaskButton: React.FC<Props> = FollowUpTask;
