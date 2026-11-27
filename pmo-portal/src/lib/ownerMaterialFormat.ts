import { formatNumberExact } from '@/src/lib/format';

/** A server quantity (exact decimal string) as the reader's number; never summed in the browser. */
export const qty = (v: string): string => formatNumberExact(Number(v));
/** A server percentage (0..100 or null) shown to at most two decimals; null is absent, never 0. */
export const pct = (v: string | null): string => (v === null ? '—' : `${formatNumberExact(Number(Number(v).toFixed(2)))}%`);
export const isDenied = (e: unknown): boolean => (e as { code?: string } | null)?.code === '42501';

const squash = (v: string): string => v.replace(/\s+/g, '').toLowerCase();
/** A location by its code and name, once when they are the same text (ignoring case and spaces); the name alone when there is no code. */
export const locationLabel = (code: string | null, name: string): string => (!code || squash(code) === squash(name) ? name || code || '' : `${code} · ${name}`);
/** A category by its name; its code only when the organisation gave it no name. */
export const categoryLabel = (code: string | null, categories: readonly { code: string; name: string }[]): string | null => {
  if (!code) return null;
  return categories.find((c) => c.code === code)?.name.trim() || code;
};
