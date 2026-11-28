# Raise an invoice from a claim

## What this is for

A **claim** is one thing you are billing: measured progress on the contract, or a down payment the
client agreed to pay in advance. Each claim becomes one invoice. Raising the invoice from its claim
keeps the invoice tied to the work, so the project always shows what has been billed and what is
still left to bill.

## Who can do this

- **Create a claim and raise its invoice**: Admin, Finance.
- **Attach a claim's evidence**: Admin, Finance.
- **Read the claims and their invoices**: Admin, Executive, Project Manager, Finance.
- **Record a claim's billing stages**: Admin, Finance, Project Manager (see
  [Billing stages and retention](../office/billing-stages-and-retention.md)).
- The person who raises the invoice **cannot approve it**. Another Admin or Finance user approves
  it (see [Approve an invoice someone else prepared](approve-an-invoice.md)).

## Where to find it

- Open a project → **Contract** tab.
- The **Billing claims** card lists the project's claims and holds **New claim**.
- Time-and-materials claims sit in the **Time and materials** section of the same tab.

## Steps

### Bill measured progress

1. On the **Contract** tab, choose **New claim**.
2. Set **Claim type** to **Progress: quantities against the bill of quantities**.
3. If the project bills through more than one work order, pick the one this claim bills under
   **Bills**.
4. Under **Quantities to bill**, enter the quantity for each line. The button
   **Start from the ⟨month⟩ assessment** fills the lines with the quantities already assessed.
5. Choose **Create claim**. The claim is created as a draft.
6. On the claim, choose **Attach evidence** and attach the project documents the client expects.
   A claim with no evidence cannot be invoiced.
7. Choose **Raise invoice**. Check the figures — the gross claim, any down payment recovered, and
   the net — then confirm with **Create invoice**.
8. The invoice is created as a **Draft**. It needs another Admin or Finance user to approve it.

If your organisation keeps its invoices in an accounting system, step 7 creates the invoice there
instead, and the confirm button reads **Create ERP invoice**.

### Take a down payment

1. Choose **New claim** and set **Claim type** to **Down payment**.
2. Enter the **Down payment amount (excl. tax)** and the percentage **Recovered from each claim (%)**.
   The percentage is suggested in proportion to the contract; you can change it.
3. Choose **Create claim**, attach the evidence, then **Raise invoice**.

Recovery of the down payment is covered in
[Down payments and recovery](down-payments-and-recovery.md).

### Bill a time-and-materials claim

1. In the **Time and materials** section, preview the approved hours for a period under
   **Assemble a claim**, then choose **Assemble claim**.
2. Choose **Prepare sign-off** and attach an issued or approved project document.
3. A different Admin or Finance user confirms it with **Confirm sign-off**.
4. Once the claim reads **Signed off**, choose **Create invoice**.

## What the result looks like

- The claim's row shows its kind, what was claimed, any down payment recovered, the net, how many
  evidence documents it has, and its **Invoice** column: *Not raised*, then the invoice number and
  status.
- The project's **Billing summary** shows **Contract value**, **Assessed to date**,
  **Billed to date**, **Remaining**, **Down payment held**, and **Work done, not yet billed**.
- Where invoices are written in PMO, the new invoice appears in
  [Receivables](who-owes-what-and-ageing.md) as a **Draft**. Once it is approved it gets its number
  and becomes **Unpaid**, and it can receive payments.

## Common errors and what to do

- **"Claims need evidence attached before an invoice draft can be raised."** — attach at least one
  project document to the claim under **Attach evidence**.
- **"Complete every billing stage of this claim before raising its invoice."** — the claim's billing
  stages are not all complete. Open the claim's **Billing stages** section and finish the open one
  (see [Billing stages and retention](../office/billing-stages-and-retention.md)).
- **"This claim already has an invoice."** — one claim makes one invoice. If the invoice is wrong,
  cancel it and raise a new claim (see
  [Cancel an invoice and bill again](cancel-an-invoice-and-bill-again.md)).
- **"This claim is invoiced from its sign-off, not from here."** — a time-and-materials claim is
  invoiced from its own section after the client sign-off is confirmed.
- **"This project has no client to invoice. Set the client on the project first."** — record the
  client on the project, then raise the claim's invoice.
- **"This claim's net is zero, so there is nothing to invoice."** — the claim is fully absorbed by
  down-payment recovery. Withdraw it and assemble it again.
- **"This claim's net lines do not add up to its total."** — withdraw the claim and assemble it
  again; do not try to invoice it.
- **"An invoice for this claim is still being raised. Wait for it to finish."** — the invoice is
  still being created. Wait, then refresh the page.
- **An over-claim warning appears** — a warning lets you continue. A message beginning
  **"Will be refused"** means the quantity is more than the client has accepted or surveyed;
  lower the quantity, or have the next acceptance confirmed first.

---

## Bahasa Indonesia

# Menerbitkan invoice dari klaim

## Untuk apa ini

**Klaim** adalah satu hal yang Anda tagihkan: progres terukur pada kontrak, atau uang muka yang
disetujui klien untuk dibayar di muka. Setiap klaim menjadi satu invoice. Menerbitkan invoice dari
klaimnya menjaga invoice tetap terikat pada pekerjaannya, sehingga proyek selalu menunjukkan apa
yang sudah ditagih dan apa yang masih harus ditagih.

## Siapa yang dapat melakukannya

