import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { waitingForText, waitingRoleLabel } from './waitingFor';
import enWaitingList from '../../../public/locales/en/waitingList.json';
import idWaitingList from '../../../public/locales/id/waitingList.json';

const t = i18next.createInstance();
await t.init({
  lng: 'en',
  ns: ['waitingList'],
  defaultNS: 'waitingList',
  resources: {
    en: { waitingList: enWaitingList },
    id: { waitingList: idWaitingList },
  },
  interpolation: { escapeValue: false },
});

describe('fix-waiting item 3: a waiting record names who it waits for', () => {
  describe('AC-WAIT-031..035: backward compatible old inputs', () => {
    it('AC-WAIT-031 names the person, their role and the step', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: ['Ani'], role: 'Finance', step: { n: 1, of: 2 } }, t.t)).toBe('Waiting for Ani, Finance (step 1 of 2)');
    });

    it('AC-WAIT-032 several people who can decide are joined with "or"', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: ['Ani', 'Budi'], role: 'Finance' }, t.t)).toBe('Waiting for Ani or Budi, Finance');
    });

    it('AC-WAIT-033 a role with nobody named, and a single decision, omit what is not known', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [], role: 'Project Manager', step: { n: 1, of: 1 } }, t.t)).toBe('Waiting for Project Manager');
    });

    it('AC-WAIT-034 nothing known falls back to the plain sentence', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [] }, t.t)).toBe('Waiting for approval');
      expect(waitingForText({ names: ['  '] }, t.t)).toBe('Waiting for approval');
    });

    it('AC-WAIT-035 the same sentence is worded in Bahasa Indonesia', async () => {
      await t.changeLanguage('id');
      expect(waitingForText({ names: ['Ani'], role: 'Finance', step: { n: 1, of: 2 } }, t.t)).toBe('Menunggu Ani, Finance (langkah 1 dari 2)');
      expect(waitingForText({ names: [] }, t.t)).toBe('Menunggu persetujuan');
    });
  });

  describe('role-only inputs with real catalogue keys', () => {
    it('formats roleFinanceAdmin in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t.t) }, t.t)).toBe('Waiting for Finance or Admin');
      await t.changeLanguage('id');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleFinanceAdmin', t.t) }, t.t)).toBe('Menunggu Keuangan atau Admin');
    });

    it('formats roleFinanceExecAdmin in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t.t) }, t.t)).toBe('Waiting for Finance, Executive, or Admin');
      await t.changeLanguage('id');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleFinanceExecAdmin', t.t) }, t.t)).toBe('Menunggu Keuangan, Eksekutif, atau Admin');
    });

    it('formats roleApprovalRank including all four roles in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleApprovalRank', t.t) }, t.t)).toBe('Waiting for Project Manager, Finance, Executive, or Admin');
      await t.changeLanguage('id');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleApprovalRank', t.t) }, t.t)).toBe('Menunggu Manajer Proyek, Keuangan, Eksekutif, atau Admin');
    });

    it('formats roleManager in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleManager', t.t) }, t.t)).toBe('Waiting for line manager');
      await t.changeLanguage('id');
      expect(waitingForText({ names: [], role: waitingRoleLabel('roleManager', t.t) }, t.t)).toBe('Menunggu atasan langsung');
    });
  });

  describe('named role inputs', () => {
    it('formats named person and roleManager in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: ['Ani'], role: waitingRoleLabel('roleManager', t.t) }, t.t)).toBe('Waiting for Ani, line manager');
      await t.changeLanguage('id');
      expect(waitingForText({ names: ['Ani'], role: waitingRoleLabel('roleManager', t.t) }, t.t)).toBe('Menunggu Ani, atasan langsung');
    });

    it('formats named person and roleProject in English and Indonesian', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({ names: ['Budi'], role: waitingRoleLabel('roleProject', t.t) }, t.t)).toBe('Waiting for Budi, project approver');
      await t.changeLanguage('id');
      expect(waitingForText({ names: ['Budi'], role: waitingRoleLabel('roleProject', t.t) }, t.t)).toBe('Menunggu Budi, penyetuju proyek');
    });
  });

  describe('names primary plus alternative roles', () => {
    it('formats named manager with alternative Admin role without mislabeling manager as Admin', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Ani'],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
      }, t.t)).toBe('Waiting for Ani, line manager or Admin');

      await t.changeLanguage('id');
      expect(waitingForText({
        names: ['Ani'],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
      }, t.t)).toBe('Menunggu Ani, atasan langsung atau Admin');
    });

    it('formats named project approver with alternative Finance or Admin roles', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Budi'],
        role: waitingRoleLabel('roleProject', t.t),
        alternativeRoles: [waitingRoleLabel('roleFinanceAdmin', t.t)],
      }, t.t)).toBe('Waiting for Budi, project approver or Finance or Admin');

      await t.changeLanguage('id');
      expect(waitingForText({
        names: ['Budi'],
        role: waitingRoleLabel('roleProject', t.t),
        alternativeRoles: [waitingRoleLabel('roleFinanceAdmin', t.t)],
      }, t.t)).toBe('Menunggu Budi, penyetuju proyek atau Keuangan atau Admin');
    });

    it('formats unnamed primary role with alternative role', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: [],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
      }, t.t)).toBe('Waiting for line manager or Admin');

      await t.changeLanguage('id');
      expect(waitingForText({
        names: [],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
      }, t.t)).toBe('Menunggu atasan langsung atau Admin');
    });
  });

  describe('blank and deduplication handling (no extras)', () => {
    it('deduplicates alternative roles matching primary role or repeated in alternatives', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Ani'],
        role: 'Finance',
        alternativeRoles: ['Finance', 'Finance', '  '],
      }, t.t)).toBe('Waiting for Ani, Finance');

      expect(waitingForText({
        names: [],
        role: 'Admin',
        alternativeRoles: ['Admin', '  '],
      }, t.t)).toBe('Waiting for Admin');
    });

    it('falls back to plain sentence when all names, role, and alternatives are blank', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['  ', ''],
        role: '  ',
        alternativeRoles: ['  ', ''],
      }, t.t)).toBe('Waiting for approval');

      await t.changeLanguage('id');
      expect(waitingForText({
        names: ['  ', ''],
        role: '  ',
        alternativeRoles: ['  ', ''],
      }, t.t)).toBe('Menunggu persetujuan');
    });

    it('handles empty alternativeRoles array cleanly', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Ani'],
        role: 'Finance',
        alternativeRoles: [],
      }, t.t)).toBe('Waiting for Ani, Finance');
    });
  });

  describe('step formatting with alternative roles', () => {
    it('formats step count when step.of > 1 with primary and alternative roles', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Ani'],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
        step: { n: 1, of: 2 },
      }, t.t)).toBe('Waiting for Ani, line manager or Admin (step 1 of 2)');

      await t.changeLanguage('id');
      expect(waitingForText({
        names: ['Ani'],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
        step: { n: 1, of: 2 },
      }, t.t)).toBe('Menunggu Ani, atasan langsung atau Admin (langkah 1 dari 2)');
    });

    it('omits step count when step.of <= 1 (single decision)', async () => {
      await t.changeLanguage('en');
      expect(waitingForText({
        names: ['Ani'],
        role: waitingRoleLabel('roleManager', t.t),
        alternativeRoles: [waitingRoleLabel('roleAdmin', t.t)],
        step: { n: 1, of: 1 },
      }, t.t)).toBe('Waiting for Ani, line manager or Admin');
    });
  });
});
