import React from 'react';
import { EntityNameLink } from './EntityNameLink';

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
 */
export const CompanyNameLink: React.FC<CompanyNameLinkProps> = ({
  companyId,
  name,
  className,
  'aria-label': ariaLabel,
}) => (
  <EntityNameLink
    to={companyId ? `/companies/${companyId}` : null}
    name={name}
    className={className}
    aria-label={ariaLabel}
  />
);
