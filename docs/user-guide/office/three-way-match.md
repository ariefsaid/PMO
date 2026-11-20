# Three-way match

## What this is for

Before anyone pays a vendor bill for goods, the bill is checked against what was **ordered**
and what was **actually received** — three-way matching — so the organisation never pays for
goods it did not get, or at a price it did not agree. A bill that does not line up is **held**:
while any bill on a purchase is held, nothing on that purchase can be paid. A deliberate
exception can be approved by someone other than the person who entered the bill, and the
approval stays on record.

The match is **off for every organisation by default**; an Admin switches it on. Bills
recorded before the switch-on are not matched. Subcontract purchases, record-only purchases,
bills mirrored from a connected accounting system, and purchasing owned by an ERP are never
matched — those keep their existing rules.

## Who can do this

- **Switch the match on and set tolerances**: Admin only.
- **Record receipt lines and bill match lines**: Admin, Executive, Project Manager, Finance.
- **Approve an exception** for a held bill: Admin or Finance — but **never** the person who
  recorded the bill, nor the person who recorded its match lines. If the bill's author was not
  recorded, no exception can be approved.
- **Read** the match status: the roles that may read bills.

## What gets checked

With the match on, a bill in scope is held when any of these is true:

- It has **no match lines** recorded.
- A billed item is **not on the order**.
- The quantity billed so far exceeds the received quantity, or the ordered quantity, by more
  than the organisation's **quantity tolerance** (a percentage).
- A billed rate exceeds the order rate by more than the **amount tolerance**.
- The bill's pre-tax amount differs from the sum of its lines by more than the **amount
  tolerance**.

Each bill reads as **Matched**, **Held** (with the reasons per line), or **Exception
approved**.

## What a hold does

While a purchase has a held bill:

- No new payment can be added to the purchase.
- No payment on it can move to Paid.
- The held bill cannot be marked Paid, and the purchase cannot move to Paid.

The hold is computed live: recording the missing receipt (or correcting a line) releases the
hold by itself. Cumulative quantities count bills in their recorded order, so a later
over-bill never holds an earlier, correct bill.

### Approving an exception

A held bill can be released by an eligible Admin or Finance user with a written reason (up to
1,000 characters). The approval records who approved, when, why, and the match as it stood,
then frees the payment gate. An exception is permanent and can be approved once; the bill's
lines freeze afterwards.

## Where to find it

This build ships the match as a rule enforced by the database. There is no dedicated screen
for it in the app yet: the match runs in the background on purchases it covers, and its
refusals surface when a payment is saved. The refusal names the hold (*three-way-match-held*).

## Common problems

| What you see | What to do |
|---|---|
| A payment is refused and the message names the three-way-match hold | Something on the purchase's bills does not line up. Check the receipt is recorded for what was billed, that quantities and rates match the order within tolerance, and that every bill has its match lines. |
| A bill is held for over-receipt | Record the goods receipt that is missing, or correct the quantities. The bill matches again on its own — no exception needed. |
| A bill is held for a price difference | Check the rate against the order rate. If the higher price is deliberate, an eligible Admin or Finance user approves the exception with a reason. |
| Exception approval is refused | The approver must be Admin or Finance, must give a reason, and must not be the bill's author or the person who recorded its match lines. A matched bill cannot be "approved". Ask a different eligible person. |
| The match does nothing for your bills | The match is off, the bills were recorded before it was switched on, or the purchase is a subcontract, record-only, ERP-owned, or ERP-mirrored — those are out of scope by design. |

## Bahasa Indonesia

# Pencocokan tiga arah

## Untuk apa ini

Sebelum ada yang membayar tagihan vendor untuk barang, tagihan diperiksa terhadap apa yang
**dipesan** dan apa yang **benar-benar diterima** — pencocokan tiga arah — agar organisasi
tidak pernah membayar barang yang tidak diterima, atau pada harga yang tidak disepakati.
Tagihan yang tidak cocok **ditahan**: selama ada tagihan yang ditahan pada sebuah pembelian,
tidak ada pembayaran pada pembelian itu yang bisa dibayar. Pengecualian yang disengaja dapat
disetujui oleh orang selain yang memasukkan tagihan, dan persetujuan itu tercatat.

Pencocokan ini **nonaktif untuk setiap organisasi secara bawaan**; Admin yang mengaktifkannya.
Tagihan yang dicatat sebelum pengaktifan tidak dicocokkan. Pembelian subkontraktor, pembelian
catatan saja, tagihan cermin dari sistem akuntansi yang terhubung, dan pembelian yang dimiliki
ERP tidak pernah dicocokkan — semuanya memakai aturan yang sudah ada.

