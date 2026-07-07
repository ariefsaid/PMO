import React from 'react';
import { cn } from '@/src/components/ui/cn';
import { APP_VERSION, BUILD_TIME, GIT_SHA } from '@/src/lib/version';

export interface AppVersionProps {
  /** Positioning/layout overrides for the mount site (e.g. fixed corner). */
  className?: string;
}

/**
 * A muted, always-rendered "what's live" label: `v<version> · <sha>`. Unlike
 * {@link EnvBadge} it renders on EVERY environment — including production —
 * so anyone can see exactly which build is deployed (ADR-0042 §4). The sha is
 * a deep link to its GitHub commit; the build time surfaces on hover.
 *
 * Token-only (DESIGN.md muted-foreground) at EnvBadge's 11px scale.
 */
export const AppVersion: React.FC<AppVersionProps> = ({ className }) => {
  const commitUrl = `https://github.com/ariefsaid/PMO/commit/${GIT_SHA}`;
  return (
    <div
      data-testid="app-version"
      title={BUILD_TIME}
      className={cn(
        'pointer-events-auto select-none text-[11px] text-muted-foreground',
        className,
      )}
    >
      <span>v{APP_VERSION}</span>
      <span aria-hidden> · </span>
      <a
        href={commitUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium hover:underline"
      >
        {GIT_SHA}
      </a>
    </div>
  );
};

export default AppVersion;
