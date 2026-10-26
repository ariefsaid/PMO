import React from 'react';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';

/** Secondary collection scope collapses on phones; applied scope stays visible. */
export function ProjectFilters({ summary, children }: { summary: React.ReactNode; children: React.ReactNode }) {
  const desktop = useIsDesktop();
  return desktop ? <div className="flex flex-wrap items-center gap-2">{children}</div> : (
    <details className="min-w-0 flex-1">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold">{summary}<span aria-hidden>⌄</span></summary>
      <div className="flex flex-wrap items-center gap-2 py-2">{children}</div>
    </details>
  );
}
