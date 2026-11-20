# Request materials

When a work order needs material, raise a material request: the items, the quantities and the date
you need them. The request walks through your organisation's approval steps in order, and when it
is fully approved a delivery document (a stock transfer) is created automatically for the store
keeper to post.

**Who can do this:** any member of the organisation can raise and send a request. Only its author
can edit the draft, resubmit after a return, or withdraw it.

## Steps

1. Open **Material requests** and choose **New request**.
2. Pick the **Project**, then the **Work order**.
3. Add each item: **Choose an item**, enter the **Quantity** (more than 0), and add more lines with
   **Add item**.
4. Check the **Needed by** date — it starts as tomorrow, and today is the earliest you can pick.
5. Look at each line's plan figures: "Plan &lt;plan&gt; · already requested &lt;prior&gt; · new
   total &lt;total&gt;". If your new total is over plan, the line asks
   "Why do you need more than the plan?" — give a reason (up to 500 characters). The request
   cannot be sent without it.
6. Add an optional note.
7. **Save draft** while you work, then **Send for approval**.

## What the result looks like

- The request moves through its statuses: **Draft** → **Waiting for approval** → **Approved** →
  **Delivered**. **Rejected** and **Withdrawn** are endings.
- Each approval step is recorded in the request's history with who decided, when, and why.
- When the last step approves, a transfer draft with your lines is created for the work order's
  site warehouse. The request's **Delivery** section links to it ("Open the delivery document");
  when the store keeper posts the transfer, the request shows **Delivered**.
- If your organisation set a **daily cut-off**, a request needed tomorrow must be sent before that
  time of day; after it, tomorrow is refused and you must pick a later date.

## Common errors and what to do

- **"A line over plan needs a reason."** — fill in the reason on the over-plan line.
- **"The daily cut-off has passed for tomorrow. Choose a later needed-by date."** — move the
  needed-by date one day later, or wait until tomorrow and send early.
- **"Choose a project to see its work orders."** — pick the project before the work order.
- **"Enter a quantity above zero."** — quantities must be positive.
- **Sent for the wrong work order** — you cannot change a sent request. Use **Withdraw request**
  while it is still waiting (the approvers are no longer asked), then raise a new one.
- **The request was sent back ("Sent back")** — the requester amends the draft and sends it for
  approval again; it starts again at step 1.
- **"No approval chain is set up yet. Ask an administrator."** — an Admin must configure the
  approval chain first (see [Set up material approvals](approval-settings.md)).
- **The delivery document is missing although the request is approved** — the transfer draft could
  not be created (for example, the project has no site warehouse to deliver to). The page offers
  **Create the transfer again** once the cause is fixed.

---

## Bahasa Indonesia

# Mengajukan permintaan material

Bila sebuah perintah kerja butuh material, ajukan permintaan material: barangnya, jumlahnya, dan
tanggal Anda membutuhkannya. Permintaan melewati langkah-langkah persetujuan organisasi Anda
sesuai urutan, dan ketika disetujui penuh, dokumen pengiriman (sebuah transfer stok) dibuat
otomatis untuk diposting oleh penjaga gudang.

**Siapa yang bisa melakukannya:** semua anggota organisasi dapat membuat dan mengirim permintaan.
Hanya pembuatnya yang bisa mengubah draf, mengirim ulang setelah dikembalikan, atau menariknya.

## Langkah-langkah

1. Buka **Permintaan material** dan pilih **Permintaan baru**.
2. Pilih **Proyek**, lalu **Perintah kerja**.
3. Tambahkan setiap barang: **Pilih barang**, isi **Jumlah** (lebih dari 0), dan tambahkan baris
   lain dengan **Tambah barang**.
4. Periksa **Dibutuhkan pada** — isinya awalnya besok, dan hari ini adalah tanggal paling awal yang
   bisa dipilih.
5. Perhatikan angka rencana setiap baris: "Rencana &lt;plan&gt; · sudah diminta &lt;prior&gt; ·
   total baru &lt;total&gt;". Bila total baru Anda melebihi rencana, baris itu bertanya "Mengapa
   Anda butuh lebih dari rencana?" — berikan alasan (maksimal 500 karakter). Permintaan tidak bisa
   dikirim tanpanya.
6. Tambahkan catatan bila perlu.
7. **Simpan draf** selama mengerjakan, lalu **Kirim untuk persetujuan**.

## Hasilnya seperti apa

- Permintaan berpindah status: **Draf** → **Menunggu persetujuan** → **Disetujui** → **Terkirim**.
  **Ditolak** dan **Ditarik** adalah akhir.
- Setiap langkah persetujuan tercatat di riwayat permintaan: siapa memutuskan, kapan, dan mengapa.
- Saat langkah terakhir menyetujui, draf transfer berisi barang-barang Anda dibuat untuk gudang
  lokasi perintah kerja. Bagian **Pengiriman** permintaan menautkannya ("Buka dokumen pengiriman");
  ketika penjaga gudang memposting transfernya, permintaan menjadi **Terkirim**.
- Bila organisasi Anda menetapkan **batas waktu harian**, permintaan yang dibutuhkan besok harus
  dikirim sebelum jam itu; setelahnya, tanggal besok ditolak dan Anda harus memilih tanggal lebih
  lambat.

## Kesalahan umum dan cara mengatasinya

- **"Barang yang melebihi rencana perlu alasan."** — isi alasan pada baris yang melebihi rencana.
- **"Batas waktu harian untuk besok sudah lewat. Pilih tanggal dibutuhkan yang lebih lambat."** —
  geser tanggal dibutuhkan satu hari, atau tunggu besok dan kirim lebih awal.
- **"Pilih proyek untuk melihat perintah kerjanya."** — pilih proyek sebelum perintah kerja.
- **"Masukkan jumlah lebih dari nol."** — jumlah harus di atas nol.
- **Terkirim ke perintah kerja yang salah** — permintaan terkirim tidak bisa diubah. Gunakan
  **Tarik permintaan** selagi masih menunggu (penyetujunya tidak lagi diminta), lalu ajukan yang
  baru.
- **Permintaan dikembalikan ("Dikembalikan")** — pemohon memperbaiki drafnya dan mengirimnya lagi
  untuk persetujuan; permintaan mulai lagi dari langkah 1.
- **"Rantai persetujuan belum diatur. Hubungi administrator."** — Admin harus mengatur rantai
  persetujuan lebih dahulu (lihat [Menyiapkan persetujuan material](approval-settings.md)).
- **Dokumen pengiriman tidak muncul padahal permintaan disetujui** — draf transfer gagal dibuat
  (misalnya proyeknya tidak punya gudang lokasi tujuan). Setelah penyebabnya dibereskan, halaman
  menawarkan **Buat transfer lagi**.
