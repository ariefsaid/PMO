# Load opening stock

## What this is for

Opening stock is how a new organisation starts its stock book: one file of the dated in-and-out
movements of each item at each location, loaded once, so the ledger begins from real history instead
of from a blank page. Nothing is posted until you have seen the preview and confirmed it.

**Who can do this:** an Admin. Other roles can open the page and read what it says, but cannot load
stock.

## Where to find it

**Stock → Setup**, then the **Opening stock** link under the page title. On a phone the same link
sits at the top of the stock setup page.

## Steps

1. Open **Stock → Setup** and choose **Opening stock**.
2. Choose the **Go-live date** — the last day of your old records. No movement may be dated after it.
3. Download the template with **Download template**. It uses one sheet, with these columns:
   **Date**, **Location**, **Item**, **Direction**, **Quantity**, **Unit cost**, **Reference**.
   - **Date** — the day the stock moved, written `YYYY-MM-DD`.
   - **Location** — the code of an existing stock location.
   - **Item** — the code of an existing stock item.
   - **Direction** — `in` (received, returned or found) or `out` (issued, used or returned to the
     supplier).
   - **Quantity** — above 0, up to 3 decimals. Whole numbers only for items counted in whole units.
   - **Unit cost** — on an `in` row only, 0 or more. Leave it blank for client-supplied items.
   - **Reference** — optional; a delivery note, site report or other paper number.
4. Fill the sheet and save it as `.xlsx`. Choose it with **Choose file**.
5. The page shows the file's row count and lists any row it cannot read, with the row number and the
   column at fault. Fix those rows in your file and choose it again.
6. Read the **Preview**. It lists every row it accepted and refused, then a **Closing balance** per
   location and item — the quantity and value the ledger will start from. Client-supplied items show
   as **Client-supplied** instead of a value.
7. When the preview is clean, choose **Confirm opening stock**.
8. The page confirms **Opening stock loaded** and offers **Open the stock ledger**.

## What the result looks like

- The stock ledger holds the loaded movements, dated as your file dated them, each with its document
  and its reference. Balances at each location start from the last row for that item.
- **Stock → On hand** shows the closing quantities and values.
- Opening stock can be loaded once. Later corrections are ordinary counts and adjustments, not
  another opening load.

## Common errors and what to do

- **"An Admin loads opening stock."** — your role cannot load it. Ask an Admin.
- **"Choose the go-live date first." / "Choose the file first."** — set both before confirming.
- **"This file could not be read. Use the template, saved as .xlsx."** — the file is not a readable
  spreadsheet. Save it from the template as `.xlsx` and choose it again.
- **"The file has no … column. Use the template."** — a required column header is missing or renamed.
  Use the downloaded template's header row unchanged.
- **"Use a day written as YYYY-MM-DD…"** — correct that row's date.
- **"Write the code of an existing stock location." / "… of the stock item."** — the code does not
  exist yet or is misspelled. Add the item or location under **Stock → Setup** first, or correct the
  code.
- **Rows refused because a movement is dated after the go-live date** — move the date to the go-live
  date or earlier, or choose a later go-live date.
- **"Fix the … refused rows in your file, then choose it again."** — the preview refused rows, so
  nothing is posted. Correct them and reload; a partly right file is never posted.
- **"A file holds 1 to 5000 rows. Split it by location."** — split the sheet into files of at most
  5000 rows.

---

## Bahasa Indonesia

# Memuat stok awal

## Untuk apa ini

Stok awal adalah cara organisasi baru memulai buku stoknya: satu berkas berisi pergerakan masuk dan
keluar setiap barang di setiap lokasi beserta tanggalnya, dimuat sekali, sehingga buku stok dimulai
dari riwayat nyata, bukan dari halaman kosong. Tidak ada yang dicatat sebelum Anda melihat pratinjau
dan mengonfirmasinya.

**Siapa yang bisa melakukannya:** Admin. Peran lain dapat membuka halamannya dan membaca
keterangannya, tetapi tidak dapat memuat stok.

## Di mana menemukannya

**Stok → Pengaturan**, lalu tautan **Stok awal** di bawah judul halaman.

## Langkah-langkah

