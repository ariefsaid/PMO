import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { classifyMutationError, type ClassifyContext } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useTerms } from '@/src/lib/i18n/terms';

/**
 * The database refuses with `raise exception 'FAMILY_CODE: sentence'`. This is the one place the app reads that protocol:
 * the user's sentence lives in the `refusals` namespace under the full code (`refusals:PCI_CREW`), in both languages,
 * and a gate (`scripts/check-refusal-codes.mjs`) fails CI for a code a migration raises that has no sentence.
 */
export interface Refusal { family: string; code: string; text: string; values: Record<string, string> }

const CODE_RE = /(?:^|[^A-Z0-9_])([A-Z][A-Z0-9]{1,5})_([A-Z0-9_]+):\s*(.*)$/s;
const DATE = /\d{4}-\d{2}-\d{2}/;
const day = (s: string): string => { const d = DATE.exec(s)?.[0]; return d ? formatDay(d) : ''; };
const qty = (s: string | undefined): string => (s === undefined ? '' : formatQuantity(s, getNumberLocale()));
const first = (re: RegExp, s: string): string[] => re.exec(s)?.slice(1) ?? [];

/**
 * Figures a migration writes into the sentence and no `details`. Each reads one wording; a code absent here carries none.
 * ponytail: remove an entry when its migration moves the figure into `details` (stock already does).
 */
const FIGURES: Record<string, (text: string) => Record<string, string>> = {
  ATT_DAY_CEILING: (s) => { const [hours = '', workOrder = ''] = first(/already has ([\d.]+) hours on (.+) that day/, s); return { hours, workOrder }; },
  ATT_DATE_WINDOW: (s) => ({ date: day(s) }),
  ATT_TS_MANUAL_ENTRY: (s) => ({ date: day(s) }),
  ATT_UNDECIDED: (s) => ({ date: day(s) }),
  HC_DATE_OLD: (s) => ({ date: day(s) }),
  LOAN_HOURS_LOCKED: (s) => ({ date: day(s) }),
  PTYPE_EXT_ORDER: (s) => ({ date: day(s) }),
  CTR_QTY_EXCEEDS_USABLE: (s) => ({ usable: first(/only (\d+) usable/, s)[0] ?? '0' }),
  CWO_NOT_READY: (s) => ({ names: s.split('not ready:')[1]?.trim() ?? '' }),
  WOS_ALLOCATION_CAP: (s) => { const [total = '', plan = ''] = first(/would be ([\d.]+) against a work-order plan of ([\d.]+)/, s); return { total, plan }; },
  WOS_ARCHIVE_BLOCKED: (s) => ({ reason: s }),
  WPVA_SPLIT_SUM: (s) => ({ sum: first(/add up to ([\d.]+)/, s)[0] ?? '' }),
  MRQ_CUTOFF: (s) => { const [time = '', date = ''] = first(/close at (\S+); .*? is (\S+)$/, s); return { time, date: day(date) }; },
  MRQ_OVER_PLAN_REASON: (s) => ({ line: first(/line (\d+)/, s)[0] ?? '' }),
  MRQ_OUT_OF_ORDER: (s) => ({ step: first(/step (\d+)/, s)[0] ?? '' }),
  CSR_OVER_REQUESTED: (s) => ({ n: qty(first(/by ([\d.]+)$/, s)[0]) }),
  CSR_OVER_COLLECT: (s) => ({ n: qty(first(/only ([\d.]+) is still/, s)[0]) }),
  CSR_RELEASE_BELOW_COLLECTED: (s) => ({ n: qty(first(/below the ([\d.]+) already/, s)[0]) }),
};

function detailsValues(details: unknown): Record<string, string> {
  if (typeof details !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const entries = Object.entries(parsed as Record<string, unknown>);
    return entries.every(([, v]) => typeof v === 'string') ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Reads `FAMILY_CODE: text` from an error's message and its figures (a `details` JSON of strings, else the sentence); null for any other error. */
export function parseRefusal(err: unknown): Refusal | null {
  if (err === null || typeof err !== 'object') return null;
  const { message, details } = err as { message?: unknown; details?: unknown };
  if (typeof message !== 'string') return null;
  const m = CODE_RE.exec(message);
  if (!m) return null;
  const code = `${m[1]}_${m[2]}`;
  const text = m[3];
  const values = { ...FIGURES[code]?.(text), ...detailsValues(details) };
  // RSV and STK figures: the first number of the sentence is the one the copy names.
  if (m[1] === 'RSV') values.n = qty(/\d+(?:\.\d+)?/.exec(text)?.[0]);
  else if (values.available !== undefined && values.requested !== undefined) {
    values.available = qty(values.available);
    values.requested = qty(values.requested);
  }
  return { family: m[1], code, text, values };
}

/** `known` is true when the sentence is a catalogue sentence for the database's own rule, false for the classifier's copy. */
export interface RefusalSentence { headline: string; detail: string; known: boolean }

export interface RefusalOptions {
  /** Extra values for the sentence, such as the organisation's words for an entity. */
  values?: Record<string, string>;
  context?: ClassifyContext;
}

/**
 * The user's words for a failed write: the `refusals:<CODE>` sentence (a `<CODE>_detail` entry is the second line, a
 * `<CODE>_figures` entry replaces the sentence when the refusal carries figures), else the shared classifier's product
 * copy. The server's own text and the code prefix never reach the screen.
 */
export function refusalText(err: unknown, t: TFunction, opts: RefusalOptions = {}): RefusalSentence {
  const r = parseRefusal(err);
  if (r) {
    const vars = { ...r.values, ...opts.values, defaultValue: '' };
    const figures = Object.keys(r.values).length ? t(`refusals:${r.code}_figures`, vars) : '';
    const headline = figures || t(`refusals:${r.code}`, vars);
    if (headline) return { headline, detail: t(`refusals:${r.code}_detail`, vars), known: true };
  }
  const c = classifyMutationError(err, undefined, opts.context);
  return { headline: c.headline, detail: r ? '' : c.detail, known: false };
}

/** The two lines as one sentence, for a screen with a single text slot. */
export const refusalLine = ({ headline, detail }: Pick<RefusalSentence, 'headline' | 'detail'>): string => (detail ? `${headline}. ${detail}` : headline);

/**
 * `refusalText` bound to the active language; loads the `refusals` catalogue with the component. The organisation's words for
 * a work-order section reach every sentence as `{{section}}` / `{{sections}}`, so no sentence types the word.
 */
export function useRefusalText(): (err: unknown, opts?: RefusalOptions) => RefusalSentence {
  const { t } = useTranslation('refusals');
  const terms = useTerms();
  const words = { section: terms.section.toLowerCase(), sections: terms.sections.toLowerCase() };
  return (err, opts) => refusalText(err, t, { ...opts, values: { ...words, ...opts?.values } });
}

/** `useRefusalText` for a screen with one text slot: the sentence as a single line. */
export function useRefusalLine(): (err: unknown, opts?: RefusalOptions) => string {
  const text = useRefusalText();
  return (err, opts) => refusalLine(text(err, opts));
}
