# Set usage standards for consumables

A usage standard says how much of a consumable a unit of planned work uses — for example, how much
welding rod one dia-inch of welded pipe takes. Work orders turn these standards into a **Consumables**
plan, and material requests are then checked against that plan, so "we always use about this much"
becomes a number the site can plan from.

**Who can do this:** everyone can read the list. Adding, editing and archiving a standard is done by
Finance, Project Manager, Executive or Admin.

## Where to find it

**Stock → Usage standards**.

## Steps

1. Open **Stock → Usage standards** and choose **New standard**.
2. Choose the **Consumable** — the stock item the standard is about.
3. Enter the **Unit of work** — the word the work is measured in, such as `dia-inch`. It is matched
   to the contract line's unit, ignoring case and spaces.
4. Optionally enter a **Contract line code starts with** prefix. Leave it empty to apply the standard
   to every contract line with that unit.
5. Enter the **Quantity per unit of work** — above zero, up to 6 decimals.
6. Optionally add a **Waste margin %** — 0 to 100, up to 2 decimals — added on top of the quantity.
7. Choose **Add standard**.
8. Use the filters **Item**, **Work unit** and **Show archived** to find a standard. Use the row menu
   for **Edit** or **Archive**.

## What the result looks like

- Each row shows the item, **Per unit of work**, the **Contract line code** rule, the **Quantity**,
  the **Waste margin**, and **Matches now** — how many contract lines the standard currently applies
  to. **No lines** means it applies to nothing yet; check the unit and the prefix.
- On a work order, the **Consumables** section builds its plan from these standards with **Generate
  plan** (or **Regenerate** when the work or the standards change). The plan shows, per item, the
  **Plan**, the **Requested** quantity and what is **Remaining**, and it carries a source: **From
  standards**, **Adjusted**, or **From material allowance**.
- A generated plan can be **Adjusted** with a reason, and once **Approved** it is what material
  requests are judged against.
- Archiving a standard stops it applying to new plans; plans already generated keep their figures,
  and you can **Restore** it later.

## Common errors and what to do

- **"A standard for this item, work unit and code prefix already exists. Edit that one instead."** —
  the same combination is already defined. Open that standard and edit it rather than adding a
  duplicate.
- **"To change the item, archive this standard and add a new one."** — the item is fixed on a saved
  standard. Archive it and create the standard again with the right item.
- **"Enter a quantity above zero, up to 6 decimals."** — the per-unit quantity must be positive.
- **"Enter 0 to 100, up to 2 decimals."** — the waste margin is a percentage; clear it for none.
- **"Keep it under 40 characters."** — shorten the unit of work or the code prefix.
- **"No lines" in Matches now** — the standard applies to nothing: the unit of work does not match a
  contract line's unit, or the prefix matches no line code.
- **"The work or the usage standards changed since this plan was made."** — on the work order,
  **Regenerate** the plan and request approval again before the new figures are used.

---

## Bahasa Indonesia

# Menetapkan standar pemakaian bahan habis pakai

Standar pemakaian menyebut berapa banyak bahan habis pakai yang dipakai satu satuan pekerjaan —
misalnya berapa kawat las untuk satu dia-inci pipa yang dilas. Perintah kerja mengubah standar ini
menjadi rencana **Bahan habis pakai**, lalu permintaan material diperiksa terhadap rencana itu,
sehingga "biasanya sebanyak ini" menjadi angka yang bisa direncanakan lokasi.

**Siapa yang bisa melakukannya:** semua orang dapat membaca daftarnya. Menambah, mengubah, dan
mengarsipkan standar dilakukan Finance, Manajer Proyek, Eksekutif, atau Admin.

## Di mana menemukannya

**Stok → Standar pemakaian**.

## Langkah-langkah

1. Buka **Stok → Standar pemakaian** dan pilih **Standar baru**.
2. Pilih **Bahan habis pakai** — barang stok yang menjadi pokok standar.
3. Isi **Satuan pekerjaan** — kata ukur pekerjaannya, misalnya `dia-inci`. Ia dicocokkan dengan
   satuan baris kontrak, tanpa membedakan huruf besar-kecil dan spasi.
4. Bila perlu isi awalan **Kode baris kontrak diawali**. Kosongkan agar berlaku untuk semua baris
   kontrak dengan satuan itu.
5. Isi **Jumlah per satuan pekerjaan** — di atas nol, maksimal 6 desimal.
6. Bila perlu tambahkan **Margin sisa %** — 0 sampai 100, maksimal 2 desimal — ditambahkan di atas
   jumlahnya.
7. Pilih **Tambah standar**.
8. Gunakan filter **Barang**, **Satuan pekerjaan**, dan **Tampilkan yang diarsipkan** untuk mencari
   standar. Gunakan menu baris untuk **Ubah** atau **Arsipkan**.

## Hasilnya seperti apa

- Setiap baris menampilkan barangnya, **Per satuan pekerjaan**, aturan **Kode baris kontrak**,
  **Jumlah**, **Margin sisa**, dan **Cocok saat ini** — berapa baris kontrak yang kini memakai standar
  itu. **Tidak ada baris** berarti belum berlaku pada apa pun; periksa satuan dan awalannya.
- Di perintah kerja, bagian **Bahan habis pakai** membangun rencananya dari standar ini dengan **Buat
  rencana** (atau **Buat ulang** saat pekerjaan atau standarnya berubah). Rencana menampilkan, per
  barang, **Rencana**, jumlah **Diminta**, dan **Sisa**, serta sumbernya: **Dari standar**,
  **Disesuaikan**, atau **Dari jatah material**.
- Rencana yang dibuat dapat **Disesuaikan** dengan alasan, dan setelah **Disetujui** itulah yang
  menjadi dasar pemeriksaan permintaan material.
- Mengarsipkan standar menghentikan pemakaiannya pada rencana baru; rencana yang sudah dibuat tetap
  memakai angkanya, dan Anda dapat **Memulihkannya** nanti.

## Kesalahan umum dan cara mengatasinya

- **"Standar untuk barang, satuan pekerjaan, dan awalan kode ini sudah ada. Ubah yang itu saja."** —
  kombinasi yang sama sudah didefinisikan. Buka standar itu dan ubah, jangan menambah duplikat.
- **"Untuk mengganti barang, arsipkan standar ini dan tambahkan yang baru."** — barang terkunci pada
  standar tersimpan. Arsipkan dan buat standarnya lagi dengan barang yang benar.
- **"Isi jumlah di atas nol, maksimal 6 desimal."** — jumlah per satuan harus positif.
- **"Isi 0 sampai 100, maksimal 2 desimal."** — margin sisa adalah persentase; kosongkan bila tidak
  ada.
- **"Maksimal 40 karakter."** — pendekkan satuan pekerjaan atau awalan kodenya.
- **"Tidak ada baris" di Cocok saat ini** — standar belum berlaku pada apa pun: satuan pekerjaannya
  tidak cocok dengan satuan baris kontrak, atau awalannya tidak cocok dengan kode baris mana pun.
- **"Pekerjaan atau standar pemakaian berubah sejak rencana ini dibuat."** — di perintah kerja, **Buat
  ulang** rencananya dan minta persetujuan lagi sebelum angka baru dipakai.
