# Move leftover material to another work order

## What this is for

When one work order finishes a part of the job with material left over, that material often belongs
to another work order at the same site. This feature moves it as one document: the first work order is
credited with the return and the second is charged with the issue, while the stock stays exactly where
it is on site. Both work orders' balances and costs end up right without a second trip through the
store.

**Who can do this:** a keeper of the site, yard or staging location, and an Admin. Work-order
transfers have no switch of their own: they come with the **Stock** module, which an Admin can turn
on or off under **Administration → Modules**. They stay off while an external inventory system owns
the stock.

## Where to find it

Two ways to the same page:

- **Stock → Documents**, then **New document → Move leftover to another work order**.
- **Stock → On hand**, then the **More** menu → **Move leftover to another work order**.

## Steps

1. Open the page from either route above.
2. Choose the **Project**.
3. Choose **From work order** — the one holding the leftover material.
4. Choose **To work order** — the one that will use it. It must be a different work order of the same
   project.
5. Choose **Where the material is** — a site, yard or staging location of this project that you keep.
6. Add the lines. Each line's item list shows only material the first work order actually holds; the
   line's help says **Held by the work order: …** with the quantity and unit.
7. Enter the **Quantity** to move on each line. Add more lines with **Add another line**.
8. Add a **Note** if it helps the reader.
9. Choose **Move to the other work order** and confirm.

## What the result looks like

- The page opens the finished transfer, which lists the two documents it made: **Return from the
  first work order** and **Issue to the second work order**. Each carries **Part of work-order
  transfer** so it is findable from either side.
- The first work order now holds less of the item; the second holds it instead. The stock has not
  moved location — only which work order it belongs to.
- Each work order's stock section shows the new balance, and each document appears in **Stock →
  Documents** and in the **Stock → Ledger**.
- The transfer cannot be edited afterwards. To correct it, move the material back the same way.

## Common errors and what to do

- **"Work-order transfers are off"** — the **Stock** module is switched off for your organisation, or
  an external inventory system owns the stock. Ask an Admin to turn **Stock** on under **Administration
  → Modules**; transfers cannot be used while an external system owns the stock.
- **"Choose a different work order."** — the two work orders must differ; pick the receiving one.
- **"This work order holds no material that can be moved."** — the first work order has nothing left
  at that location. Check the **From** work order and the **Where the material is** location.
- **"The work order holds only … of this item."** — lower the quantity to what is held, or check you
  picked the right item.
- **"Each item can be on one line only."** — combine the quantity onto one line for that item.
- **"Choose where the material is."** — pick a site, yard or staging location of this project that
  you keep.
- **The location list is empty** — you keep no site, yard or staging location of this project. Ask an
  Admin to add you as a keeper (see [Set up stores, items and units](set-up-stores-items-and-units.md)).
- **"This work-order transfer was not found."** — the link points to a transfer you cannot read; open
  it again from **Stock → Documents**.

---

## Bahasa Indonesia

# Memindahkan sisa material ke perintah kerja lain

## Untuk apa ini

Saat sebuah perintah kerja menyelesaikan sebagian pekerjaan dan materialnya bersisa, sisa itu sering
menjadi milik perintah kerja lain di lokasi yang sama. Fitur ini memindahkannya sebagai satu dokumen:
perintah kerja pertama dikreditkan dengan pengembalian dan yang kedua dibebani dengan pengeluaran,
sementara stok tetap di tempatnya di lokasi. Sisa dan biaya kedua perintah kerja menjadi benar tanpa
melewati gudang dua kali.

**Siapa yang bisa melakukannya:** penjaga lokasi proyek, halaman proyek, atau area penyiapan, dan
Admin. Transfer antar perintah kerja tidak punya sakelar sendiri: fitur ini ikut modul **Stok**, yang dapat
dinyalakan atau dimatikan Admin di **Administrasi → Modul**. Fitur ini tetap mati selama sistem
inventaris eksternal memegang stok.

## Di mana menemukannya

Dua jalan menuju halaman yang sama:

- **Stok → Dokumen**, lalu **Dokumen baru → Pindahkan sisa ke perintah kerja lain**.
- **Stok → Persediaan**, lalu menu **Lainnya** → **Pindahkan sisa ke perintah kerja lain**.

## Langkah-langkah

1. Buka halamannya dari salah satu jalan di atas.
2. Pilih **Proyek**.
3. Pilih **Dari perintah kerja** — yang memegang sisa material.
4. Pilih **Ke perintah kerja** — yang akan memakainya. Harus perintah kerja lain di proyek yang sama.
5. Pilih **Lokasi material** — lokasi proyek, halaman, atau area penyiapan proyek ini yang Anda
   pegang.
6. Tambahkan barisnya. Daftar barang tiap baris hanya berisi material yang benar-benar dipegang
   perintah kerja pertama; bantuan barisnya menyebut **Dipegang perintah kerja: …** dengan jumlah dan
   satuannya.
7. Isi **Kuantitas** yang dipindahkan di tiap baris. Tambah baris lain dengan **Tambah baris**.
8. Isi **Catatan** bila membantu pembaca.
9. Pilih **Pindahkan ke perintah kerja lain** dan konfirmasi.

## Hasilnya seperti apa

- Halaman membuka transfer yang sudah jadi, memuat dua dokumen yang dibuatnya: **Pengembalian dari
  perintah kerja pertama** dan **Pengeluaran ke perintah kerja kedua**. Masing-masing bertanda
  **Bagian dari transfer antar perintah kerja**, sehingga mudah ditemukan dari kedua sisi.
- Perintah kerja pertama kini memegang lebih sedikit barang itu; perintah kerja kedua memegangnya.
  Stok tidak berpindah lokasi — hanya perintah kerja pemiliknya.
- Bagian stok setiap perintah kerja menampilkan sisa barunya, dan setiap dokumen muncul di **Stok →
  Dokumen** serta di **Stok → Buku stok**.
- Transfer tidak bisa diubah setelahnya. Untuk mengoreksinya, pindahkan materialnya kembali dengan
  cara yang sama.

## Kesalahan umum dan cara mengatasinya

- **"Transfer antar perintah kerja nonaktif"** — modul **Stok** dimatikan untuk organisasi Anda, atau
  sistem inventaris eksternal memegang stok. Minta Admin menyalakan **Stok** di **Administrasi →
  Modul**; transfer tidak dapat dipakai selama sistem eksternal memegang stok.
- **"Pilih perintah kerja yang berbeda."** — kedua perintah kerja harus berbeda; pilih yang menerima.
- **"Perintah kerja ini tidak memegang material yang dapat dipindahkan."** — perintah kerja pertama
  tidak punya sisa di lokasi itu. Periksa perintah kerja **Dari** dan **Lokasi material**.
- **"Perintah kerja hanya memegang … barang ini."** — turunkan jumlahnya sesuai yang dipegang, atau
  periksa apakah barang yang dipilih benar.
- **"Setiap barang hanya boleh di satu baris."** — gabungkan jumlahnya ke satu baris untuk barang itu.
- **"Pilih lokasi material."** — pilih lokasi proyek, halaman, atau area penyiapan proyek ini yang
  Anda pegang.
- **Daftar lokasi kosong** — Anda tidak memegang lokasi proyek, halaman, atau area penyiapan proyek
  ini. Minta Admin menambahkan Anda sebagai penjaga (lihat [Menyiapkan gudang, barang, dan
  satuan](set-up-stores-items-and-units.md)).
- **"Transfer antar perintah kerja ini tidak ditemukan."** — tautannya menunjuk transfer yang tidak
  dapat Anda baca; buka lagi dari **Stok → Dokumen**.
