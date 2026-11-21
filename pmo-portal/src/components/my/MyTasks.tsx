import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui';
import type { MyHomeTask } from '@/src/lib/repositories/myHome';
import { MySection } from './MySection';

/** My tasks: assigned to the person, any project. A light account may only change the status (database-enforced). */
export const MyTasks: React.FC<{ tasks: MyHomeTask[]; busyId: string | null; onSetStatus: (id: string, status: 'In Progress' | 'Done') => void }> = ({ tasks, busyId, onSetStatus }) => {
  const { t } = useTranslation('myHome');
  const open = tasks.filter((x) => x.status !== 'Done');
  return (
    <MySection id="my-tasks" title={t('myHome:tasks.title', 'My tasks')}>
      {open.length === 0 ? <p className="text-control text-muted-foreground">{t('myHome:tasks.empty', 'No tasks assigned to you')}</p> : (
        <ul className="space-y-2">
          {open.map((task) => (
            <li key={task.id} className="rounded-md border border-border p-3">
              <p className="text-control font-semibold">{task.name}</p>
              <p className="text-control text-muted-foreground">{task.project_name} · {task.status}{task.end_date ? ` · ${task.end_date}` : ''}</p>
              <div className="mt-2 flex gap-2">
                {task.status === 'To Do' && (
                  <Button variant="outline" className="min-h-11" disabled={busyId === task.id} onClick={() => onSetStatus(task.id, 'In Progress')}>
                    {t('myHome:tasks.start', 'Start')}
                  </Button>
                )}
                <Button variant="primary" className="min-h-11" disabled={busyId === task.id} onClick={() => onSetStatus(task.id, 'Done')}>
                  {t('myHome:tasks.done', 'Mark done')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MySection>
  );
};
