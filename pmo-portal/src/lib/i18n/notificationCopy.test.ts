import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { NOTIFICATION_TITLE_KEYS, notificationBody, notificationTitle } from './notificationCopy';

describe('notification wording', () => {
  afterEach(() => setOrgTerms({}));
  it.each(['budgetCancellationHeld', 'budgetRetryAuthorization'])('renders the %s app template', async (key) => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(notificationBody({ body: 'stored', message_key: key, message_params: {} }, inst.t.bind(inst))).toContain('job');
  });
  it('renders the shipped Indonesian template and retains the typed invoice number', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'pekerjaan-pekerjaan' } } });
    const body = notificationBody({ body: 'stored', message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: '' } }, inst.t.bind(inst));
    expect(body).toContain('Project Phoenix');
    expect(body).toContain('tanpa pekerjaan');
    expect(body).toContain('ke pekerjaan');
  });
  it('AC-TERM-007 renames a generated label but leaves a new user body and a historical body unchanged', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: {
      en: { notifications: { budgetArchiveWarning: 'Budget for this project.', literal: '{{body}}', unassignedInvoice: 'Invoice {{invoice}}{{amount}} has no project.', unassignedInvoiceTitle: 'Invoice needs a project', budgetPushFailed: 'Project failed: {{reason}}.' } },
    } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(notificationBody({ body: 'old body', message_key: 'budgetArchiveWarning', message_params: {} }, inst.t.bind(inst))).toBe('Budget for this job.');
    expect(notificationBody({ body: 'Project {{name}}', message_key: 'literal', message_params: { body: 'Project {{name}}' } }, inst.t.bind(inst))).toBe('Project {{name}}');
    expect(notificationTitle({ title: 'old title', message_key: 'unassignedInvoice' }, inst.t.bind(inst))).toBe('Invoice needs a job');
    expect(notificationBody({ body: 'old body', message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: ' (42)' } }, inst.t.bind(inst))).toBe('Invoice Project Phoenix (42) has no job.');
    expect(notificationBody({ body: 'old body', message_key: 'budgetPushFailed', message_params: { reason: 'Project {{name}}' } }, inst.t.bind(inst))).toBe('Job failed: Project {{name}}.');
    expect(notificationBody({ body: 'Project Phoenix', message_key: null, message_params: null }, inst.t.bind(inst))).toBe('Project Phoenix');
    expect(notificationBody({ body: 'Project Phoenix', message_key: 'unknown', message_params: {} }, inst.t.bind(inst))).toBe('Project Phoenix');
  });
  it('fix/walk-people item 9: the leave result reads in the reader\'s language, with the note when there is one', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
    const t = inst.t.bind(inst);
    const params = { type: 'Sakit', from: '2026-12-01', to: '2026-12-03', note: 'Dokumen kurang' };
    expect(notificationTitle({ title: 'Leave rejected', message_key: 'leaveRejected' }, t)).toBe('Cuti ditolak');
    const body = notificationBody({ body: 'stored', message_key: 'leaveRejected', message_params: params }, t);
    expect(body).toContain('ditolak');
    expect(body).toContain('Sakit');
    expect(body).toContain('Dokumen kurang');
    expect(notificationBody({ body: 'stored', message_key: 'leaveApproved', message_params: { ...params, note: null } }, t)).toContain('disetujui');
  });

  describe('fix-waiting item 4: titles the database writes reach the reader in their language', () => {
    it('fix1122 renders the four migrated titles in both languages and keeps legacy and dynamic matches', async () => {
      const expectedTitles: Record<string, Record<string, string>> = {
        en: {
          'A crew member reports absent today': 'A crew member reports absent today',
          'Your daily report was sent back': 'Your daily report was sent back',
          'Your material request was approved': 'Your material request was approved',
          'Your subcontract certificate was sent back': 'Your subcontract certificate was sent back',
        },
        id: {
          'A crew member reports absent today': 'Ada anggota kru yang melaporkan tidak hadir hari ini',
          'Your daily report was sent back': 'Laporan harian Anda dikembalikan',
          'Your material request was approved': 'Permintaan material Anda disetujui',
          'Your subcontract certificate was sent back': 'Sertifikat subkontraktor Anda dikembalikan',
        },
      };

      for (const [lng, titles] of Object.entries(expectedTitles)) {
        const inst = i18next.createInstance();
        await inst.init({ lng, fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
        const t = inst.t.bind(inst);
        for (const [title, expected] of Object.entries(titles)) {
          expect(notificationTitle({ title, message_key: 'literal' }, t)).toBe(expected);
        }
        expect(notificationTitle({ title: 'Equipment down more than 2 days', message_key: 'literal' }, t)).toBe(
          lng === 'id' ? 'Peralatan rusak lebih dari 2 hari' : 'Equipment down more than 2 days',
        );
      }
    });

    it('JOB-WAIT-4 shows every known database title in Bahasa Indonesia on a Bahasa organisation, and keeps an unknown one as stored', async () => {
      const inst = i18next.createInstance();
      await inst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const t = inst.t.bind(inst);
      expect(notificationTitle({ title: 'Your material request was sent back', message_key: 'literal' }, t)).toBe('Permintaan material Anda dikembalikan');
      expect(notificationTitle({ title: 'Your procurement was approved', message_key: 'literal' }, t)).toBe('Pengadaan Anda disetujui');
      expect(notificationTitle({ title: 'Something written by a person', message_key: 'literal' }, t)).toBe('Something written by a person');
    });
    it('AC-WAIT-060 every title in the table has English and Bahasa text, so none can reach a Bahasa screen in English', () => {
      for (const key of Object.values(NOTIFICATION_TITLE_KEYS)) {
        expect((en as { title: Record<string, string> }).title[key], `en ${key}`).toBeTruthy();
        expect((id as { title: Record<string, string> }).title[key], `id ${key}`).toBeTruthy();
      }
    });
  });

  describe('fix-waiting item 4: approval notification body reader-language localization', () => {
    it('formats approved timesheet notification week label in the reader language for English and Bahasa', async () => {
      const timesheetRow = {
        title: 'Your timesheet was approved',
        body: 'Timesheet week of 2026-01-05',
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021', label: 'Timesheet week of 2026-01-05' } },
      };

      // English
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);
      expect(notificationTitle(timesheetRow, enT)).toBe('Your timesheet was approved');
      expect(notificationBody(timesheetRow, enT)).toBe('Timesheet week of 5 Jan 2026');

      // Bahasa Indonesia
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);
      expect(notificationTitle(timesheetRow, idT)).toBe('Timesheet Anda disetujui');
      expect(notificationBody(timesheetRow, idT)).toBe('Timesheet minggu 5 Jan 2026');
    });

    it('formats timesheet awaiting approval week label in reader language and handles timesheetApproved message_key', async () => {
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      const awaitingRow = {
        title: 'Timesheet awaiting your approval',
        body: 'Timesheet week of 2026-01-05',
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021' } },
      };
      expect(notificationBody(awaitingRow, idT)).toBe('Timesheet minggu 5 Jan 2026');

      const messageKeyRow = {
        title: 'Your timesheet was approved',
        body: null,
        message_key: 'timesheetApproved',
        message_params: { date: '2026-01-05' },
      };
      expect(notificationBody(messageKeyRow, idT)).toBe('Timesheet minggu 5 Jan 2026');
    });

    it('leaves user rejection reason unchanged and does not translate arbitrary user text or reasons', async () => {
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // Timesheet rejection with user reason (from 1562)
      const userReasonRow = {
        title: 'Your timesheet was rejected',
        body: 'Hours exceed project allocation',
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000022' } },
      };
      expect(notificationBody(userReasonRow, idT)).toBe('Hours exceed project allocation');

      // Procurement rejection with user reason (from 0237/0349)
      const procurementReasonRow = {
        title: 'Your procurement was rejected',
        body: 'Missing quote',
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'procurement_case', id: '02370000-0000-0000-0000-000000000011' } },
      };
      expect(notificationBody(procurementReasonRow, idT)).toBe('Missing quote');
    });

    it('leaves unknown body, no raw key, and non-timesheet rows unchanged', async () => {
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // Unknown row with matching string but no timesheet producer identity
      const unknownRowWithoutProducer = {
        title: 'General announcement',
        body: 'Timesheet week of 2026-01-05',
        message_key: null,
        message_params: null,
        metadata: null,
      };
      expect(notificationBody(unknownRowWithoutProducer, idT)).toBe('Timesheet week of 2026-01-05');

      // Unknown row with no title and no metadata
      expect(notificationBody({ body: 'Timesheet week of 2026-01-05', message_key: null, message_params: null }, idT)).toBe('Timesheet week of 2026-01-05');

      // Unrecognized message key
      expect(notificationBody({ body: 'System maintenance scheduled', message_key: 'unrecognized_key', message_params: {} }, idT)).toBe('System maintenance scheduled');
    });

    it('preserves record identity labels and null bodies without translation', async () => {
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // MRQ approved has null body (entity label holds record number MR-001)
      const mrqApprovedRow = {
        title: 'Your material request was approved',
        body: null,
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'material_request', id: 'mrq-uuid', label: 'MR-001' } },
      };
      expect(notificationBody(mrqApprovedRow, idT)).toBeNull();

      // Equipment plan approved has null body
      const eqpApprovedRow = {
        title: 'Your equipment plan was approved',
        body: null,
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'equipment_plan', id: 'eqp-uuid', label: 'Project Alpha · 2026-11' } },
      };
      expect(notificationBody(eqpApprovedRow, idT)).toBeNull();
    });

    it('timesheet week label catalogue key exists and differs between English and Bahasa', () => {
      expect((en as Record<string, unknown>).timesheetWeek).toBe('Timesheet week of {{date}}');
      expect((id as Record<string, unknown>).timesheetWeek).toBe('Timesheet minggu {{date}}');
      expect((id as Record<string, unknown>).timesheetWeek).not.toBe((en as Record<string, unknown>).timesheetWeek);
    });
  });
});