- **Membuat klaim dan menerbitkan invoice-nya**: Admin, Keuangan.
- **Melampirkan bukti klaim**: Admin, Keuangan.
- **Membaca klaim dan invoice-nya**: Admin, Eksekutif, Manajer Proyek, Keuangan.
- **Mencatat tahap penagihan klaim**: Admin, Keuangan, Manajer Proyek (lihat
  [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).
- Orang yang menerbitkan invoice **tidak dapat menyetujuinya**. Admin atau pengguna Keuangan lain
  yang menyetujuinya (lihat [Menyetujui invoice yang dibuat orang lain](approve-an-invoice.md)).

## Di mana menemukannya

- Buka proyek → tab **Kontrak**.
- Kartu **Klaim penagihan** memuat daftar klaim proyek dan tombol **Klaim baru**.
- Klaim time and materials ada di bagian **Time and materials** pada tab yang sama.

## Langkah-langkah

### Menagih progres terukur

1. Di tab **Kontrak**, pilih **Klaim baru**.
2. Isi **Claim type** dengan **Progress: quantities against the bill of quantities**.
3. Bila proyek menagih lewat lebih dari satu perintah kerja, pilih perintah kerja yang ditagih pada
   **Bills**.
4. Di bawah **Quantities to bill**, masukkan kuantitas tiap baris. Tombol
   **Start from the ⟨month⟩ assessment** mengisi baris dengan kuantitas yang sudah diukur.
5. Pilih **Create claim**. Klaim dibuat sebagai draf.
6. Pada klaim, pilih **Attach evidence** dan lampirkan dokumen proyek yang diminta klien. Klaim
   tanpa bukti tidak dapat diterbitkan invoice-nya.
7. Pilih **Raise invoice**. Periksa angkanya — nilai bruto klaim, uang muka yang dipulihkan, dan
   netonya — lalu konfirmasi dengan **Create invoice**.
8. Invoice dibuat sebagai **Draf**. Invoice ini menunggu Admin atau pengguna Keuangan lain untuk
   menyetujuinya.

Bila organisasi Anda menyimpan invoice di sistem akuntansi, langkah 7 membuat invoice di sana, dan
tombol konfirmasinya berbunyi **Create ERP invoice**.

### Mengambil uang muka

1. Pilih **Klaim baru** dan isi **Claim type** dengan **Down payment**.
2. Isi **Down payment amount (excl. tax)** dan persentase **Recovered from each claim (%)**.
   Persentasenya diusulkan sebanding dengan kontrak; Anda dapat mengubahnya.
3. Pilih **Create claim**, lampirkan buktinya, lalu **Raise invoice**.

Pemulihan uang muka dijelaskan di [Uang muka dan pemulihannya](down-payments-and-recovery.md).

### Menagih klaim time and materials

1. Di bagian **Time and materials**, pratinjau jam yang disetujui untuk satu periode pada
   **Assemble a claim**, lalu pilih **Assemble claim**.
2. Pilih **Prepare sign-off** dan lampirkan dokumen proyek yang diterbitkan atau disetujui.
3. Admin atau pengguna Keuangan lain mengonfirmasinya dengan **Confirm sign-off**.
4. Saat klaim bertanda **Signed off**, pilih **Create invoice**.

## Bagaimana hasilnya

- Baris klaim menunjukkan jenisnya, yang diklaim, uang muka yang dipulihkan, netonya, jumlah
  dokumen buktinya, dan kolom **Invoice**: *Not raised*, lalu nomor serta status invoice-nya.
- **Billing summary** proyek menampilkan **Contract value**, **Assessed to date**,
  **Billed to date**, **Remaining**, **Down payment held**, dan **Work done, not yet billed**.
- Bila invoice ditulis di PMO, invoice baru muncul di [Piutang](who-owes-what-and-ageing.md) sebagai
  **Draf**. Setelah disetujui, invoice mendapat nomornya, menjadi **Belum dibayar**, dan dapat
  menerima pembayaran.

## Kesalahan umum dan cara mengatasinya

- **"Claims need evidence attached before an invoice draft can be raised."** — lampirkan minimal
  satu dokumen proyek pada klaim lewat **Attach evidence**.
- **"Complete every billing stage of this claim before raising its invoice."** — tahap penagihan
  klaim belum semua selesai. Buka bagian **Billing stages** klaim dan selesaikan yang masih terbuka
  (lihat [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).
- **"This claim already has an invoice."** — satu klaim menghasilkan satu invoice. Bila invoice-nya
  salah, batalkan lalu buat klaim baru (lihat
  [Membatalkan invoice dan menagih ulang](cancel-an-invoice-and-bill-again.md)).
- **"This claim is invoiced from its sign-off, not from here."** — klaim time and materials
  diterbitkan invoice-nya dari bagiannya sendiri setelah sign-off klien dikonfirmasi.
- **"This project has no client to invoice. Set the client on the project first."** — catat klien
  pada proyek, lalu terbitkan invoice klaimnya.
- **"This claim's net is zero, so there is nothing to invoice."** — seluruh klaim terserap
  pemulihan uang muka. Tarik klaim dan susun ulang.
- **"This claim's net lines do not add up to its total."** — tarik klaim dan susun ulang; jangan
  coba menerbitkan invoice-nya.
- **"An invoice for this claim is still being raised. Wait for it to finish."** — invoice masih
  dibuat. Tunggu, lalu muat ulang halaman.
- **Muncul peringatan kelebihan klaim** — peringatan biasa boleh dilanjutkan. Pesan yang dimulai
  **"Will be refused"** berarti kuantitasnya melebihi yang sudah diterima atau diukur klien;
  turunkan kuantitasnya, atau konfirmasi penerimaan berikutnya lebih dulu.
