# Partner Booking History & Reconciliation

## Tujuan
Modul ini menyatukan booking manual dan Production API per partner untuk pencocokan transaksi bulanan.

## Partner
Halaman: `/partner/history.html`

Partner dapat memilih periode `YYYY-MM`, melihat booking, reference partner, source, tujuan, berat, nominal, transaction ID, tracking, POD, insiden/klaim, serta status rekonsiliasi.

Export:
- CSV melalui `/.netlify/functions/partner-reconciliation?month=YYYY-MM&format=csv`
- PDF melalui tampilan print-friendly `Cetak / Simpan PDF`

## Admin Libra
Halaman: `/admin-reconciliation`

Admin dapat memilih partner dan periode, melihat ringkasan serta export CSV/print PDF.

## Status rekonsiliasi
- `MATCHED`: nilai booking cocok dengan debit wallet.
- `UNPAID`: booking belum mempunyai transaction ID/debit saldo.
- `MISSING_LEDGER`: booking memiliki transaction ID tetapi ledger terkait tidak ditemukan pada data yang dibaca.
- `AMOUNT_MISMATCH`: nominal debit wallet berbeda dari nominal booking.

## Periode
Batas periode memakai zona waktu `Asia/Jayapura` (WIT). Booking UAT/dry-run dikecualikan dari statement finansial.

## Ringkasan
Statement menampilkan jumlah booking, booking berbayar, delivered, insiden, total charge booking berbayar, nilai booking belum dibayar, matched/issues, credit wallet periode, debit wallet periode, debit booking periode, dan saldo wallet saat ini.
