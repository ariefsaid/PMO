import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

/**
 * JOB-F17: the link back to the issue a task was made from, shown on the task wherever the task lists
 * (My Tasks row, the project Tasks tab's `#task-<id>` anchor). Pure display: the caller passes the issue
 * id read by `useTaskSourceIssues` (one read per page); a task with no issue renders nothing at all. The
 * link only navigates — the issue page itself decides what its reader may open.
 */
export const SourceIssueLink: React.FC<{ incidentId: string; className?: string }> = ({ incidentId, className }) => {
  const { t } = useTranslation('tasks');
  return (
    <Link
      to={`/incidents/${incidentId}`}
      className={className ?? 'font-medium text-primary underline-offset-2 hover:underline'}
    >
      {/* #2905: no aria-label — the accessible name must be the visible words ("From issue"), so
          voice control saying the visible words activates the link (WCAG 2.5.3 Label in Name). */}
      {t('sourceIssue.from', 'From issue')}
    </Link>
  );
};
