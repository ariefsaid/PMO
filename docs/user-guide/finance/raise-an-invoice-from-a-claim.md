# Raise an invoice from a claim

## What this is for

A **claim** is one thing you are billing: measured progress on the contract, or a down payment the
client agreed to pay in advance. Each claim becomes one invoice. Raising the invoice from its claim
keeps the invoice tied to the work, so the project always shows what has been billed and what is
still left to bill.

## Who can do this

- **Create a claim, attach its evidence and raise its invoice**: Admin, Finance.
- **Read the claims and their invoices**: Admin, Executive, Project Manager, Finance.
- **Record a claim's billing stages**: Admin, Finance, Project Manager (see
  [Billing stages and retention](../office/billing-stages-and-retention.md)).
- The person who raises the invoice cannot approve it. Another Admin or Finance user approves it
  (see [Approve an invoice someone else prepared](approve-an-invoice.md)).

## Where to find it

- Open a project → **Contract** tab.
- The **Claims & down payment** card lists the project's claims and holds **New claim**.
- Time-and-materials claims have their own **Time-and-materials claims** list on the same tab.

## Steps

### Bill measured progress

1. On the **Contract** tab, choose **New claim**.
2. Set **Claim type** to **Progress: quantities against the bill of quantities**.
3. Under **Bills**, pick what the claim bills: a work order, or **Lines with no work order**.
4. Under **Quantities to bill**, enter the quantity for each line. Where the button
   **Start from the ⟨month⟩ assessment** (or **Start from the surveyed quantities** / **Start from
   the accepted BAST quantities**) is offered, it fills the lines for you.
5. Choose **Create claim**. The message **Billing claim created** appears.
6. On the claim, choose **Attach evidence**, pick the **Evidence document** and choose **Attach**.
   Only an issued or approved project document with a file can be attached. A claim with no
   evidence cannot be invoiced.
7. Choose **Raise invoice**. The window shows **Claimed**, **Down payment recovered** and
   **Net (excl. tax)**. Check them, then confirm with **Create invoice**.
8. The message **Invoice drafted in PMO** appears. The invoice is a draft; another Admin or Finance
   user approves it.

If your organisation keeps its invoices in an accounting system, the window is titled **Raise this
claim's invoice?**, the confirm button reads **Create ERP invoice**, and the message reads **Invoice
raised in the ERP**.

### Take a down payment

1. Choose **New claim** and set **Claim type** to **Down payment**.
2. Enter the **Down payment amount (excl. tax)** and **Recovered from each claim (%)**. A hint under
   the percentage shows **Proportional to the contract: ⟨n⟩%**; you can change the percentage.
3. Choose **Create claim**, attach the evidence, then **Raise invoice**.

Recovery of the down payment is covered in
[Down payments and recovery](down-payments-and-recovery.md).

### Bill a time-and-materials claim

1. In **Assemble a claim**, choose the period (**From**, **To**) and look at the approved hours the
   preview shows, then choose **Assemble claim**.
2. Open the claim and choose **Prepare sign-off**. Pick an issued or approved project document with
   a file.
3. A different user confirms it with **Confirm sign-off**.
4. Once the claim reads **Signed off**, choose **Create invoice**.

## What the result looks like

- The claim's row shows its kind (**Progress** or **Down payment**) and date, **Gross**,
  **DP recovery**, **Net** and its **Invoice** column: *Not raised*, then the invoice number once
  raised. The **Evidence** column counts the attached documents.
- A claim waiting for evidence shows **Attach evidence** in its **Invoice** column; once it has
  evidence, **Raise invoice** takes its place.
- The card also shows **Work done, not yet billed** (or **Billed ahead of progress**) and
  **Down payment held**. **Billing summary details** opens **Billed to date**, **Contract value**,
  **Contract not yet billed**, **Assessed to date** (or **Earned to date**) and **Claims raised, not
  yet submitted**.
- Where invoices are written in PMO, the new invoice appears in
  [Receivables](who-owes-what-and-ageing.md) as **Draft · needs a second approver**. Once it is
  approved it gets its number and becomes **Unpaid**, and it can receive payments.

## Common errors and what to do

- **"Claims need evidence attached before an invoice draft can be raised."** — attach at least one
  project document to the claim with **Attach evidence**.
- **"Complete every billing stage of this claim before raising its invoice."** — the claim's billing
  stages are not all complete. Open the claim's **Billing stages** section and finish the open one
  with **Complete stage** (see
  [Billing stages and retention](../office/billing-stages-and-retention.md)).
- **"This claim already has an invoice."** — one claim makes one invoice. If the invoice is wrong,
  cancel it (see [Cancel an invoice and bill again](cancel-an-invoice-and-bill-again.md)).
