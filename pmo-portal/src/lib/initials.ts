/**
 * #1459 — the one avatar-initials helper. Before this, ten surfaces each carried their own copy and
 * two of them drifted (one read a single word as two letters and a longer name as first + last; the
 * rest read the first two words). Both readings are kept, named, so no tile changes.
 */
export interface InitialsOptions {
  /** Marker shown for a missing or blank name. Defaults to `?`. */
  fallback?: string;
  /**
   * `people` (default): the first letter of the first two words ("Rina Kartika" → "RK").
   * `tile`: an entity chip that reads a single word as two letters ("Finance" → "FI") and a longer
   * name as its first and last letters ("Rina Kartika Dewi" → "RD").
   */
  style?: 'people' | 'tile';
}

export function initials(name: string | null | undefined, options: InitialsOptions = {}): string {
  const { fallback = '?', style = 'people' } = options;
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return (style === 'tile' ? parts[0].slice(0, 2) : parts[0].slice(0, 1)).toUpperCase();
  const second = style === 'tile' ? parts[parts.length - 1][0] : parts[1][0];
  return (parts[0][0] + second).toUpperCase();
}
