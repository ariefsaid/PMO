import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { create, importHistory } = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({ id: 'new-id' }), importHistory: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { project: { create }, projectStage: { importHistory } } }));

import { makeProjectImportDescriptor } from '../projectDescriptor';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const EN_LOCALE = { locale: 'en', numberLocale: 'en-US', timezone: 'UTC' };
const ID_LOCALE = { locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' };

const companies = [{ id: 'co-1', name: 'Acme Corp' }];
const managers = [{ id: 'pm-1', name: 'Jane Manager' }];

describe('makeProjectImportDescriptor', () => {
  beforeEach(() => {
    create.mockClear();
    setActiveLocale(EN_LOCALE);
  });
  afterEach(() => resetActiveLocale());
  const d = makeProjectImportDescriptor(companies, managers);
  const field = (k: string) => d.fields.find((f) => f.key === k)!;

  it('constrains status to origination statuses', () => {
    expect(field('status').validate('Leads')).toBeNull();
    expect(field('status').validate('Internal Project')).toBeNull();
    expect(field('status').validate('On-hand')).toMatch(/Leads/);
  });

  it('validates contract_value as a non-negative number, optional', () => {
    expect(field('contract_value').validate('')).toBeNull();
    expect(field('contract_value').validate('1000')).toBeNull();
    expect(field('contract_value').validate('-5')).toMatch(/non-negative/i);
    expect(field('contract_value').validate('abc')).toMatch(/number/i);
  });

  it('optional refs: empty → null, non-empty no-match → error', () => {
    expect(field('client_id').validate('')).toBeNull();
    expect(field('client_id').validate('Ghost')).toMatch(/not found/i);
    expect(field('project_manager_id').validate('Jane Manager')).toBeNull();
  });

  it('toInput resolves refs, defaults contract_value to 0, emits no org_id', () => {
    const input = d.toInput({
      name: ' Apollo ',
      status: 'Leads',
      client_id: 'Acme Corp',
      project_manager_id: '',
      contract_value: '',
      start_date: '',
      end_date: '2026-12-31',
    });
    expect(input).toEqual({
      name: 'Apollo',
      status: 'Leads',
      client_id: 'co-1',
      project_manager_id: null,
      contract_value: 0,
      start_date: null,
      end_date: '2026-12-31',
    });
    expect(input).not.toHaveProperty('org_id');
  });

  // ── #513: a row that states a value must state its basis, rejected at PREVIEW ──
  describe('#513 contract-value tax basis (migration 0197)', () => {
    const row = (over: Partial<Record<string, string>> = {}) => ({
      name: 'Apollo',
      status: 'Leads',
      client_id: '',
      project_manager_id: '',
      contract_value: '1000',
      tax_treatment: 'exclusive',
      tax_amount: '110',
      start_date: '',
      end_date: '',
      ...over,
    });

    it('#513: a valued row with no tax treatment is INVALID at preview — before any write', () => {
      const errors = d.validateRow!(row({ tax_treatment: '' }));
      expect(errors.tax_treatment).toMatch(/must state its tax treatment/i);
      expect(create).not.toHaveBeenCalled();
    });

    it('#513: a valued row with no tax amount is INVALID at preview', () => {
      const errors = d.validateRow!(row({ tax_amount: '' }));
      expect(errors.tax_amount).toMatch(/tax amount/i);
    });

    it('#513: a row at 0 (or blank) states nothing and is asked nothing', () => {
      expect(d.validateRow!(row({ contract_value: '0', tax_treatment: '', tax_amount: '' }))).toEqual({});
      expect(d.validateRow!(row({ contract_value: '', tax_treatment: '', tax_amount: '' }))).toEqual({});
    });

    it('#513: tax_amount 0 is a legitimate answer on a valued row — 0 is "no tax", never "unknown"', () => {
      expect(d.validateRow!(row({ tax_amount: '0' }))).toEqual({});
    });

    it('#513: an out-of-domain treatment is rejected by the cell validator', () => {
      expect(field('tax_treatment').validate('')).toBeNull();
      expect(field('tax_treatment').validate('inclusive')).toBeNull();
      expect(field('tax_treatment').validate('sometimes')).toMatch(/inclusive/);
    });

    it('#513: toInput carries the stated basis onto the create input', () => {
      expect(d.toInput(row())).toMatchObject({
        contract_value: 1000,
        tax_treatment: 'exclusive',
        tax_amount: 110,
      });
    });

    it('#513: toInput on a 0-value row emits NO tax columns — not a guessed treatment', () => {
      const input = d.toInput(row({ contract_value: '', tax_treatment: '', tax_amount: '' }));
      expect(input.contract_value).toBe(0);
      expect(input).not.toHaveProperty('tax_treatment');
    });

    it('#513: money cells go through parseMoneyInput — a comma-grouped sheet cell parses', () => {
      expect(field('contract_value').validate('4,820,000')).toBeNull();
      expect(d.toInput(row({ contract_value: '4,820,000', tax_amount: '530,200' }))).toMatchObject({
        contract_value: 4820000,
        tax_amount: 530200,
      });
    });

    it('AC-PLC-009: project sheet money stays neutral and scale-2 under both viewer locales', () => {
      for (const locale of [EN_LOCALE, ID_LOCALE]) {
        setActiveLocale(locale);
        expect(field('contract_value').validate('1.23')).toBeNull();
        expect(field('tax_amount').validate('1.23')).toBeNull();
        expect(field('contract_value').validate('1.234')).toMatch(/2 decimal|two decimal/i);
        expect(field('tax_amount').validate('1.234')).toMatch(/2 decimal|two decimal/i);
        expect(d.toInput(row({ contract_value: '1.23', tax_amount: '1.23' }))).toMatchObject({
          contract_value: 1.23,
          tax_amount: 1.23,
        });
        expect(d.toInput(row({ contract_value: '4,820,000', tax_amount: '530,200' }))).toMatchObject({
          contract_value: 4820000,
          tax_amount: 530200,
        });
      }
    });
  });

  it('create delegates to repositories.project.create', async () => {
    const input = d.toInput({ name: 'X', status: 'Leads', client_id: '', project_manager_id: '', contract_value: '', start_date: '', end_date: '' });
    await d.create(input);
    expect(create).toHaveBeenCalledWith(input);
  });
});

describe('#1638 stage dates', () => {
  beforeEach(() => { create.mockClear(); importHistory.mockClear(); });
  afterEach(() => { vi.useRealTimers(); });
  it('AC-PSH-015: stage dates out of order are rejected at preview, on the later column', () => {
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Leads', pq_submitted_on: '2026-07-15', quoted_on: '2026-07-01' }))
      .toEqual({ quoted_on: 'Stage dates must not go backwards.' });
  });
  it('AC-PSH-015: a future stage date is rejected', () => {
    vi.useFakeTimers({ now: new Date('2026-11-01T05:00:00Z'), toFake: ['Date'] });
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Leads', quoted_on: '2026-11-03' }))
      .toEqual({ quoted_on: 'A stage date cannot be in the future.' });
  });
  it('AC-PSH-015: an Internal Project row cannot carry stage dates', () => {
    const d = makeProjectImportDescriptor([], []);
    expect(d.validateRow!({ name: 'X', status: 'Internal Project', quoted_on: '2026-07-01' }))
      .toEqual({ quoted_on: 'Only a lead can carry stage dates.' });
  });
  it('AC-PSH-015: in-order past dates pass and ride to the history call', () => {
    const d = makeProjectImportDescriptor([], []);
    const cells = { name: 'X', status: 'Leads', lead_on: '2026-06-20', pq_submitted_on: '2026-07-01', quoted_on: '2026-07-15' };
    expect(d.validateRow!(cells)).toEqual({});
    expect(d.toInput(cells)).toMatchObject({ lead_on: '2026-06-20', pq_submitted_on: '2026-07-01', quoted_on: '2026-07-15' });
  });
  it('AC-PSH-015: create writes the project, then its stage history, without the date columns on the project', async () => {
    const d = makeProjectImportDescriptor([], []);
    await d.create(d.toInput({ name: 'X', status: 'Leads', pq_submitted_on: '2026-07-01' }));
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ pq_submitted_on: expect.anything() }));
    expect(importHistory).toHaveBeenCalledWith('new-id', [{ stage: 'PQ Submitted', entered_on: '2026-07-01' }]);
  });
});
