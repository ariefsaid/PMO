# Approval routing

## What this is for

When a purchase request is waiting for approval, it should reach the right person
automatically:

| Spend | Approved by |
|---|---|
| Charged to a project **and** within that project's budget line | the project's named approver(s) |
| Overhead (no project) **or** more than the project's budget line allows | the organisation's overhead / over-budget approver set |

Any **one** person in the set that receives the request can decide it — approving or
rejecting. No second signature, no sequence. Routine project spend does not queue behind
senior approvers, and over-budget or overhead spend always gets a senior signature.

The route is decided when somebody tries to approve (the request moving from *Requested*), by
checking the request against the project's active budget line. Once a request has been
submitted, its project, budget category, total and currency cannot be changed — so the route
cannot be steered after the fact.

## Who can do this

- **Name the approvers** (add and remove people on both sets): Admin only.
- **Act on a routed request**: any active person named on the route, with approval rank
  (Project Manager or above), who is not the requester.
- If nobody named can act, the decision falls upward: a project request goes to the overhead
  set; a stuck overhead set leaves the decision to an Admin only. If no set is configured at
  all, the standard role rules decide.

## Where to find it

**Administration → Accounting setup → Spend approvers.** The screen shows two lists:

- **Overhead and over-budget approvers** — the senior set for overhead and over-budget spend.
- **Project approvers** — grouped by project; each project can have its own approver list.

## Steps (Admin)

1. Choose **Add overhead approver** or **Add project approver**.
2. Pick the **Person**. The picker lists only people who can actually approve: active members
   with approval rank. For a project approver, also pick the **Project**.
3. Confirm with **Add**.
4. To remove someone, choose **Remove ⟨name⟩** on their row and confirm. Cases already decided
   are unchanged.

## What the result looks like

- Each list shows the named people, and beneath it a note — **Who can approve now** — telling
  you who on the list can act right now.
- If the people on a project list cannot act (away, inactive, or the requester), a warning
  says the overhead approvers decide; if the overhead set is also stuck, only an Admin can
  decide.
- If a list is empty, the note says the standard role rules apply.
- A routed request does not appear in an Admin's "awaiting you" lists unless the Admin is
  named on it.

## Common problems

| What you see | What to do |
|---|---|
| *Nobody listed can approve right now. The overhead approvers decide.* | Nobody on the project list can act. Add another project approver, or let the overhead set decide. |
| *Nobody listed can approve right now. Only an Admin can decide.* | Both sets are stuck. An Admin decides (the decision is recorded as a break-glass action). |
| *Only an Admin can change this.* | You can read the lists but not change them. Ask an Admin. |
| The picker does not offer someone | They are inactive, or their role is below Project Manager — they cannot hold approval authority. |
| A request routed to the senior set unexpectedly | Its amount exceeds the project's budget line, has no budget category or active budget, mixes currencies, or its amount could not be read. Routing goes up, never down. |

## Bahasa Indonesia

# Perutean persetujuan

## Untuk apa ini

Saat permintaan pembelian menunggu persetujuan, permintaan itu harus sampai ke orang yang
tepat secara otomatis:

| Pengeluaran | Disetujui oleh |
|---|---|
| Dibebankan ke proyek **dan** masih dalam baris anggaran proyek itu | penyetuju yang ditunjuk untuk proyek tersebut |
| Overhead (tanpa proyek) **atau** melebihi baris anggaran proyek | kelompok penyetuju overhead / melebihi anggaran organisasi |

**Satu** orang saja di kelompok yang menerima permintaan dapat memutusinya — menyetujui atau
menolak. Tanpa tanda tangan kedua, tanpa urutan. Pengeluaran proyek rutin tidak mengantre di
belakang penyetuju senior, dan pengeluaran over-budget atau overhead selalu mendapat tanda
tangan senior.

Rute diputuskan ketika seseorang mencoba menyetujui (permintaan berpindah dari *Requested*),
dengan memeriksa permintaan terhadap baris anggaran aktif proyek. Setelah permintaan
diajukan, proyek, kategori anggaran, total, dan mata uangnya tidak dapat diubah — sehingga
rute tidak bisa diarahkan setelah kejadian.

## Siapa yang dapat melakukannya

- **Menunjuk penyetuju** (menambah dan menghapus orang di kedua kelompok): hanya Admin.
- **Menindaklanjuti permintaan yang dirutekan**: setiap orang aktif yang tercantum pada rute,
  dengan wewenang persetujuan (Manajer Proyek atau lebih tinggi), dan bukan pemohon.
- Bila tidak ada yang ditunjuk dapat bertindak, keputusan naik ke atas: permintaan proyek
  pergi ke kelompok overhead; kelompok overhead yang bermasalah meninggalkan keputusan hanya
  kepada Admin. Bila tidak ada kelompok yang diatur sama sekali, aturan peran standar yang
  memutuskan.

## Di mana menemukannya

**Administrasi → Accounting setup → Spend approvers.** Layar menampilkan dua daftar:

- **Overhead and over-budget approvers** — kelompok senior untuk pengeluaran overhead dan
  over-budget.
- **Project approvers** — dikelompokkan per proyek; tiap proyek dapat punya daftar penyetuju
  sendiri.

## Langkah-langkah (Admin)

1. Pilih **Add overhead approver** atau **Add project approver**.
2. Pilih **Person**. Pemilih hanya menampilkan orang yang benar-benar dapat menyetujui:
   anggota aktif dengan wewenang persetujuan. Untuk penyetuju proyek, pilih juga
   **Project**-nya.
3. Konfirmasi dengan **Add**.
4. Untuk menghapus seseorang, pilih **Remove ⟨nama⟩** pada barisnya dan konfirmasi. Kasus yang
   sudah diputuskan tidak berubah.

## Bagaimana hasilnya

- Tiap daftar menampilkan orang-orang yang ditunjuk, dan di bawahnya sebuah keterangan —
  **Yang dapat menyetujui sekarang** — yang memberi tahu siapa di daftar itu yang dapat
  bertindak saat ini.
- Bila orang pada daftar proyek tidak dapat bertindak (cuti, tidak aktif, atau pemohonnya),
  sebuah peringatan mengatakan penyetuju overhead yang memutuskan; bila kelompok overhead juga
  buntu, hanya Admin yang dapat memutuskan.
- Bila daftar kosong, keterangan mengatakan aturan peran standar yang berlaku.
- Permintaan yang dirutekan tidak muncul di daftar "menunggu Anda" milik Admin kecuali Admin
  itu ditunjuk di dalamnya.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Nobody listed can approve right now. The overhead approvers decide.* | Tidak ada yang di daftar proyek dapat bertindak. Tambahkan penyetuju proyek lain, atau biarkan kelompok overhead memutuskan. |
| *Nobody listed can approve right now. Only an Admin can decide.* | Kedua kelompok buntu. Admin yang memutuskan (keputusan tercatat sebagai tindakan darurat). |
| *Only an Admin can change this.* | Anda dapat membaca daftarnya tetapi tidak dapat mengubahnya. Tanyakan ke Admin. |
| Pemilih tidak menampilkan seseorang | Orang itu tidak aktif, atau perannya di bawah Manajer Proyek — ia tidak dapat memegang wewenang persetujuan. |
| Permintaan dirutekan ke kelompok senior padahal tidak disangka | Jumlahnya melebihi baris anggaran proyek, tanpa kategori anggaran atau anggaran aktif, mata uangnya tercampur, atau jumlahnya tidak dapat dibaca. Perutean selalu naik, tidak pernah turun. |
