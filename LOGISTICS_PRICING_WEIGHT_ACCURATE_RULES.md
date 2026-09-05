# Master Rule — JL Express / Libra Partner Web / Accurate

Status: BUSINESS RULE SOURCE-OF-TRUTH
Tanggal keputusan: 5 September 2026

Dokumen ini mengunci rule bisnis yang telah disepakati. Implementasi frontend/backend/Accurate wajib mengikuti rule ini. Jika ada konflik dengan implementasi lama, perubahan kode harus dilakukan secara eksplisit dan diuji; jangan mengubah behavior production diam-diam.

## 1. Pemisahan Channel

### JL Express Frontend
Mencakup seluruh layanan:
- Door to Port
- Port to Port
- Port to Door / Last-mile Incoming
- Door to Door

JL Express memakai engine lengkap untuk pricing, airline surcharge, klasifikasi DG/karantina, pickup, last-mile dan biaya hub yang applicable.

### Libra Partner Web
Dikhususkan untuk partner layanan:
- Port to Door / Last-mile Incoming

Port to Door dan Last-mile Incoming adalah satu jenis layanan dalam konteks operasional Libra.

## 2. Prinsip Weight

### 2.1 Incoming — Port to Door / Last-mile
Libra tidak melakukan timbang ulang untuk pekerjaan incoming.

Dasar berat penagihan:
- PTI Partner Weight / chargeable weight yang diterima dari partner.

SMU tidak boleh dijadikan basis berat customer karena satu SMU dapat berisi gabungan beberapa booking/partner.

### 2.2 Outgoing via transit/gudang Libra
Berat customer saat booking adalah estimasi / declared weight.

Urutan proses:
1. Booking dibuat.
2. Barang dijemput.
3. Barang masuk transit/gudang Libra.
4. Repacking bila diperlukan.
5. Timbang aktual dan ukur dimensi setelah repacking.
6. Final Chargeable Weight ditetapkan.
7. SO Accurate diperbarui ke berat final.
8. Faktur baru diterbitkan berdasarkan berat final.

Final Chargeable Weight:
- nilai terbesar antara Actual Weight Libra setelah repacking dan Volume Weight Libra setelah repacking, mengikuti rumus volumetrik layanan yang berlaku.

### 2.3 Toleransi selisih timbang
Gunakan selisih absolut:
`weight_delta = abs(final_libra_weight - customer_booking_weight)`

Rule:
- Jika `weight_delta < 0.2 kg` → CLEAR.
- Jika `weight_delta >= 0.2 kg` → WEIGHT_ADJUSTMENT.

CLEAR berarti tidak perlu approval ulang customer.

WEIGHT_ADJUSTMENT berarti customer harus menerima perubahan berat/harga final sebelum faktur diterbitkan/pengiriman diteruskan sesuai workflow yang ditetapkan.

Penting:
- toleransi 0,2 kg bukan potongan berat;
- faktur tetap memakai Final Chargeable Weight Libra;
- tepat 0,20 kg sudah masuk WEIGHT_ADJUSTMENT.

## 3. SMU

SMU adalah dokumen master shipment / consolidation dan dapat memuat banyak booking.

SMU tidak boleh:
- dipakai sebagai basis Qty penjualan per customer booking;
- otomatis mengubah berat invoice customer.

SMU boleh dipakai untuk:
- referensi flight/consolidation;
- biaya maskapai;
- biaya per SMU;
- rekonsiliasi cost dan margin;
- hubungan `Booking ID -> Consolidation ID -> SMU Number`.

## 4. Biaya Airline dan Hub

Biaya airline/cost flight hanya berlaku ketika Libra menangani outgoing yang membutuhkan pembelian/handling flight, terutama:
- Door to Port outgoing;
- Door to Door outgoing;
- Port to Port mengikuti rule route existing bila Libra membeli space/flight.

Untuk Port to Door / Last-mile Incoming:
- tidak ada airline cost Libra;
- basis berat adalah PTI Partner.

