import React from 'react';
import { EntityNameLink } from './EntityNameLink';

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
 */
export const ContactNameLink: React.FC<ContactNameLinkProps> = ({
  contactId,
  name,
  className,
  'aria-label': ariaLabel,
}) => (
  <EntityNameLink
    to={contactId ? `/contacts/${contactId}` : null}
    name={name}
    className={className}
    aria-label={ariaLabel}
  />
);
