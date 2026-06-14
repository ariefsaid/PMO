import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

export interface ProjectNameLinkProps {
  /** Project id; when null/undefined the name renders as inert text + em-dash fallback. */
  projectId: string | null | undefined;
  /** Display name; falls back to em-dash when empty. */
  name: string | null | undefined;
  className?: string;
  /** Override the default accessible label ("Open <name>"). */
  'aria-label'?: string;
}

/**
 * The ONE click-to-open affordance for a linked project name (census violation E).
 * Reuses the BvACard hover/focus signature so every procurement,
 * timesheet, and approval surface reads identically. Inert text + em-dash when no id.
 *
 * AC-JR-W1-01
 */
export const ProjectNameLink: React.FC<ProjectNameLinkProps> = ({
  projectId,
  name,
  className,
  'aria-label': ariaLabel,
}) => {
  const label = name?.trim() || '—';
  if (!projectId || !name?.trim()) {
    return <span className={cn('text-muted-foreground', className)}>{label}</span>;
  }
  return (
    <Link
      to={`/projects/${projectId}`}
      aria-label={ariaLabel ?? `Open ${label}`}
      className={cn(
        'hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      {label}
    </Link>
  );
};
