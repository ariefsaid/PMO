# Reorder levels and restocking

A reorder level is the quantity of an item, at one warehouse, at which you want to buy more. When
stock on hand reaches that level, the item appears on the **Reorder** list so nothing runs out
quietly. PMO can also suggest a level for you from how much the item has actually been used, and
turn the shortfall into a purchase request with one click.

**Who can do this:** everyone can read the reorder list. Setting, editing or clearing a level is
done by Finance, Project Manager, Executive or Admin. Anyone may raise the purchase request that
restocks an item.

## Where to find it

**Stock → Reorder**.

## Steps

### Set a level

1. Open **Stock → Reorder**.
2. In **Set a reorder level**, choose the **Item** and the **Warehouse**.
3. If PMO knows enough history, it shows a **Suggested level** and a **Suggested order quantity**,
   with the working behind them — usage over the history window, the lead time, the safety days and
   the order cycle.
4. Choose **Accept suggestion**, or **Edit** the numbers yourself. If there is no suggestion yet,
   use **Set a level**.
5. Type the **Reorder level** (0 or more, up to 3 decimals) and, if you want one, the
   **Order quantity (optional)**. Choose **Save level**.
6. To stop watching an item, use **Clear level** and confirm.

### Act on the list

1. The **Below reorder level** list shows every item at or under its level, with its item code, the
   warehouse, **On hand**, the **Reorder level** and the **Order quantity**.
2. Use **Edit** on a row to change its level, or **Clear** to remove it.
3. Use **Request purchase** on a row. A new purchase request opens with the item, the quantity
   needed to reach the level (or the order quantity if that is set) and the project already filled
   in. Adjust it, then send it as usual.

## What the result looks like

- The row leaves the **Below reorder level** list once stock is above its level again.
- The purchase request you raised from the list appears under **Purchases** with your project and
  item, and follows the usual approval route. When the goods are received into that warehouse, on
  hand rises and the row leaves the list.
- A saved level shows in the panel as *Reorder level: …* and, if you set one, *Order quantity: …*.

## Common errors and what to do

- **"Levels are set by someone else."** — you can read the list but not change levels. Use
  **Request purchase** on the row to get the item in, or ask a Project Manager or above to set the
  level.
- **"Not enough history for a suggestion."** — PMO needs a minimum span of history and a minimum
  number of usage movements before it will suggest. Set the level yourself with **Set a level**;
  a suggestion will appear once the item has been used enough.
- **"Couldn't load the reorder suggestion"** — the suggestion could not be read. Use its **Try
  again**; the list above keeps working.
- **"Enter a level of 0 or more, with at most 3 decimals."** — correct the number. A level of 0
  means the item is watched only when it has run out.
- **"Enter a quantity above 0, with at most 3 decimals, or leave it empty."** — the order quantity
  is optional; clear it if you do not want a fixed order size.
- **Clearing was refused** — a level can be cleared only by a role that may change levels; confirm
  the dialog again, or ask a Project Manager or above.

---

## Bahasa Indonesia

# Level pemesanan ulang dan pengisian stok

Level pemesanan ulang adalah jumlah sebuah barang di satu gudang yang menjadi tanda untuk membeli
lagi. Saat sisa stok mencapai level itu, barang muncul di daftar **Pemesanan ulang** agar tidak
habis tanpa diketahui. PMO juga dapat menyarankan level dari seberapa banyak barang itu benar-benar
terpakai, dan mengubah kekurangannya menjadi permintaan pembelian dengan satu klik.

**Siapa yang bisa melakukannya:** semua orang dapat membaca daftar pemesanan ulang. Menetapkan,
mengubah, atau menghapus level dilakukan Finance, Manajer Proyek, Eksekutif, atau Admin. Siapa pun
boleh mengajukan permintaan pembelian untuk mengisi ulang barang.

## Di mana menemukannya

**Stok → Pemesanan ulang**.

## Langkah-langkah

### Menetapkan level

1. Buka **Stok → Pemesanan ulang**.
2. Di **Atur level pemesanan ulang**, pilih **Barang** dan **Gudang**.
3. Bila riwayatnya cukup, PMO menampilkan **Saran level** dan **Saran jumlah pesanan**, beserta
   dasar hitungnya — pemakaian selama rentang riwayat, waktu tunggu, hari cadangan, dan siklus
   pesanan.
4. Pilih **Terima saran**, atau **Ubah** angkanya sendiri. Bila belum ada saran, gunakan **Atur
   level**.
5. Isi **Level pemesanan ulang** (0 atau lebih, maksimal 3 desimal) dan, bila mau,
   **Jumlah pesanan (opsional)**. Pilih **Simpan level**.
6. Untuk berhenti memantau sebuah barang, gunakan **Hapus level** lalu konfirmasi.

### Menindaklanjuti daftar

1. Daftar **Di bawah level pemesanan ulang** menampilkan setiap barang yang berada pada atau di
   bawah levelnya, dengan kode barang, gudang, **Sisa**, **Level pemesanan ulang**, dan **Jumlah
   pesanan**.
2. Gunakan **Ubah** pada baris untuk mengganti levelnya, atau **Hapus** untuk membuangnya.
3. Gunakan **Ajukan pembelian** pada baris. Permintaan pembelian baru terbuka dengan barang, jumlah
   yang dibutuhkan untuk mencapai level (atau jumlah pesanan bila diisi), dan proyek sudah terisi.
   Sesuaikan, lalu kirim seperti biasa.

## Hasilnya seperti apa

- Baris keluar dari daftar **Di bawah level pemesanan ulang** setelah stok naik melewati levelnya.
- Permintaan pembelian yang Anda ajukan dari daftar muncul di **Pembelian** dengan proyek dan
  barangnya, dan mengikuti jalur persetujuan biasa. Saat barangnya diterima di gudang itu, sisa
  stok naik dan baris keluar dari daftar.
- Level yang tersimpan tampil di panel sebagai *Level pemesanan ulang: …* dan, bila diisi,
  *Jumlah pesanan: …*.

## Kesalahan umum dan cara mengatasinya

- **"Level ditetapkan oleh orang lain."** — Anda dapat membaca daftar tetapi tidak mengubah level.
  Gunakan **Ajukan pembelian** pada baris untuk mendatangkan barang, atau minta Manajer Proyek atau
  di atasnya menetapkan levelnya.
- **"Riwayat belum cukup untuk memberi saran."** — PMO perlu rentang riwayat dan jumlah pergerakan
  pemakaian minimum sebelum memberi saran. Tetapkan levelnya sendiri dengan **Atur level**; saran
  akan muncul setelah barang cukup sering dipakai.
- **"Gagal memuat saran pemesanan ulang"** — saran tidak dapat dibaca. Gunakan **Coba lagi**; daftar
  di atasnya tetap berjalan.
- **"Masukkan level 0 atau lebih, maksimal 3 desimal."** — betulkan angkanya. Level 0 berarti barang
  hanya dipantau saat sudah habis.
- **"Masukkan jumlah di atas 0, maksimal 3 desimal, atau kosongkan."** — jumlah pesanan opsional;
  kosongkan bila Anda tidak ingin ukuran pesanan tetap.
- **Penghapusan ditolak** — level hanya bisa dihapus oleh peran yang boleh mengubah level; konfirmasi
  dialognya lagi, atau minta Manajer Proyek atau di atasnya.