- **"This claim is invoiced from its sign-off, not from here."** — a time-and-materials claim is
  invoiced from its own list after the sign-off is confirmed.
- **"This project has no client to invoice. Set the client on the project first."** — record the
  client on the project, then raise the claim's invoice.
- **"This claim's net is zero, so there is nothing to invoice. Withdraw it."** — withdraw the claim
  with **Withdraw** in its menu.
- **"This claim's lines do not add up to its total. Withdraw it and assemble it again."** — withdraw
  the claim and create it again; do not try to invoice it.
- **"An invoice for this claim is still being raised in the ERP. Wait for it to finish."** — wait,
  then refresh the page.
- **"This claim was withdrawn. Its invoice can't be raised."** — a withdrawn claim stays as a record;
  create a new claim.
- **An over-claim warning appears** — a message beginning **"Warning"** still lets you raise the
  claim. A message beginning **"Will be refused"** means the quantity is more than the client has
  accepted or surveyed; lower the quantity, or have the next acceptance confirmed first.

---

## Bahasa Indonesia

# Menerbitkan invoice dari tagihan

## Untuk apa ini

**Tagihan** (klaim) adalah satu hal yang Anda tagihkan: progres terukur pada kontrak, atau uang
muka yang disetujui klien untuk dibayar di muka. Setiap tagihan menjadi satu invoice. Menerbitkan
invoice dari tagihannya menjaga invoice tetap terikat pada pekerjaannya, sehingga proyek selalu
menunjukkan apa yang sudah ditagih dan apa yang masih harus ditagih.

## Siapa yang dapat melakukannya

