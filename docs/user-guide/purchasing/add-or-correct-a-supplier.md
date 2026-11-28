# Add or correct a supplier

## What this is for

Every supplier you buy from is a company of type **Supplier**. A correct supplier record means the
right name on the order and the invoice, the right payment terms, the right tax number, and the
right tax treatment pre-filled on every bill — so nobody retypes it, and tax is not lost.

## Who can do this

- **Add or edit a supplier:** Admin, Executive, Project Manager and Finance.
- **Set the supplier's default tax treatment:** Admin or Finance.
- **Archive a supplier you no longer use:** Admin or Executive. Only an Admin can delete one.

## Where to find it

- **Companies** in the menu (in the **Sales** section), then choose **Supplier** in the type
  filter; the page title becomes **Suppliers**. Where your organisation has the sales side switched
  off, **Suppliers** is in the **Delivery** section instead, for Project Managers, Finance and Admin.
- Open a supplier row to see its page, with **Edit** at the top and **Supplier tax defaults** below
  the header. **Archive** is in the menu on the page header.

## Steps

### Add a supplier

1. Open **Companies**, choose **New company**.
2. In **Identity**:
   - **Company name** — the supplier's legal name, as it must appear on the order.
   - **Short name** — optional; the name shown around the app while the legal name stays.
   - **Type** — choose **Supplier**. The vendor fields appear.
3. In **Vendor details**:
   - **Vendor code** — your own code for this supplier.
   - **Payment terms (days)** — the agreed terms, for example 30.
   - **Tax number** — the supplier's registered tax number (NPWP).
   - **Address**.
4. Choose **Create company**.

### Correct a supplier

1. Open the supplier from **Companies**.
2. Choose **Edit**, change what is wrong, and choose **Save company**. 
3. To stop using a supplier without losing its history, choose **Archive** from the menu on its page and confirm
   with **Archive company**. It leaves the pickers and cannot be chosen on new records, and the
   orders and invoices that name it keep it. The confirmation says it can be restored any time.

### Set the supplier's tax defaults

1. On the supplier's page, find **Supplier tax defaults**.
2. Enter the **VAT rate (%)** the supplier charges, choose the **Withholding** — **None**,
   **PPh 23** or **PPh 4(2)** — and, when you choose one, its **PPh rate (%)**.
3. Choose **Save defaults**. New bills from this supplier start with these values; each bill's
   amounts stay editable and are what is recorded.

## What the result looks like

- The supplier appears in the **Supplier** picker on purchase requests, quotes, orders and bills.
- Its page shows the recorded details, its **Supplier tax defaults** and its contacts.
- Coming back to the list, the supplier shows with its type; archived suppliers are out of the
  filtered list but their records stay intact.
- The next bill you record from this supplier arrives with the VAT rate and withholding already
  filled, so you only check them. See
  [Record the supplier invoice](record-the-supplier-invoice.md).

## Common errors and what to do

- **"Company name is required."** — fill the legal name.
- **"Company saved, but one change did not persist"** — the record was saved, but the tax number
  (or the client-number segment) was not. Correct that field and save again.
- **"Payment terms are a whole number of days, or empty."** — use a whole number such as 30, or
  leave it empty.
- **"Enter a rate from 0 to 100…"** on the VAT rate — use a rate between 0 and 100 with at most
  three decimals, or leave it blank.
- **Required when withholding is selected** (under **PPh rate (%)**) — choose **None** as the
  withholding, or type the rate.
- **"…is referenced by other records and can't be deleted."** — projects, orders or bills already
  name the supplier. Choose **Archive instead**. Delete is in the row menu of the **Companies** list
  and is offered to Admin only.
- **"Only Admin or Finance can change these."** on the tax defaults — ask an Admin or Finance to set
  them.

---

## Bahasa Indonesia

# Tambah atau perbaiki supplier

## Untuk apa ini

Setiap supplier tempat Anda membeli adalah perusahaan bertipe **Supplier**. Catatan supplier yang
benar berarti nama yang tepat pada pesanan dan tagihan, termin pembayaran yang tepat, nomor pajak
yang tepat, dan perlakuan pajak yang tepat terisi otomatis pada setiap tagihan — sehingga tidak ada
yang mengetik ulang, dan pajak tidak hilang.

## Siapa yang dapat melakukannya

- **Menambah atau mengubah supplier:** Admin, Eksekutif, Manajer Proyek, dan Keuangan.
- **Mengatur perlakuan pajak bawaan supplier:** Admin atau Keuangan.
- **Mengarsipkan supplier yang tidak dipakai lagi:** Admin atau Eksekutif. Hanya Admin yang dapat
  menghapusnya.

