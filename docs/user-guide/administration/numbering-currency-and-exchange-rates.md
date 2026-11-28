# Keep numbering, currency and exchange rates right

## What this is for

These are the organisation-wide settings that every other screen depends on: the pattern project
numbers follow, the fiscal year and default tax treatment money is read against, and the exchange
rates that let a foreign-currency amount be shown in rupiah. They are set once, then left alone — and
when they do change, they change for everyone.

**Who can do this:** an **Admin** changes the project-number pattern, the fiscal year and the default
tax treatment. **Finance** and **Admin** read and upload exchange rates; adding or editing a single
rate is done by an Admin.

## Where to find it

**Administration → All settings** lists every organisation setting by the job it serves, shows
whether it is on, names the roles that may change it, and links to the screen it is changed on. Use
it as the index. The three screens this page covers:

- **Administration → Project setup** — **Numbering and project lists**.
- **Administration → Accounting setup** — **Tax and fiscal year**.
- **Administration → Exchange rates**. It appears only when your plan includes multi-currency.

## Steps

### Number projects your way

1. Open **Administration → Project setup** and find **Project number pattern**.
2. Read the format: PMO-assigned project numbers use `{CLIENT}`, `{YY}` and `{SEQ4}`, once each. The
   default is `PRJ-{YY}-{SEQ4}`.
3. Type your pattern. The page tells you at once if a token is unknown, repeated or missing.
4. Choose **Save pattern**. **New project numbers will use this pattern. Existing project numbers are
   unchanged.**

### Set the fiscal year and default tax treatment

1. Open **Administration → Accounting setup** and the **Tax and fiscal year** group.
2. Choose the month the **Fiscal year starts in**, then choose **Save fiscal year**. PMO places each payment in a fiscal year
   by its date, and the Budget tab shows spending per year; changing the month re-sorts past
   payments.
3. Choose the **Default tax treatment** — **Inclusive: the amount already includes tax** or
   **Exclusive: tax is on top of the amount**. It saves as soon as you choose, with a message *Default
   tax treatment updated*: new contracts, work orders and invoices start on this basis, and existing
   records keep theirs.

### Keep exchange rates

1. Open **Administration → Exchange rates**. The table lists each rate's **Publication date**, the
   **IDR per USD** rate, its **Source**, **Set by** and **Last change**.
2. **Upload file** takes a Bank Indonesia workbook or a `date,rate` CSV of up to 500 rows. You see a
   preview of how many rates are new, changed and unchanged before anything is saved, and rows it
   cannot read are listed with the row and the reason.
3. **Add one rate** records a single day: the **Publication date**, the **IDR per USD** rate and the
   **Source**.
4. If a rate already exists for that date with a different value, PMO asks **Replace the rate for …?**
   and shows the old and new value. Confirm only if the new figure is the right one.
5. Use **Previous** and **Next** to page through older rates.

## What the result looks like

- New projects take the new number pattern; existing numbers never change.
- Spending per year follows the fiscal year you set, and new amounts are read as inclusive or
  exclusive of tax according to the default.
- Rupiah equivalents on foreign-currency figures use the rate published for that date. Rates are
  display equivalents only — they do not restate the money already recorded.
- Each saved rate shows who set it and when it last changed.

## Common errors and what to do

- **"Pattern cannot be empty. Enter a project-number pattern."** — enter a pattern; there is always one in force.
- **"The token … is not one this app knows. Use CLIENT, YY or SEQ4."** — a token is misspelled.
- **"Use … exactly once." / "Include … exactly once."** — a token is repeated or missing; each of the
  three appears once.
- **"Exchange rates are available to Finance and Admin."** — your role cannot read or change rates.
  Ask Finance or an Admin.
- **"Publication date cannot be in the future."** — pick today or an earlier day.
- **"Enter a rate from 1,000 to 100,000 with at most six decimal places; check separators."** — the
  rate is out of range or the thousands separator was read as a decimal.
- **"Different rates occur for this date; correct the file."** — the file names two different rates
  for one day. Keep one, then upload again.
- **"Correct rejected rows and upload again; nothing has been saved."** — the upload is all or
  nothing. Fix the listed rows first.
- **"Could not identify one date column and one rate column."** — the file's header row does not say
  which column is which. Use the supported workbook or a two-column `date,rate` CSV.
- **"Your accounting system sets the fiscal year."** — when an accounting system is connected, the
  fiscal year comes from it and is not edited here.

---

## Bahasa Indonesia

# Menjaga penomoran, mata uang, dan kurs tetap benar

## Untuk apa ini

Ini adalah pengaturan organisasi yang menjadi dasar semua layar lain: pola nomor proyek, tahun buku
dan perlakuan pajak bawaan yang menjadi dasar pembacaan uang, serta kurs yang memungkinkan nilai mata
uang asing ditampilkan dalam rupiah. Semuanya ditetapkan sekali, lalu dibiarkan — dan bila berubah,
berubah untuk semua orang.

**Siapa yang bisa melakukannya:** **Admin** mengubah pola nomor proyek, tahun buku, dan perlakuan
pajak bawaan. **Keuangan** dan **Admin** membaca serta mengunggah kurs; menambah atau mengubah satu
kurs dilakukan Admin.

## Di mana menemukannya

**Administrasi → Semua pengaturan** mencantumkan setiap pengaturan organisasi menurut pekerjaan yang
dilayaninya, menunjukkan apakah aktif, menyebut peran yang boleh mengubahnya, dan menautkan ke layar
tempat mengubahnya. Gunakan sebagai daftar isi. Tiga layar yang dibahas halaman ini:

