/**
 * THE NOTIFICATION BODY GATE. The generated approval sentences a migration writes are matched EXACTLY by the shipped
 * formatter (`notificationCopy.ts`), so the coupling is three-way: the SQL literal, the English catalogue text, and the
 * formatter's exact comparison. A hardcoded unit fixture can drift from all three and stay green; this cannot.
 *
 * It reads the HIGHEST definition of each producer function (the last migration, by filename, that defines it),
 * builds the row shape the 1025/1611 template guard stamps (`message_key = 'literal'`, `message_params.body = the body`),
 * and drives the shipped `notificationBody` with the SQL's own sentence. Therefore:
 *  - a producer sentence edited in SQL stops matching its catalogue text → the first assertion fails;
 *  - a catalogue edited away from the producer → also fails;
 *  - a formatter literal edited away from the producer → the Bahasa output falls back to the stored English body → fails.
 *
 * It is NOT a general SQL parser: it reads one function's dollar-quoted body and one adjacent literal (or the two arms of
 * the QCR client-decision CASE). It writes no marker and touches no database.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { resetActiveLocale, setActiveLocale } from '../locale/activeLocale';
import { formatIsoDay } from '../format';
import { notificationBody } from './notificationCopy';
import { NOTIFICATION_TITLES } from './notificationTitles';

const MIGRATIONS = join(__dirname, '../../../../supabase/migrations');
const SAMPLE_DATE = '2026-08-10';
const SAMPLE_REASON = 'Exceeds client variance ceiling by 15%';

/** The source of the highest definition of a `public.<name>` function, or a loud failure. */
function highestFunctionSource(name: string): string {
  const definition = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, 'i');
  let source: string | null = null;
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const match = definition.exec(sql);
    if (!match) continue;
    const opened = sql.indexOf('$$', match.index);
    const closed = opened === -1 ? -1 : sql.indexOf('$$', opened + 2);
    if (closed === -1) throw new Error(`unterminated function body for public.${name} in ${file}`);
    source = sql.slice(opened + 2, closed);
  }
  if (source === null) throw new Error(`no definition of public.${name} in supabase/migrations`);
  return source;
}

/** A comment is prose about the sentence, not the sentence. */
const stripComments = (source: string): string => source.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const unescapeSql = (literal: string): string => literal.replaceAll("''", "'");
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_all, name: string) => values[name] ?? '');

/** The body literal that follows a `notify_workflow_user(..., '<title>', ...)` title, read from the SQL. */
function literalAfter(source: string, title: string): string {
  const at = source.indexOf(`'${title}'`);
  if (at === -1) throw new Error(`producer title "${title}" not found in the highest definition`);
  const rest = source.slice(at + title.length + 2);
  const match = /^\s*,\s*'((?:[^']|'')*)'/.exec(rest);
  if (!match) throw new Error(`no body literal right after "${title}"`);
  return unescapeSql(match[1]);
}

/** `notify_timesheet_transition` writes `v_label := '<prefix>' || new.week_start_date::text` for its week labels. */
function timesheetLabelPrefix(source: string): string {
  const match = /v_label\s+text\s*:=\s*'((?:[^']|'')*)'\s*\|\|\s*new\.week_start_date::text/.exec(source);
  if (!match) throw new Error('cannot read the week-label prefix from notify_timesheet_transition');
  return unescapeSql(match[1]);
}

/** `qcr_record_decision` has three `p_decision = 'accepted'` CASE arms: the title, the body, and the severity. */
function qcrDecisionBodies(source: string): { accepted: string; declined: string } {
  const arms = [...source.matchAll(/p_decision = 'accepted' then '((?:[^']|'')*)' else '((?:[^']|'')*)'/g)]
    .map((match) => ({ accepted: unescapeSql(match[1]), declined: unescapeSql(match[2]) }));
  const severities = new Set(['info', 'warning', 'critical']);
  const bodyArms = arms.filter((arm) => !severities.has(arm.accepted) && !(arm.accepted in NOTIFICATION_TITLES));
  if (bodyArms.length !== 1) {
    throw new Error(`expected exactly one body CASE arm in qcr_record_decision, found ${bodyArms.length} of ${arms.length}`);
  }
  return bodyArms[0];
}

type Binding = {
  label: string;
  fn: string;
  key: string;
  title: string;
  /** The concrete body the producer writes, read from its SQL. */
  body: (source: string) => string;
  /** The producer-supplied values the English catalogue template must carry (before display formatting). */
  values: Record<string, string>;
};