## Di mana menemukannya

- **Perusahaan** di menu (bagian **Penjualan**), lalu pilih **Supplier** pada filter tipe; judul
  halaman menjadi **Supplier**. Bila organisasi Anda mematikan sisi penjualan, **Supplier** ada di bagian
  **Pelaksanaan**, untuk Manajer Proyek, Keuangan, dan Admin.
- Buka baris supplier untuk melihat halamannya, dengan **Ubah** di atas dan **Default pajak
  supplier** di bawah kepala halaman. **Arsipkan** ada di menu pada kepala halaman.

## Langkah-langkah

### Menambah supplier

1. Buka **Perusahaan**, pilih **Perusahaan baru**.
2. Di **Identitas**:
   - **Nama perusahaan** — nama resmi supplier, seperti yang harus muncul pada pesanan.
   - **Nama singkat** — opsional; nama yang ditampilkan di aplikasi sementara nama resmi tetap.
   - **Tipe** — pilih **Supplier**. Kolom vendor muncul.
3. Di **Detail vendor**:
   - **Kode vendor** — kode Anda sendiri untuk supplier ini.
   - **Termin pembayaran (hari)** — termin yang disepakati, misalnya 30.
   - **Nomor pajak** — nomor pajak terdaftar supplier (NPWP).
   - **Alamat**.
4. Pilih **Buat perusahaan**.

### Memperbaiki supplier

1. Buka supplier dari **Perusahaan**.
2. Pilih **Ubah**, perbaiki yang salah, lalu pilih **Simpan perusahaan**.
3. Untuk berhenti memakai supplier tanpa kehilangan riwayatnya, pilih **Arsipkan** dari menu di halamannya
   dan konfirmasi dengan **Arsipkan perusahaan**. Supplier keluar dari pilihan dan tidak dapat
   dipilih pada data baru, sedangkan pesanan serta tagihan yang menyebutnya tetap menyimpannya.
   Konfirmasinya menyebutkan bahwa data dapat dipulihkan kapan saja.

### Mengatur default pajak supplier

1. Di halaman supplier, cari **Default pajak supplier**.
2. Isi **Tarif PPN (%)** yang dikenakan supplier, pilih **Pemotongan pajak** — **Tidak ada**,
   **PPh 23**, atau **PPh 4(2)** — dan, bila memilih salah satu, **Tarif PPh (%)**-nya.
3. Pilih **Simpan default**. Tagihan baru dari supplier ini dimulai dengan nilai tersebut; jumlah
   setiap tagihan tetap dapat diubah dan itulah yang dicatat.

## Hasilnya seperti apa

- Supplier muncul di pilihan **Supplier** pada permintaan pembelian, penawaran, pesanan, dan
  tagihan.
- Halamannya menampilkan detail yang tercatat, **Default pajak supplier**, dan kontaknya.
- Kembali ke daftar, supplier tampil dengan tipenya; supplier yang diarsipkan keluar dari daftar
  terfilter tetapi catatannya tetap utuh.
- Tagihan berikutnya dari supplier ini datang dengan tarif PPN dan pemotongan pajak yang sudah
  terisi, sehingga Anda hanya memeriksanya. Lihat
  [Catat invoice supplier](record-the-supplier-invoice.md).

## Kesalahan umum dan cara mengatasinya

- **"Nama perusahaan wajib diisi."** — isi nama resminya.
- **"Perusahaan tersimpan, tetapi satu perubahan tidak bertahan"** — catatannya tersimpan, tetapi
  nomor pajak (atau segmen nomor klien) tidak. Perbaiki kolom itu dan simpan lagi.
- **"Termin pembayaran adalah bilangan bulat hari, atau kosong."** — gunakan bilangan bulat seperti
  30, atau kosongkan.
- **"Masukkan tarif 0 sampai 100…"** pada tarif PPN — gunakan tarif antara 0 dan 100 dengan paling
  banyak tiga angka desimal, atau kosongkan.
- **Wajib jika pemotongan pajak dipilih** (di bawah **Tarif PPh (%)**) — pilih **Tidak ada** sebagai
  pemotongan, atau isi tarifnya.
- **"…is referenced by other records and can't be deleted."** (pesan ini tampil dalam bahasa Inggris) — proyek, pesanan, atau tagihan sudah
  menyebut supplier. Pilih **Arsipkan saja**. Hapus ada di menu baris daftar **Perusahaan** dan hanya
  ditawarkan kepada Admin.
- **"Hanya Admin atau Finance yang dapat mengubahnya."** pada default pajak — minta Admin atau
  Keuangan mengaturnya.
