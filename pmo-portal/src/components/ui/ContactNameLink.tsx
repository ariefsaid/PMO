import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from './cn';

export interface ContactNameLinkProps {
  /** The contact's UUID. When null/undefined, renders inert text or em-dash fallback. */
  contactId: string | null | undefined;
  /** The contact display name. When null/undefined, renders an em-dash. */
  name: string | null | undefined;
  className?: string;
  /** Optional aria-label override (defaults to "Open <name>"). */
  'aria-label'?: string;
}

/**
 * Single click-to-open affordance for a contact name (ADR-0028).
 *
 * When both `contactId` and `name` are present: renders a `<Link>` to
 * `/contacts/:id` with `aria-label="Open <name>"` and the standard
 * hover/focus-visible keyboard signature.
 *
 * When `contactId` is null/undefined: renders inert `<span>` with the name
 * (no navigation affordance — contact not yet linked).
 *
 * When `name` is null/undefined: renders an em-dash `—` (defensive fallback).
 */
export const ContactNameLink: React.FC<ContactNameLinkProps> = ({
  contactId,
  name,
  className,
  'aria-label': ariaLabel,
}) => {
  // No name at all — em-dash fallback
  if (!name) {
    return <span className={cn('text-muted-foreground', className)}>—</span>;
  }

  // Name present but no contact id — inert display
  if (!contactId) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link
      to={`/contacts/${contactId}`}
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
