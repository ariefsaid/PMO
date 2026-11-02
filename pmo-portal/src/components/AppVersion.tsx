import React from 'react';
import { APP_VERSION, BUILD_TIME, GIT_SHA } from '@/src/lib/version';

/**
 * A muted, always-rendered "what's live" label: `v<version> · <sha>`. Unlike
 * {@link EnvBadge} it renders on EVERY environment — including production —
 * so anyone can see exactly which build is deployed (ADR-0042 §4). The build
 * time surfaces on hover.
 *
 * The SHA is PLAIN TEXT, not a link: the client-facing app must not expose the
 * source-repo URL (a commit deep-link would reveal where the code lives).
 *
 * Token-only (DESIGN.md muted-foreground) at EnvBadge's 11px scale.
 */
export const AppVersion: React.FC = () => {
  return (
    <div
      data-testid="app-version"
      title={BUILD_TIME}
      className="pointer-events-none select-none text-[11px] text-muted-foreground"
    >
      <span>v{APP_VERSION}</span>
      <span aria-hidden> · </span>
      <span className="font-medium">{GIT_SHA}</span>
    </div>
  );
};

export default AppVersion;
