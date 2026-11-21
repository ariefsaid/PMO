import React from 'react';
import { useTaskLinkedRecords } from '@/src/hooks/useTaskLinkedRecords';
import { LinkedRecordLine } from './LinkedRecordLine';
import type { TaskRow } from '@/src/lib/db/tasks';

type Props = Pick<TaskRow, 'id' | 'procurement_id' | 'expense_claim_id' | 'material_request_id'> & Partial<Pick<TaskRow, 'closed_by_record_type' | 'closed_by_record_status'>>;

/**
 * #2587: the linked record of ONE task (the drawer / detail), with its own single-id read. A list reads its whole page
 * once through `useTaskLinkedRecords` and renders `LinkedRecordLine` rows instead — never this component per row.
 */
export const TaskLinkedRecord: React.FC<{ task: Props }> = ({ task }) => {
  const { data } = useTaskLinkedRecords([task.id]);
  return <LinkedRecordLine task={task} linked={data?.get(task.id)} />;
};
