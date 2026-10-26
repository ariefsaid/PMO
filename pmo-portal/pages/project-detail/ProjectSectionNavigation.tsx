import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Drawer, cn } from '@/src/components/ui';
import { projectLabel } from './typography';

export interface ProjectSectionItem<T extends string = string> {
  value: T;
  label: string;
}

export interface ProjectSectionGroup<T extends string = string> {
  label: string;
  items: ProjectSectionItem<T>[];
}

interface ProjectSectionNavigationProps<T extends string> {
  projectId: string;
  recordName?: string;
  groups: ProjectSectionGroup<T>[];
  activeSection: T;
  search: string;
  hash: string;
  navigationState: unknown;
  onNavigate: (section: T) => void;
}

function SectionLinks<T extends string>({
  projectId,
  groups,
  activeSection,
  search,
  hash,
  navigationState,
  onNavigate,
  onSelect,
}: ProjectSectionNavigationProps<T> & { onSelect?: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="min-w-0">
          <h2 className={`mb-1 px-2 ${projectLabel} text-muted-foreground`}>{group.label}</h2>
          <ul className="space-y-1">
            {group.items.map((item) => {
              const active = activeSection === item.value;
              return (
                <li key={item.value} className="min-w-0">
                  <Link
                    to={{
                      pathname: `/projects/${projectId}/${item.value}`,
                      search,
                      hash,
                    }}
                    state={navigationState}
                    replace
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      onNavigate(item.value);
                      onSelect?.();
                    }}
                    className={cn(
                      'touch-target flex min-h-11 min-w-0 items-center rounded-md px-2 text-sm font-medium text-foreground',
                      'break-words hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      active && 'bg-primary/10 font-semibold text-nav-active-text',
                    )}
                  >
                    {item.label || t('projectDetail.tabs.overview', 'Overview')}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ProjectSectionNavigation<T extends string>({
  projectId,
  recordName,
  groups,
  activeSection,
  search,
  hash,
  navigationState,
  onNavigate,
}: ProjectSectionNavigationProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);
  useEffect(() => {
    const header = document.querySelector('[data-testid="record-header"]');
    if (!header || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setShowIdentity(!entry.isIntersecting));
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const activeLabel = groups.flatMap((group) => group.items).find((item) => item.value === activeSection)?.label ?? '';
  const navigationLabel = t('project:projectDetail.sectionNav.open', 'Project sections');

  return (
    <>
      <aside aria-label={navigationLabel} className="hidden min-w-0 min-[921px]:block">
        <nav aria-label={navigationLabel} className="sticky top-4">
          {showIdentity && <p className="mb-3 break-words text-sm font-semibold">{recordName}</p>}
          <SectionLinks
            projectId={projectId}
            groups={groups}
            activeSection={activeSection}
            search={search}
            hash={hash}
            navigationState={navigationState}
            onNavigate={onNavigate}
          />
        </nav>
      </aside>

      <div className="sticky top-0 z-20 min-w-0 self-start bg-background py-2 min-[921px]:hidden">
        {showIdentity && <p className="mb-2 break-words text-sm font-semibold">{recordName}</p>}
        <button
          type="button"
          aria-label={navigationLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="touch-target flex min-h-11 w-full items-center justify-between rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span>{activeLabel} · {navigationLabel}</span>
          <span aria-hidden="true">⌄</span>
        </button>
        <Drawer open={open} title={navigationLabel} subtitle={activeLabel} onClose={() => setOpen(false)} width="sm">
          <nav aria-label={navigationLabel}>
            <SectionLinks
              projectId={projectId}
              groups={groups}
              activeSection={activeSection}
              search={search}
              hash={hash}
              navigationState={navigationState}
              onNavigate={onNavigate}
              onSelect={() => setOpen(false)}
            />
          </nav>
        </Drawer>
      </div>
    </>
  );
}

export default ProjectSectionNavigation;
