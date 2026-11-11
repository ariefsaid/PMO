import React, { useId } from 'react';
import { Link } from 'react-router';
import { cn } from './cn';

export interface ProjectNameLinkProps {
  /** The project's UUID. When null/undefined, renders inert text or em-dash fallback. */
  projectId: string | null | undefined;
  /** The project display name. When null/undefined, renders an em-dash. */
  name: string | null | undefined;
  /** Contractual title behind a short `name`: hover title + accessible description (#1325). */
  legalName?: string | null;
  className?: string;
}

/**
 * Single click-to-open affordance for a project name (ADR-0028).
 *
 * When both `projectId` and `name` are present: renders a `<Link>` to
 * `/projects/:id` with `aria-label="Open <name>"` and the BvACard
 * hover/focus-visible keyboard signature.
 *
 * When `projectId` is null/undefined: renders inert `<span>` with the name
 * (no navigation affordance — project not yet linked).
 *
 * When `name` is null/undefined: renders an em-dash `—` (defensive fallback).
 */
export const ProjectNameLink: React.FC<ProjectNameLinkProps> = ({
  projectId,
  name,
  legalName,
  className,
}) => {
  const legalId = useId();
  const legal = legalName && legalName !== name ? legalName : undefined;
  // No name at all — em-dash fallback
  if (!name) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  // Name present but no project id — inert display
  if (!projectId) {
    return <span className={className} title={legal}>{name}</span>;
  }

  return (
    <Link
      to={`/projects/${projectId}`}
      aria-label={`Open ${name}`}
      aria-describedby={legal ? legalId : undefined}
      title={legal}
      className={cn(
        'truncate font-medium text-foreground underline-offset-2',
        'hover:text-primary-text hover:underline',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      {name}
      {legal && <span id={legalId} className="sr-only">{legal}</span>}
    </Link>
  );
};
