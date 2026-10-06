import { en } from '@blocknote/core/locales';

/**
 * BlockNote's UI dictionary for the minutes editor, per app locale (FR-MTG-023, DD-I18N-1).
 * BlockNote ships no Bahasa Indonesia dictionary, so `id` is this file: the en dictionary with every
 * string the minutes palette and toolbars can show translated, slash-menu ALIASES included (an author
 * typing in Bahasa will not type `/heading`; the English aliases stay too, so muscle memory keeps working).
 * The action-item slash entry and every other app string live in `common.json`, not here.
 */
type Dict = typeof en;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends (...a: never[]) => unknown ? T[K] : DeepPartial<T[K]> };

const item = (title: string, subtext: string, group: string, aliases: string[]) => ({
  title,
  subtext,
  group,
  aliases,
});

const idOverrides: DeepPartial<Dict> = {
  slash_menu: {
    heading: item('Judul 1', 'Judul tingkat atas', 'Judul', ['judul', 'judul1', 'h1']),
    heading_2: item('Judul 2', 'Judul bagian utama', 'Judul', ['judul2', 'subjudul', 'h2']),
    heading_3: item('Judul 3', 'Judul sub-bagian', 'Judul', ['judul3', 'subjudul', 'h3']),
    heading_4: item('Judul 4', 'Judul sub-bagian kecil', 'Sub-judul', ['judul4', 'h4']),
    heading_5: item('Judul 5', 'Judul sub-bagian kecil sekali', 'Sub-judul', ['judul5', 'h5']),
    heading_6: item('Judul 6', 'Judul tingkat terendah', 'Sub-judul', ['judul6', 'h6']),
    toggle_heading: item('Judul Lipat 1', 'Judul tingkat atas yang bisa dilipat', 'Sub-judul', ['judul', 'lipat']),
    toggle_heading_2: item('Judul Lipat 2', 'Judul bagian utama yang bisa dilipat', 'Sub-judul', ['judul2', 'lipat']),
    toggle_heading_3: item('Judul Lipat 3', 'Judul sub-bagian yang bisa dilipat', 'Sub-judul', ['judul3', 'lipat']),
    quote: item('Kutipan', 'Kutipan atau cuplikan', 'Blok dasar', ['kutipan', 'kutip']),
    toggle_list: item('Daftar Lipat', 'Daftar dengan butir yang bisa disembunyikan', 'Blok dasar', ['daftar', 'lipat']),
    numbered_list: item('Daftar Bernomor', 'Daftar berurutan', 'Blok dasar', ['daftar', 'nomor', 'bernomor']),
    bullet_list: item('Daftar Poin', 'Daftar tanpa urutan', 'Blok dasar', ['daftar', 'poin', 'butir']),
    paragraph: item('Paragraf', 'Isi dokumen', 'Blok dasar', ['paragraf', 'teks']),
    code_block: item('Blok Kode', 'Blok kode dengan penyorotan sintaks', 'Blok dasar', ['kode']),
    page_break: item('Pemisah Halaman', 'Pemisah halaman', 'Blok dasar', ['halaman', 'pemisah']),
    table: item('Tabel', 'Tabel dengan sel yang dapat diedit', 'Lanjutan', ['tabel']),
    emoji: item('Emoji', 'Cari dan sisipkan emoji', 'Lainnya', ['emoji']),
    divider: item('Pembatas', 'Pisahkan blok secara visual', 'Blok dasar', ['pembatas', 'garis', 'pemisah']),
  },
  placeholders: { default: "Ketik teks atau '/' untuk perintah" },
  toggle_blocks: { add_block_button: 'Lipatan kosong. Klik untuk menambah blok.' },
  code_block: { add_source_button_text: 'Tambah kode sumber', ok_button_text: 'OK' },
  side_menu: { add_block_label: 'Tambah blok', drag_handle_label: 'Buka menu blok' },
  drag_handle: {
    delete_menuitem: 'Hapus',
    colors_menuitem: 'Warna',
    header_row_menuitem: 'Baris judul',
    header_column_menuitem: 'Kolom judul',
  },
  table_handle: {
    delete_column_menuitem: 'Hapus kolom',
    delete_row_menuitem: 'Hapus baris',
    add_left_menuitem: 'Tambah kolom di kiri',
    add_right_menuitem: 'Tambah kolom di kanan',
    add_above_menuitem: 'Tambah baris di atas',
    add_below_menuitem: 'Tambah baris di bawah',
    split_cell_menuitem: 'Pisahkan sel',
    merge_cells_menuitem: 'Gabungkan sel',
    background_color_menuitem: 'Warna latar',
  },
  suggestion_menu: { no_items_title: 'Tidak ada item' },
  color_picker: {
    text_title: 'Teks',
    background_title: 'Latar',
    colors: {
      default: 'Otomatis',
      gray: 'Abu-abu',
      brown: 'Cokelat',
      red: 'Merah',
      orange: 'Oranye',
      yellow: 'Kuning',
      green: 'Hijau',
      blue: 'Biru',
      purple: 'Ungu',
      pink: 'Merah muda',
    },
  },
  formatting_toolbar: {
    bold: { tooltip: 'Tebal' },
    italic: { tooltip: 'Miring' },
    underline: { tooltip: 'Garis bawah' },
    strike: { tooltip: 'Coret' },
    code: { tooltip: 'Kode' },
    colors: { tooltip: 'Warna' },
    link: { tooltip: 'Buat tautan' },
    nest: { tooltip: 'Masukkan blok' },
    unnest: { tooltip: 'Keluarkan blok' },
    align_left: { tooltip: 'Rata kiri' },
    align_center: { tooltip: 'Rata tengah' },
    align_right: { tooltip: 'Rata kanan' },
    align_justify: { tooltip: 'Rata kiri-kanan' },
    table_cell_merge: { tooltip: 'Gabungkan sel' },
  },
  link_toolbar: {
    delete: { tooltip: 'Hapus tautan' },
    edit: { text: 'Ubah tautan', tooltip: 'Ubah' },
    open: { tooltip: 'Buka di tab baru' },
    form: { title_placeholder: 'Ubah judul', url_placeholder: 'Ubah URL' },
  },
};

const isPlain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function merge<T>(base: T, over: unknown): T {
  if (!isPlain(base) || !isPlain(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over)) out[k] = merge((base as Record<string, unknown>)[k], over[k]);
  return out as T;
}

/**
 * BlockNote paints a per-block-type placeholder ("List", "Heading", "Toggle"…) on EVERY empty block of that
 * type — focused or not, and in a read-only view too. Only `default` (the focused empty block) and
 * `emptyDocument` are focus-scoped, so those are the only ones the minutes editor keeps.
 */
const focusScoped = (d: Dict): Dict => ({
  ...d,
  placeholders: { default: d.placeholders.default, emptyDocument: d.placeholders.emptyDocument },
});

/** The BlockNote dictionary for an app language code (`id…` → Bahasa, anything else → en). */
export function minutesDictionary(language: string | undefined): Dict {
  return focusScoped(language?.toLowerCase().startsWith('id') ? merge(en, idOverrides) : en);
}

/**
 * Slash-menu keys a v1 palette shows. Media is excluded by the schema (FR-MTG-022); the check list is
 * withheld (DD-MTG-10) — it looks like a to-do but never becomes a task.
 */
export const PALETTE_SLASH_KEYS = (Object.keys(en.slash_menu) as Array<keyof Dict['slash_menu']>).filter(
  (k) => !['image', 'video', 'audio', 'file', 'check_list'].includes(k),
);
