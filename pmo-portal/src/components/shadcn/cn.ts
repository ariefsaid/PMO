import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * className joiner for the vendored shadcn/ReUI primitives. Unlike the app's own `ui/cn` (clsx only),
 * this merges conflicting Tailwind utilities, which those primitives rely on for `className` overrides.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
