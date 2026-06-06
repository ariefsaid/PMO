import { clsx, type ClassValue } from 'clsx';

/**
 * Conditional className joiner. We deliberately do NOT pull in tailwind-merge:
 * the primitive variants here are authored to be non-conflicting (one source of
 * truth per property), so clsx's conditional join is sufficient and lighter.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
