import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

export interface CompanyNameLinkProps {
  /** The company's UUID. When null/undefined, renders inert text or em-dash fallback. */
  companyId: string | null | undefined;
  /** The company display name. When null/undefined, renders an em-dash. */
  name: string | null | undefined;
  className?: string;
  /** Optional aria-label override (defaults to "Open <name>"). */
  'aria-label'?: string;
}

/**
 * Single click-to-open affordance for a company name (ADR-0028).
 *
 * When both `companyId` and `name` are present: renders a `<Link>` to
 * `/companies/:id` with `aria-label="Open <name>"` and the standard
 * hover/focus-visible keyboard signature.
 *
 * When `companyId` is null/undefined: renders inert `<span>` with the name
 * (no navigation affordance — company not yet linked).
 *
 * When `name` is null/undefined: renders an em-dash `—` (defensive fallback).
 */
export const CompanyNameLink: React.FC<CompanyNameLinkProps> = ({
  companyId,
  name,
  className,
  'aria-label': ariaLabel,
}) => {
  // No name at all — em-dash fallback
  if (!name) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  // Name present but no company id — inert display
  if (!companyId) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link
      to={`/companies/${companyId}`}
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
