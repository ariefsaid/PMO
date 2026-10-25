import type { ReactNode } from 'react';
import { Toolbar } from '@/src/components/ui';

interface ProjectPageFrameProps {
  title: string;
  scope: ReactNode;
  toolbar?: ReactNode;
  primaryAction?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Local adapter for the Projects page while the shared shell frame is being delivered. */
export function ProjectPageFrame({ title, scope, toolbar, primaryAction, children, className }: ProjectPageFrameProps) {
  return (
    <section className={className ?? 'min-w-0 space-y-3'} data-testid="projects-page-frame">
      <header data-testid="list-page-header" className="min-w-0">
        <h1 className="break-words text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {scope}
        </div>
      </header>
      {toolbar != null && (
        <Toolbar standalone data-testid="list-page-toolbar" className="gap-2.5">
          {toolbar}
          {primaryAction}
        </Toolbar>
      )}
      {children}
    </section>
  );
}
