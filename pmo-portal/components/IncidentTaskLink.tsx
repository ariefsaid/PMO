import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useIncidentLinkedTask } from '@/src/hooks/useIncidentLinkedTask';

export function IncidentTaskLink({ taskId }: { taskId: string }) {
  const { t } = useTranslation('incidents');
  const { data: task } = useIncidentLinkedTask(taskId);
  if (!task?.project_id) {
    return <span data-testid="incident-task-linked">{t('detail.taskLinked', 'A task was created for this issue.')}</span>;
  }
  return (
    <Link className="text-primary underline-offset-2 hover:underline" data-testid="incident-task-linked" to={`/projects/${task.project_id}/tasks?open=${encodeURIComponent(taskId)}`}>
      {t('detail.openTask', 'Open task')}
    </Link>
  );
}
