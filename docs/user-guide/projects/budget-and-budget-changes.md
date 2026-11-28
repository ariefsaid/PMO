# Budget and budget changes

## What this is for

The **Budget** tab holds the project's planned cost, split by category (labor, materials,
subcontractors, equipment, permits and fees, project operating costs, contingency). The budget
changes through **versions**: you prepare a Draft, someone else activates it, and after that a
change means preparing a new draft and activating it again. Beside the plan you always see the
actual spending and open orders, so over-budget projects show early.

## Who can do this

- **View** the budget: Admin, Executive, Project Manager, Finance.
- **Prepare and edit a draft** (budget lines, paste rows from a spreadsheet): Admin, Executive,
  Project Manager, Finance.
- **Activate a draft** (make it the live budget): Admin, Executive, Finance — and not the
  person who drafted or edited it. (The only exception is an organisation with a single member,
  who may activate their own draft.)

## Where to find it

Open the project, then the **Budget** tab.

## Steps

### The first budget

1. On the **Budget** tab, choose **New version** (or **Create budget** if nothing exists yet),
   type a version name, for example "Budget v1", choose **Create**, and confirm **Create
   version**.
2. Add each line: **Category**, **Description** and **Amount**. Use **+ Add line item** for
   each line. To type once, use **Paste rows** and paste lines straight from a spreadsheet —
   PMO checks the columns, asks you to map each category, and flags amounts it could not read.
3. If your project runs across financial years, choose **Change budget mode**, then **Switch to
   per-year**, and assign each line a **Fiscal year**. Otherwise the budget covers the whole
   project.
4. Choose **Activate v1** (the number of your version) and confirm **Activate version** to make
   it the live budget. PMO first checks that the draft is ready and tells you what is missing.

### A budget change

1. Choose **Update budget** (or **Prepare new draft**) to copy the active version into an
   editable draft. Under **Manage versions**, **Clone to revise** does the same for a chosen
   version.
2. Edit the lines: add, change amounts, or remove lines. The draft shows as **Draft waiting
   for approval**.
3. An eligible approver — Admin, Executive or Finance, and someone other than the drafter or
   editors — chooses **Activate v…**. If it is not right, they choose **Return**, give a
   **Reason for returning** and confirm **Return draft**; the drafter fixes it and uses
   **Resubmit for approval**.
4. The newly activated version becomes the live budget; the older version is kept and can be
   compared (**Compare versions**) or archived.

### Reading the budget

- **Budget vs actual by category** lists each category's budget, what is spent, what is
  committed in open orders, what is left, and **% used**.
