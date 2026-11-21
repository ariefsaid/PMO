import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import { parseNeutralMoneyInputAtScale } from '@/src/lib/format';
import type { CatalogueItemInput } from '@/src/lib/db/rateCatalogue';
import type { ImportDescriptor, ImportField } from './types';

/** A 2,000-item catalogue is the target size (#2520); the generic cap of 500 is for small lists. */
export const RATE_CATALOGUE_MAX_ROWS = 5000;

export const rateColumnKey = (variant: string) => `rate:${variant}`;

type Cells = Record<string, string>;
type Input = CatalogueItemInput;

/** "Fabrication=10; Welding=80; Testing=10" → stages. Anything else → `null` (the cell carries the error). */
export function parseStages(raw: string): { stage: string; weightPct: number }[] | null {
  const text = raw.trim();
  if (text === '') return [];
  const out: { stage: string; weightPct: number }[] = [];
  for (const part of text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean)) {
    const at = part.lastIndexOf('=');
    const stage = at > 0 ? part.slice(0, at).trim() : '';
    const pct = at > 0 ? parseNeutralMoneyInputAtScale(part.slice(at + 1).replace('%', ''), 2) : null;
    if (!stage || stage.length > 80 || pct === null || pct <= 0 || pct > 100) return null;
    out.push({ stage, weightPct: pct });
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => ISO_DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Unit-rate catalogue import for ONE contract (#2520). One row = one catalogue item, with one rate column per location
 * variant the contract defines (`variants`, in the reader's order). A row whose item code is already in the catalogue
 * updates its descriptions and adds a new effective-dated rate where the figure changed; a rate already in force from a
 * later date refuses the row (history is never rewritten). The wizard's cap is raised for this entity.
 */
export function makeRateCatalogueImportDescriptor(projectId: string, variants: string[], t?: TFunction): ImportDescriptor<Input> {
  const label = (key: string, fallback: string) => (t ? String(t(key, fallback)) : fallback);
  const noCell = () => null;
  const field = (key: string, text: string, required: boolean, previewSize: number, extra: Partial<ImportField<Input>> = {}) =>
    ({ key, label: text, required, validate: noCell, previewSize, ...extra }) as unknown as ImportField<Input>;
  const text = (key: string, en: string, id: string, required: boolean, size: number, aliases: string[] = []) =>
    field(key, label(`import:rateCatalogue.${key}`, en), required, size, { aliases: [en, id, ...aliases], ...(key === 'itemCode' || key === 'description' ? { inRowTitle: true } : {}) });

  const err = (key: string, en: string) => label(`import:rateCatalogue.error.${key}`, en);
  const rateOf = (raw: string) => (raw.trim() === '' ? undefined : parseNeutralMoneyInputAtScale(raw, 2));

  return {
    entity: 'Rate catalogue',
    entityDisplay: label('import:entity.rateCatalogue', 'catalogue items'),
    entityDisplayOne: label('import:entity.rateCatalogueItem', 'catalogue item'),
    rowTitle: (c) => [c.itemCode, c.description].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    wide: true,
    maxRows: RATE_CATALOGUE_MAX_ROWS,
    template: {
      version: 1,
      example: { itemCode: 'PIPE-001', description: 'Pipe spool, 6 inch', unit: 'm', effectiveFrom: '2026-01-01', ...Object.fromEntries(variants.map((v) => [rateColumnKey(v), '120.00'])) },
    },
    fields: [
      text('category', 'Category', 'Kategori', false, 90),
      text('class', 'Class', 'Kelas', false, 80),
      text('itemCode', 'Item code', 'Kode item', true, 90),
      text('description', 'Description', 'Deskripsi', true, 150),
      text('unit', 'Unit', 'Satuan', true, 60),
      text('workMethod', 'Work method', 'Metode kerja', false, 90),
      text('testType', 'Test type', 'Jenis uji', false, 80),
      field('effectiveFrom', label('import:rateCatalogue.effectiveFrom', 'Effective from'), true, 100, {
        aliases: ['Effective from', 'Berlaku mulai', 'Effective date'],
        hint: label('import:rateCatalogue.effectiveFromHint', 'Written as year-month-day, e.g. 2026-01-31. The rates below apply from this date.'),
      }),
      ...variants.map((v) => field(rateColumnKey(v), v, false, 90, { numeric: true, aliases: [v, `Rate (${v})`, `Rate ${v}`], hint: label('import:rateCatalogue.rateHint', 'Rate for this location variant. Leave blank for no rate.') })),
      field('stages', label('import:rateCatalogue.stages', 'Stage weights'), false, 150, {
        aliases: ['Stages', 'Stage weights', 'Bobot tahap'],
        hint: label('import:rateCatalogue.stagesHint', 'Optional. Stage name and percent, e.g. Fabrication=10; Welding=80; Testing=10. Must add up to 100.'),
      }),
    ],
    validateRow: (c: Cells) => {
      const out: Record<string, string> = {};
      const need = (k: string, max: number, en: string) => {
        const v = (c[k] ?? '').trim();
        if (v === '') out[k] = err(`${k}Required`, en);
        else if (v.length > max) out[k] = err(`${k}TooLong`, `${en.replace(' is required.', '')} is too long.`);
      };
      need('itemCode', 140, 'Item code is required.');
      need('description', 500, 'Description is required.');
      need('unit', 40, 'Unit is required.');
      if (!isRealDate((c.effectiveFrom ?? '').trim())) out.effectiveFrom = err('effectiveFrom', 'Effective from must be a date written year-month-day.');
      let any = false;
      for (const v of variants) {
        const raw = c[rateColumnKey(v)] ?? '';
        if (raw.trim() === '') continue;
        const n = rateOf(raw);
        if (n === null || n === undefined || n < 0) out[rateColumnKey(v)] = err('rate', `The ${v} rate must be a number of 0 or more (up to 2 decimals).`);
        else any = true;
      }
      if (!any && !Object.keys(out).some((k) => k.startsWith('rate:'))) out.itemCode ??= err('noRate', 'Give at least one location rate.');
      const stages = parseStages(c.stages ?? '');
      if (stages === null) out.stages = err('stagesFormat', 'Stage weights must read like Fabrication=10; Welding=80.');
      else if (stages.length > 0 && Math.abs(stages.reduce((s, x) => s + x.weightPct, 0) - 100) > 1e-9) out.stages = err('stagesSum', 'Stage weights must add up to 100.');
      return out as Partial<Record<keyof Input & string, string>>;
    },
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        const code = (c.itemCode ?? '').trim().toLowerCase();
        if (code === '') return {};
        if (first.has(code)) return { itemCode: err('duplicate', `Item code "${(c.itemCode ?? '').trim()}" appears twice (rows ${(first.get(code) ?? 0) + 2} and ${i + 2}).`) };
        first.set(code, i);
        return {};
      });
    },
    toInput: (c: Cells) => {
      const rates: Record<string, number> = {};
      for (const v of variants) {
        const n = rateOf(c[rateColumnKey(v)] ?? '');
        if (typeof n === 'number') rates[v] = n;
      }
      return {
        category: (c.category ?? '').trim(), class: (c.class ?? '').trim(), itemCode: (c.itemCode ?? '').trim(),
        description: (c.description ?? '').trim(), unit: (c.unit ?? '').trim(), workMethod: (c.workMethod ?? '').trim(),
        testType: (c.testType ?? '').trim(), effectiveFrom: (c.effectiveFrom ?? '').trim(), rates,
        stages: parseStages(c.stages ?? '') ?? [],
      };
    },
    create: (input) => repositories.rateCatalogue.upsertItem(projectId, input),
  };
}
