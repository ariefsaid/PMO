# Billing stages and retention

## What this is for

Measured work often passes through several hands before it can be invoiced: internal
measurement, a joint survey with the client, the client's review, approval and acceptance.
**Billing stages** record each step for one progress claim, its documents, and how long each
step has been waiting — so the invoice goes out complete and before the client's monthly
cut-off.

**Retention** is the share of a progress claim the client holds back until a later event
(handover, end of the defects period). PMO holds it on the receivable: the invoice and its VAT
stay at full value; the amount due now is the invoice less the retention still held. A
**retention release** is a scheduled, then recorded, payment-due event for part or all of a
claim's retention.

A **billing reconciliation** table rounds it off: per bill-of-quantities item, what was done,
measured and billed, and what is left.

## Who can do this

- **Set the stage list, invoice deadline and retention percentage**: Finance or Admin.
- **Record stages** (attach documents, complete a stage): Finance, Admin, Project Manager.
- **Schedule, record and cancel retention releases**: Finance or Admin.
- **Read** the stages, retention and reconciliation: Finance, Admin, Executive, Project
  Manager (Engineers are excluded, as for claims).

## Where to find it

- Open a project → **Contract** tab. The **Billing terms** button opens stage list, deadline
  and retention; it sits with the contract tools and on the **Billing claims** card.
- A claim's detail shows its **Billing stages** section, its deadline, the retention it holds,
  and its **Retention releases**.
- The **Billing reconciliation** table sits at the bottom of the tab.

## Steps

### Set the project's billing terms (once, Finance/Admin)

1. Choose **Billing terms**.
2. Under **Billing stages**, add each stage in order: a **Stage name**, tick **In the
   client's system** for steps that happen in the client's own system, and list **Required
   documents** and **Optional documents**, one per line. Use **Up** to reorder and **Remove**
   to delete; **Add stage** adds another.
3. Set the **Invoice deadline (day of month)** (1–31, or leave empty), **Warn this many days
   ahead** (0–27, default 5), and the **Retention (%)** (0 to under 100).
4. **Save billing terms**. Each new progress claim takes a copy of this list; editing the list
   never changes a claim already made.

### Move a claim through its stages

1. Open the claim and find its **Billing stages** section. The first stage is current from the
   claim date; each stage shows its age in days.
2. For each checklist item, choose a project document (**Choose a document**, then **Attach**).
   Only an issued or approved document with a file is accepted; attaching it also adds it to
   the claim's billing evidence.
3. On the current stage, set **Completed on** (today or earlier, not before the previous
   stage), enter the **Client's document number** for a client-side stage, and choose
   **Complete stage**. The next stage becomes current from that date.
4. Watch the deadline pill — *Invoice deadline ⟨date⟩ · ⟨n⟩ days left* — it warns when the
   days left are within the warning window.
5. When every stage is complete, raise the invoice from the claim.

### Release retention (Finance/Admin)

1. On the claim, under **Retention releases**, enter an **Amount** and **Due date** and choose
   **Schedule release**. Scheduled plus released totals must stay within the claim's
   retention.
2. When the client pays it back, fill **Release date** (from the invoice date through today),
   an optional **Reference** and optional **Proof document**, then **Record release** and
   confirm. A recorded release cannot be changed; a scheduled one can still be cancelled.

## What the result looks like

- The claim's stage list shows every stage with its status pill — *Completed ⟨date⟩*,
  *Current*, or *Waiting* — its age, and its documents as links.
- *Retention held: ⟨amount⟩ (⟨pct⟩%)* and *Scheduled total (including released): ⟨scheduled⟩ ·
  Released: ⟨released⟩* sit above the release list.
- The **Billing reconciliation** table lists, per contract item: **Scope**, **Progress**,
  **Measured**, **Billed**, **Billed amount**, **Unbilled**, **Surplus**, and a **Status** of
  *Unbilled*, *Partly billed*, *Fully billed* or *Surplus*. Items shared by several work
  orders show *Unknown* progress — *Progress for shared items is recorded at project level.*
- The billed amounts in the table add up to the invoiced progress claims' gross.

## Common problems