- **Membuat tagihan, melampirkan buktinya, dan menerbitkan invoice-nya**: Admin, Keuangan.
- **Membaca tagihan dan invoice-nya**: Admin, Eksekutif, Manajer Proyek, Keuangan.
- **Mencatat tahap penagihan**: Admin, Keuangan, Manajer Proyek (lihat
  [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).
- Orang yang menerbitkan invoice tidak dapat menyetujuinya. Admin atau pengguna Keuangan lain
  yang menyetujuinya (lihat [Menyetujui invoice yang dibuat orang lain](approve-an-invoice.md)).

## Di mana menemukannya

- Buka proyek → tab **Kontrak**.
- Kartu **Tagihan & uang muka** memuat daftar tagihan proyek dan tombol **Tagihan baru**.
- Tagihan waktu dan material punya daftar sendiri, **Klaim waktu dan material**, pada tab yang
  sama.

## Langkah-langkah

### Menagih progres terukur

1. Di tab **Kontrak**, pilih **Tagihan baru**.
2. Isi **Jenis tagihan** dengan **Progres: kuantitas terhadap bill of quantities**.
3. Pada **Menagih**, pilih apa yang ditagih: sebuah perintah kerja, atau **Baris tanpa perintah
   kerja**.
4. Di bawah **Kuantitas yang ditagih**, masukkan kuantitas tiap baris. Bila tombol
   **Mulai dari penilaian ⟨bulan⟩** (atau **Mulai dari kuantitas yang disurvei** / **Mulai dari
   kuantitas BAST yang diterima**) ditawarkan, tombol itu mengisi barisnya untuk Anda.
5. Pilih **Buat tagihan**. Pesan **Tagihan dibuat** muncul.
6. Pada tagihannya, pilih **Lampirkan bukti**, pilih **Dokumen bukti**, lalu pilih **Lampirkan**.
   Hanya dokumen proyek berstatus diterbitkan atau disetujui yang memiliki berkas yang dapat
   dilampirkan. Tagihan tanpa bukti tidak dapat diinvoice.
7. Pilih **Terbitkan invoice**. Jendelanya menampilkan **Ditagih**, **Uang muka dipulihkan**, dan
   **Neto (belum termasuk PPN)**. Periksa, lalu konfirmasi dengan **Buat invoice**.
8. Pesan **Draf invoice dibuat di PMO** muncul. Invoice itu draf; Admin atau pengguna Keuangan lain
   yang menyetujuinya.

Bila organisasi Anda menyimpan invoice di sistem akuntansi, jendelanya berjudul **Terbitkan invoice
tagihan ini?**, tombol konfirmasinya berbunyi **Buat invoice ERP**, dan pesannya berbunyi **Invoice
diterbitkan di ERP**.

### Mengambil uang muka

1. Pilih **Tagihan baru** dan isi **Jenis tagihan** dengan **Uang muka**.
2. Masukkan **Nilai uang muka (belum termasuk PPN)** dan **Dipulihkan dari setiap tagihan (%)**.
   Petunjuk di bawah persentase menampilkan **Proporsional terhadap kontrak: ⟨n⟩%**; Anda dapat
   mengubah persentasenya.
3. Pilih **Buat tagihan**, lampirkan buktinya, lalu **Terbitkan invoice**.

Pemulihan uang muka dijelaskan di [Uang muka dan pemulihannya](down-payments-and-recovery.md).

### Menagih tagihan waktu dan material

1. Di **Susun klaim**, pilih periodenya (**Dari**, **Sampai**) dan lihat jam kerja yang disetujui
   pada pratinjau, lalu pilih **Susun klaim**.
2. Buka klaimnya dan pilih **Siapkan persetujuan**. Pilih dokumen proyek berstatus diterbitkan atau
   disetujui yang memiliki berkas.
3. Pengguna lain mengonfirmasinya dengan **Konfirmasi persetujuan**.
4. Setelah klaim berbunyi **Disetujui klien**, pilih **Buat invoice**.

## Bagaimana hasilnya

- Baris tagihan menampilkan jenisnya (**Progres** atau **Uang muka**) dan tanggalnya, **Bruto**,
  **Uang muka dipulihkan**, **Neto**, dan kolom **Invoice**-nya: *Belum diterbitkan*, lalu nomor
  invoice setelah diterbitkan. Kolom **Bukti** menghitung dokumen yang dilampirkan.
- Tagihan yang menunggu bukti menampilkan **Lampirkan bukti** di kolom **Invoice**-nya; setelah ada
  bukti, **Terbitkan invoice** menggantikannya.
- Kartu itu juga menampilkan **Pekerjaan selesai, belum ditagih** (atau **Ditagih melebihi
  progres**) dan **Uang muka tertahan**. **Rincian ringkasan penagihan** membuka **Ditagih s.d. saat
  ini**, **Nilai kontrak**, **Kontrak belum ditagih**, **Dinilai s.d. saat ini** (atau **Diperoleh
  s.d. saat ini**), dan **Klaim diterbitkan, belum dikirim**.
- Bila invoice ditulis di PMO, invoice baru muncul di [Piutang](who-owes-what-and-ageing.md)
  sebagai **Draf · perlu penyetuju kedua**. Setelah disetujui, invoice mendapat nomornya dan menjadi
  **Belum dibayar**, dan dapat menerima pembayaran.

## Kesalahan umum dan cara mengatasinya

- **"Klaim harus dilengkapi bukti sebelum draf invoice dapat dibuat."** — lampirkan setidaknya satu
  dokumen proyek pada tagihan dengan **Lampirkan bukti**.
- **"Selesaikan semua tahap penagihan klaim ini sebelum menerbitkan invoice-nya."** — tahap penagihan
  tagihan belum semuanya selesai. Buka bagian **Tahap penagihan** pada tagihan dan selesaikan yang
  terbuka dengan **Selesaikan tahap** (lihat
  [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).
- **"Tagihan ini sudah memiliki invoice."** — satu tagihan membuat satu invoice. Bila invoice-nya
  salah, batalkan (lihat [Membatalkan invoice dan menagih ulang](cancel-an-invoice-and-bill-again.md)).
- **"Invoice tagihan ini dibuat dari persetujuannya, bukan dari sini."** — tagihan waktu dan material
  diinvoice dari daftarnya sendiri setelah persetujuan dikonfirmasi.
- **"Proyek ini belum punya klien untuk ditagih. Atur klien proyek terlebih dahulu."** — catat
  kliennya pada proyek, lalu terbitkan invoice tagihannya.
- **"Nilai neto tagihan ini nol, jadi tidak ada yang bisa diinvoice. Tarik tagihan ini."** — tarik
  tagihan dengan **Tarik** di menunya.
- **"Rincian tagihan ini tidak sesuai dengan totalnya. Tarik tagihan lalu susun ulang."** — tarik
  tagihan dan buat lagi; jangan coba menginvoice-nya.
- **"Invoice untuk tagihan ini masih diterbitkan di ERP. Tunggu sampai selesai."** — tunggu, lalu
  muat ulang halaman.
- **"Tagihan ini telah ditarik. Invoice-nya tidak dapat diterbitkan."** — tagihan yang ditarik tetap
  menjadi catatan; buat tagihan baru.
- **Peringatan kelebihan klaim muncul** — pesan yang diawali **"Peringatan"** tetap mengizinkan Anda
  menerbitkan tagihan. Pesan yang diawali **"Akan ditolak"** berarti kuantitasnya melebihi yang
  sudah diterima atau disurvei klien; turunkan kuantitasnya, atau konfirmasikan dulu penerimaan
  berikutnya.
