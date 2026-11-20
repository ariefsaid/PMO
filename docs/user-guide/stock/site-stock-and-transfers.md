# Site stock and transfers

Stock in PMO moves on documents: **Receive** into a warehouse, **Transfer** between warehouses,
**Issue to project** for material used on a work order, **Return from project**, plus
**Adjustment** and **Stock count**. Warehouses can be a central store, a project site, a project
yard, or a staging area, so material can travel warehouse → yard → work order with its paperwork.
Every posted document updates the stock ledger, which is the single record of what moved and what
it cost.

**Who can do this:** a warehouse **keeper** creates and posts receive, transfer, issue and return
documents for the warehouses they keep; an Admin can do it anywhere. Adjustments and counts are
posted by Finance, Project Manager, Executive or Admin — and never by the person who wrote the
draft. Everyone can read stock.

## Steps

1. Open **Stock → Documents** and choose **New document**, then pick the kind.
2. Fill in **Where**:
   - **Receive**: the warehouse that takes the goods in.
   - **Transfer**: the **From warehouse** and a different **To warehouse**. A transfer into a
     site, yard or staging location of a project may also name that project's **Work order**.
   - **Issue to project**: the project, then the **Work item** the material is used on.
   - **Return from project**: pick the original **Issue line you are returning**.
3. Add the lines: item, quantity (more than 0, up to 3 decimals, whole numbers only for units that
   count in pieces). A receive also asks the **Unit cost** — for a client-supplied item (a zero-
   cost tag) the cost must be zero. Leave the **Date** empty for today.
4. Attach the paperwork — picking slip, delivery note or photo — with **Upload attachment**. If
   the organisation requires paper for client-supplied transfers, posting is refused until an
   attachment exists.
5. **Save draft** while you work. When the details are right, choose **Post** and confirm: stock on
   hand changes and the document can no longer be edited.

## What the result looks like

- **Stock → On hand** shows every item's quantity per warehouse (and value, for roles that read
  stock value).
- **Stock → Ledger** lists every posted movement with its date, document, change and running
  balance.
- The work order page shows **Stock for this work order**: received, moved elsewhere, issued, and
  what is **on site** now — with client-supplied items marked as costing nothing.
- Posting an issue above a work item's planned quantity still posts, but the system flags it as
  **Over allowance**.

## Common errors and what to do

- **"Only a keeper of this warehouse can do this."** — ask an administrator to make you a keeper
  of that warehouse.
- **"Sisa hanya &lt;available&gt;; Anda meminta &lt;requested&gt;." / "Not enough stock on hand for
  this movement."** — the warehouse does not hold that quantity. Receive first, or lower the
  quantity.
- **"This item must be received at zero cost."** — the item carries your organisation's zero-cost
  (client-supplied) tag. Enter 0 as the unit cost.
- **"This tag cannot be changed after stock has moved."** — an item's tag is fixed once it has
  movements. Create a new item with the right tag instead.
- **"Attach the required paper before posting this transfer."** — upload the delivery note or
  photo, then post again.
- **"Hanya Admin yang dapat memberi tanggal lebih dari 31 hari ke belakang, dan tidak ada yang
  dapat memakai tanggal di masa depan."** — correct the date, or ask an Admin for an older one.
- **A count or adjustment refuses to post for its author** — another eligible person (Project
  Manager or above) must post it; this separation is deliberate.
- **"A posted attachment must be archived with a reason."** — posted paperwork cannot be deleted;
  archive it with a reason instead.

---

## Bahasa Indonesia

# Stok lokasi dan transfer

Stok di PMO bergerak lewat dokumen: **Penerimaan** ke gudang, **Transfer** antar gudang,
**Pengeluaran ke proyek** untuk material yang dipakai pada perintah kerja, **Pengembalian dari
proyek**, ditambah **Penyesuaian** dan **Stok opname**. Gudang bisa berupa gudang pusat, lokasi
proyek, halaman proyek, atau area penyiapan, sehingga material bisa berpindah gudang → halaman →
perintah kerja dengan dokumennya. Setiap dokumen yang diposting memperbarui buku stok, satu-satunya
catatan tentang apa yang bergerak dan berapa biayanya.

