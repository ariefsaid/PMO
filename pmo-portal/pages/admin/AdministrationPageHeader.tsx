import React from 'react';

/**
 * Temporary adapter for the route job, scope, and primary-action slots until the shared shell
 * frame lands. Keep shell-facing markup here so the area can adopt the common frame in one place.
 */
const AdministrationPageHeader: React.FC<{
  title: React.ReactNode;
  scope: React.ReactNode;
  primary?: React.ReactNode;
  desktopContentAligned?: boolean;
}> = ({ title, scope, primary, desktopContentAligned = false }) => (
  <header className={`mb-5 flex min-w-0 flex-wrap items-end justify-between gap-3 ${desktopContentAligned ? 'md:mb-0' : ''}`}>
    <div className="min-w-0">
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground">{scope}</p>
    </div>
    {primary ? <div className="shrink-0">{primary}</div> : null}
  </header>
);

export default AdministrationPageHeader;
