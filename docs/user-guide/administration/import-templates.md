# Load master data with import templates

Typing a hundred stock items, a rate catalogue or a crew list by hand is slow and easy to get wrong.
Wherever PMO offers an **Import** button, it also offers a spreadsheet template: download it, fill it,
upload it, and PMO checks every row before it saves anything. Rows that fail are listed in a file you
can correct and upload again.

**Who can do this:** the import button appears only for a role that may create that kind of record —
an Admin, Project Manager, Finance or Executive, depending on the list. If you do not see the
button, your role may read the list but not add to it.

## Where to find it

Each list carries its own **Import** button:

- **Projects** — **Import** for projects, **Import budgets** for budget lines.
- **A project → Contract (Billing)** — **Import lines** for contract lines, the rate catalogue import
  under **Rate catalogue**, and the work-order import.
- **Stock → Setup** — **Import** on the **Items** and **Warehouses** tabs.
- **Stock → Setup → Opening stock** — the opening stock movement template.
- **Equipment → Assets** — **Import**.
- **Administration → People** — **Import people**; a person's own page imports their documents.
- **Crews** — **Import crews** and **Import crew members**.
- **Companies** and **Contacts** — **Import**.

## Steps

1. Open the list you want to fill and choose **Import**.
2. **Download template** and open it. Each template has one sheet of column headers, a second sheet
   explaining each field, and the accepted values for lists such as a kind or a status. Read the
   notes sheet before typing.
3. Fill one record per row. Leave a column blank when the notes say it is optional — do not invent a
   value.
4. Save as `.xlsx`. The first row must stay as the header row, and a file holds up to the row count
   the wizard states.
5. Choose the file with **Choose an .xlsx file**. (If the list offers it, you can also **paste rows
   copied from a spreadsheet**, header row included, and use **Use pasted rows**.)
6. On **Match columns**, confirm which column of your file feeds each field. PMO guesses from the
   headers; correct anything it guessed wrongly.
7. On **Review before importing**, read the counts and fix anything flagged. Invalid rows are
   skipped, so only valid rows are imported.
8. Choose **Import**. The final step says how many records were created, and how many were skipped
   because they were already there.
9. If anything did not import, choose **Download rows not imported**. That file holds your original
   rows plus **Row in your file** and **Why not imported**, so you can correct them and upload the
   same file again.

## What the result looks like

- The list updates with the imported records, each created exactly as a hand-typed one would be.
- The result step reports **created**, **skipped because already imported**, **skipped for errors** and
  **failed** counts separately, so a partly good file is never mistaken for a clean one.
- Rows left out because the record already exists are listed on their own sheet (**Already there**),
  apart from genuine failures.
- A fixed row can be re-uploaded: the two extra columns in the download match no field, so the
  column matching step ignores them.

## Common errors and what to do

- **"Upload an .xlsx file"** — the wizard takes a spreadsheet, not a CSV or a PDF. Save your sheet as
  `.xlsx` from the template.
- **A required column is not matched** — on **Match columns**, choose the column that holds it. A
  field marked required cannot be left unmatched.
- **Rows skipped for errors** — open **Download rows not imported**; the **Why not imported** column
  names the problem on each row.
- **"Already imported"** — the record exists already; imports do not overwrite. Edit the existing
  record instead.
- **A code the file refers to is refused** — a reference such as a unit code, project code or crew
  code must exist already. Add the reference first, then import the rows again.
- **The file is rejected for size** — split it into files within the row count the wizard states.
- **Nothing was imported, though the file looked right** — the column headers must stay on row one.
  A title row above them makes every column unmatchable.

---

## Bahasa Indonesia

# Memuat data induk dengan templat impor

Mengetik seratus barang stok, katalog tarif, atau daftar kru dengan tangan itu lambat dan mudah salah.
Di setiap tempat PMO menawarkan tombol **Impor**, ia juga menawarkan templat spreadsheet: unduh, isi,
unggah, dan PMO memeriksa setiap baris sebelum menyimpan apa pun. Baris yang gagal didaftar dalam
berkas yang dapat Anda betulkan lalu unggah lagi.

**Siapa yang bisa melakukannya:** tombol impor hanya muncul untuk peran yang boleh membuat jenis
catatan itu — Admin, Manajer Proyek, Finance, atau Eksekutif, tergantung daftarnya. Bila tombolnya
tidak terlihat, peran Anda boleh membaca daftar tetapi tidak boleh menambah.

## Di mana menemukannya

Setiap daftar membawa tombol **Impor**-nya sendiri:

