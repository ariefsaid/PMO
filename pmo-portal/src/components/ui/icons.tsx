import React from 'react';
import { ICON_PATHS, type IconName } from './iconPaths';

export type { IconName } from './iconPaths';

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  /** Decorative by default (aria-hidden). Pass a `title`/`aria-label` to expose it. */
  className?: string;
}

/**
 * One icon family, one stroke width (2). Renders an icon from the shared
 * `ICON_PATHS` registry; color comes from the consuming token utility
 * (`currentColor`).
 */
export const Icon: React.FC<IconProps> = ({ name, className, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={rest['aria-label'] ? undefined : true}
    width="1em"
    height="1em"
    className={className}
    {...rest}
  >
    {ICON_PATHS[name]}
  </svg>
);
