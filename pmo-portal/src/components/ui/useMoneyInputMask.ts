import React from 'react';
import { formatMoneyInputDraft, numberSymbols, parseMoneyInput } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

/**
 * The shared locale-aware money-entry mask (#684, FR-PLC-010). Groups a valid or partially typed
 * draft in the viewer's number convention as the user types, and keeps the caret beside the digit
 * the user just entered. The draft stays a STRING — callers parse it once, at the validation and
 * persistence boundary, with the same locale-aware parser.
 *
 * `NumberField localeAware` uses it; bespoke inputs (table cells, inline capture rows) spread
 * `ref` + `onChange` onto their own `<input>` so every money entry shares one behavior.
 */
export function useMoneyInputMask(
  value: string,
  onChange: (next: string) => void,
  enabled = true,
): {
  ref: React.RefObject<HTMLInputElement | null>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
} {
  const ref = React.useRef<HTMLInputElement>(null);
  const pendingCaret = React.useRef<{ value: string; start: number; end: number } | null>(null);

  React.useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    if (value === pending.value) ref.current?.setSelectionRange(pending.start, pending.end);
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (!enabled) {
      onChange(input.value);
      return;
    }

    const raw = input.value;
    const locale = getNumberLocale();
    const nativeInput = event.nativeEvent as InputEvent;
    const group = numberSymbols(locale).group;
    const isTypedDigit = nativeInput.inputType === 'insertText' && /^\d$/.test(nativeInput.data ?? '');
    const isDeletion = nativeInput.inputType?.startsWith('delete') ?? false;
    let draft = raw;

    // Group separators are inserted by this mask. A digit typed or deleted next to one can
    // temporarily make its group width invalid (`4,8200`, or `1,23` after a backspace); normalize
    // that edit before strict validation can see it. Pasted or otherwise malformed grouping
    // remains untouched.
    if ((isTypedDigit || isDeletion) && group && raw.includes(group) && parseMoneyInput(value, locale) !== null) {
      const ungrouped = raw.split(group).join('');
      if (parseMoneyInput(ungrouped, locale) !== null) draft = ungrouped;
    }

    const next = formatMoneyInputDraft(draft, locale);
    if (next === raw) {
      // No mask adjustment is needed. Preserve the browser's native caret so partial drafts such
      // as `1e` remain editable without the next character being inserted before the `e`.
      pendingCaret.current = null;
      onChange(next);
      return;
    }

    const start = input.selectionStart ?? raw.length;
    const end = input.selectionEnd ?? start;
    pendingCaret.current = {
      value: next,
      start: mapMoneyCaret(raw, next, start, locale),
      end: mapMoneyCaret(raw, next, end, locale),
    };
    onChange(next);
  };

  return { ref, onChange: handleChange };
}

function mapMoneyCaret(raw: string, formatted: string, position: number, locale: string): number {
  const { decimal, group } = numberSymbols(locale);
  const prefix = raw.slice(0, position);
  const digitsBefore = prefix.match(/\d/g)?.length ?? 0;
  const decimalBefore = prefix.includes(decimal);
  let index = 0;
  let digitsSeen = 0;

  while (index < formatted.length && digitsSeen < digitsBefore) {
    if (/\d/.test(formatted[index])) digitsSeen++;
    index++;
  }
  if (decimalBefore) {
    const decimalIndex = formatted.indexOf(decimal);
    if (decimalIndex >= 0) index = Math.max(index, decimalIndex + decimal.length);
  } else if (group) {
    while (formatted.startsWith(group, index)) index += group.length;
  }
  return index;
}
