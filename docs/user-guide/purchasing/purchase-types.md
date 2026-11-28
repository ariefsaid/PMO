# Purchase types

## What this is for

A purchase type is a label you put on a request — goods, service, rental, or whatever your
organisation calls its purchases. Types are your own list, and a type marked as having a rental
period lets you record the rental dates and extend the rental later with a new order.

Purchase types are on by default. An Admin can switch them off with the **Purchasing extras** module
(**Administration → Modules**), which also covers line planning, payment channels, printable purchase
orders and delivery notes. While that module is off, the type field and the list of types are hidden.
The type field also shows only once at least one type is active. With no type chosen, a request
behaves exactly as before.

## Who can do this

- **Add, rename, retire and restore types:** Admin only.
- **Other roles:** the page is read-only.
- **Choose a type on a request:** whoever raises the request. Extending a rental is available to the
  people who can create purchases, on a rental purchase that is not cancelled or returned.

## Where to find it

- **Administration**, then **All settings**, then **Purchase types**.
- The page's back link, **Procurement**, returns to the purchase list.

## Steps

### Set up your types (Admin)

1. Open **Administration → All settings → Purchase types**.
2. Read **Types**. Each row shows its **Name (English)**, its **Name in Bahasa Indonesia**, whether
   **This type has a rental period**, and its actions.
3. To add one, use **Add type** at the foot of the list: fill the **Name (English)** (the **Name in Bahasa Indonesia** is optional), tick **This type has a
   rental period** when it is a rental, and choose **Add type**.
4. To rename one, change its name and choose **Save**. The English name is what appears in the
   English app; the Bahasa name is used in the Bahasa app when it is filled.
5. To stop offering a type, choose **Retire**. It shows as **Retired** and leaves the picker; the
   purchases that already carry it keep it. Choose **Restore** to offer it again.

### Use a type on a request

1. On **New procurement**, find **Purchase type**.
2. Choose the type, or leave **No type**. For a type with a rental period, fill **Rental from** and
   **Rental to**; both are required.
3. Save the request as usual and send it for approval. See
   [Raise and follow a purchase request](raise-a-purchase-request.md).

### Extend a rental

1. Open the purchase. Under its title, the **Purchase type** section shows the type and the period.
2. Choose **Extend rental**.
3. Fill the **New rental period**: **From** and **To**. The new period must start after the current
   one ends.
4. Check the **Lines carried over** — each line's **Quantity** and **Rate**. Change them if the
   extension differs.
5. Choose **Create extension order**. A new purchase is created as a draft, linked to the original,
   and goes through approval like any other order.

## What the result looks like

- The type appears on the purchase, and a rental purchase shows its period under the title, with
  its original rental and any extensions linked to each other.
- The type's name is used in the language the reader has chosen; English fallback applies when the
  Bahasa name is empty.
- Retiring a type never changes a purchase that already carries it.
- An extension order starts as a draft purchase: it is not approved and not ordered until you send
  it and an approver decides it.

## Common errors and what to do

- **"Only an Admin can change purchase types."** — the page is read-only for your role. Ask an
  Admin to add or change the type.
- **"Enter the rental period."** — a rental type needs both dates before the request can be saved.
- **"The end cannot be before the start."** — correct the two dates.
- **"The new period must start after ⟨date⟩."** — an extension begins after the rental it extends
  ends; pick a later start.
- **"Enter a quantity and a rate of 0 or more."** — on an extension line, fill both figures.
- **The type you need is not in the picker** — it may be retired, or the page may still be loading,
  or the Purchasing extras module is off. Ask an Admin to restore it or switch the module on.

---

## Bahasa Indonesia

# Jenis pembelian

## Untuk apa ini

Jenis pembelian adalah label yang Anda berikan pada sebuah permintaan — barang, jasa, sewa, atau
apa pun sebutan organisasi Anda untuk pembeliannya. Jenis adalah daftar milik Anda sendiri, dan
jenis yang ditandai memiliki masa sewa memungkinkan Anda mencatat tanggal sewa dan memperpanjangnya
nanti dengan pesanan baru.

Jenis pembelian aktif secara bawaan. Admin dapat mematikannya lewat modul **Tambahan pembelian**
(**Administrasi → Modul**), yang juga mencakup perencanaan baris, saluran pembayaran, pesanan pembelian
yang bisa dicetak, dan surat jalan. Selama modul itu mati, kolom jenis dan daftar jenis tersembunyi.
Kolom jenis juga baru muncul bila ada setidaknya satu jenis yang aktif. Tanpa memilih jenis,
permintaan berjalan persis seperti sebelumnya.

## Siapa yang dapat melakukannya

