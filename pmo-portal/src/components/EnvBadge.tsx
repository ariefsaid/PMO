import React from 'react';

/**
 * A fixed-corner ribbon that names the backend a build is wired to, so you can
 * SEE at a glance whether a deploy is talking to local / test / prod. Driven by
 * the build-time `VITE_APP_ENV` var (set per host environment).
 *
 * Renders NOTHING for production builds (env unset, '', 'prod', or 'production')
 * — the badge exists only to flag a NON-prod surface, so prod stays clean.
 * `pointer-events-none` so it never intercepts a click; tokens only (DESIGN.md
 * Warning Amber — a deliberate "you are not on prod" signal).
 */
export const EnvBadge: React.FC = () => {
  const env = (import.meta.env.VITE_APP_ENV ?? '').trim().toLowerCase();
  if (env === '' || env === 'prod' || env === 'production') return null;

  return (
    <div
      data-testid="env-badge"
      role="status"
      aria-label={`Environment: ${env}`}
      className="pointer-events-none fixed bottom-3 right-3 z-[900] select-none rounded-md bg-warning/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-warning-foreground"
    >
      {env}
    </div>
  );
};