**Siapa yang bisa melakukannya:** **penjaga gudang** membuat dan memposting penerimaan, transfer,
pengeluaran, dan pengembalian untuk gudang yang dipegangnya; Admin bisa di mana saja. Penyesuaian
dan stok opname diposting oleh Keuangan, Manajer Proyek, Eksekutif, atau Admin — dan tidak pernah
oleh orang yang menulis drafnya. Semua orang dapat membaca stok.

## Langkah-langkah

1. Buka **Stok → Dokumen** dan pilih **Dokumen baru**, lalu pilih jenisnya.
2. Isi **Lokasi**:
   - **Penerimaan**: gudang yang menerima barangnya.
   - **Transfer**: **Dari gudang** dan **Ke gudang** yang berbeda. Transfer ke lokasi proyek,
     halaman proyek, atau area penyiapan sebuah proyek juga boleh menyebut **Perintah kerja**
     proyek itu.
   - **Pengeluaran ke proyek**: proyeknya, lalu **Item pekerjaan** tempat material dipakai.
   - **Pengembalian dari proyek**: pilih **baris Pengeluaran yang dikembalikan** aslinya.
3. Tambahkan barisnya: barang, kuantitas (lebih dari 0, maksimal 3 desimal, hanya bilangan bulat
   untuk satuan yang dihitung utuh). Penerimaan juga menanyakan **Biaya satuan** — untuk barang
   titipan klien (label tanpa biaya) biayanya harus nol. Biarkan **Tanggal** kosong untuk hari ini.
4. Lampirkan dokumennya — slip pengambilan, surat jalan, atau foto — dengan **Unggah lampiran**.
   Bila organisasi mewajibkan dokumen untuk transfer titipan klien, posting ditolak sampai ada
   lampiran.
5. **Simpan draf** selama mengerjakan. Setelah detailnya benar, pilih **Posting** dan konfirmasi:
   sisa stok berubah dan dokumen tidak bisa diubah lagi.

## Hasilnya seperti apa

- **Stok → Persediaan** menampilkan kuantitas setiap barang per gudang (dan nilainya, untuk peran
  yang membaca nilai stok).
- **Stok → Buku stok** memuat setiap pergerakan yang diposting beserta tanggal, dokumen,
  perubahan, dan sisa berjalannya.
- Halaman perintah kerja menampilkan **Stok untuk perintah kerja ini**: diterima, dipindah ke
  tempat lain, dikeluarkan, dan yang **di lokasi** saat ini — barang titipan klien ditandai tanpa
  biaya.
- Posting pengeluaran yang melebihi kuantitas rencana sebuah item pekerjaan tetap tercatat, tetapi
  sistem menandainya **Melebihi jatah**.

## Kesalahan umum dan cara mengatasinya

- **"Hanya penjaga gudang ini yang dapat melakukannya."** — minta administrator menjadikan Anda
  penjaga gudang itu.
- **"Sisa hanya &lt;available&gt;; Anda meminta &lt;requested&gt;."** — gudang tidak menyimpan
  kuantitas itu. Terima stok lebih dulu, atau turunkan kuantitasnya.
- **"Barang ini harus diterima tanpa biaya."** — barang itu membawa label tanpa biaya (titipan
  klien) organisasi Anda. Isi 0 sebagai biaya satuannya.
- **"Label ini tidak dapat diubah setelah stok bergerak."** — label sebuah barang terkunci setelah
  ada pergerakan. Buat barang baru dengan label yang benar.
- **"Lampirkan dokumen yang diwajibkan sebelum memposting transfer ini."** — unggah surat jalan
  atau fotonya, lalu posting lagi.
- **"Hanya Admin yang dapat memberi tanggal lebih dari 31 hari ke belakang, dan tidak ada yang
  dapat memakai tanggal di masa depan."** — perbaiki tanggalnya, atau minta Admin untuk tanggal
  yang lebih lama.
- **Posting stok opname atau penyesuaian ditolak untuk pembuatnya** — orang lain yang berwenang
  (Manajer Proyek ke atas) harus mempostingnya; pemisahan ini memang disengaja.
- **"Lampiran yang sudah diposting harus diarsipkan dengan alasan."** — dokumen yang sudah
  diposting tidak bisa dihapus; arsipkan dengan alasan.
