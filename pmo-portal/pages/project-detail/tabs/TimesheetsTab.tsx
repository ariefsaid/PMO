import React from 'react';
import { ListState } from '@/src/components/ui';

/**
 * DEFERRED placeholder (Director OQ-1). A real project-scoped timesheet read
 * ("all hours logged against this project across engineers") is a NEW
 * RLS/authorization surface — the existing `listTimesheets(userId)` is
 * user-scoped and cannot answer it, and client-side filtering the cache would
 * leak only the current user's hours. Until the RLS-gated query + pgTAP
 * read-contract land, this tab is an on-brand "coming soon" placeholder (NOT
 * mockData, NOT a wrong cross-user query). A follow-up will build the real read.
 */
const TimesheetsTab: React.FC = () => (
  <div className="rounded-lg border border-border bg-card">
    <ListState
      variant="empty"
      icon="clock"
      title="Project time tracking is coming soon"
      sub="Hours logged against this project across the team will appear here, role-gated."
    />
  </div>
);

export default TimesheetsTab;
