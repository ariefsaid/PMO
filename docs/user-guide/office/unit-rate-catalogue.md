# Unit-rate catalogue

## What this is for

A per-project catalogue of priced work items. Each item has a code, a description, a unit, a
work method and a test type, and one rate per **location** (for example *Remote* and
*Non-remote* — the names are set per project). Rates are dated: each rate says the date it
takes effect, so a rate amendment from a later date never changes lines already priced.

Contract (bill-of-quantities) lines can be priced straight from the catalogue: pick the item,
the location and a pricing date, and PMO copies the rate in force on that date into the line.

## Who can do this

- **View** the catalogue: Admin, Executive, Project Manager, Finance.
- **Add locations, import items and set rates** (everything that writes): Admin and Finance.

## Where to find it

Open a project → **Contract** tab → **Contract tools** → **Rate catalogue**. It opens as a
panel listing items, location rates and effective dates.

## Steps

### Set up locations

1. Type a location name (for example *Remote*) into **New location** and choose
   **Add location**. Repeat for each location you price work at.
2. Choose which location new contract lines default to with **Default location**. Location
   names cannot be renamed or removed later, so name them carefully.

### Fill the catalogue

1. Choose **Import** to bring items in from a spreadsheet. The sheet has one rate column per
   location; up to 5,000 rows per import.
2. Check the preview. Rows that cannot be imported are listed with a reason, and you can
   download exactly those rows to fix and re-import.

### Price a contract line from the catalogue

1. On a contract line, pick **Catalogue item**, then **Choose location** (defaults to the
   project's default location, changeable per line) and a **Pricing date** (defaults to
   today).
2. PMO previews the rate in force for that item and location on that date before you save.
3. Save the line. The rate is copied into the line and the item, location and date are
   recorded with it.

## What the result looks like

- The catalogue panel lists every item as *code · description* with one row per location
  showing the **Rate** and **Effective from** date. An item with no rates shows dashes.
- A priced contract line keeps its rate even when the catalogue is later amended: an amendment
  takes effect only from its later date, and lines priced before it are unchanged.
- Rates can only be changed through the catalogue — there is no way to overwrite a priced
  line's rate by hand.

## Common problems

| What you see | What to do |
|---|---|
| *No locations yet. Add a location.* | Add at least one location before importing items or setting rates. |
| *No rate for this location on this date.* | No rate row is in force for that item and location on the pricing date. Set a rate with an earlier effective date, or pick another date. |
| An amendment is refused | A rate already exists for that item and location on that date (or the amendment is dated before one). Add later-dated amendments instead; earlier history stays as it is. |
| *Could not save. Try again.* | Retry. If the location list did not load, use **Retry** at the top of the panel. |
| Some import rows were refused | Download the failed-rows file, fix the reasons named on each row, and import again. |

## Bahasa Indonesia

# Daftar tarif

## Untuk apa ini

Daftar item pekerjaan bertarif untuk satu proyek. Tiap item memiliki kode, deskripsi,
satuan, metode kerja, dan jenis pengujian, serta satu tarif per **lokasi** (misalnya *Remote*
dan *Non-remote* — namanya ditetapkan per proyek). Tarif bersifat bertanggal: tiap tarif
menyebut tanggal berlakunya, sehingga perubahan tarif bertanggal lebih lambat tidak pernah
mengubah baris yang sudah dihargai.

Baris kontrak (bill of quantities) dapat dihargai langsung dari daftar: pilih item, lokasi,
dan tanggal tarif, lalu PMO menyalin tarif yang berlaku pada tanggal itu ke dalam baris.

## Siapa yang dapat melakukannya

- **Melihat** daftar tarif: Admin, Eksekutif, Manajer Proyek, Keuangan.
- **Menambah lokasi, mengimpor item, dan menetapkan tarif** (semua yang menulis): Admin dan
  Keuangan.

## Di mana menemukannya

Buka proyek → tab **Kontrak** → peralatan kontrak → **Daftar tarif**. Terbuka sebagai panel
berisi item, tarif per lokasi, dan tanggal berlaku.

## Langkah-langkah

### Menyiapkan lokasi

1. Ketik nama lokasi (misalnya *Remote*) di **Lokasi baru** dan pilih **Tambah lokasi**.
   Ulangi untuk setiap lokasi tempat Anda menghargai pekerjaan.
2. Pilih lokasi bawaan untuk baris kontrak baru dengan **Lokasi bawaan**. Nama lokasi tidak
   dapat diubah atau dihapus kemudian, jadi beri nama dengan hati-hati.

### Mengisi daftar

1. Pilih **Impor** untuk memasukkan item dari spreadsheet. Sheet memiliki satu kolom tarif per
   lokasi; maksimal 5.000 baris per impor.
2. Periksa pratinjau. Baris yang tidak dapat diimpor didaftar dengan alasannya, dan Anda dapat
   mengunduh tepat baris-baris itu untuk diperbaiki dan diimpor ulang.

### Menghargai baris kontrak dari daftar

1. Pada baris kontrak, pilih **Item daftar tarif**, lalu **Pilih lokasi** (bawaan mengikuti
   lokasi bawaan proyek, dapat diubah per baris) dan **Tanggal tarif** (bawaan hari ini).
2. PMO menampilkan pratinjau tarif yang berlaku untuk item dan lokasi itu pada tanggal tersebut
   sebelum Anda menyimpan.
3. Simpan barisnya. Tarif tersalin ke baris, dan item, lokasi serta tanggal dicatat
   menyertainya.

## Bagaimana hasilnya

- Panel daftar tarif memuat tiap item sebagai *kode · deskripsi* dengan satu baris per lokasi
  yang menampilkan **Tarif** dan **Berlaku mulai**. Item tanpa tarif menampilkan tanda pisah.
- Baris kontrak yang sudah dihargai tetap memakai tarifnya meski daftar kemudian diubah:
  perubahan hanya berlaku sejak tanggalnya, dan baris yang dihargai sebelumnya tidak berubah.
- Tarif hanya dapat diubah lewat daftar — tidak ada cara mengubah tarif baris yang sudah
  dihargai secara manual.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Belum ada lokasi. Tambahkan lokasi.* | Tambahkan sedikitnya satu lokasi sebelum mengimpor item atau menetapkan tarif. |
| *Tidak ada tarif untuk lokasi pada tanggal ini.* | Tidak ada baris tarif yang berlaku untuk item dan lokasi itu pada tanggal tarif. Tetapkan tarif dengan tanggal berlaku lebih awal, atau pilih tanggal lain. |
| Perubahan tarif ditolak | Sudah ada tarif untuk item dan lokasi itu pada tanggal tersebut (atau perubahan bertanggal sebelum tarif yang ada). Tambahkan perubahan dengan tanggal lebih lambat; riwayat sebelumnya tetap apa adanya. |
| *Tidak dapat menyimpan. Coba lagi.* | Coba lagi. Bila daftar lokasi tidak termuat, gunakan **Coba lagi** di atas panel. |
| Sebagian baris impor ditolak | Unduh berkas baris yang gagal, perbaiki alasan yang tercantum pada tiap baris, lalu impor lagi. |
