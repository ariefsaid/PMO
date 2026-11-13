/**
 * Fan-out round 1 (11-13) — the strings other agents handed to the locale owner.
 *
 * Every new visible string in round 1 travels the same way: the call site is
 * `t('<ns>.<key>', '<English default>')` and the English + Indonesian values are handed to A10 in
 * `fanout/strings/<agent>.md`. The two catalogue gates prove presence and non-emptiness, but they
 * cannot prove the catalogue holds THE STRING THE CALL SITE PASSES — a default that drifts from the
 * catalogue is invisible in a test without resources and visible to users as stale copy (that is
 * `check-i18n-completeness.mjs`'s DEFAULT DRIFT finding, which only runs on launch-scope files).
 *
 * So this suite pins the handoff itself: for each handed-in string, en holds the exact English the
 * agent wrote and id holds a real translation. A key that goes missing, or an id value copied from
 * English, fails here at the handoff point rather than at the next launch-scope sweep.
 *
 * Source of each row: docs/private/ux-1110/fanout/strings/{A5,A6,A9}.md (round 1), plus the
 * `update.empty` leftover from the c4 merge (`src/auth/UpdatePasswordPage.tsx`, whose call line the
 * orchestrator changes in round 2 — src/auth is out of scope for agents).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Handoff = [namespace: string, key: string, english: string, indonesian: string];

/** A5 — stock screens (C1/C5/C13 rows, documents order, the Stock on hand moves). */
const A5: Handoff[] = [
  ['stock', 'onHand.count', '{{shown}} balances', '{{shown}} saldo'],
  ['stock', 'onHand.countOne', '1 balance', '1 saldo'],
  ['stock', 'onHand.countOfTotal', 'Showing {{shown}} of {{total}} balances', 'Menampilkan {{shown}} dari {{total}} saldo'],
  ['stock', 'detail.overAllowanceFailed', 'Could not check whether this issue is over its work-item allowance.', 'Tidak dapat memeriksa apakah pengeluaran ini melebihi batas item pekerjaannya.'],
  ['stock', 'detail.costsFailed', "Couldn't load the line costs", 'Gagal memuat biaya per baris'],
  ['stock', 'documents.loadMoreFailed', "Couldn't load more documents", 'Gagal memuat dokumen berikutnya'],
  ['stock', 'ledger.loadMoreFailed', "Couldn't load more entries", 'Gagal memuat entri berikutnya'],
  ['stock', 'ledger.filters.dateHelp', 'From and To filter the movement date (the Date column), not when the entry was posted.', 'Dari dan Sampai menyaring tanggal pergerakan (kolom Tanggal), bukan waktu pencatatannya.'],
  ['stock', 'reorder.panel.suggestionFailed', "Couldn't load the reorder suggestion", 'Gagal memuat saran pemesanan ulang'],
];

/** A6 — C1 error anatomy in Administration/integrations, the C13 exchange-rate row. */
const A6: Handoff[] = [
  ['common', 'fx.setBy', 'Set by', 'Diubah oleh'],
  ['common', 'fx.lastChange', 'Last change', 'Perubahan terakhir'],
  ['common', 'fx.actorNotRecorded', 'Not recorded', 'Tidak tercatat'],
  ['common', 'fx.actorResolving', 'Loading the name…', 'Memuat nama…'],
  ['common', 'fx.actorDirectoryError', "Couldn't read the people who changed these rates", 'Tidak bisa membaca orang yang mengubah kurs ini'],
  ['common', 'fx.actorDirectoryErrorSub', 'Each rate still shows the day it changed; the person is not named until this read succeeds.', 'Setiap kurs tetap menampilkan hari perubahannya; nama orang muncul setelah pembacaan ini berhasil.'],
  ['common', 'uxs10.proposalRetry', 'Try again', 'Coba lagi'],
  ['common', 'admin.expenseMap.error.noCauseRemedy', 'The account was not saved. Your entry is kept; try again.', 'Akun tidak tersimpan. Isian Anda tetap ada; coba lagi.'],
  ['common', 'uxs32.peopleLoadError', "Couldn't read the people this screen checks", 'Tidak bisa membaca daftar orang yang diperiksa layar ini'],
  ['common', 'uxs32.peopleLoadErrorSub', 'Who can approve now could not be verified. The approver lists below are unaffected.', 'Siapa yang bisa menyetujui sekarang tidak dapat diverifikasi. Daftar penyetuju di bawah tidak terpengaruh.'],
  ['common', 'admin.spendApprovers.form.projectLoadError', "Couldn't load the projects", 'Tidak bisa memuat daftar proyek'],
  ['common', 'export.failed', 'Could not complete the export. Try again.', 'Ekspor tidak dapat diselesaikan. Coba lagi.'],
  ['administration', 'odoo.warehouse.savedReadError', "Couldn't read the saved default warehouse", 'Tidak bisa membaca gudang default yang tersimpan'],
  ['administration', 'odoo.warehouse.savedReadErrorSub', 'The default is still saved. Retry to see whether Odoo archived or deleted it.', 'Gudang default masih tersimpan. Coba lagi untuk melihat apakah Odoo mengarsipkan atau menghapusnya.'],
];

