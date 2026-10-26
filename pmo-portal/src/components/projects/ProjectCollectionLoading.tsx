import React from 'react';
import { cn } from '@/src/components/ui/cn';

export type ProjectCollectionView = 'cards' | 'kanban' | 'calendar';

interface ProjectCollectionLoadingProps {
  view: ProjectCollectionView;
  label: string;
}

const Skeleton = ({ className }: { className: string }) => (
  <span aria-hidden="true" className={cn('block animate-pulse rounded bg-muted', className)} />
);

function CardsLoading() {
  return <div aria-hidden="true" className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
    {Array.from({ length: 3 }, (_, index) => <div key={index} className="min-w-0 space-y-3 rounded-lg border border-border bg-card p-4">
      <Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2" />
      <div className="flex gap-2"><Skeleton className="h-5 w-20" /><Skeleton className="h-3 w-28 self-center" /></div>
      <div className="border-t border-border pt-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="mt-2 h-4 w-1/2" /></div>
    </div>)}
  </div>;
}

function KanbanLoading() {
  return <div aria-hidden="true" className="min-w-0 overflow-x-auto">
    <div className="grid min-w-[900px] grid-cols-5 gap-3">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="min-w-0 space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
        <div className="flex items-center justify-between"><Skeleton className="h-3 w-20" /><Skeleton className="size-5 rounded-full" /></div>
        <div className="space-y-2 rounded-lg border border-border bg-card p-3"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /><Skeleton className="h-3 w-2/3" /></div>
      </div>)}
    </div>
  </div>;
}

function CalendarLoading() {
  return <div aria-hidden="true" className="min-w-0">
    <div className="mb-3 flex h-11 items-center gap-2"><Skeleton className="size-11" /><Skeleton className="size-11" /><Skeleton className="h-8 w-16" /><Skeleton className="ml-2 h-4 w-32" /></div>
    <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid">
      {Array.from({ length: 42 }, (_, index) => <div key={index} className="min-h-24 space-y-2 bg-card p-2"><Skeleton className="h-3 w-6" />{index % 3 === 0 && <Skeleton className="h-8 w-full" />}</div>)}
    </div>
    <div className="space-y-3 md:hidden">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="flex min-h-16 items-start gap-3 border-b border-border py-3"><Skeleton className="h-3 w-12 shrink-0" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-8 w-full" /></div></div>)}
    </div>
  </div>;
}

/** Loading composition that follows the selected collection while its data is being read. */
export function ProjectCollectionLoading({ view, label }: ProjectCollectionLoadingProps) {
  return <section role="status" aria-label={label} aria-busy="true" data-testid="projects-loading"
    data-loading-view={view} className="min-w-0 rounded-lg border border-border bg-card p-3">
    <span className="sr-only">{label}</span>
    {view === 'cards' ? <CardsLoading /> : view === 'kanban' ? <KanbanLoading /> : <CalendarLoading />}
  </section>;
}
