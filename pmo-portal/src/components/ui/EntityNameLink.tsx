import React from 'react';
import { Link } from 'react-router';
import { cn } from './cn';

export interface EntityNameLinkProps {
  /** Target path (e.g. `/companies/123`). When null/undefined, renders inert text. */
  to: string | null | undefined;
  /** Display name. When null/undefined, renders an em-dash. */
  name: string | null | undefined;
  className?: string;
  /** Optional aria-label override (defaults to "Open <name>"). */
  'aria-label'?: string;
}

/**
 * Shared name link affordance for entity views (ADR-0028).
 * When `name` is missing, renders an em-dash.
 * When `to` is missing, renders inert text.
 * When both are present, renders an accessible `<Link>`.
 */
export const EntityNameLink: React.FC<EntityNameLinkProps> = ({
  to,
  name,
  className,
  'aria-label': ariaLabel,
}) => {
  if (!name) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  if (!to) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link
      to={to}
      aria-label={ariaLabel ?? `Open ${name}`}
      className={cn(
        'truncate font-medium text-foreground underline-offset-2',
        'hover:text-primary-text hover:underline',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
        className,
      )}
    >
      {name}
    </Link>
  );
};
