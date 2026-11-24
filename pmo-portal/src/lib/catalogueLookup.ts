import type { TFunction } from 'i18next';

const NONE = '\u0000';

/**
 * The catalogue sentence under `key`, or '' when there is none. The app's missing-key handler answers an empty default
 * with the key's own name (`returnEmptyString: false`), so `defaultValue: ''` cannot signal "absent": the key itself
 * would show on screen. A sentinel default comes back untouched only when the entry is absent.
 */
export function catalogueSentence(t: TFunction, key: string, vars: Record<string, unknown> = {}): string {
  const s: unknown = t(key, { ...vars, defaultValue: NONE });
  return typeof s === 'string' && s !== NONE ? s : '';
}
