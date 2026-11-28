# Record a supplier payment

## What this is for

Paying a supplier happens in two steps: the supplier's **invoice** is recorded on the purchase, and
then the **payment** is recorded against that invoice. When a tax amount is withheld from the
supplier, it is stated on the invoice, so the payment settles the invoice net of it.

## Who can do this

- **Record the supplier invoice and the payment**: Admin, Finance.
- **Read purchases, supplier invoices and payments**: Admin, Executive, Project Manager, Finance.
- If **Record payment** is unavailable and a line beside it says the approver cannot pay their own
  purchase, you approved this purchase: another Admin or Finance user records the payment.

## Where to find it

- **Finance** → **Payables** → **New vendor bill**, to start from a purchase that is waiting for its
  supplier invoice.
- Or open the purchase itself: **Procurement** → the purchase → **Files** tab. The **Case documents**
  panel lists its documents and holds the capture row at its foot.

## Steps

### Record the supplier invoice, with tax withheld

1. Open the purchase and go to its **Files** tab.
2. In the capture row at the foot of **Case documents**, choose **Capture Supplier invoice** — or,
   from **Payables**, choose **New vendor bill**, pick the **Purchase** and **Continue to the bill**.
3. Enter the **Invoice #** (optional), the **Invoice status** (**Received** or **Scheduled**) and the
   **Invoice date**.
4. Enter the **Amount** and its **Tax treatment** (**Inclusive: VAT included** or **Exclusive: VAT
   added**) and the **Tax amount**. The invoice cannot be saved until the tax treatment and tax
   amount are stated.
5. Set **Tax withheld** to **None**, **PPh 23** or **PPh 4(2)**. With a type chosen, enter the
   **PPh amount**. The supplier's default rate is offered as a suggestion (*Supplier default ⟨n⟩% of
   ⟨amount⟩*); you can change it.
6. Choose **Save supplier invoice** and confirm **Record this supplier invoice?**.

### Record the payment

1. On the same purchase, the capture row now offers **Record payment**. Choose it.
2. Enter the supplier's **External ref** for the payment — required.
3. Set the **Date**.
4. In **Links to invoice**, choose the supplier invoice this payment closes.
5. Check the **Amount**. You may pay less for a part payment.
6. Choose **Save Payment**. The message **Payment recorded** appears.

## What the result looks like

- The **Case documents** panel gains a **Payment** row.
- Once the invoice is fully paid it leaves [Payables](what-to-pay-and-overdue.md), and
  **To pay suppliers** falls by the amount paid. A part payment leaves the rest on the list.
- An invoice held by the three-way match says so (*⟨invoice⟩ is held by the three-way match, so
  payments wait.*) (see [Three-way match](../office/three-way-match.md)).

## Common errors and what to do

- **"Select the supplier invoice this payment closes."** — choose one in **Links to invoice**.
- **"Payment already in progress"** — *A payment for this bill is already in progress. Wait for it to
  finish before paying again.* Do not record it again.
- **Record payment is unavailable and a line says the approver cannot pay their own purchase** —
  you approved this purchase. Ask another Admin or Finance user to record the payment.
- **A payment went in twice** — ask an Admin to review the purchase's documents before recording it
  again.
- **The supplier invoice has no withholding but the supplier's slip shows one** — record the
  withholding slip (see [Record a withholding slip](record-a-withholding-slip.md)).

---

## Bahasa Indonesia

# Mencatat pembayaran supplier

## Untuk apa ini

Membayar supplier berlangsung dua langkah: **invoice** supplier dicatat pada pengadaan, lalu
**pembayaran** dicatat terhadap invoice itu. Bila ada pajak yang dipotong dari supplier, pajaknya
dicantumkan pada invoice, sehingga pembayaran melunasi invoice setelah dipotong pajak.

## Siapa yang dapat melakukannya

- **Mencatat invoice supplier dan pembayarannya**: Admin, Keuangan.
- **Membaca pengadaan, invoice supplier, dan pembayaran**: Admin, Eksekutif, Manajer Proyek,
  Keuangan.
