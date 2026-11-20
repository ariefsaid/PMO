# Equipment rental terms and the downtime check

## What this is for

Two related jobs around rented machines:

1. **Daily status** — mark each machine's condition once a day (with proof when it is down),
   so broken machines get escalated, and so availability and utilisation figures mean
   something.
2. **Rental invoice check** — when the rental vendor's invoice arrives, compare it with what
   the machine's record says: rate × days in service, less the **downtime deduction** for
   proven down days. The check only reads and compares; it never pays or edits the bill.

Status (what condition the machine is in) is separate from usage (what it did). Availability
comes from status; utilisation from status plus approved usage.

## Who can do this

- **Set daily status and attach proof**: Admin, Project Manager, Engineer.
- **See the availability figures and the rental invoice check**: Admin and Finance; Admin also
  sets **Working hours per day**.
- **Edit rental terms** (vendor, rate, dates): Admin and Finance. A field role never edits
  rates.

## Where to find it

**Equipment → Availability.** The page has two views (shown to those who may run the rental
check):

- **Equipment status** — today's status for every machine, plus the month's figures.
- **Rental invoice check** — the comparison against a vendor invoice.

Rental terms live on each asset's own page (**Equipment → Assets** → open an asset), in the
**Rental terms** section.

## Steps

### Set today's status

1. Check the **Status date** (defaults to today; you can backfill an earlier date).
2. For each machine, pick a status: **Ready**, **Standby**, **Broken**, **At vendor**, or
   **Waiting for parts**. Add an optional **note**.
3. For a down status (Broken, At vendor, Waiting for parts), attach **proof** — a photo or the
   vendor's ticket (image or PDF). A down day with proof counts as **Proven**; without proof
   the row shows *No proof*.
4. **Save statuses** (one save covers every machine you changed).
5. A machine down **more than 2 days in a row** is flagged *Down more than 2 days* and the
   equipment managers are notified.
6. Machines with no status for a day simply show *Not recorded* (or *Last: ⟨status⟩*); a day
   with no status counts in no figure.

### Read the month's figures

The **This month** table shows, per machine and period (day, week or month; set the period
with **Metric period from / to** and pick machines under **Assets for metrics**):

- **Availability** — the share of in-service days the machine was ready or on standby.
- **Utilisation** — approved work hours against available days × working hours per day. A
  note shows *(n awaiting approval)* when submitted usage is still pending.
- **Unrecorded days** — how many days carry no status.

### Keep rental terms current (Admin/Finance, on the asset page)

1. Under **Rental terms**, set the **Vendor**, **Rate**, **Rate basis** (Day or Month),
   **Currency**, **Rental start** and optional **Rental end**; then **Save rental terms**.
2. **Set in service from** with **Save in-service date**; use **Mark owned** when a rented
   machine is bought.
3. When the vendor raises the rate, enter the new rate and start date and use **Change rate
   from date** — earlier periods keep their old rate (rate changes are kept as history, never
   rewritten).

### Check a rental invoice (Admin/Finance)

1. Open **Equipment → Availability** and switch to the **Rental invoice check** view.
2. Pick the **Rented machine**, set **Invoice period from / to**, and enter the **Vendor
   invoice amount**.
3. Choose **Check invoice**. The result shows:
   - **Rental amount** — rate × in-service days in the period (a monthly rate is divided by
     the days in that month).
   - **Downtime deduction** — proven down days × the daily rate, listed day by day with links
     to each proof.
   - **Expected invoice** — rental amount minus the deduction.
   - **Difference** — vendor invoice minus expected.
4. Unproven down days are listed but **not deducted** by default. To include them, give a
   **Reason to include unproven days** and choose **Include unproven days** — the reason is
   recorded.
5. The deduction never exceeds the period's rental amount, and nothing is posted or paid from
   here.

## What the result looks like

- The status list shows each machine with its status picker, its proof pill (*Proven* / *No
  proof*) and escalation flags; the figures table sits below it.
- A check result is a short money summary plus a day-by-day list of down days, each with its
  status and proof links — enough to settle the invoice with the vendor.

## Common problems

