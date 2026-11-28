# Set up stores, items and units

## What this is for

Before the site can use **Stock**, three lists must exist: the **units** you count in (bag, metre,
kilogram), the **items** you keep, and the **warehouses** — a central store, a project site store, a
project yard, a staging area, or a vendor's place where your material sits. Each warehouse has
keepers: the people who post its receipts, transfers and issues.

**Who can do this:** every role can read the lists. Changing units, items and warehouses is done by
Finance, Project Manager, Executive or Admin. Naming a warehouse's keepers is done by an Admin.

## Where to find it

**Stock → Setup**. The **Setup** tab appears on the Stock pages only for people who may change stock
master data.

## Steps

### Units

1. Open the **Units** tab and choose **New unit**.
2. Enter a **Code** (for example `bag`) and a **Name** (for example `Bag`).
3. Tick **Whole numbers only** for things counted in whole pieces — bags, pieces. Leave it clear
   for lengths, weights and volumes, so fractions are allowed.
4. **Create unit**. Use **Edit** on a row to change it later.

### Items

1. Open the **Items** tab and choose **New item**.
2. Enter the **Code**, the **Name**, an optional **Description**, and choose the **Unit**.
3. Optionally set a **Lead time (days)**. It is used later when PMO suggests reorder levels.
4. Optionally choose a **Tag**. The tag is fixed once the item has stock movements. If your
   organisation uses tags, an Admin can manage the list with **Manage stock tags** — a tag can mark
   an item as **Zero cost** (client-supplied) and require **Paper required** on its transfers.
5. Tick **Consumable** for material that is used up on site, such as welding rod or nails;
   consumables are issued from the site store as the daily site report says they were used.
6. **Create item**. If a similar item already exists, a panel lists it before you save — check it,
   then either edit that item or carry on and create a new one.
7. Use the **Import** button to load many items from a spreadsheet instead of typing them.

### Warehouses

1. Open the **Warehouses** tab and choose **New warehouse**.
2. Enter the **Code** and the **Name**, and choose the **Kind**: **Central**, **Site**, **Yard**,
   **Staging**, **Vendor** or **In transit**.
3. For a site, yard or staging location, choose the **Site project**. This is only a default for
   issues; it does not limit which project may draw from the store.
4. For a vendor location, choose the **Vendor company** that holds the material.
5. Optionally set a **Cover value** — the protection recorded for this location. Stock value above
   it shows on **Stock → At risk**.
6. **Create warehouse**. Use **Import** to load many locations at once.

### Keepers

1. Open the row menu of a warehouse and choose **Keepers**.
2. Tick each person who should post that warehouse's documents. Untick to remove.
3. Choose **Done**.

## What the result looks like

- **Units** lists each unit with its code, name and whether quantities are whole or may be
  fractional.
- **Items** lists each item with its code and name, unit, on-hand total across warehouses, lead
  time and tag.
- **Warehouses** lists each location with its kind, project or vendor, and its keepers.
- A person who is not a keeper of a warehouse cannot create documents for it; an Admin can work in
  any warehouse.
- **Show archived** reveals archived rows with an **Archived** pill; **Restore** brings one back.
  Archiving keeps all history. An item that still has stock on hand cannot be archived.

## Common errors and what to do

- **"Code is required." / "Name is required."** — both are needed for a unit, an item or a
  warehouse.
- **"Choose a unit."** — an item cannot be saved without the unit it is counted in. Add the unit on
  the **Units** tab first.
- **"Enter whole days between 0 and 365."** — the lead time is optional; clear it or enter whole
  days only.
- **"This tag cannot be changed after stock has moved."** — the item already has movements. Create a
  new item with the right tag instead.
- **"It disappears from new documents. Existing history stays. An item with stock on hand cannot be
  archived."** — receive it out, issue it, or count it to zero before archiving the item.
- **A warehouse is missing from the document form** — you are not its keeper. Ask an Admin to add
  you under **Keepers**.
- **"You can view stock setup."** — your role reads the lists but does not change them. Ask a
  Project Manager, Finance, Executive or Admin.

---

## Bahasa Indonesia

# Menyiapkan gudang, barang, dan satuan

## Untuk apa ini

Sebelum lokasi dapat memakai **Stok**, tiga daftar harus ada: **satuan** yang Anda pakai menghitung
(sak, meter, kilogram), **barang** yang Anda simpan, dan **gudang** — gudang pusat, gudang lokasi
proyek, halaman proyek, area penyiapan, atau tempat vendor tempat material Anda berada. Setiap gudang
punya penjaga: orang yang memposting penerimaan, transfer, dan pengeluarannya.

**Siapa yang bisa melakukannya:** semua peran dapat membaca daftarnya. Mengubah satuan, barang, dan
gudang dilakukan Keuangan, Manajer Proyek, Eksekutif, atau Admin. Menetapkan penjaga gudang dilakukan
Admin.

## Di mana menemukannya

**Stok → Pengaturan**. Tab **Pengaturan** hanya muncul di halaman Stok untuk orang yang boleh
mengubah data induk stok.