- **Menambah, mengganti nama, menonaktifkan, dan mengaktifkan lagi jenis:** hanya Admin.
- **Peran lain:** halamannya hanya untuk dibaca.
- **Memilih jenis pada permintaan:** siapa pun yang mengajukan permintaan. Memperpanjang sewa
  tersedia bagi orang yang dapat membuat pembelian, pada pembelian sewa yang tidak dibatalkan atau
  dikembalikan.

## Di mana menemukannya

- **Administrasi**, lalu **Semua pengaturan**, lalu **Jenis pembelian**.
- Tautan kembali halaman, **Pengadaan**, membawa Anda ke daftar pembelian.

## Langkah-langkah

### Menyiapkan jenis Anda (Admin)

1. Buka **Administrasi → Semua pengaturan → Jenis pembelian**.
2. Baca **Jenis**. Setiap baris menampilkan **Nama (English)**, **Nama dalam Bahasa Indonesia**,
   apakah **Jenis ini memiliki masa sewa**, dan aksinya.
3. Untuk menambah, gunakan **Tambah jenis** di bawah daftar: isi **Nama (English)** (**Nama dalam Bahasa Indonesia** opsional), centang **Jenis ini memiliki masa
   sewa** bila jenisnya sewa, lalu pilih **Tambah jenis**.
4. Untuk mengganti nama, ubah namanya dan pilih **Simpan**. Nama Inggris yang muncul di aplikasi
   Inggris; nama Bahasa dipakai di aplikasi Bahasa bila diisi.
5. Untuk berhenti menawarkan suatu jenis, pilih **Nonaktifkan**. Jenis tampil sebagai **Nonaktif**
   dan keluar dari pilihan; pembelian yang sudah memakainya tetap memakainya. Pilih **Aktifkan
   lagi** untuk menawarkannya kembali.

### Memakai jenis pada permintaan

1. Di **Pengadaan baru**, cari **Jenis pembelian**.
2. Pilih jenisnya, atau biarkan **Tanpa jenis**. Untuk jenis dengan masa sewa, isi **Sewa dari** dan
   **Sewa sampai**; keduanya wajib.
3. Simpan permintaan seperti biasa dan ajukan untuk persetujuan. Lihat
   [Ajukan dan pantau permintaan pembelian](raise-a-purchase-request.md).

### Memperpanjang sewa

1. Buka pembelian. Di bawah judulnya, bagian **Jenis pembelian** menampilkan jenis dan masa sewanya.
2. Pilih **Perpanjang sewa**.
3. Isi **Masa sewa baru**: **Dari** dan **Sampai**. Masa baru harus dimulai setelah masa sekarang
   berakhir.
4. Periksa **Baris yang dibawa** — **Jumlah** dan **Tarif** setiap baris. Ubah bila perpanjangannya
   berbeda.
5. Pilih **Buat pesanan perpanjangan**. Pembelian baru dibuat sebagai draf, tertaut ke aslinya, dan
   melalui persetujuan seperti pesanan lain.

## Hasilnya seperti apa

- Jenis tampil pada pembelian, dan pembelian sewa menampilkan masa sewanya di bawah judul, dengan
  sewa asal dan setiap perpanjangan saling tertaut.
- Nama jenis dipakai dalam bahasa yang dipilih pembaca; nama Inggris dipakai bila nama Bahasa
  kosong.
- Menonaktifkan jenis tidak pernah mengubah pembelian yang sudah memakainya.
- Pesanan perpanjangan dimulai sebagai draf pembelian: belum disetujui dan belum dipesan sampai Anda
  mengajukannya dan pemberi persetujuan memutuskannya.

## Kesalahan umum dan cara mengatasinya

- **"Hanya Admin yang dapat mengubah jenis pembelian."** — halaman ini hanya untuk dibaca bagi peran
  Anda. Minta Admin menambah atau mengubah jenisnya.
- **"Isi masa sewa."** — jenis sewa memerlukan kedua tanggal sebelum permintaan dapat disimpan.
- **"Tanggal akhir tidak boleh sebelum tanggal mulai."** — perbaiki kedua tanggalnya.
- **"Masa baru harus dimulai setelah ⟨tanggal⟩."** — perpanjangan dimulai setelah sewa yang
  diperpanjang berakhir; pilih tanggal mulai yang lebih lambat.
- **"Isi jumlah dan tarif 0 atau lebih."** — pada baris perpanjangan, isi kedua angkanya.
- **Jenis yang Anda butuhkan tidak ada di pilihan** — mungkin sudah dinonaktifkan, halamannya masih
  dimuat, atau modul Tambahan pembelian mati. Minta Admin mengaktifkannya lagi atau menyalakan modulnya.
