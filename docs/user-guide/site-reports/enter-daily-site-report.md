# Enter a daily site report

A daily site report records one day of work on one work order: what was built (progress), the hours
worked, the weather, materials used up on site, and photos of the day — usually a photo of your
paper field form. When a validator approves the report it becomes the day's earned revenue for the
work order.

**Who can do this:** Admin, Engineer, or the Project Manager of the report's project.

## Steps

1. Open **Site reports** and choose **New report**.
2. Pick the **Project**, the **Work order**, and the **Work date** (today or an earlier day).
   There can be only one report per work order per day.
3. Fill the sections you have:
   - **Progress** — for each contract item on the work order: the item, an optional sub-stage, and
     the quantity done that day (more than 0, up to 3 decimals). The unit comes from the contract
     item. Each line shows its rate and its day revenue; a line without a rate shows "No rate" and
     adds nothing.
   - **Hours and weather** — start, end and total hours, plus any idle time in minutes with a
     reason from your organisation's list. Pick the day's weather and add an optional weather note.
   - **Consumables used** — stock items used up, with quantities. This is a record only; it does
     not move stock.
   - **Equipment hours** — shown from the equipment usage recorded for that work order and date.
     If an entry is missing, use **Add usage** to record it.
   - **People hours** — shown from crew attendance and timesheets for that work order and date.
     These are read-only; the report never creates timesheet hours.
   - **Photos** — add a **Photo of paper form** (your signed paper field form) and any other
     photos.
4. Choose **Save draft** as often as you need. A draft can be edited by you and by people with
   report-entry permission until it is submitted.
5. Choose **Submit**. The report moves to "Waiting to validate" and appears in the validation
   queue.

## What the result looks like

- The report shows **Day revenue** (the sum of the progress lines) and, next to the work order's
  order value, the **Validated to date** figure. Only validated reports count toward it.
- After validation the rate used for each line is frozen, so later price changes never change a
  validated day.
- A validator who is not happy chooses **Return** with a reason. The report comes back to you as
  "Returned", you edit it and submit again.

## Common errors and what to do

- **"A report exists for this date"** — someone already started a report for this work order and
  day. Open it from the list instead of creating a new one.
- **"No rate" on a progress line** — the rate catalogue has no price for that contract item (or
  sub-stage) on that date. The line is counted in the report header as a line without a rate. Ask
  the person who maintains rates to add one; a validated report keeps the rate it was validated
  with.
- **A photo upload failed** — your draft is kept and your text is not lost. Use **Retry** on the
  photo.
- **The work order or date is wrong after saving** — they cannot be changed on a saved report, and
  there is no delete. Check them before you start; an unused draft adds nothing to any figure, and
  a report for the correct work order and date can always be created.

---

## Bahasa Indonesia

# Mengisi laporan lapangan harian

Laporan lapangan harian mencatat satu hari kerja pada satu perintah kerja: apa yang dikerjakan
(progres), jam kerja, cuaca, bahan yang habis dipakai di lokasi, dan foto hari itu — biasanya foto
formulir kertas Anda. Setelah validator menyetujuinya, laporan menjadi pendapatan hari itu untuk
perintah kerja.

**Siapa yang bisa melakukannya:** Admin, Insinyur, atau Manajer Proyek proyek laporan tersebut.

## Langkah-langkah

1. Buka **Laporan lapangan** dan pilih **Laporan baru**.
2. Pilih **Proyek**, **Perintah kerja**, dan **Tanggal kerja** (hari ini atau hari sebelumnya).
   Hanya ada satu laporan untuk satu perintah kerja per tanggal.
3. Isi bagian yang tersedia:
   - **Progres** — untuk setiap item kontrak pada perintah kerja: itemnya, sub-tahap opsional, dan
     jumlah yang diselesaikan hari itu (lebih dari 0, paling banyak 3 desimal). Satuan mengikuti
     item kontrak. Setiap baris menampilkan tarif dan pendapatannya; baris tanpa tarif menampilkan
     "Tanpa tarif" dan tidak menambah apa pun.
   - **Jam kerja dan cuaca** — jam mulai, selesai, dan total, ditambah waktu menganggur dalam
     menit beserta alasannya dari daftar organisasi Anda. Pilih cuaca hari itu dan tambahkan
     **Catatan cuaca** bila perlu.
   - **Bahan habis pakai** — barang stok yang habis dipakai, dengan jumlahnya. Ini hanya catatan;
     stok tidak bergerak.
   - **Jam alat** — ditampilkan dari pemakaian alat yang tercatat untuk perintah kerja dan tanggal
     itu. Bila belum ada, gunakan **Tambah pemakaian** untuk mencatatnya.
   - **Jam orang** — ditampilkan dari kehadiran kru dan lembar waktu untuk perintah kerja dan
     tanggal itu. Bagian ini hanya bisa dibaca; laporan tidak pernah membuat jam lembar waktu.
   - **Foto** — tambahkan **Foto formulir kertas** (formulir kertas yang sudah ditandatangani) dan
     foto lainnya.
4. Pilih **Simpan draf** sesering perlu. Draf dapat diubah oleh Anda dan oleh orang dengan izin
   pengisian laporan sampai dikirim.
5. Pilih **Kirim**. Laporan berubah menjadi "Menunggu validasi" dan muncul di antrean validasi.

## Hasilnya seperti apa

- Laporan menampilkan **Pendapatan hari ini** (jumlah seluruh baris progres) dan, di samping nilai
  pesanan perintah kerja, angka **Tervalidasi sampai kini**. Hanya laporan tervalidasi yang
  dihitung.
- Setelah validasi, tarif setiap baris dibekukan, sehingga perubahan harga kemudian tidak pernah
  mengubah hari yang sudah tervalidasi.
- Validator yang kurang setuju memilih **Kembalikan** dengan alasan. Laporan kembali ke Anda
  dengan status "Dikembalikan"; ubah lalu kirim lagi.

## Kesalahan umum dan cara mengatasinya

- **"Sudah ada laporan untuk tanggal ini"** — seseorang sudah memulai laporan untuk perintah kerja
  dan tanggal ini. Buka laporan itu dari daftar, jangan membuat baru.
- **"Tanpa tarif" pada baris progres** — katalog tarif belum punya harga untuk item kontrak (atau
  sub-tahap) itu pada tanggal itu. Barisnya dihitung di kepala laporan sebagai baris tanpa tarif.
  Minta pengelola tarif menambahkannya; laporan tervalidasi memakai tarif saat divalidasi.
- **Unggah foto gagal** — draf Anda tetap tersimpan dan teks tidak hilang. Gunakan **Coba lagi**
  pada foto tersebut.
- **Perintah kerja atau tanggal salah setelah tersimpan** — keduanya tidak bisa diubah pada
  laporan tersimpan, dan tidak ada penghapusan. Periksa keduanya sebelum mulai; draf yang tidak
  dipakai tidak menambah angka apa pun, dan laporan untuk perintah kerja serta tanggal yang benar
  tetap bisa dibuat.