- Bila **Catat pembayaran** tidak tersedia dan sebuah baris di sampingnya menyebut penyetuju tidak
  dapat membayar pengadaan yang disetujuinya sendiri, Anda yang menyetujui pengadaan ini: Admin atau
  pengguna Keuangan lain yang mencatat pembayarannya.

## Di mana menemukannya

- **Keuangan** → **Utang** → **Invoice supplier baru**, untuk mulai dari pengadaan yang menunggu
  invoice supplier-nya.
- Atau buka pengadaannya: **Pengadaan** → pengadaannya → tab **Berkas**. Panel **Dokumen kasus**
  memuat daftar dokumennya dan baris pencatatan di bagian bawah.

## Langkah-langkah

### Mencatat invoice supplier, dengan pajak yang dipotong

1. Buka pengadaan dan masuk ke tab **Berkas**.
2. Di baris pencatatan pada bagian bawah **Dokumen kasus**, pilih **Catat Supplier invoice** — atau,
   dari **Utang**, pilih **Invoice supplier baru**, pilih **Pembelian**, lalu **Lanjut ke tagihan**.
3. Isi **No. invoice** (opsional), **Status invoice** (**Diterima** atau **Dijadwalkan**), dan
   **Tanggal invoice**.
4. Isi **Jumlah**, **Perlakuan pajak** (**Inklusif: termasuk PPN** atau **Eksklusif: PPN
   ditambahkan**), dan **Jumlah pajak**. Invoice tidak dapat disimpan sebelum perlakuan pajak dan
   jumlah pajaknya diisi.
5. Atur **Pajak dipotong** ke **Tidak ada**, **PPh 23**, atau **PPh 4(2)**. Setelah jenisnya dipilih,
   isi **Jumlah PPh**. Tarif bawaan supplier ditawarkan sebagai saran (*Default supplier ⟨n⟩% dari
   ⟨jumlah⟩*); Anda dapat mengubahnya.
6. Pilih **Simpan invoice supplier** dan konfirmasi **Catat invoice supplier ini?**.

### Mencatat pembayaran

1. Pada pengadaan yang sama, baris pencatatan kini menawarkan **Catat pembayaran**. Pilih itu.
2. Isi **Ref eksternal** supplier untuk pembayaran itu — wajib.
3. Atur **Tanggal**.
4. Di **Terkait ke invoice**, pilih invoice supplier yang ditutup pembayaran ini.
5. Periksa **Jumlah**. Anda boleh membayar lebih kecil untuk pembayaran sebagian.
6. Pilih **Simpan pembayaran**. Pesan **Pembayaran dicatat** muncul.

## Bagaimana hasilnya

- Panel **Dokumen kasus** bertambah satu baris **Pembayaran**.
- Setelah invoice lunas, invoice itu keluar dari [Utang](what-to-pay-and-overdue.md), dan
  **Yang harus dibayar kepada supplier** turun sebesar yang dibayar. Pembayaran sebagian
  meninggalkan sisanya di daftar.
- Invoice yang ditahan pencocokan tiga arah menyatakannya (*⟨invoice⟩ ditahan oleh pencocokan tiga
  arah, sehingga pembayaran menunggu.*) (lihat [Pencocokan tiga arah](../office/three-way-match.md)).

## Kesalahan umum dan cara mengatasinya

- **"Pilih invoice supplier yang ditutup oleh pembayaran ini."** — pilih satu di **Terkait ke
  invoice**.
- **"Pembayaran sedang berlangsung"** — *Pembayaran untuk tagihan ini sedang berlangsung. Tunggu
  hingga selesai sebelum membayar lagi.* Jangan catat lagi.
- **Catat pembayaran tidak tersedia dan sebuah baris menyebut penyetuju tidak dapat membayar
  pengadaan yang disetujuinya sendiri** — Anda yang menyetujui pengadaan ini. Minta Admin atau
  pengguna Keuangan lain mencatat pembayarannya.
- **Sebuah pembayaran tercatat dua kali** — minta Admin memeriksa dokumen pengadaan sebelum mencatat
  lagi.
- **Invoice supplier tidak punya pemotongan tetapi bukti potong supplier menunjukkannya** — catat
  bukti potongnya (lihat [Mencatat bukti potong](record-a-withholding-slip.md)).