1. Buka **Stok → Pengaturan** dan pilih **Stok awal**.
2. Pilih **Tanggal mulai pakai** — hari terakhir catatan lama Anda. Tidak boleh ada pergerakan
   bertanggal setelahnya.
3. Unduh templatnya dengan **Unduh templat**. Templat memakai satu lembar dengan kolom **Tanggal**,
   **Lokasi**, **Barang**, **Arah**, **Jumlah**, **Biaya satuan**, **Referensi**.
   - **Tanggal** — hari stok bergerak, ditulis `YYYY-MM-DD`.
   - **Lokasi** — kode lokasi stok yang sudah ada.
   - **Barang** — kode barang stok yang sudah ada.
   - **Arah** — `masuk` (diterima, dikembalikan, atau ditemukan) atau `keluar` (dikeluarkan,
     dipakai, atau dikembalikan ke pemasok).
   - **Jumlah** — di atas 0, maksimal 3 desimal. Hanya bilangan bulat untuk barang yang dihitung
     utuh.
   - **Biaya satuan** — hanya pada baris `masuk`, 0 atau lebih. Kosongkan untuk barang titipan klien.
   - **Referensi** — opsional; nomor surat jalan, laporan lokasi, atau dokumen lain.
4. Isi lembar dan simpan sebagai `.xlsx`. Pilih dengan **Pilih berkas**.
5. Halaman menampilkan jumlah baris berkas dan mendaftar baris yang tidak dapat dibaca, beserta nomor
   baris dan kolom yang bermasalah. Perbaiki baris itu di berkas Anda lalu pilih lagi.
6. Baca **Pratinjau**. Ia mendaftar setiap baris yang diterima dan ditolak, lalu **Sisa akhir** per
   lokasi dan barang — jumlah dan nilai yang menjadi titik awal buku stok. Barang titipan klien
   tampil sebagai **Dipasok klien**, bukan nilai.
7. Setelah pratinjau bersih, pilih **Konfirmasi stok awal**.
8. Halaman menegaskan **Stok awal dimuat** dan menawarkan **Buka buku besar stok**.

## Hasilnya seperti apa

- Buku stok memuat pergerakan yang dimuat, bertanggal sesuai berkas Anda, masing-masing dengan
  dokumen dan referensinya. Sisa di setiap lokasi dimulai dari baris terakhir barang itu.
- **Stok → Persediaan** menampilkan jumlah dan nilai akhirnya.
- Stok awal hanya dapat dimuat sekali. Koreksi berikutnya adalah stok opname dan penyesuaian biasa,
  bukan pemuatan awal lagi.

## Kesalahan umum dan cara mengatasinya

- **"Admin yang memuat stok awal."** — peran Anda tidak dapat memuatnya. Minta Admin.
- **"Pilih tanggal mulai pakai terlebih dahulu." / "Pilih berkas terlebih dahulu."** — isi keduanya
  sebelum mengonfirmasi.
- **"Berkas ini tidak dapat dibaca. Gunakan templat, disimpan sebagai .xlsx."** — berkas bukan
  spreadsheet yang terbaca. Simpan dari templat sebagai `.xlsx` lalu pilih lagi.
- **"Berkas tidak memiliki kolom … Gunakan templat."** — judul kolom wajib hilang atau berubah.
  Pakai baris judul templat yang diunduh apa adanya.
- **"Gunakan tanggal dengan format YYYY-MM-DD…"** — betulkan tanggal baris itu.
- **"Tulis kode lokasi stok yang sudah ada." / "… kode barang stok."** — kodenya belum ada atau salah
  ketik. Tambahkan barang atau lokasinya di **Stok → Pengaturan** lebih dulu, atau betulkan kodenya.
- **Baris ditolak karena pergerakan bertanggal setelah tanggal mulai pakai** — pindahkan tanggalnya
  ke tanggal mulai pakai atau lebih awal, atau pilih tanggal mulai pakai yang lebih lambat.
- **"Perbaiki … baris yang ditolak di berkas Anda, lalu pilih berkas itu lagi."** — pratinjau menolak
  baris, jadi tidak ada yang dicatat. Betulkan dan muat ulang; berkas yang sebagian benar tidak
  pernah dicatat.
- **"Satu berkas berisi 1 sampai 5000 baris. Bagi per lokasi."** — bagi lembarnya menjadi berkas
  maksimal 5000 baris.
