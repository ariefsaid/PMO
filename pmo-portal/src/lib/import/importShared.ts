import type { TFunction } from 'i18next';
import type { ImportField } from './types';

type Cells = Record<string, string>;

export const labelOf = (t: TFunction | undefined) => (key: string, fallback: string) => (t ? String(t(key, fallback)) : fallback);

/** Field with a validator that only checks one cell; its aliases carry the other language's label. */
export function makeField<Input>(
  key: string, label: string, required: boolean, validate: (raw: string) => string | null, extra: Partial<ImportField<Input>> = {},
): ImportField<Input> {
  return { key, label, required, validate, ...extra } as unknown as ImportField<Input>;
}

export const requiredText = (message: string, max: number, tooLong: string) => (raw: string): string | null => {
  const v = raw.trim();
  if (v === '') return message;
  return v.length > max ? tooLong : null;
};

/** Existing-key check shared by every new descriptor: re-importing the same file reports every row as already there. */
export function keyedAlready<Input>(
  load: () => Promise<Iterable<string>>, field: string,
  words: { alreadyThere: string; unavailable: string; nothingNew: string },
): NonNullable<import('./types').ImportDescriptor<Input>['existingKeys']> {
  return {
    load: async () => [...(await load())].map((k) => k.trim().toLowerCase()),
    keyOf: (c: Cells) => (c[field] ?? '').trim().toLowerCase(),
    ...words,
  };
}
