# Kebijakan Posting Accurate — Libra Jaya Logistic

## Titik pengakuan pendapatan

Untuk transaksi partner berbasis deposit, PT. Libra Jaya Logistic mengakui pendapatan pada saat **booking telah disetujui/final dan saldo deposit partner berhasil dipotong** oleh sistem.

Event sumber yang digunakan oleh integrasi adalah wallet transaction `source: BOOKING` dengan nilai negatif (debit saldo partner).

Posting Journal Voucher otomatis:

- **Debit:** Deposit Partner / Saldo Wallet Partner (`ACCURATE_ACCOUNT_CUSTOMER_DEPOSIT`)
- **Kredit:** Pendapatan Jasa Logistik (`ACCURATE_ACCOUNT_SERVICE_REVENUE`)
- **Cabang:** `JLX Cargo`

Status operasional `DELIVERED` dipakai sebagai bukti penyelesaian pengiriman/POD dan kontrol operasional, **bukan** sebagai trigger pengakuan pendapatan untuk flow partner deposit ini.

## Kontrol

- Booking yang belum berhasil memotong deposit tidak boleh menjadi pendapatan.
- Idempotency wallet transaction dan nomor Journal Voucher wajib dipertahankan.
- Duplicate guard wajib memeriksa nomor JV sebelum POST.
- Setelah POST, read-back verification wajib memeriksa nomor, tanggal, cabang, akun, dan debit/kredit.
- Ketidakpastian jaringan atau mismatch hasil read-back harus masuk `RECONCILE_REQUIRED`; tidak boleh blind retry.
- Perubahan kebijakan pengakuan pendapatan harus merupakan keputusan bisnis/akuntansi yang eksplisit, bukan perubahan teknis diam-diam.

## Status Full Auto

Production Full Auto tetap hanya boleh berjalan jika seluruh production readiness terpenuhi dan ketiga gate diaktifkan secara sengaja:

- `ACCURATE_POSTING_ENABLED=true`
- `ACCURATE_PRODUCTION_ARMED=true`
- `ACCURATE_AUTO_POST_ENABLED=true`
- `ACCURATE_AUTO_POST_START_AT` valid dan ditetapkan sebagai waktu cutover produksi.