- **Proyek** — **Impor** untuk proyek, **Impor anggaran** untuk baris anggaran.
- **Sebuah proyek → Kontrak (Penagihan)** — **Impor baris** untuk baris kontrak, impor katalog tarif
  di bagian **Katalog tarif**, dan impor perintah kerja.
- **Stok → Pengaturan** — **Impor** pada tab **Barang** dan **Gudang**.
- **Stok → Pengaturan → Stok awal** — templat pergerakan stok awal.
- **Peralatan → Aset** — **Impor**.
- **Administrasi → Orang** — **Impor orang**; halaman orangnya sendiri mengimpor dokumennya.
- **Kru** — **Impor kru** dan **Impor anggota kru**.
- **Perusahaan** dan **Kontak** — **Impor**.

## Langkah-langkah

1. Buka daftar yang ingin diisi dan pilih **Impor**.
2. **Unduh templat** lalu buka. Setiap templat punya satu lembar berisi judul kolom, satu lembar
   penjelasan tiap kolom, dan nilai yang diterima untuk daftar seperti jenis atau status. Baca lembar
   catatan sebelum mengetik.
3. Isi satu catatan per baris. Kosongkan kolom yang menurut catatan opsional — jangan mengarang nilai.
4. Simpan sebagai `.xlsx`. Baris pertama harus tetap baris judul, dan satu berkas memuat sampai jumlah
   baris yang disebut wizard.
5. Pilih berkasnya dengan **Pilih berkas .xlsx**. (Bila daftarnya menawarkan, Anda juga dapat
   **menempel baris yang disalin dari spreadsheet**, termasuk baris judul, lalu pilih **Pakai baris
   yang ditempel**.)
6. Di **Cocokkan kolom**, pastikan kolom mana di berkas Anda mengisi tiap kolom isian. PMO menebaknya
   dari judul kolom; betulkan yang salah tebak.
7. Di **Tinjau sebelum mengimpor**, baca jumlahnya dan betulkan yang ditandai. Baris tidak valid
   dilewati, jadi hanya baris valid yang diimpor.
8. Pilih **Impor**. Langkah akhir menyebut berapa catatan dibuat, dan berapa yang dilewati karena
   sudah ada.
9. Bila ada yang tidak terimpor, pilih **Unduh baris yang tidak terimpor**. Berkas itu memuat baris
   asli Anda ditambah **Baris di berkas Anda** dan **Alasan tidak terimpor**, sehingga Anda dapat
   membetulkannya dan mengunggah berkas yang sama lagi.

## Hasilnya seperti apa

- Daftar diperbarui dengan catatan yang diimpor, masing-masing dibuat persis seperti yang diketik
  tangan.
- Langkah hasil melaporkan jumlah **dibuat**, **dilewati karena sudah diimpor**, **dilewati karena
  kesalahan**, dan **gagal** secara terpisah, sehingga berkas yang sebagian benar tidak pernah
  disangka bersih.
- Baris yang dilewati karena catatannya sudah ada didaftar pada lembarnya sendiri (**Sudah ada**),
  terpisah dari kegagalan sungguhan.
- Baris yang sudah dibetulkan dapat diunggah lagi: dua kolom tambahan pada unduhan tidak cocok dengan
  kolom isian mana pun, jadi langkah pencocokan mengabaikannya.

## Kesalahan umum dan cara mengatasinya

- **"Unggah berkas .xlsx"** — wizard menerima spreadsheet, bukan CSV atau PDF. Simpan lembar Anda
  sebagai `.xlsx` dari templatnya.
- **Kolom wajib tidak tercocokkan** — di **Cocokkan kolom**, pilih kolom yang memuatnya. Kolom isian
  yang wajib tidak boleh dibiarkan tidak tercocokkan.
- **Baris dilewati karena kesalahan** — buka **Unduh baris yang tidak terimpor**; kolom **Alasan tidak
  terimpor** menyebut masalahnya di tiap baris.
- **"Sudah diimpor"** — catatannya sudah ada; impor tidak menimpa. Ubah catatan yang sudah ada.
- **Kode yang dirujuk berkas ditolak** — rujukan seperti kode satuan, kode proyek, atau kode kru harus
  sudah ada. Tambahkan rujukannya dulu, lalu impor barisnya lagi.
- **Berkas ditolak karena ukuran** — bagi menjadi beberapa berkas sesuai jumlah baris yang disebut
  wizard.
- **Tidak ada yang terimpor, padahal berkasnya tampak benar** — judul kolom harus tetap di baris
  pertama. Baris judul tambahan di atasnya membuat semua kolom tidak dapat dicocokkan.
