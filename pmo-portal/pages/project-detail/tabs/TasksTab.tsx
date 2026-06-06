import React from 'react';
import { ListState } from '@/src/components/ui';

/**
 * DEFERRED module (OQ-2). Task scheduling is schema-ready but has no DAL/UI yet;
 * the legacy Gantt + TaskModal are intentionally NOT ported. The on-brand
 * ListState placeholder teaches what's coming (screen-reader meaningful heading
 * + descriptive text) — never a blank card and never fabricated rows.
 */
const TasksTab: React.FC = () => (
  <div className="rounded-lg border border-border bg-card">
    <ListState
      variant="empty"
      icon="check"
      title="Task scheduling is coming soon"
      sub="Plan, sequence, and track project tasks here. We're building this surface next."
    />
  </div>
);

export default TasksTab;