- **Forecast** (a view beside **Budget vs actual**, available when an accounting system is
  connected or the project's own paid purchases are used) adds, per financial year, the **Cost
  to finish** the manager estimates and the **Forecast final**.
- Each category carries a status such as **On track**, **Watch**, **At risk** or **Over
  budget**.

## What the result looks like

- The tab shows the active version's totals, the **Budget vs actual by category** table, and
  the version list under **Manage versions** (Draft, Active, Archived).
- Money tiles read: **Budget** (before tax), **Budget used**, **Spent**, **Committed** and what
  is left (**Left after open orders**, **Left after spending**).
- The project list's **Budget used** column and the header tile follow the active budget, so
  "over budget" means the same figure everywhere.
- If your organisation connects an accounting system, the active budget is sent to it; the tab
  shows the send status (**Queued**, **Sending**, **Not sent**, **On hold**, **Not enforced**)
  under **Sources and budget enforcement**.

## Common errors and what to do

- **"You drafted or edited this version, so someone else must activate it."** — ask another
  Admin, Executive or Finance person to activate.
- **"No drafter is recorded for this version, so only Admin or Finance can activate it."** —
  the version was created before people were recorded; an Admin or Finance person activates it.
- **"Add an activation date"** — set the activation date, then activate again.
- **"Save or discard all open line item edits before activating."** — finish or cancel the line
  you were editing.
- **Paste rows read a number wrong** — the dialog shows how each amount was read ("Read as
  12345, not a decimal."); confirm it or fix the pasted text before saving.
- **"The project now runs to …; this budget covers …"** — the project's dates moved past the
  budget's years. Prepare a new draft that covers the new years.
- **A figure shows a reason instead of a number** — spending or commitments are not readable
  for your role or not linked yet; the note names the cause.

---

## Bahasa Indonesia

# Anggaran dan perubahan anggaran

## Untuk apa ini

Tab **Anggaran** menyimpan rencana biaya proyek, dipecah per kategori (tenaga kerja, material,
subkontraktor, peralatan, izin dan retribusi, biaya operasional proyek, kontingensi). Anggaran
berubah melalui **versi**: Anda menyiapkan Draf, orang lain mengaktifkannya, dan setelah itu
perubahan berarti menyiapkan draf baru dan mengaktifkannya lagi. Di samping rencana Anda selalu
melihat pengeluaran aktual dan pesanan terbuka, sehingga proyek yang lewat anggaran terlihat
dini.

## Siapa yang dapat melakukannya

- **Melihat** anggaran: Admin, Eksekutif, Manajer Proyek, Keuangan.
- **Menyiapkan dan mengubah draf** (baris anggaran, menempel baris dari lembar kerja): Admin,
  Eksekutif, Manajer Proyek, Keuangan.
- **Mengaktifkan draf** (menjadikannya anggaran yang berlaku): Admin, Eksekutif, Keuangan —
  dan bukan orang yang menyusun atau mengedit drafnya. (Pengecualian: organisasi dengan satu
  anggota saja, yang boleh mengaktifkan drafnya sendiri.)

## Di mana menemukannya

Buka proyek, lalu tab **Anggaran**.

## Langkah-langkah

### Anggaran pertama

1. Di tab **Anggaran**, pilih **Versi baru** (atau **Buat anggaran** bila belum ada apa pun),
   ketik nama versi, misalnya "Budget v1", pilih **Buat**, lalu konfirmasi **Buat versi**.
2. Tambahkan setiap baris: **Kategori**, **Deskripsi**, dan **Jumlah**. Gunakan **+ Tambah item
   anggaran** untuk setiap baris. Agar sekali ketik, gunakan **Tempel baris** dan tempel baris
   langsung dari lembar kerja — PMO memeriksa kolomnya, meminta Anda memetakan setiap kategori,
   dan menandai jumlah yang tidak bisa dibaca.
3. Bila proyek Anda berjalan melewati beberapa tahun fiskal, pilih **Ubah mode anggaran**,
   lalu **Ubah ke per tahun**, dan tetapkan **Tahun fiskal** setiap baris. Jika tidak, anggaran
   berlaku untuk seluruh proyek.
4. Pilih **Aktifkan v1** (nomor versi Anda) dan konfirmasi **Aktifkan versi** untuk menjadikannya
   anggaran yang berlaku. PMO lebih dulu memeriksa apakah draf sudah siap dan memberi tahu apa
   yang kurang.

### Perubahan anggaran

1. Pilih **Perbarui anggaran** (atau **Siapkan draf baru**) untuk menyalin versi aktif menjadi
   draf yang bisa diubah. Di **Kelola versi**, **Salin untuk revisi** melakukan hal yang sama
   untuk versi yang dipilih.
2. Ubah barisnya: tambah, ubah jumlah, atau hapus baris. Draf tampil sebagai **Draf menunggu
   persetujuan**.
3. Pemberi persetujuan yang berwenang — Admin, Eksekutif, atau Keuangan, dan orang selain
   penyusun dan penyunting draf — memilih **Aktifkan v…**. Bila belum benar, mereka memilih
   **Kembalikan**, mengisi **Alasan pengembalian**, dan mengonfirmasi **Kembalikan draf**;
   penyusunnya memperbaiki lalu memakai **Ajukan ulang untuk persetujuan**.
4. Versi yang baru diaktifkan menjadi anggaran yang berlaku; versi lama disimpan dan bisa
   dibandingkan (**Bandingkan versi**) atau diarsipkan.

### Membaca anggaran

- **Anggaran vs aktual per kategori** memuat anggaran tiap kategori, yang terpakai, yang
  terikat di pesanan terbuka, sisanya, dan **% digunakan**.
- **Proyeksi** (tampilan di samping **Anggaran vs aktual**, tersedia bila sistem akuntansi
  terhubung atau pembelian yang sudah dibayar di PMO dipakai) menambahkan, per tahun fiskal,
  **Biaya penyelesaian** yang diestimasi manajer dan **Proyeksi akhir**.
- Setiap kategori membawa status seperti **Sesuai rencana**, **Perlu perhatian**, **Berisiko**,
  atau **Melebihi anggaran**.

## Hasilnya seperti apa

- Tab menampilkan total versi aktif, tabel **Anggaran vs aktual per kategori**, dan daftar
  versi di **Kelola versi** (Draf, Aktif, Arsip).
- Angka-angkanya dibaca: **Anggaran** (sebelum pajak), **Anggaran terpakai**, **Terpakai**,
  **Terikat**, dan sisanya (**Sisa setelah pesanan terbuka**, **Sisa setelah pengeluaran**).
- Kolom **Anggaran terpakai** di daftar proyek dan angka di kepala halaman mengikuti anggaran
  aktif, sehingga "melebihi anggaran" berarti angka yang sama di mana-mana.
- Bila organisasi Anda menghubungkan sistem akuntansi, anggaran aktif dikirim ke sana; tab
  menampilkan status kirimnya (**Dalam antrean**, **Mengirim**, **Belum dikirim**, **Ditahan**,
  **Tidak diterapkan**) di bagian sumber dan penerapan anggaran.

## Kesalahan umum dan cara mengatasinya

- **"Anda menyusun draf atau mengedit versi ini, jadi orang lain yang harus mengaktifkannya."** —
  minta orang Admin, Eksekutif, atau Keuangan lain mengaktifkannya.
- **"Penyusun versi ini tidak tercatat, jadi hanya Admin atau Finance yang dapat
  mengaktifkannya."** — versi dibuat sebelum pencatatannya ada; Admin atau Keuangan
  mengaktifkannya.
- **"Tambahkan tanggal aktivasi"** — isi tanggal aktivasi, lalu aktifkan lagi.
- **"Simpan atau batalkan semua edit item baris yang terbuka sebelum mengaktifkan."** —
  selesaikan atau batalkan baris yang sedang Anda ubah.
- **Tempel baris membaca angka secara keliru** — dialog menunjukkan bagaimana setiap jumlah
  dibaca ("Dibaca 12345, bukan desimal."); konfirmasi atau perbaiki teks tempelan sebelum
  menyimpan.
- **"Proyek kini berjalan hingga …; anggaran ini mencakup …"** — tanggal proyek bergeser
  melewati tahun anggaran. Siapkan draf baru yang mencakup tahun-tahun barunya.
- **Sebuah angka menampilkan alasan, bukan angka** — pengeluaran atau komitmen tidak dapat
  dibaca peran Anda atau belum terhubung; keterangannya menyebut sebabnya.