| What you see | What to do |
|---|---|
| *Attach every required document before completing this stage.* | Attach an issued or approved project document with a file to each required item, then complete the stage. |
| *Complete the earlier stages first.* | Stages complete in order; record the previous stage first. |
| *The completion date cannot be in the future.* / *A stage cannot complete before the previous one.* | Correct the **Completed on** date. |
| *Enter the client's document number.* | A client-side stage needs the client's own reference. |
| *This stage is already completed.* | Completed stages are locked, as is a withdrawn claim's whole stage plan. |
| *Only an issued or approved document can be attached.* / *The document has no file.* / *The document must be one of this project's documents.* | Pick a different document: issued or approved, with a file, belonging to this project. |
| *Complete every billing stage of this claim before raising its invoice.* (shown in place of **Raise invoice**) | Every stage must be complete first. The stages section shows which one is open. |
| *The scheduled releases exceed the retention held.* | Schedule a smaller amount; the total of scheduled and released cannot pass the claim's retention. |
| *Approve the claim invoice before recording a release.* | The claim's invoice must be submitted (not a draft, not cancelled) before a release can be recorded. |
| *Use a release date from the invoice date through today.* | Correct the release date. |
| Retention or stage list will not save for you | Only Finance or an Admin can change billing terms, retention and releases; Project Managers record stages. |

## Bahasa Indonesia

# Tahap penagihan dan retensi

## Untuk apa ini

Pekerjaan yang telah diukur sering melewati beberapa pihak sebelum bisa ditagih: pengukuran
internal, survei bersama klien, peninjauan klien, persetujuan dan penerimaan. **Tahap
penagihan** mencatat setiap langkah untuk satu klaim progres, dokumennya, dan berapa lama
tiap langkah menunggu — agar faktur keluar lengkap dan sebelum batas waktu bulanan klien.

**Retensi** adalah porsi klaim progres yang ditahan klien sampai peristiwa berikutnya
(serah terima, akhir masa pemeliharaan). PMO menahannya pada piutang: faktur dan PPN-nya tetap
bernilai penuh; jumlah yang jatuh tempo sekarang adalah faktur dikurangi retensi yang masih
ditahan. **Pelepasan retensi** adalah peristiwa jatuh tempo pembayaran yang dijadwalkan, lalu
dicatat, untuk sebagian atau seluruh retensi klaim.

Tabel **rekonsiliasi penagihan** melengkapinya: per item bill of quantities, apa yang
dikerjakan, diukur, dan ditagih, serta sisanya.

## Siapa yang dapat melakukannya

- **Menetapkan daftar tahap, batas faktur, dan persentase retensi**: Keuangan atau Admin.
- **Mencatat tahap** (melampirkan dokumen, menyelesaikan tahap): Keuangan, Admin, Manajer
  Proyek.
- **Menjadwalkan, mencatat, dan membatalkan pelepasan retensi**: Keuangan atau Admin.
- **Membaca** tahap, retensi, dan rekonsiliasi: Keuangan, Admin, Eksekutif, Manajer Proyek
  (Rekayasa dikecualikan, seperti pada klaim).

## Di mana menemukannya

- Buka proyek → tab **Kontrak**. Tombol **Ketentuan penagihan** membuka daftar tahap, batas
  waktu, dan retensi; tombol ini ada di peralatan kontrak dan pada kartu **Klaim penagihan**.
- Detail klaim menampilkan bagian **Tahap penagihan**, batas waktunya, retensi yang
  ditahannya, dan **Pelepasan retensi**-nya.
- Tabel **Rekonsiliasi penagihan** ada di bagian bawah tab.

## Langkah-langkah

### Menetapkan ketentuan penagihan proyek (sekali, Keuangan/Admin)

1. Pilih **Ketentuan penagihan**.
2. Di bawah **Tahap penagihan**, tambahkan tiap tahap berurutan: **Nama tahap**, centang **Di
   sistem klien** untuk langkah yang terjadi di sistem klien sendiri, dan daftarkan **Dokumen
   wajib** serta **Dokumen opsional**, satu per baris. Gunakan **Naik** untuk mengurutkan dan
   **Hapus** untuk menghapus; **Tambah tahap** menambah lagi.
3. Tetapkan **Batas faktur (tanggal dalam bulan)** (1–31, atau kosongkan), **Ingatkan sekian
   hari sebelumnya** (0–27, bawaan 5), dan **Retensi (%)** (0 sampai kurang dari 100).
4. **Simpan ketentuan penagihan**. Tiap klaim progres baru mengambil salinan daftar ini;
   mengubah daftar tidak pernah mengubah klaim yang sudah dibuat.

### Mengantar klaim melewati tahap-tahapnya

1. Buka klaim dan cari bagian **Tahap penagihan**nya. Tahap pertama berjalan sejak tanggal
   klaim; tiap tahap menampilkan usianya dalam hari.
2. Untuk tiap butir daftar periksa, pilih dokumen proyek (**Pilih dokumen**, lalu
   **Lampirkan**). Hanya dokumen yang diterbitkan atau disetujui dan memiliki berkas yang
   diterima; melampirkannya juga menambahkannya ke bukti penagihan klaim.