## 5. Biaya Khusus HUB Soetta

Rule berikut hanya berlaku pada shipment yang applicable melalui HUB Soetta / CGK:

- RA: Rp2.500/kg
- Handling Gudang: Rp1.000/kg
- Handling SMU: Rp20.000/SMU
- DG Gadget Class 9 / UN3481: Rp200.000/SMU
- Fresh/Frozen Product — Karantina: Rp500/kg
- Airline freight: mengikuti tarif airline/rute
- Airline surcharge: wajib tetap berlaku sesuai pricing engine JL Express yang aktif

Biaya di atas tidak boleh diberlakukan sebagai rule global untuk hub lain tanpa konfigurasi eksplisit.

## 6. DG Scope Libra/JL Express

DG yang dilayani otomatis dalam scope saat ini dibatasi pada gadget ber-baterai lithium:
- HP
- Tablet
- Laptop
- Gadget sejenis yang masuk Class 9 / UN3481 sesuai acceptance airline/RA

Jika engine frontend menandai `DG_GADGET=true` dan shipment applicable di HUB Soetta:
- tambahkan cost DG/AVSEC Rp200.000 per SMU.

Jika satu SMU berisi beberapa booking DG, biaya per-SMU tidak boleh dikali per booking. Cost internal dapat dialokasikan hanya ke booking DG yang ada dalam SMU tersebut, misalnya proporsional berdasarkan chargeable weight.

DG di luar scope otomatis harus masuk manual review / tidak dilayani otomatis sampai ada rule tersendiri.

## 7. Karantina Fresh/Frozen

Frontend JL Express sudah memiliki engine klasifikasi DG dan karantina; jangan membuat klasifikasi uang di browser sebagai sumber final.

Jika engine mengklasifikasikan Fresh/Frozen dan shipment applicable di HUB Soetta:
- tambahkan Karantina Rp500/kg.

Frontend mengklasifikasikan dan menampilkan estimasi; backend wajib menghitung ulang semua komponen sebagai source-of-truth keuangan sebelum order difinalisasi.

## 8. Last-mile / Port to Door

Untuk Port to Door / Last-mile Incoming:
- Basis berat: PTI Partner Weight.
- Handling barang: Rp25.000 per SMU.
- Tidak ada airline cost Libra.
- Tidak ada timbang ulang Libra sebagai syarat billing.

Jika satu SMU memiliki beberapa booking last-mile, biaya handling Rp25.000 tetap merupakan biaya per SMU, bukan otomatis Rp25.000 per booking. Alokasi internal per booking dapat dilakukan untuk margin reporting tanpa mengubah sifat biaya aslinya.

## 9. Airline Surcharge

Airline surcharge yang sudah ada di engine JL Express tetap wajib masuk perhitungan frontend sesuai rule airline/rute yang berlaku.

Backend wajib menghitung ulang surcharge yang sama sebelum final booking/SO/invoice agar user tidak dapat memanipulasi harga dari browser.

Jangan hard-code surcharge baru di Accurate. Accurate menerima nilai final yang sudah melalui pricing engine backend.

## 10. Struktur Revenue vs Cost

### Revenue side
`Booking -> Customer Chargeable Weight -> Harga Jual -> Sales Order -> Sales Invoice`

### Cost side
`Booking/Consolidation -> Airline + Airline Surcharge/Cost + RA + Warehouse + Handling + DG + Karantina + biaya applicable lain -> Margin`

Jangan menggunakan SMU weight sebagai customer billing weight hanya untuk mempermudah alokasi cost.

## 11. Accurate — Native Sales Flow Phase 2

Untuk transaksi penjualan normal, target architecture adalah memakai modul native Accurate, bukan Journal Voucher booking sebagai desain akhir.

