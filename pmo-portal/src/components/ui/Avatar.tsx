import React from 'react';
import { Avatar as AvatarPrimitive } from '@base-ui/react/avatar';
import { initials as toInitials } from '@/src/lib/initials';
import { cn } from './cn';

// The ONE avatar (#2059): photo when `src` loads, else neutral initials. Image-load fallback
// behaviour comes from Base UI; the look is DESIGN.md tokens only (no per-person hue).
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

// A minimum square that GROWS with wide initials ("HW" at 14px is wider than a 24px circle), so the
// chip always contains them instead of clipping; a loaded photo is laid over it and keeps the square.
const sizeClasses: Record<AvatarSize, string> = {
  xs: 'h-5 min-w-5',
  sm: 'h-6 min-w-6',
  md: 'h-[30px] min-w-[30px]',
  lg: 'h-9 min-w-9',
};

export interface AvatarProps {
  name: string | null | undefined;
  src?: string | null;
  size?: AvatarSize;
  /** Explicit initials (e.g. an entity tile); defaults to the name's initials. */
  initials?: string;
  /** Hide from assistive tech when the name is printed next to the avatar. */
  decorative?: boolean;
  /** Marker for a blank name. */
  fallback?: string;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'sm', initials, decorative = false, fallback, className }) => (
  <AvatarPrimitive.Root
    {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name || undefined, title: name || undefined })}
    className={cn(
      'relative inline-grid shrink-0 select-none place-items-center overflow-hidden whitespace-nowrap rounded-full px-1 bg-secondary text-control font-semibold text-secondary-foreground',
      sizeClasses[size],
      className
    )}
  >
    {src ? <AvatarPrimitive.Image src={src} alt="" className="absolute inset-0 size-full object-cover" /> : null}
    <AvatarPrimitive.Fallback>{initials ?? toInitials(name, { fallback })}</AvatarPrimitive.Fallback>
  </AvatarPrimitive.Root>
);