3. Pada tahap yang berjalan, isi **Tanggal selesai** (hari ini atau lebih awal, tidak sebelum
   tahap sebelumnya), masukkan **Nomor dokumen klien** untuk tahap di sistem klien, lalu pilih
   **Selesaikan tahap**. Tahap berikutnya menjadi berjalan sejak tanggal itu.
4. Perhatikan pil batas waktu — *Batas faktur ⟨tanggal⟩ · sisa ⟨n⟩ hari* — yang memberi
   peringatan saat sisa hari masuk jendela peringatan.
5. Saat semua tahap selesai, terbitkan faktur dari klaim tersebut.

### Melepas retensi (Keuangan/Admin)

1. Pada klaim, di bawah **Pelepasan retensi**, masukkan **Jumlah** dan **Tanggal jatuh tempo**
   lalu pilih **Jadwalkan pelepasan**. Total terjadwal dan terlepas harus tetap dalam retensi
   klaim.
2. Saat klien membayarnya kembali, isi **Tanggal pelepasan** (dari tanggal faktur hingga hari
   ini), **Referensi** opsional dan **Dokumen bukti** opsional, lalu **Catat pelepasan** dan
   konfirmasi. Pelepasan yang dicatat tidak dapat diubah; yang masih terjadwal masih dapat
   dibatalkan.

## Bagaimana hasilnya

- Daftar tahap klaim menampilkan tiap tahap dengan pil statusnya — *Selesai ⟨tanggal⟩*,
  *Berjalan*, atau *Menunggu* — usianya, dan dokumennya sebagai tautan.
- *Retensi ditahan: ⟨jumlah⟩ (⟨pct⟩%)* dan *Total terjadwal (termasuk yang dilepas):
  ⟨terjadwal⟩ · Dilepas: ⟨terlepas⟩* berada di atas daftar pelepasan.
- Tabel **Rekonsiliasi penagihan** memuat, per item kontrak: **Lingkup**, **Progres**,
  **Terukur**, **Ditagih**, **Jumlah ditagih**, **Belum ditagih**, **Kelebihan**, dan
  **Status** berupa *Belum ditagih*, *Ditagih sebagian*, *Ditagih penuh*, atau *Kelebihan*.
  Item yang dipakai bersama beberapa perintah kerja menampilkan progres *Tidak diketahui* —
  *Progres item bersama dicatat pada tingkat proyek.*
- Jumlah ditagih pada tabel itu dijumlah sama dengan bruto klaim progres yang telah
  difakturkan.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Lampirkan semua dokumen wajib sebelum menyelesaikan tahap ini.* | Lampirkan dokumen proyek yang diterbitkan atau disetujui dan memiliki berkas pada tiap butir wajib, lalu selesaikan tahapnya. |
| *Selesaikan tahap sebelumnya terlebih dahulu.* | Tahap diselesaikan berurutan; catat tahap sebelumnya lebih dulu. |
| *Tanggal selesai tidak boleh di masa depan.* / *Tahap tidak boleh selesai sebelum tahap sebelumnya.* | Perbaiki **Tanggal selesai**. |
| *Masukkan nomor dokumen klien.* | Tahap di sistem klien membutuhkan referensi milik klien. |
| *Tahap ini sudah selesai.* | Tahap yang selesai terkunci, demikian juga seluruh rencana tahap klaim yang ditarik. |
| *Hanya dokumen yang diterbitkan atau disetujui yang dapat dilampirkan.* / *Dokumen ini belum memiliki berkas.* / *Dokumen harus milik proyek ini.* | Pilih dokumen lain: diterbitkan atau disetujui, punya berkas, milik proyek ini. |
| *Selesaikan semua tahap penagihan klaim ini sebelum menerbitkan invoice-nya.* (tampil menggantikan **Terbitkan invoice**) | Semua tahap harus selesai dulu. Bagian tahap menunjukkan mana yang masih terbuka. |
| *Pelepasan terjadwal melebihi retensi yang ditahan.* | Jadwalkan jumlah lebih kecil; total terjadwal dan terlepas tidak boleh melewati retensi klaim. |
| *Setujui faktur tagihan sebelum mencatat pelepasan.* | Faktur klaim harus sudah diajukan (bukan draf, bukan dibatalkan) sebelum pelepasan dapat dicatat. |
| *Gunakan tanggal pelepasan dari tanggal faktur hingga hari ini.* | Perbaiki tanggal pelepasan. |
| Ketentuan penagihan atau retensi tidak mau tersimpan oleh Anda | Hanya Keuangan atau Admin yang dapat mengubah ketentuan penagihan, retensi, dan pelepasan; Manajer Proyek mencatat tahap. |
