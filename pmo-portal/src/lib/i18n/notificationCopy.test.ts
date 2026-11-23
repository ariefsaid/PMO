import { afterEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { orgTermsPlugin } from './index';
import { setOrgTerms } from './orgTerms';
import { resetActiveLocale, setActiveLocale } from '../locale/activeLocale';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { NOTIFICATION_TITLE_KEYS, notificationBody, notificationTitle } from './notificationCopy';

// Every instance below mirrors the app's own config (`src/lib/i18n/index.ts`): `interpolation.escapeValue: false`.
// The app can do that because a notification body is rendered as React text, never as HTML. Without the same option
// here a test cannot prove that a user reason keeps its exact bytes — i18next's default would HTML-escape it.
describe('notification wording', () => {
  afterEach(() => {
    setOrgTerms({});
    resetActiveLocale();
  });
  it.each(['budgetCancellationHeld', 'budgetRetryAuthorization'])('renders the %s app template', async (key) => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en } } });
    setOrgTerms({ en: { project: { singular: 'job', plural: 'jobs' } } });
    expect(notificationBody({ body: 'stored', message_key: key, message_params: {} }, inst.t.bind(inst))).toContain('job');
  });
  it('renders the shipped Indonesian template and retains the typed invoice number', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
    setOrgTerms({ id: { project: { singular: 'pekerjaan', plural: 'pekerjaan-pekerjaan' } } });
    const body = notificationBody({ body: 'stored', message_key: 'unassignedInvoice', message_params: { invoice: 'Project Phoenix', amount: '' } }, inst.t.bind(inst));
    expect(body).toContain('Project Phoenix');
    expect(body).toContain('tanpa pekerjaan');
    expect(body).toContain('ke pekerjaan');
  });
  it('AC-TERM-007 renames a generated label but leaves a new user body and a historical body unchanged', async () => {
    const inst = i18next.createInstance();
    await inst.use(orgTermsPlugin).init({ lng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: {
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
    await inst.use(orgTermsPlugin).init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
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
        await inst.init({ lng, fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
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
      await inst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
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
    it('formats approved timesheet notification week label in the reader language for English and Bahasa with real producer+guard literal shape', async () => {
      // Real producer + 1025/1611 guard row shape: message_key is 'literal', message_params carries body
      const timesheetRow = {
        title: 'Your timesheet was approved',
        body: 'Timesheet week of 2026-08-10',
        message_key: 'literal',
        message_params: { body: 'Timesheet week of 2026-08-10' },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021', label: 'Timesheet week of 2026-08-10' } },
      };

      // English (active locale en, month Aug)
      setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);
      expect(notificationTitle(timesheetRow, enT)).toBe('Your timesheet was approved');
      expect(notificationBody(timesheetRow, enT)).toBe('Timesheet week of 10 Aug 2026');

      // Bahasa Indonesia (active locale id, month Agu)
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);
      expect(notificationTitle(timesheetRow, idT)).toBe('Timesheet Anda disetujui');
      expect(notificationBody(timesheetRow, idT)).toBe('Timesheet minggu 10 Agu 2026');
    });

    it('formats timesheet awaiting approval week label and handles historical null-key rows', async () => {
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // Real producer + guard awaiting row shape
      const awaitingRow = {
        title: 'Timesheet awaiting your approval',
        body: 'Timesheet week of 2026-08-10',
        message_key: 'literal',
        message_params: { body: 'Timesheet week of 2026-08-10' },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021' } },
      };
      expect(notificationBody(awaitingRow, idT)).toBe('Timesheet minggu 10 Agu 2026');

      // Historical pre-1025 row with null message_key
      const historicalRow = {
        title: 'Your timesheet was approved',
        body: 'Timesheet week of 2026-08-10',
        message_key: null,
        message_params: null,
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021' } },
      };
      expect(notificationBody(historicalRow, idT)).toBe('Timesheet minggu 10 Agu 2026');
    });

    it('leaves user rejection reasons untouched in literal and historical rows, and never localizes a rejected body', async () => {
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // Timesheet rejection with user reason (from 1562, stamped literal by 1611 guard)
      const userReasonRow = {
        title: 'Your timesheet was rejected',
        body: 'Hours exceed project allocation',
        message_key: 'literal',
        message_params: { body: 'Hours exceed project allocation' },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000022' } },
      };
      expect(notificationTitle(userReasonRow, idT)).toBe('Timesheet Anda dikembalikan');
      expect(notificationBody(userReasonRow, idT)).toBe('Hours exceed project allocation');

      // Timesheet rejection whose stored body is the week-label shape (1562's defensive fallback arm) — the origin
      // is unknowable read-side, so the stored literal is kept (root ruling, R-4).
      const blankReasonFallbackRow = {
        title: 'Your timesheet was rejected',
        body: 'Timesheet week of 2026-08-10',
        message_key: 'literal',
        message_params: { body: 'Timesheet week of 2026-08-10' },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000022' } },
      };
      expect(notificationBody(blankReasonFallbackRow, idT)).toBe('Timesheet week of 2026-08-10');

      // Procurement rejection with user note (stamped literal by guard)
      const procurementReasonRow = {
        title: 'Your procurement was rejected',
        body: 'Missing quote',
        message_key: 'literal',
        message_params: { body: 'Missing quote' },
        metadata: { entity: { type: 'procurement_case', id: '02370000-0000-0000-0000-000000000011' } },
      };
      expect(notificationBody(procurementReasonRow, idT)).toBe('Missing quote');
    });

    it('R-4: a rejected timesheet body stays literal even when the reason is exactly the generated week label', async () => {
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      const rejectedRow = (reason: string) => ({
        title: 'Your timesheet was rejected',
        body: reason,
        message_key: 'literal',
        message_params: { body: reason },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000023' } },
      });

      // A person's reason that happens to be the generated label grammar: kept byte-for-byte in BOTH languages.
      const exactLabelReason = 'Timesheet week of 2026-08-10';
      expect(notificationTitle(rejectedRow(exactLabelReason), idT)).toBe('Timesheet Anda dikembalikan');
      expect(notificationBody(rejectedRow(exactLabelReason), enT)).toBe(exactLabelReason);
      expect(notificationBody(rejectedRow(exactLabelReason), idT)).toBe(exactLabelReason);

      // A normal rejection reason: unchanged.
      expect(notificationBody(rejectedRow('Hours exceed project allocation'), idT)).toBe('Hours exceed project allocation');

      // Special bytes in a rejection reason: unchanged exactly, no escaping and no whitespace collapsing.
      const specialReason = 'Exceeds   allocation\tby 3h\nplease & review <this> "note" \'x\'';
      expect(notificationBody(rejectedRow(specialReason), idT)).toBe(specialReason);

      // The exclusion is by producer identity, not by body: the SAME label on an approved row still localizes.
      const approvedRow = {
        title: 'Your timesheet was approved',
        body: exactLabelReason,
        message_key: 'literal',
        message_params: { body: exactLabelReason },
        metadata: { entity: { type: 'timesheet', id: '02370000-0000-0000-0000-000000000021' } },
      };
      expect(notificationBody(approvedRow, idT)).toBe('Timesheet minggu 10 Agu 2026');
    });

    it('localizes QCR generated approval bodies in English and Bahasa while preserving exact user reason suffix', async () => {
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);

      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // QCR awaiting approval (1176:476-477 + guard)
      const qcrAwaitingRow = {
        title: 'Quantity change request awaiting approval',
        body: 'A quantity change request has been submitted for your approval.',
        message_key: 'literal',
        message_params: { body: 'A quantity change request has been submitted for your approval.' },
        metadata: { entity: { type: 'quantity_change_request', id: '1176-uuid' } },
      };
      expect(notificationBody(qcrAwaitingRow, enT)).toBe('A quantity change request has been submitted for your approval.');
      expect(notificationBody(qcrAwaitingRow, idT)).toBe('Permintaan perubahan kuantitas telah diajukan untuk persetujuan Anda.');

      // QCR approved internally (1177:47-49 + guard)
      const qcrApprovedRow = {
        title: 'Quantity change request approved',
        body: 'Your quantity change request was approved internally. Record when it is sent to the client.',
        message_key: 'literal',
        message_params: { body: 'Your quantity change request was approved internally. Record when it is sent to the client.' },
        metadata: { entity: { type: 'quantity_change_request', id: '1177-uuid' } },
      };
      expect(notificationBody(qcrApprovedRow, enT)).toBe('Your quantity change request was approved internally. Record when it is sent to the client.');
      expect(notificationBody(qcrApprovedRow, idT)).toBe('Permintaan perubahan kuantitas Anda telah disetujui secara internal. Catat saat dikirim ke klien.');

      // QCR returned with user reason (1177:70-71 + guard)
      const qcrReturnedRow = {
        title: 'Quantity change request returned',
        body: 'Your quantity change request was returned: Exceeds client variance ceiling by 15%',
        message_key: 'literal',
        message_params: { body: 'Your quantity change request was returned: Exceeds client variance ceiling by 15%' },
        metadata: { entity: { type: 'quantity_change_request', id: '1177-uuid' } },
      };
      expect(notificationBody(qcrReturnedRow, enT)).toBe('Your quantity change request was returned: Exceeds client variance ceiling by 15%');
      expect(notificationBody(qcrReturnedRow, idT)).toBe('Permintaan perubahan kuantitas Anda dikembalikan: Exceeds client variance ceiling by 15%');
    });

    it('localizes the QCR client decision (accepted / declined) generated bodies from 1177:189-191', async () => {
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // qcr_record_decision accepted: the contract quantities were updated (1177:189-191 + guard stamps literal)
      const clientAcceptedRow = {
        title: 'Quantity change accepted by the client',
        body: 'The contract quantities were updated.',
        message_key: 'literal',
        message_params: { body: 'The contract quantities were updated.' },
        metadata: { entity: { type: 'quantity_change_request', id: '1177-uuid', label: 'Quantity change request' } },
      };
      expect(notificationTitle(clientAcceptedRow, idT)).toBe('Perubahan kuantitas diterima klien');
      expect(notificationBody(clientAcceptedRow, enT)).toBe('The contract quantities were updated.');
      expect(notificationBody(clientAcceptedRow, idT)).toBe('Kuantitas kontrak telah diperbarui.');

      // qcr_record_decision declined: no quantity was changed (1177:189-191 + guard stamps literal)
      const clientDeclinedRow = {
        title: 'Quantity change declined by the client',
        body: 'No quantity was changed.',
        message_key: 'literal',
        message_params: { body: 'No quantity was changed.' },
        metadata: { entity: { type: 'quantity_change_request', id: '1177-uuid', label: 'Quantity change request' } },
      };
      expect(notificationTitle(clientDeclinedRow, idT)).toBe('Perubahan kuantitas ditolak klien');
      expect(notificationBody(clientDeclinedRow, enT)).toBe('No quantity was changed.');
      expect(notificationBody(clientDeclinedRow, idT)).toBe('Tidak ada kuantitas yang diubah.');

      // Identity still fails safe: the same two sentences on a non-QCR record stay as stored.
      expect(notificationBody({ ...clientAcceptedRow, title: 'Task assigned', metadata: { entity: { type: 'task' } } }, idT)).toBe('The contract quantities were updated.');
      expect(notificationBody({ ...clientDeclinedRow, title: 'Task assigned', metadata: { entity: { type: 'task' } } }, idT)).toBe('No quantity was changed.');
    });

    it('preserves the exact user reason bytes — internal spaces, tab, newline, ampersand, angle brackets and quotes', async () => {
      const enInst = i18next.createInstance();
      await enInst.init({ lng: 'en', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const enT = enInst.t.bind(enInst);
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // A real returned-request reason, verbatim as a person typed it (the producer btrims only the ends).
      const exactReason = 'Exceeds   client\tvariance\nceiling & <limit> "15%" \'note\'';
      const producedBody = `Your quantity change request was returned: ${exactReason}`;
      const row = {
        title: 'Quantity change request returned',
        body: producedBody,
        message_key: 'literal',
        message_params: { body: producedBody },
        metadata: { entity: { type: 'quantity_change_request', id: '1177-uuid' } },
      };

      const enOut = notificationBody(row, enT) ?? '';
      const idOut = notificationBody(row, idT) ?? '';
      expect(enOut).toBe(producedBody);
      expect(idOut).toBe(`Permintaan perubahan kuantitas Anda dikembalikan: ${exactReason}`);
      // The suffix is byte-identical, not HTML-escaped and not whitespace-collapsed.
      expect(idOut.endsWith(exactReason)).toBe(true);
      expect(idOut.length).toBe('Permintaan perubahan kuantitas Anda dikembalikan: '.length + exactReason.length);
      expect(idOut).not.toContain('&amp;');
      expect(idOut).not.toContain('&lt;');
      expect(idOut).not.toContain('&quot;');
      expect(enOut).not.toContain('&amp;');
    });

    it('leaves unknown bodies, metadata/title mismatches, and null bodies unchanged', async () => {
      setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
      const idInst = i18next.createInstance();
      await idInst.init({ lng: 'id', fallbackLng: 'en', ns: ['notifications'], defaultNS: 'notifications', interpolation: { escapeValue: false }, resources: { en: { notifications: en }, id: { notifications: id } } });
      const idT = idInst.t.bind(idInst);

      // Title matches timesheet but body is arbitrary non-grammar text
      const nonGrammarBodyRow = {
        title: 'Your timesheet was approved',
        body: 'Custom manual memo',
        message_key: 'literal',
        message_params: { body: 'Custom manual memo' },
        metadata: { entity: { type: 'timesheet' } },
      };
      expect(notificationBody(nonGrammarBodyRow, idT)).toBe('Custom manual memo');

      // Body matches timesheet week grammar but metadata and title are not timesheet
      const mismatchEntityRow = {
        title: 'Document updated',
        body: 'Timesheet week of 2026-08-10',
        message_key: 'literal',
        message_params: { body: 'Timesheet week of 2026-08-10' },
        metadata: { entity: { type: 'project_document' } },
      };
      expect(notificationBody(mismatchEntityRow, idT)).toBe('Timesheet week of 2026-08-10');

      // Body matches QCR grammar but entity is not QCR
      const mismatchQcrRow = {
        title: 'Task assigned',
        body: 'A quantity change request has been submitted for your approval.',
        message_key: 'literal',
        message_params: { body: 'A quantity change request has been submitted for your approval.' },
        metadata: { entity: { type: 'task' } },
      };
      expect(notificationBody(mismatchQcrRow, idT)).toBe('A quantity change request has been submitted for your approval.');

      // Unknown row with no title and no metadata
      expect(notificationBody({ body: 'Timesheet week of 2026-08-10', message_key: 'literal', message_params: { body: 'Timesheet week of 2026-08-10' } }, idT)).toBe('Timesheet week of 2026-08-10');

      // Null body row (MRQ approved has null body in 1561)
      const mrqApprovedRow = {
        title: 'Your material request was approved',
        body: null,
        message_key: 'literal',
        message_params: { body: null },
        metadata: { entity: { type: 'material_request', id: 'mrq-uuid', label: 'MR-001' } },
      };
      expect(notificationBody(mrqApprovedRow, idT)).toBeNull();

      // Null body row (equipment plan approved has a null body and a record-code label in 1561:70-77)
      const equipmentApprovedRow = {
        title: 'Your equipment plan was approved',
        body: null,
        message_key: 'literal',
        message_params: { body: null },
        metadata: { entity: { type: 'equipment_plan', id: 'eqp-uuid', label: 'Riverside · 2026-12' } },
      };
      expect(notificationTitle(equipmentApprovedRow, idT)).toBe('Rencana peralatan Anda disetujui');
      expect(notificationBody(equipmentApprovedRow, idT)).toBeNull();

      // Null body in historical null-key row
      expect(notificationBody({ body: null, message_key: null, message_params: null }, idT)).toBeNull();

      // Unrecognized message key
      expect(notificationBody({ body: 'System maintenance scheduled', message_key: 'unrecognized_key', message_params: {} }, idT)).toBe('System maintenance scheduled');
    });

    it('catalogue keys exist and differ between English and Bahasa catalogues', () => {
      const checkKeys = ['timesheetWeek', 'qcrAwaitingBody', 'qcrApprovedBody', 'qcrReturnedBody', 'qcrClientAcceptedBody', 'qcrClientDeclinedBody'] as const;
      for (const key of checkKeys) {
        const enVal = (en as Record<string, unknown>)[key];
        const idVal = (id as Record<string, unknown>)[key];
        expect(typeof enVal).toBe('string');
        expect(typeof idVal).toBe('string');
        expect(idVal, `${key} must differ in Bahasa`).not.toBe(enVal);
      }
      // The exact template shape (not only the rendered output): the date/reason placeholder and the label words.
      expect(en.timesheetWeek).toBe('Timesheet week of {{date}}');
      expect(id.timesheetWeek).toBe('Timesheet minggu {{date}}');
    });
  });
});