| What you see | What to do |
|---|---|
| *No equipment yet — Add assets under Equipment → Assets, then set their daily status here.* | Register the machines first; statuses need assets. |
| *No rented equipment on this page* | The check view needs a machine marked rented with rental terms. Set the terms on the asset page first. |
| *Down more than 2 days* stays flagged | The machine is still in a down status. Set **Ready** or **Standby** on the day it comes back — that ends the downtime period. |
| A down day shows *No proof* | Attach the photo or vendor ticket for that day; proven days are the ones deducted. |
| Availability or utilisation shows a dash or *Unrecorded days* | Days without a status are excluded from the figures. Backfill the **Status date** to cover them. |
| Utilisation has *(n awaiting approval)* | Submitted usage entries are not approved yet; only approved usage counts. Approve them under Equipment usage. |
| The expected figure looks wrong | Check the rate basis: a monthly rate is spread over the days of that month, and unproven days are not deducted unless you include them with a reason. |
| *Only an Admin can change this.* (working hours) | Working hours per day is an Admin setting; ask your Admin. |

## Bahasa Indonesia

# Ketentuan sewa peralatan dan pemeriksaan waktu henti

## Untuk apa ini

Dua pekerjaan yang berkaitan pada alat sewaan:

1. **Status harian** — tandai kondisi tiap alat sekali sehari (dengan bukti saat alat mati),
   agar alat rusak segera dieskalasi, dan agar angka ketersediaan serta pemanfaatan bermakna.
2. **Pemeriksaan tagihan sewa** — saat tagihan vendor sewa tiba, bandingkan dengan catatan
   alat: tarif × hari digunakan, dikurangi **potongan waktu henti** untuk hari henti yang
   terbukti. Pemeriksaan hanya membaca dan membandingkan; ia tidak pernah membayar atau
   mengubah tagihan.

Status (kondisi alat) terpisah dari pemakaian (apa yang dikerjakannya). Ketersediaan datang
dari status; pemanfaatan dari status ditambah pemakaian yang disetujui.

## Siapa yang dapat melakukannya

- **Menetapkan status harian dan melampirkan bukti**: Admin, Manajer Proyek, Rekayasa.
- **Melihat angka ketersediaan dan pemeriksaan tagihan sewa**: Admin dan Keuangan; Admin juga
  menetapkan **Jam kerja per hari**.
- **Mengubah ketentuan sewa** (penyedia, tarif, tanggal): Admin dan Keuangan. Peran lapangan
  tidak pernah mengubah tarif.

## Di mana menemukannya

**Peralatan → Ketersediaan.** Halaman ini punya dua tampilan (tampil bagi yang boleh
menjalankan pemeriksaan sewa):

- **Status peralatan** — status hari ini untuk tiap alat, plus angka bulan ini.
- **Pemeriksaan tagihan sewa** — perbandingan terhadap tagihan vendor.

Ketentuan sewa ada di halaman masing-masing aset (**Peralatan → Aset** → buka aset), pada
bagian **Ketentuan sewa**.

## Langkah-langkah

### Menetapkan status hari ini

1. Periksa **Tanggal status** (bawaan hari ini; Anda dapat mengisi tanggal lebih awal).
2. Untuk tiap alat, pilih status: **Siap**, **Siaga**, **Rusak**, **Di vendor**, atau
   **Menunggu suku cadang**. Tambahkan **catatan** opsional.
3. Untuk status henti (Rusak, Di vendor, Menunggu suku cadang), lampirkan **bukti** — foto
   atau tiket vendor (gambar atau PDF). Hari henti dengan bukti dihitung **Terbukti**; tanpa
   bukti barisnya menampilkan *Belum ada bukti*.
4. **Simpan status** (satu simpanan mencakup semua alat yang Anda ubah).
5. Alat yang henti **lebih dari 2 hari berturut-turut** ditandai *Rusak lebih dari 2 hari* dan
   pengelola peralatan diberi tahu.
6. Alat tanpa status untuk sehari cukup menampilkan *Belum dicatat* (atau *Terakhir:
   ⟨status⟩*); hari tanpa status tidak masuk angka mana pun.

### Membaca angka bulan ini

Tabel **Bulan ini** menampilkan, per alat dan periode (hari, minggu, atau bulan; atur periode
dengan **Awal/Akhir periode metrik** dan pilih alat di **Aset untuk metrik**):

- **Ketersediaan** — porsi hari digunakan ketika alat siap atau siaga.
- **Pemanfaatan** — jam kerja yang disetujui dibanding hari tersedia × jam kerja per hari.
  Ada keterangan *(n menunggu persetujuan)* bila pemakaian masih diajukan.