### JL Express Outgoing
1. Customer membuat booking/quotation di frontend.
2. Setelah booking disetujui → buat/update Pesanan Penjualan (Sales Order) provisional di Accurate.
3. Barang pickup dan masuk transit Libra.
4. Setelah repacking/timbang/ukur → tentukan Final Chargeable Weight.
5. Jika delta `< 0.2 kg` → CLEAR dan SO boleh diperbarui otomatis.
6. Jika delta `>= 0.2 kg` → WEIGHT_ADJUSTMENT dan perlu approval customer sesuai workflow.
7. Setelah berat/harga final locked → update SO.
8. Buat Faktur Penjualan dari SO.
9. Pembayaran/deposit customer dialokasikan melalui modul native Accurate yang sesuai.

### Libra Partner Web — Last-mile Incoming
1. Partner input PTI + PTI weight + data penerima/alamat/GPS/kelurahan.
2. Booking approved.
3. SO/faktur memakai PTI Partner Weight sebagai Qty billing basis.
4. Tambahkan handling barang Rp25.000/SMU sesuai rule pricing.
5. Tidak menunggu timbang Libra.

## 12. Data Weight yang Wajib Disimpan

Untuk audit dan dispute prevention, simpan field terpisah:
- `customer_declared_weight_kg`
- `partner_pti_weight_kg`
- `libra_actual_weight_kg`
- `libra_volume_weight_kg`
- `libra_final_chargeable_weight_kg`
- `weight_basis` = `PARTNER_PTI` atau `LIBRA_VERIFIED`
- `weight_delta_kg`
- `weight_status` = `CLEAR` atau `WEIGHT_ADJUSTMENT`
- timestamp timbang
- petugas timbang
- bukti foto timbangan
- dimensi per koli bila dipakai
- status/riwayat repacking

SMU weight boleh disimpan di level consolidation/SMU, bukan sebagai customer billing basis.

## 13. Data Klasifikasi Shipment

Simpan hasil engine frontend/backend sebagai data booking:
- `is_dg_gadget`
- `dg_class` bila applicable
- `dg_un_number` bila applicable
- `is_fresh_frozen`
- `requires_quarantine`
- `hub_code`
- `service_type`
- `smu_number`
- `consolidation_id`

Backend adalah authority final untuk pricing.

## 14. Komponen yang Sebaiknya Terlihat di Sales Detail / Reporting

Pisahkan komponen agar dapat diaudit dan dianalisis:
- Freight / layanan utama
- Airline surcharge
- Pickup
- Last-mile
- RA
- Handling Gudang
- Handling SMU
- DG Gadget / AVSEC
- Karantina Fresh/Frozen
- Handling Barang Last-mile
- Packing/Repacking bila ditagihkan
- Asuransi bila applicable

Tidak semua komponen harus menjadi item terpisah di invoice customer jika kebijakan komersial ingin harga bundled, tetapi backend harus tetap menyimpan breakdown untuk margin reporting.

## 15. Pengaman Sistem

- Frontend tidak boleh menjadi source-of-truth nominal akhir.
- Backend wajib recompute harga dan weight rule.
- Tidak boleh membuat Faktur final sebelum final billing weight tersedia untuk outgoing.
- Tidak boleh memakai SMU gabungan sebagai weight customer.
- Tidak boleh double-charge biaya per-SMU karena banyak booking.
- Perubahan tarif/rule harus versioned dan punya audit trail.
- Native Accurate write wajib idempotent dan mempunyai duplicate/read-back verification seperti kontrol Accurate Phase 1.

## 16. Rule yang Belum Dikunci di Dokumen Ini

Hal berikut tetap mengikuti engine/config existing sampai diputuskan eksplisit:
- rumus volumetrik per layanan/rute;
- minimum chargeable weight per produk;
- detail minimum load per route;
- nilai dan jenis airline surcharge per airline/rute;
- tarif airline per rute;
- pricing pickup/last-mile per zona;
- perlakuan detail Port to Port yang berbeda per rute bila flight tidak dibeli Libra;
- metode pembulatan final chargeable weight jika berbeda per produk/airline.

Jangan mengisi nilai baru untuk rule tersebut tanpa keputusan bisnis atau data master yang sah.
