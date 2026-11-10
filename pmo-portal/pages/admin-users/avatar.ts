import { initials } from '@/src/lib/initials';

/** Deterministic two-letter initials for the avatar tile (#1459: the one shared helper). */
export function initialsOf(name: string): string {
  return initials(name, { style: 'tile' });
}