/** A9 — people and time: C5/C13 rows, C11 NotFound, form B in the tasks toolbar. */
const A9: Handoff[] = [
  ['calendar', 'phasesUnavailable', 'Phases could not be loaded, so this calendar is missing them. Tasks are still shown.', 'Fase tidak dapat dimuat, sehingga kalender ini tidak menampilkannya. Tugas tetap ditampilkan.'],
  ['calendar', 'retry', 'Retry', 'Coba lagi'],
  ['calendar', 'undatedNotice', "Only work with a date appears here. Tasks with no due date are not on the calendar — they stay on their project's task list.", 'Hanya pekerjaan bertanggal yang tampil di sini. Tugas tanpa tenggat tidak ada di kalender — tugas itu tetap ada di daftar tugas proyeknya.'],
  ['calendar', 'overdue', 'Overdue', 'Terlambat'],
  ['meetings', 'actions.archiveRestricted', 'Archive — author or Admin only', 'Arsipkan — hanya penulis atau Admin'],
  ['common', 'contactDetail.pill.archived', 'Archived', 'Diarsipkan'],
  ['common', 'myTasks.archived', 'Archived', 'Diarsipkan'],
  ['common', 'myTasks.priority.urgent', 'Priority: Urgent', 'Prioritas: Mendesak'],
  ['common', 'myTasks.priority.high', 'Priority: High', 'Prioritas: Tinggi'],
  ['common', 'myTasks.priority.normal', 'Priority: Normal', 'Prioritas: Normal'],
  ['common', 'myTasks.priority.low', 'Priority: Low', 'Prioritas: Rendah'],
  ['common', 'financeCopy.owner', 'Owner', 'Pemilik'],
  ['common', 'financeCopy.ownerYou', 'You', 'Anda'],
  ['common', 'financeCopy.ownerTeammate', 'A teammate', 'Rekan tim'],
  ['common', 'financeCopy.sharedWithOrg', 'shared with the organisation', 'dibagikan ke organisasi'],
  ['common', 'notFound.region', 'Page not found', 'Halaman tidak ditemukan'],
  ['common', 'notFound.title', 'Page not found', 'Halaman tidak ditemukan'],
  ['common', 'notFound.body', "The page you're looking for doesn't exist or has been moved.", 'Halaman yang Anda cari tidak ada atau sudah dipindahkan.'],
  ['common', 'notFound.back', 'Back to Dashboard', 'Kembali ke Dasbor'],
];

/** The c4 merge leftover: the literal in UpdatePasswordPage.tsx becomes `update.empty`. */
const C4_LEFTOVER: Handoff[] = [
  ['auth', 'update.empty', 'Enter a password to continue.', 'Masukkan kata sandi untuk melanjutkan.'],
];

const HANDOFF: Handoff[] = [...A5, ...A6, ...A9, ...C4_LEFTOVER];

const catalogue = (locale: 'en' | 'id', namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public/locales', locale, `${namespace}.json`), 'utf8')) as Record<string, unknown>;

const namespaces = [...new Set(HANDOFF.map(([namespace]) => namespace))];
const catalogues = {
  en: Object.fromEntries(namespaces.map((namespace) => [namespace, catalogue('en', namespace)])),
  id: Object.fromEntries(namespaces.map((namespace) => [namespace, catalogue('id', namespace)])),
};

function valueIn(tree: Record<string, unknown>, key: string): unknown {
  let current: unknown = tree;
  for (const part of key.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe('fan-out round 1 handoff strings (A5, A6, A9 + the c4 update.empty leftover)', () => {
  it.each(HANDOFF)('%s:%s holds the English the call site passes', (namespace, key, english) => {
    expect(valueIn(catalogues.en[namespace], key)).toBe(english);
  });

  it.each(HANDOFF)('%s:%s holds a real Indonesian value', (namespace, key, english, indonesian) => {
    const value = valueIn(catalogues.id[namespace], key);
    expect(value, `${namespace}:${key} is missing from the id catalogue`).toBe(indonesian);
    expect(value, `${namespace}:${key} reads English in the id catalogue`).not.toBe(english);
    expect(String(value).trim().length).toBeGreaterThan(0);
  });

  it('every handed-in key names a namespace the app ships', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/i18n/index.ts'), 'utf8');
    const literal = /export const NAMESPACES = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    const shipped = new Set((literal.match(/'[a-zA-Z]+'/g) ?? []).map((match) => match.slice(1, -1)));
    expect(shipped.size).toBeGreaterThan(0);
    for (const [namespace] of HANDOFF) expect(shipped, namespace).toContain(namespace);
  });
});