const BINDINGS: Binding[] = [
  {
    label: 'timesheet week label',
    fn: 'notify_timesheet_transition',
    key: 'timesheetWeek',
    title: 'Your timesheet was approved',
    body: (source) => timesheetLabelPrefix(source) + SAMPLE_DATE,
    values: { date: SAMPLE_DATE },
  },
  {
    label: 'QCR awaiting approval',
    fn: 'qcr_submit',
    key: 'qcrAwaitingBody',
    title: 'Quantity change request awaiting approval',
    body: (source) => literalAfter(source, 'Quantity change request awaiting approval'),
    values: {},
  },
  {
    label: 'QCR approved internally',
    fn: 'qcr_approve',
    key: 'qcrApprovedBody',
    title: 'Quantity change request approved',
    body: (source) => literalAfter(source, 'Quantity change request approved'),
    values: {},
  },
  {
    label: 'QCR returned prefix + reason',
    fn: 'qcr_return',
    key: 'qcrReturnedBody',
    title: 'Quantity change request returned',
    body: (source) => literalAfter(source, 'Quantity change request returned') + SAMPLE_REASON,
    values: { reason: SAMPLE_REASON },
  },
  {
    label: 'QCR client accepted',
    fn: 'qcr_record_decision',
    key: 'qcrClientAcceptedBody',
    title: 'Quantity change accepted by the client',
    body: (source) => qcrDecisionBodies(source).accepted,
    values: {},
  },
  {
    label: 'QCR client declined',
    fn: 'qcr_record_decision',
    key: 'qcrClientDeclinedBody',
    title: 'Quantity change declined by the client',
    body: (source) => qcrDecisionBodies(source).declined,
    values: {},
  },
];

const catalogueText = (catalogue: Record<string, unknown>, key: string): string => {
  const value = catalogue[key];
  if (typeof value !== 'string') throw new Error(`catalogue key ${key} is missing`);
  return value;
};

async function instance(lng: 'en' | 'id') {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    fallbackLng: 'en',
    ns: ['notifications'],
    defaultNS: 'notifications',
    interpolation: { escapeValue: false }, // mirror src/lib/i18n/index.ts: React renders the body as text
    resources: { en: { notifications: en }, id: { notifications: id } },
  });
  return inst.t.bind(inst);
}

describe('the template guard still stamps what the formatter reads', () => {
  it('notifications_message_template_guard stores a body as message_key=literal + params.body', () => {
    const guard = stripComments(highestFunctionSource('notifications_message_template_guard'));
    expect(guard).toContain("new.message_key := 'literal';");
    expect(guard).toContain("new.message_params := jsonb_build_object('body', new.body);");
  });
});

describe('every generated approval body a migration writes is localized from its own SQL sentence', () => {
  it.each(BINDINGS)('$label: $fn -> $key', async (binding) => {
    const source = stripComments(highestFunctionSource(binding.fn));
    const producedBody = binding.body(source);
    // The row shape the guard above stamps for this producer.
    const row = {
      title: binding.title,
      body: producedBody,
      message_key: 'literal',
      message_params: { body: producedBody },
      metadata: { entity: { type: binding.fn.startsWith('qcr_') ? 'quantity_change_request' : 'timesheet', id: 'gate-row' } },
    };

    // 1. The English catalogue still carries exactly the sentence the producer writes.
    expect(
      fill(catalogueText(en, binding.key), binding.values),
      `${binding.key} drifted from the sentence ${binding.fn} writes — update the catalogue and the formatter together`,
    ).toBe(producedBody);

    const enT = await instance('en');
    const idT = await instance('id');

    // 2. The shipped formatter localizes that exact body, in both languages, instead of passing it through.
    try {
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
      const displayValues = binding.key === 'timesheetWeek' ? { ...binding.values, date: formatIsoDay(SAMPLE_DATE) } : binding.values;
      expect(notificationBody(row, enT)).toBe(fill(catalogueText(en, binding.key), displayValues));

      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idValues = binding.key === 'timesheetWeek' ? { ...binding.values, date: formatIsoDay(SAMPLE_DATE) } : binding.values;
      const localized = notificationBody(row, idT);
      expect(localized).toBe(fill(catalogueText(id, binding.key), idValues));
      // The durability property: a Bahasa screen must never receive the stored English sentence back.
      expect(localized, `${binding.fn}'s sentence reached a Bahasa screen untranslated`).not.toBe(producedBody);
    } finally {
      resetActiveLocale();
    }
  });
});

describe('a rejected timesheet body is never localized (root ruling R-4)', () => {
  it('keeps the stored literal even when it is byte-identical to the generated week label', async () => {
    // 1562 writes this label on the approval/awaiting arms and (defensively) as the blank-reason fallback; a person's
    // rejection reason can be exactly this text, and its origin is unknowable read-side. So every rejected body stays
    // as stored — proven here from the real producer prefix so a future arm cannot silently re-localize it.
    const label = timesheetLabelPrefix(stripComments(highestFunctionSource('notify_timesheet_transition'))) + SAMPLE_DATE;
    const row = {
      title: 'Your timesheet was rejected',
      body: label,
      message_key: 'literal',
      message_params: { body: label },
      metadata: { entity: { type: 'timesheet', id: 'gate-row' } },
    };
    const enT = await instance('en');
    const idT = await instance('id');
    try {
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      expect(notificationBody(row, idT)).toBe(label);
      expect(notificationBody(row, enT)).toBe(label);
    } finally {
      resetActiveLocale();
    }
  });
});
