# Record the supplier invoice

## What this is for

When the supplier sends their invoice for goods that arrived, record it on the purchase. The
invoice closes the buying trail — request, order, receipt, invoice — and lets Finance pay it. The
tax on the invoice is recorded here too, because it cannot be worked out later.

## Who can do this

- **Record a supplier invoice:** Finance or Admin.
- **Approve an amount higher than the approved amount:** an approver, when the invoice is bigger
  than what was approved — never the person who recorded the bill, chose the quote or raised the
  request.
- **Record the payment:** Finance or Admin, and never the person who approved the purchase.

## Where to find it

- **Procurement** in the menu, then open the purchase. While it is at **Goods receipt**, the filled
  button is **Record supplier invoice**.
- The invoice can also be entered with **Record another document → Supplier invoice** on the
  purchase.

## Steps

1. Open the purchase and check the order and the receipt are right.
2. Choose **Record supplier invoice**.
3. Fill in the invoice:
   - **Invoice #** — the supplier's invoice number (optional, but record it when you have it).
   - **Invoice date**.
   - **Amount (optional)** — the invoice total. Record it: a purchase with neither line items nor an
     amount cannot be marked paid.
   - **Invoice status** — **Received**, or **Scheduled** when payment is planned for a later date.
   - **Tax treatment** — **Inclusive: VAT included** when VAT is already in the amount, or
     **Exclusive: VAT added** when VAT comes on top. There is no default: you must choose.
   - **Tax amount** — the tax on the invoice. Enter 0 when there is no tax.   - If you know the rate, you may enter the **Nominal tax rate (%)** and the **Tax base (DPP)**
     instead of the amount; the tax amount is then calculated. The tax fields do not appear where
     your accounting system owns the tax.
   - **Tax withheld** — **None**, **PPh 23** or **PPh 4(2)**, and its **PPh amount**, when tax is
     withheld from this supplier. The supplier's saved defaults pre-fill these.
4. Choose **Confirm & mark invoiced** (or **Save supplier invoice** if you used **Record another
   document**). The confirmation **Record this supplier invoice?** names the case; confirm with
   **Save supplier invoice**.
5. Finance records the payment on the same page with **Record payment**, or **Mark as Paid** where
   the page offers it. A purchase cannot be paid by the person who approved it.

## What the result looks like

- The purchase moves to **Supplier invoice**. **Money** shows **Invoiced**, and what is still
  **Unpaid**.
- The **Timeline** lists the invoice with its number, date, amount and tax, and the **Files** tab
  holds it as a record you can attach the scanned invoice to.
- The purchase waits for payment: **Record payment** for Finance. After payment it reads **Paid**
  and the project's spending includes it once.
- If your organisation switched on the three-way match, the bill is checked against the order and
  the receipts. A bill that does not line up is held, and payments wait until the receipt is
  recorded or an exception is approved. See
  [Three-way match](../office/three-way-match.md).

## Common errors and what to do

- **"State the tax treatment and the tax amount to record this invoice"** — choose the treatment
  and enter the tax amount, even when it is 0. Whether the amount already includes tax cannot be
  worked out afterwards.
- **"Enter the bill amount to calculate the supplier withholding."** — enter the invoice amount
  before the withholding can be calculated.
- **The invoice is above the approved amount** — the page says the billed amount exceeds the approved
  amount and offers **Approve higher amount** to an eligible approver. The approved amount becomes the
  billed amount, and that approver cannot pay the purchase themselves.
- **"Payment held by the three-way match"** — a bill on this purchase does not match its order and
  receipts. Record the missing receipt, correct the bill lines, or ask Finance to approve an
  exception; see [Three-way match](../office/three-way-match.md).
- **"Add a line item or a document with an amount before marking this paid."** — the invoice has no
  amount recorded. Enter it, then pay.
- **"Payment must be released by a different finance user."** — the person who approved the
  purchase cannot also pay it. Ask another Finance user.

---

## Bahasa Indonesia

# Catat invoice supplier

## Untuk apa ini

Saat supplier mengirim tagihan untuk barang yang sudah datang, catat tagihannya pada pembelian.
Tagihan menutup rangkaian pembelian — permintaan, pesanan, penerimaan, tagihan — dan memungkinkan
Keuangan membayarnya. Pajak pada tagihan juga dicatat di sini, karena tidak dapat dihitung
belakangan.

## Siapa yang dapat melakukannya

- **Mencatat invoice supplier:** Keuangan atau Admin.
- **Menyetujui jumlah yang lebih tinggi dari jumlah disetujui:** pemberi persetujuan, bila tagihan
  lebih besar dari yang disetujui — bukan orang yang mencatat tagihan, memilih penawaran, atau
  mengajukan permintaan.
- **Mencatat pembayaran:** Keuangan atau Admin, dan bukan orang yang menyetujui pembelian.

## Di mana menemukannya

- **Pengadaan** di menu, lalu buka pembelian. Selama berstatus **Penerimaan barang**, tombol penuh
  adalah **Catat invoice supplier**.