- **Administrasi → Pengaturan proyek** — **Penomoran dan daftar proyek**.
- **Administrasi → Pengaturan akuntansi** — **Pajak dan tahun buku**.
- **Administrasi → Kurs mata uang**. Menu ini muncul hanya bila paket Anda mencakup multi-mata uang.

## Langkah-langkah

### Menomori proyek sesuai cara Anda

1. Buka **Administrasi → Pengaturan proyek** dan cari **Pola nomor proyek**.
2. Baca formatnya: nomor proyek yang dibuat PMO memakai `{CLIENT}`, `{YY}`, dan `{SEQ4}`, masing-masing
   sekali. Bawaannya `PRJ-{YY}-{SEQ4}`.
3. Ketik pola Anda. Halaman langsung memberi tahu bila ada token yang tidak dikenal, berulang, atau
   hilang.
4. Pilih **Simpan pola**. **Nomor proyek baru akan menggunakan pola ini. Nomor proyek yang sudah ada
   tidak berubah.**

### Menetapkan tahun buku dan perlakuan pajak bawaan

1. Buka **Administrasi → Pengaturan akuntansi** dan grup **Pajak dan tahun buku**.
2. Pilih bulan **Tahun fiskal dimulai pada**, lalu pilih **Simpan tahun fiskal**. PMO menempatkan setiap pembayaran dalam tahun
   buku menurut tanggalnya, dan tab Anggaran menampilkan belanja per tahun; mengganti bulannya
   menyusun ulang pembayaran lampau.
3. Pilih **Perlakuan pajak default** — **Inklusif: nilai sudah termasuk pajak** atau **Eksklusif:
   pajak ditambahkan di atas nilai**. Pilihan tersimpan begitu dipilih, dengan pesan *Perlakuan pajak
   default diperbarui*: kontrak, perintah kerja, dan invoice baru memakai dasar ini, sedangkan catatan
   lama tidak berubah.

### Menjaga kurs

1. Buka **Administrasi → Kurs mata uang**. Tabel mencantumkan **Tanggal publikasi**, kurs **IDR per USD**,
   **Sumber**, **Diubah oleh**, dan **Perubahan terakhir**.
2. **Unggah berkas** menerima buku kerja Bank Indonesia atau CSV `tanggal,kurs` maksimal 500 baris.
   Anda melihat pratinjau berapa kurs baru, berubah, dan tidak berubah sebelum apa pun disimpan, dan
   baris yang tidak terbaca didaftar beserta baris dan alasannya.
3. **Tambah satu kurs** mencatat satu hari: **Tanggal publikasi**, kurs **IDR per USD**, dan
   **Sumber**.
4. Bila sudah ada kurs lain untuk tanggal itu, PMO menanyakan **Ganti kurs untuk …?** dan menampilkan
   nilai lama dan baru. Konfirmasi hanya bila angka barunya yang benar.
5. Gunakan **Sebelumnya** dan **Berikutnya** untuk menelusuri kurs lama.

## Hasilnya seperti apa

- Proyek baru memakai pola nomor baru; nomor yang sudah ada tidak pernah berubah.
- Belanja per tahun mengikuti tahun buku yang Anda tetapkan, dan jumlah baru dibaca sebagai termasuk
  atau tidak termasuk pajak sesuai bawaannya.
- Padanan rupiah pada angka mata uang asing memakai kurs yang terbit untuk tanggal itu. Kurs hanya
  padanan tampilan — ia tidak menulis ulang uang yang sudah tercatat.
- Setiap kurs yang tersimpan menampilkan siapa yang menetapkannya dan kapan terakhir berubah.

## Kesalahan umum dan cara mengatasinya

- **"Pola tidak boleh kosong. Isi pola nomor proyek."** — isi polanya; selalu ada pola yang berlaku.
- **"Token … tidak dikenal aplikasi ini. Gunakan CLIENT, YY, atau SEQ4."** — ada token yang
  salah ketik.
- **"Pakai … tepat satu kali." / "Sertakan … tepat satu kali."** — ada token yang berulang atau hilang;
  masing-masing dari ketiganya muncul sekali.
- **"Kurs tersedia bagi Finance dan Admin."** — peran Anda tidak dapat membaca atau mengubah kurs.
  Minta Keuangan atau Admin.
- **"Tanggal publikasi tidak boleh di masa depan."** — pilih hari ini atau hari sebelumnya.
- **"Masukkan kurs 1.000–100.000 dengan maksimal enam angka desimal; periksa pemisah angka."** —
  kursnya di luar rentang atau pemisah ribuan terbaca sebagai desimal.
- **"Ada kurs berbeda untuk tanggal ini; perbaiki file."** — berkas menyebut dua kurs berbeda untuk
  satu hari. Sisakan satu, lalu unggah lagi.
- **"Perbaiki baris yang ditolak dan unggah ulang; belum ada yang disimpan."** — unggahan bersifat
  semua atau tidak sama sekali. Betulkan baris yang tercantum lebih dulu.
- **"Kolom tanggal dan kurs tidak dapat ditentukan dengan pasti."** — baris judul berkas tidak
  menyebut kolom mana yang mana. Pakai buku kerja yang didukung atau CSV dua kolom `tanggal,kurs`.
- **"Sistem akuntansi Anda yang menetapkan tahun fiskal."** — bila sistem akuntansi terhubung, tahun buku
  berasal dari sana dan tidak diubah di sini.