## Siapa yang dapat melakukannya

- **Mengaktifkan pencocokan dan menetapkan toleransi**: hanya Admin.
- **Mencatat baris penerimaan dan baris pencocokan tagihan**: Admin, Eksekutif, Manajer
  Proyek, Keuangan.
- **Menyetujui pengecualian** untuk tagihan yang ditahan: Admin atau Keuangan — tetapi
  **tidak pernah** orang yang mencatat tagihan itu, dan bukan pula orang yang mencatat baris
  pencocokannya. Bila pencatat tagihan tidak tercatat, pengecualian tidak dapat disetujui.
- **Membaca** status pencocokan: peran yang boleh membaca tagihan.

## Yang diperiksa

Bila pencocokan aktif, tagihan dalam lingkupnya ditahan bila salah satu dari ini benar:

- Tidak ada **baris pencocokan** yang dicatat.
- Item yang ditagih **tidak ada di pesanan**.
- Kuantitas yang ditagih sejauh ini melebihi kuantitas diterima, atau kuantitas dipesan,
  lebih dari **toleransi kuantitas** organisasi (persentase).
- Tarif yang ditagih melebihi tarif pesanan lebih dari **toleransi jumlah**.
- Jumlah pra-pajak tagihan berbeda dari jumlah baris-barisnya lebih dari **toleransi jumlah**.

Tiap tagihan terbaca **Cocok**, **Ditahan** (dengan alasan per baris), atau **Pengecualian
disetujui**.

## Yang dilakukan penahanan

Selama sebuah pembelian memiliki tagihan yang ditahan:

- Tidak ada pembayaran baru yang dapat ditambahkan ke pembelian itu.
- Tidak ada pembayaran pada pembelian itu yang dapat berpindah ke status Dibayar.
- Tagihan yang ditahan tidak dapat ditandai Dibayar, dan pembelian tidak dapat berpindah ke
  status Dibayar.

Penahanan dihitung langsung: mencatat penerimaan yang hilang (atau memperbaiki baris) membuat
penahanan lepas dengan sendirinya. Kuantitas kumulatif dihitung menurut urutan pencatatan
tagihan, sehingga tagihan berlebih yang lebih lambat tidak pernah menahan tagihan yang benar
lebih dulu.

### Menyetujui pengecualian

Tagihan yang ditahan dapat dilepaskan oleh Admin atau Keuangan yang memenuhi syarat, dengan
alasan tertulis (hingga 1.000 karakter). Persetujuan mencatat siapa yang menyetujui, kapan,
mengapa, dan keadaan pencocokan saat itu, lalu membuka gerbang pembayaran. Pengecualian
bersifat permanen dan hanya dapat disetujui sekali; baris tagihan membeku setelahnya.

## Di mana menemukannya

Pada versi ini, pencocokan dikirim sebagai aturan yang ditegakkan basis data. Belum ada
layar khusus untuknya di aplikasi: pencocokan berjalan di latar belakang pada pembelian yang
dicakupnya, dan penolakannya muncul saat pembayaran disimpan. Pesan penolakan menyebut
penahanannya (*three-way-match-held*).

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| Pembayaran ditolak dan pesannya menyebut penahanan pencocokan tiga arah | Ada tagihan pada pembelian itu yang tidak cocok. Periksa apakah penerimaan barang sudah dicatat sesuai yang ditagih, apakah kuantitas dan tarif cocok dengan pesanan dalam toleransi, dan apakah tiap tagihan punya baris pencocokannya. |
| Tagihan ditahan karena penerimaan berlebih | Catat penerimaan barang yang belum tercatat, atau perbaiki kuantitasnya. Tagihan cocok lagi dengan sendirinya — tanpa perlu pengecualian. |
| Tagihan ditahan karena selisih harga | Periksa tarif terhadap tarif pesanan. Bila harga lebih tinggi itu disengaja, Admin atau Keuangan yang memenuhi syarat menyetujui pengecualian dengan alasan. |
| Persetujuan pengecualian ditolak | Penyetuju harus Admin atau Keuangan, harus memberi alasan, dan tidak boleh pencatat tagihan atau pencatat baris pencocokannya. Tagihan yang cocok tidak dapat "disetujui". Minta orang lain yang memenuhi syarat. |
| Pencocokan tidak berpengaruh pada tagihan Anda | Pencocokan nonaktif, tagihan dicatat sebelum diaktifkan, atau pembeliannya subkontraktor, catatan saja, milik ERP, atau cermin ERP — semuanya memang di luar lingkup. |
