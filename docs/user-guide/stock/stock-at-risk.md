# See stock at risk against each location's cover

## What this is for

Each stock location can carry a **Cover value** — the amount of protection recorded for the stock it
holds. **Stock → At risk** compares the value of the stock at every location with that cover, so the
value sitting unprotected is visible instead of assumed. It is the screen to open when you ask "how
much stock could we lose here, and is it covered?"

The page is about value per location. For items that are running low, use **Stock → Reorder**
instead (see [Reorder levels and restocking](reorder-levels-and-restock.md)).

**Who can do this:** every role can open the page. Value and cover figures are shown to roles that
may read stock cost; other roles see the locations and whether each has guard cover recorded.

## Where to find it

**Stock → At risk** (the **At risk** tab on the Stock pages).

## Steps

### Record the cover on a location

1. Open **Stock → Setup** and the **Warehouses** tab.
2. **Edit** the warehouse, or create a new one.
3. Enter the **Cover value** — 0 or more, at most 2 decimals. The help says it plainly: *the
   protection recorded for this location; stock value above it shows as at risk.*
4. **Save warehouse**.

### Read the report

1. Open **Stock → At risk**.
2. The headline figures show **Value at risk** and the **Stock value held**, with how many locations
   are above their cover.
3. The table lists each location with its **Kind**, its **Project**, the **Stock value** it holds,
   its **Cover**, and the **At risk** amount — the value above the cover.
4. Locations with no cover recorded show **Not recorded** in the **Cover** column instead of a zero.
5. Rows arrive with the largest exposure first, so the locations to deal with are at the top.

### When your role does not read stock value

1. The page shows the locations and a **Guard cover** column instead of money: **Cover recorded** or
   **No guard cover**.
2. Use it to see which locations have protection recorded at all, and ask Finance for the amounts.

## What the result looks like

- A total **Value at risk** for the organisation and the **Stock value held** beside it as context.
- A line per location, ending in the amount above its cover. A location holding stock exactly at or
  under its cover shows no at-risk amount.
- New-item duplicates: when you add an item under **Stock → Setup → Items**, a panel lists any
  similar item that already exists before you save, so the item master does not fill with duplicates
  (see [Set up stores, items and units](set-up-stores-items-and-units.md)).

## Common errors and what to do

- **"No location holds stock"** — no location currently holds any stock, so there is nothing to
  compare. Receive stock and the locations appear.
- **"Not recorded"** in **Cover** — no cover value is set on that warehouse. Add it under **Stock →
  Setup → Warehouses → Edit**.
- **No money columns** — your role does not read stock cost; the **Guard cover** column tells you
  whether protection is recorded. Ask Finance for the values.
- **"A cover is 0 or more, 2 decimals at most."** — correct the cover value; it is a money amount,
  not a quantity.
- **A new location is missing from the report** — only locations that hold stock appear. Receive
  stock into it first.

---

## Bahasa Indonesia

# Melihat stok berisiko terhadap perlindungan tiap lokasi

## Untuk apa ini

Setiap lokasi stok dapat memiliki **Nilai perlindungan** — besaran perlindungan yang dicatat untuk
stok yang disimpannya. **Stok → Risiko** membandingkan nilai stok di setiap lokasi dengan
perlindungan itu, sehingga nilai yang tidak terlindungi terlihat, bukan diasumsikan. Halaman ini
dibuka saat Anda bertanya "berapa nilai stok yang bisa hilang di sini, dan apakah terlindungi?"

Halaman ini tentang nilai per lokasi. Untuk barang yang menipis, gunakan **Stok → Pemesanan ulang**
(lihat [Level pemesanan ulang dan pengisian stok](reorder-levels-and-restock.md)).

**Siapa yang bisa melakukannya:** semua peran dapat membuka halamannya. Angka nilai dan perlindungan
ditampilkan untuk peran yang boleh membaca biaya stok; peran lain melihat lokasinya dan apakah
jaminan penjagaannya tercatat.

## Di mana menemukannya

**Stok → Risiko** (tab **Risiko** di halaman Stok).

## Langkah-langkah

### Mencatat perlindungan sebuah lokasi

1. Buka **Stok → Pengaturan** dan tab **Gudang**.
2. **Ubah** gudangnya, atau buat yang baru.
3. Isi **Nilai perlindungan** — 0 atau lebih, paling banyak 2 desimal. Bantuannya jelas: *perlindungan
   yang dicatat untuk lokasi ini; nilai stok di atasnya ditampilkan sebagai berisiko.*
4. **Simpan gudang**.

### Membaca laporannya

1. Buka **Stok → Risiko**.
2. Angka utama menampilkan **Nilai berisiko** dan **Total nilai stok**, beserta berapa lokasi yang
   melebihi perlindungannya.
3. Tabel mendaftar setiap lokasi dengan **Jenis**, **Proyek**, **Nilai stok** yang disimpannya,
   **Perlindungan**, dan jumlah **Risiko** — nilai di atas perlindungan.
4. Lokasi tanpa perlindungan tercatat menampilkan **Belum dicatat** di kolom **Perlindungan**, bukan
   nol.
5. Baris diurutkan dari nilai terbesar, sehingga lokasi yang perlu ditangani ada di atas.

### Bila peran Anda tidak membaca nilai stok

1. Halaman menampilkan lokasinya dan kolom **Jaminan penjagaan**, bukan uang: **Jaminan tercatat**
   atau **Stok tanpa penjagaan**.
2. Gunakan untuk melihat lokasi mana yang sudah punya perlindungan tercatat, dan minta angkanya ke
   Keuangan.

## Hasilnya seperti apa

- Total **Nilai berisiko** organisasi dan **Total nilai stok** di sampingnya sebagai konteks.
- Satu baris per lokasi, berakhir pada nilai di atas perlindungannya. Lokasi yang nilai stoknya sama
  dengan atau di bawah perlindungan tidak menampilkan nilai berisiko.
- Duplikat barang baru: saat Anda menambah barang di **Stok → Pengaturan → Barang**, panel mendaftar
  barang serupa yang sudah ada sebelum Anda menyimpan, sehingga data induk barang tidak dipenuhi
  duplikat (lihat [Menyiapkan gudang, barang, dan satuan](set-up-stores-items-and-units.md)).

## Kesalahan umum dan cara mengatasinya

- **"Belum ada lokasi yang menyimpan stok"** — belum ada lokasi yang menyimpan stok, jadi tidak ada
  yang dibandingkan. Terima stok dan lokasinya akan muncul.
- **"Belum dicatat"** di **Perlindungan** — belum ada nilai perlindungan di gudang itu. Tambahkan di
  **Stok → Pengaturan → Gudang → Ubah**.
- **Tidak ada kolom nilai** — peran Anda tidak membaca biaya stok; kolom **Jaminan penjagaan**
  memberi tahu apakah perlindungan sudah tercatat. Minta nilainya ke Keuangan.
- **"Perlindungan adalah 0 atau lebih, paling banyak 2 desimal."** — betulkan nilainya; itu angka
  uang, bukan jumlah barang.
- **Lokasi baru tidak muncul di laporan** — hanya lokasi yang menyimpan stok yang tampil. Terima stok
  ke lokasi itu lebih dulu.