- **Hari belum dicatat** — berapa hari tanpa status.

### Menjaga ketentuan sewa tetap mutakhir (Admin/Keuangan, di halaman aset)

1. Di bawah **Ketentuan sewa**, isi **Penyedia**, **Tarif**, **Dasar tarif** (Hari atau
   Bulan), **Mata uang**, **Awal sewa** dan **Akhir sewa** opsional; lalu **Simpan ketentuan
   sewa**.
2. **Mulai digunakan** dengan **Simpan tanggal mulai digunakan**; gunakan **Tandai milik
   sendiri** ketika alat sewaan dibeli.
3. Saat vendor menaikkan tarif, masukkan tarif dan tanggal mulai yang baru lalu gunakan
   **Ubah tarif mulai tanggal** — periode sebelumnya tetap memakai tarif lamanya (perubahan
   tarif disimpan sebagai riwayat, tidak pernah ditulis ulang).

### Memeriksa tagihan sewa (Admin/Keuangan)

1. Buka **Peralatan → Ketersediaan** dan pindah ke tampilan **Pemeriksaan tagihan sewa**.
2. Pilih **Alat sewaan**, isi **Periode tagihan dari / sampai**, dan masukkan **Jumlah tagihan
   vendor**.
3. Pilih **Periksa tagihan**. Hasilnya menampilkan:
   - **Jumlah sewa** — tarif × hari digunakan dalam periode (tarif bulanan dibagi hari dalam
     bulan itu).
   - **Potongan waktu henti** — hari henti terbukti × tarif harian, didaftar hari per hari
     dengan tautan ke tiap bukti.
   - **Tagihan yang diharapkan** — jumlah sewa dikurangi potongan.
   - **Selisih** — tagihan vendor dikurangi yang diharapkan.
4. Hari henti belum terbukti didaftar tetapi **tidak dipotong** secara bawaan. Untuk
   menyertakannya, beri **Alasan memasukkan hari belum terbukti** lalu pilih **Masukkan hari
   belum terbukti** — alasannya dicatat.
5. Potongan tidak pernah melebihi jumlah sewa periode tersebut, dan tidak ada yang diposting
   atau dibayar dari sini.

## Bagaimana hasilnya

- Daftar status menampilkan tiap alat dengan pemilih status, pil buktinya (*Terbukti* /
  *Belum ada bukti*) dan tanda eskalasi; tabel angka berada di bawahnya.
- Hasil pemeriksaan berupa ringkasan uang singkat ditambah daftar hari henti hari per hari,
  masing-masing dengan status dan tautan buktinya — cukup untuk melunasi tagihan dengan
  vendor.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Belum ada alat — Tambahkan aset di Alat → Aset, lalu atur status hariannya di sini.* | Daftarkan alatnya lebih dulu; status membutuhkan aset. |
| *Tidak ada peralatan sewa di halaman ini* | Tampilan pemeriksaan membutuhkan alat yang ditandai sewa dengan ketentuan sewa. Tetapkan ketentuannya di halaman aset dulu. |
| *Rusak lebih dari 2 hari* masih tertanda | Alat masih dalam status henti. Tetapkan **Siap** atau **Siaga** pada hari alat kembali — itu mengakhiri periode waktu henti. |
| Hari henti menampilkan *Belum ada bukti* | Lampirkan foto atau tiket vendor untuk hari itu; hari yang terbukti itulah yang dipotong. |
| Ketersediaan atau pemanfaatan menampilkan garis atau *Hari belum dicatat* | Hari tanpa status dikeluarkan dari angka. Isi kembali **Tanggal status** untuk menutupinya. |
| Pemanfaatan ada keterangan *(n menunggu persetujuan)* | Catatan pemakaian belum disetujui; hanya yang disetujui yang dihitung. Setujui di Pemakaian peralatan. |
| Angka yang diharapkan terasa salah | Periksa dasar tarif: tarif bulanan dibagi hari bulan itu, dan hari belum terbukti tidak dipotong kecuali Anda menyertakannya dengan alasan. |
| *Hanya Admin yang dapat mengubah ini.* (jam kerja) | Jam kerja per hari adalah pengaturan Admin; tanyakan ke Admin Anda. |
