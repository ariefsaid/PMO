# Set up material approvals

Before anyone can send a material request, an administrator configures how requests are approved:
the ordered approval chain, an optional daily cut-off, and stand-ins for people who are away.

**Who can do this:** Admin. Every role can read the settings; only an administrator can change
them.

## Steps

1. Open **Material requests** and choose **Approval settings**.
2. Build the **Approval chain**. Add steps with **Add step**; each step names a **Role** and
   **What this step checks** (a purpose label the approvers see, for example "plan vs requested").
   Reorder steps with **Move up**/**Move down**; a step may also be marked **Only when a line is
   over plan** so it only wakes up when a line exceeds its plan.
   - A common chain: engineer (over-plan only) → construction manager (always) → material
     coordinator (always).
   - Choose **Save chain**. Requests already sent keep the steps they were sent with; changes apply
     to new requests only. Requests cannot be sent until a chain exists.
3. Set the **Daily cut-off** (optional): requests needed by tomorrow must be sent before this time
   of day. Leave it empty for no cut-off, and **Save cut-off**.
4. Add **Stand-ins**: a person who is away picks a colleague and a **From**/**To** date range; an
   Admin can set one for anyone. The stand-in can decide steps of the away person's role in that
   range. A stand-in cannot hand the role on to a third person (one hop only).

## What the result looks like

- Requests walk the steps in order, and each decision is stored with the actor and time.
- A stand-in's decision is recorded as the stand-in acting for the away person.
- An in-flight request keeps the chain it was sent with even if you edit the chain afterwards.

## Common errors and what to do

- **"No steps yet. Requests cannot be sent until a chain exists."** — add at least one step and
  save the chain.
- **A step never gets answered** — nobody holds that step's role. Grant the role to someone, or
  add a stand-in for the current period. Steps with no eligible approver show "No approver is
  available for the open step" to the requester.
- **"That stand-in is not allowed: choose an active colleague and a valid date range."** — pick an
  active member of your organisation and a range whose start is not after its end.
- **The cut-off control is missing** — you are not an administrator; only Admin sees and saves the
  daily cut-off.

---

## Bahasa Indonesia

# Menyiapkan persetujuan material

Sebelum siapa pun bisa mengirim permintaan material, administrator mengatur cara permintaan
disetujui: rantai persetujuan berurutan, batas waktu harian opsional, dan pengganti bagi orang
yang berhalangan.

**Siapa yang bisa melakukannya:** Admin. Semua peran dapat melihat pengaturannya; hanya
administrator yang bisa mengubahnya.

## Langkah-langkah

1. Buka **Permintaan material** dan pilih **Pengaturan persetujuan**.
2. Susun **Rantai persetujuan**. Tambahkan langkah dengan **Tambah langkah**; setiap langkah
   menunjuk sebuah **Peran** dan **Yang diperiksa langkah ini** (label tujuan yang dilihat
   penyetuju, misalnya "rencana vs yang diminta"). Susun urutannya dengan **Naikkan**/**Turunkan**;
   sebuah langkah juga bisa ditandai **Hanya bila ada barang melebihi rencana** sehingga hanya
   aktif saat sebuah baris melebihi rencananya.
   - Rantai yang umum: insinyur (hanya melebihi rencana) → pengelola konstruksi (selalu) →
     koordinator material (selalu).
   - Pilih **Simpan rantai**. Permintaan yang sudah dikirim tetap memakai langkahnya; perubahan
     hanya berlaku untuk permintaan baru. Permintaan tidak bisa dikirim sebelum rantai ada.
3. Atur **Batas waktu harian** (opsional): permintaan yang dibutuhkan besok harus dikirim sebelum
   jam ini. Kosongkan bila tanpa batas waktu, lalu **Simpan batas waktu**.
4. Tambahkan **Pengganti**: orang yang berhalangan memilih rekan dan rentang tanggal
   **Dari**/**Sampai**; Admin dapat mengaturnya untuk siapa saja. Pengganti dapat memutuskan
   langkah milik peran orang yang berhalangan dalam rentang itu. Pengganti tidak bisa meneruskan
   peran itu kepada orang ketiga (satu tingkat saja).

## Hasilnya seperti apa

- Permintaan berjalan melewati langkah-langkah sesuai urutan, dan setiap keputusan disimpan
  beserta pelakunya dan waktunya.
- Keputusan pengganti tercatat sebagai pengganti yang bertindak untuk orang yang berhalangan.
- Permintaan yang sedang berjalan tetap memakai rantai saat ia dikirim, walaupun rantainya Anda
  ubah setelahnya.

## Kesalahan umum dan cara mengatasinya

- **"Belum ada langkah. Permintaan tidak dapat dikirim sampai rantai dibuat."** — tambahkan
  minimal satu langkah dan simpan rantainya.
- **Sebuah langkah tidak pernah dijawab** — tidak ada yang memegang peran langkah itu. Berikan
  peran itu kepada seseorang, atau tambahkan pengganti untuk periode sekarang. Langkah tanpa
  penyetuju menampilkan "Tidak ada penyetuju untuk langkah yang terbuka" kepada pemohon.
- **"Pengganti ini tidak diizinkan: pilih rekan aktif dan rentang tanggal yang valid."** — pilih
  anggota aktif organisasi Anda dan rentang yang awalnya tidak setelah akhirnya.
- **Kontrol batas waktu tidak muncul** — Anda bukan administrator; hanya Admin yang melihat dan
  menyimpan batas waktu harian.
