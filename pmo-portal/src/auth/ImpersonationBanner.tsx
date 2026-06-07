import React from 'react';
import { useEffectiveRole } from './impersonation';
import { Icon } from '@/src/components/ui/icons';

/**
 * Impersonation banner (ADR-0016). Shown ONLY when an Admin is viewing-as another role
 * (`effectiveRole !== realRole`). It explains that write affordances and the server gate
 * on the REAL JWT role, so the Admin is never silently misled into clicking a button the
 * server will reject. Renders nothing for everyone else (the normal case).
 *
 * DESIGN.md tokens only: a `warning`-tinted strip with AA-darkened text (the same vocab
 * as `GateNotice variant="blocked"`), an `admin` (role-context) icon, no new hue.
 */
export const ImpersonationBanner: React.FC = () => {
  const { realRole, effectiveRole } = useEffectiveRole();

  // Only diverges for an Admin who has selected a view-as role.
  if (!realRole || !effectiveRole || effectiveRole === realRole) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="impersonation-banner"
      className="flex items-center gap-2.5 border-b border-warning/40 bg-warning/12 px-5 py-2 text-[12.5px] text-warning-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-[hsl(38_92%_45%)]"
    >
      <Icon name="admin" />
      <span>
        Viewing as <strong>{effectiveRole}</strong> — writes run as your real role,{' '}
        <strong>{realRole}</strong>.
      </span>
    </div>
  );
};