- Tagihan juga dapat dimasukkan dengan **Catat dokumen lain → Invoice supplier** pada pembelian.

## Langkah-langkah

1. Buka pembelian dan pastikan pesanan serta penerimaannya sudah benar.
2. Pilih **Catat invoice supplier**.
3. Isi tagihannya:
   - **No. invoice** — nomor invoice supplier (opsional, tetapi catat bila ada).
   - **Tanggal invoice**.   - **Jumlah (opsional)** — total tagihan. Isi: pembelian tanpa item baris maupun jumlah tidak dapat
     ditandai lunas.
   - **Status invoice** — **Diterima**, atau **Dijadwalkan** bila pembayaran direncanakan pada
     tanggal lain.
   - **Perlakuan pajak** — **Inklusif: termasuk PPN** bila PPN sudah termasuk dalam jumlah, atau
     **Eksklusif: PPN ditambahkan** bila PPN ditambahkan di atasnya. Tidak ada bawaan: Anda harus
     memilih.
   - **Jumlah pajak** — pajak pada tagihan. Isi 0 bila tidak ada pajak.   - Bila Anda tahu tarifnya, Anda dapat mengisi **Tarif pajak nominal (%)** dan **Dasar pengenaan pajak (DPP)**
     sebagai ganti jumlah; jumlah pajaknya lalu dihitung. Kolom pajak tidak muncul bila sistem akuntansi
     Anda yang memegang pajak.
   - **Pemotongan pajak** — **Tidak ada**, **PPh 23**, atau **PPh 4(2)**, beserta **Jumlah PPh**,
     bila ada pajak yang dipotong dari supplier ini. Bawaan supplier yang tersimpan mengisi kolom
     ini lebih dulu.
4. Pilih **Konfirmasi & tandai ditagih** (atau **Simpan invoice supplier** bila Anda memakai **Catat
   dokumen lain**). Konfirmasi **Catat invoice supplier ini?** menyebut kasusnya; konfirmasi dengan
   **Simpan invoice supplier**.
5. Keuangan mencatat pembayaran di halaman yang sama dengan **Catat pembayaran** (atau
   **Tandai Lunas** setelah jumlahnya ada). Pembelian tidak dapat dibayar oleh orang yang
   menyetujuinya.

## Hasilnya seperti apa

- Pembelian berpindah ke **Invoice supplier**. **Nilai** menampilkan **Ditagih** dan sisanya yang
  **Belum dibayar**.
- **Linimasa** memuat tagihan beserta nomor, tanggal, jumlah, dan pajaknya, dan tab **Berkas**
  menyimpannya sebagai catatan tempat Anda dapat melampirkan hasil pindai tagihan.
- Pembelian menunggu pembayaran: **Catat pembayaran** untuk Keuangan. Setelah dibayar, statusnya
  **Dibayar** dan pengeluaran proyek memuatnya satu kali.
- Bila organisasi Anda mengaktifkan pencocokan tiga arah, tagihan dicocokkan dengan pesanan dan
  penerimaannya. Tagihan yang tidak cocok ditahan, dan pembayaran menunggu sampai penerimaannya
  dicatat atau pengecualiannya disetujui. Lihat
  [Pencocokan tiga arah](../office/three-way-match.md).

## Kesalahan umum dan cara mengatasinya

- **"State the tax treatment and the tax amount to record this invoice…"** (pesan ini tampil dalam bahasa Inggris) — pilih perlakuannya
  dan isi jumlah pajaknya, termasuk bila 0. Apakah jumlahnya sudah termasuk pajak tidak dapat
  diketahui setelahnya.
- **"Masukkan jumlah tagihan untuk menghitung pemotongan pajak supplier."** — isi jumlah tagihan
  sebelum pemotongan pajak dapat dihitung.
- **Tagihan melebihi jumlah yang disetujui** — halaman menyebutkan bahwa jumlah tagihan melebihi jumlah
  yang disetujui dan menawarkan **Setujui jumlah lebih tinggi** kepada pemberi persetujuan yang berhak. Jumlah yang disetujui
  menjadi jumlah yang ditagih, dan penyetuju itu tidak dapat membayar pembelian ini sendiri.
- **"Pembayaran ditahan oleh pencocokan tiga arah"** — ada tagihan pada pembelian ini yang tidak
  cocok dengan pesanan dan penerimaannya. Catat penerimaan yang kurang, perbaiki baris tagihannya,
  atau minta Keuangan menyetujui pengecualian; lihat
  [Pencocokan tiga arah](../office/three-way-match.md).
- **"Tambahkan item baris atau dokumen bernilai sebelum menandai lunas."** — tagihan belum punya
  jumlah. Isi jumlahnya, lalu bayar.
- **"Pembayaran harus dirilis oleh pengguna keuangan lain."** — orang yang menyetujui pembelian
  tidak dapat juga membayarnya. Minta pengguna Keuangan lain.