## Langkah-langkah

### Satuan

1. Buka tab **Satuan** dan pilih **Satuan baru**.
2. Isi **Kode** (misalnya `sak`) dan **Nama** (misalnya `Sak`).
3. Centang **Hanya bilangan bulat** untuk barang yang dihitung utuh — sak, buah. Kosongkan untuk
   panjang, berat, dan volume agar pecahan diizinkan.
4. **Buat satuan**. Gunakan **Ubah** pada baris untuk menggantinya nanti.

### Barang

1. Buka tab **Barang** dan pilih **Barang baru**.
2. Isi **Kode**, **Nama**, **Deskripsi** bila perlu, dan pilih **Satuan**.
3. Bila perlu, isi **Waktu tunggu (hari)**. Ini dipakai nanti saat PMO menyarankan level pemesanan
   ulang.
4. Bila perlu, pilih **Label**. Label terkunci setelah barang punya pergerakan stok. Bila organisasi
   Anda memakai label, Admin dapat mengelolanya dengan **Kelola label stok** — sebuah label dapat
   menandai barang sebagai **Tanpa biaya** (dipasok klien) dan mewajibkan **Dokumen wajib** pada
   transfernya.
5. Centang **Barang habis pakai** untuk material yang terpakai di lapangan, misalnya kawat las atau
   paku; barang habis pakai dikeluarkan dari gudang lokasi sesuai pemakaian di laporan harian lokasi.
6. **Buat barang**. Bila barang serupa sudah ada, panel menampilkannya sebelum Anda menyimpan —
   periksa dulu, lalu ubah barang itu atau lanjut membuat yang baru.
7. Gunakan tombol **Impor** untuk memuat banyak barang dari spreadsheet tanpa mengetiknya.

### Gudang

1. Buka tab **Gudang** dan pilih **Gudang baru**.
2. Isi **Kode** dan **Nama**, lalu pilih **Jenis**: **Pusat**, **Lokasi proyek**, **Halaman
   proyek**, **Area penyiapan**, **Vendor luar**, atau **Dalam perjalanan**.
3. Untuk lokasi proyek, halaman proyek, atau area penyiapan, pilih **Proyek lokasi**. Ini hanya
   usulan awal untuk pengeluaran; tidak membatasi proyek mana yang boleh mengambil dari gudang.
4. Untuk lokasi vendor, pilih **Perusahaan vendor** yang memegang materialnya.
5. Bila perlu, isi **Nilai perlindungan** — perlindungan yang dicatat untuk lokasi ini. Nilai stok di
   atasnya tampil di **Stok → Risiko**.
6. **Buat gudang**. Gunakan **Impor** untuk memuat banyak lokasi sekaligus.

### Penjaga gudang

1. Buka menu baris sebuah gudang dan pilih **Penjaga gudang**.
2. Centang setiap orang yang boleh memposting dokumen gudang itu. Hapus centang untuk mencabutnya.
3. Pilih **Selesai**.

## Hasilnya seperti apa

- **Satuan** menampilkan setiap satuan dengan kode, nama, dan apakah jumlahnya bilangan bulat atau
  boleh pecahan.
- **Barang** menampilkan setiap barang dengan kode dan nama, satuan, total sisa di semua gudang,
  waktu tunggu, dan label.
- **Gudang** menampilkan setiap lokasi dengan jenisnya, proyek atau vendornya, dan penjaganya.
- Orang yang bukan penjaga sebuah gudang tidak dapat membuat dokumen untuknya; Admin dapat bekerja
  di gudang mana pun.
- **Tampilkan yang diarsipkan** menampilkan baris terarsip dengan pil **Diarsipkan**; **Pulihkan**
  mengembalikannya. Pengarsipan menyimpan seluruh riwayat. Barang yang masih ada stoknya tidak dapat
  diarsipkan.

## Kesalahan umum dan cara mengatasinya

- **"Kode wajib diisi." / "Nama wajib diisi."** — keduanya diperlukan untuk satuan, barang, atau
  gudang.
- **"Pilih satuan."** — barang tidak dapat disimpan tanpa satuan hitungnya. Tambahkan satuannya di
  tab **Satuan** lebih dulu.
- **"Isi hari bulat antara 0 dan 365."** — waktu tunggu opsional; kosongkan atau isi hari bulat saja.
- **"Label ini tidak dapat diubah setelah stok bergerak."** — barangnya sudah punya pergerakan. Buat
  barang baru dengan label yang benar.
- **"Data tidak muncul lagi di dokumen baru. Riwayat tetap ada. Barang yang masih ada stoknya tidak
  bisa diarsipkan."** — keluarkan, pakai, atau hitung sampai nol sebelum mengarsipkan barangnya.
- **Gudang tidak muncul di formulir dokumen** — Anda bukan penjaganya. Minta Admin menambahkan Anda
  di **Penjaga gudang**.
- **"Anda dapat melihat pengaturan stok."** — peran Anda membaca daftar tetapi tidak mengubahnya.
  Minta Manajer Proyek, Keuangan, Eksekutif, atau Admin.
