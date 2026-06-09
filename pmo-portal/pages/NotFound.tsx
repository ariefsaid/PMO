import React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/src/components/ui/cn';
import { Icon } from '@/src/components/ui/icons';

/**
 * AC-W3-F7: 404 / unknown-route surface.
 *
 * Mirrors AccessDenied.tsx in style (secondary tile + icon + muted copy + a
 * primary action) — the same honest dead-end pattern. Uses react-router Link
 * for "/" so the user can return to the dashboard without a full page reload.
 * Strictly DESIGN.md tokens — no raw hex or inline px.
 */
const NotFound: React.FC = () => (
  <section
    role="region"
    aria-label="Page not found"
    className={cn(
      'flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-14 text-center',
    )}
  >
    <span className="grid size-[52px] place-items-center rounded-[14px] bg-secondary text-muted-foreground">
      <Icon name="alert" className="size-6" strokeWidth={1.75} />
    </span>
    <div className="text-[15px] font-semibold">Page not found</div>
    <div className="max-w-[44ch] text-[13px] text-muted-foreground">
      The page you're looking for doesn't exist or has been moved.
    </div>
    <Link
      to="/"
      className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Icon name="back" className="size-4" />
      Back to Dashboard
    </Link>
  </section>
);

export default NotFound;
