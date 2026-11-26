import React, { type ReactNode } from 'react';

/**
 * One group of organisation settings that serve the same job (Administration › Accounting / Project setup). A bordered panel
 * with the group's title; the settings inside are stacked, one left edge, separated by one hairline, each at the same inset.
 *
 * The settings keep their own components and data calls; this panel only decides how they read together: a setting's own
 * heading is set one step below the group title (14px semibold), its own top margin is dropped (the panel draws the
 * divider), and the stack is capped at 896px (the widest setting table, the budget account map, needs 760px inside the panel) so a control never flies to the far edge of a wide screen.
 */
export function SettingsGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      data-settings-group
      className="scroll-mt-4 min-w-0 rounded-lg border border-border bg-card focus:outline-none"
    >
      <h2 id={`${id}-title`} className="px-4 pt-4 text-group font-semibold tracking-[-0.01em] sm:px-6 sm:pt-5">
        {title}
      </h2>
      <div
        className={[
          'min-w-0 divide-y divide-border px-4 sm:px-6',
          // every setting: 32px of painted space between settings (14 + hairline + 14 + line leading), 12px under the group title, no margin of its own
          '[&>*]:py-3.5 [&>*]:mt-0 [&>*:first-child]:pt-3',
          // a heading sits 12px above what it heads (screen-rules Layout 2)
          '[&_h2+p]:mt-3 [&_h3+p]:mt-3 [&_h2+div]:mt-3 [&_h3+ul]:mt-3',
          // a setting's own heading (and a list heading inside it) sits one step below the group title
          '[&_h2]:text-control [&_h2]:font-semibold [&_h2]:tracking-normal [&_h3]:text-control [&_h3]:font-semibold [&_h3]:tracking-normal',
        ].join(' ')}
      >
        {children}
      </div>
    </section>
  );
}

/** The stack of groups on one settings page: panels 24px apart (16px on a phone). */
export function SettingsGroups({ children }: { children: ReactNode }) {
  return <div className="min-w-0 max-w-4xl space-y-4 sm:space-y-6">{children}</div>;
}
