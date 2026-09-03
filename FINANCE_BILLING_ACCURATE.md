# Finance, Billing & Accurate Online Bridge

## Alur Finance Libra

1. Booking live yang berhasil mendebit deposit masuk sebagai `SERVICE` pada billing partner.
2. Rekonsiliasi tetap menjadi sumber pengecekan booking vs wallet ledger.
3. Finance dapat membuat Debit Note / Credit Note / Refund atau Settlement Klaim.
4. Perubahan yang mengubah saldo **tidak dieksekusi langsung**. Sistem membuat maker-checker request.
5. Checker Finance/SUPERADMIN yang berbeda menyetujui di `/admin-approvals`.
6. Setelah approval, adjustment masuk ke `libra-billing` dan wallet ledger dengan referensi approval.
7. Finance dapat Issue/Reissue statement bulanan. Snapshot issued diberi hash SHA-256.
8. Statement issued dapat dimasukkan ke Accurate queue.

## Halaman

- `/admin-finance-billing` — billing, adjustment, klaim, aging, issue statement, Accurate queue.
- `/admin-accurate` — koneksi Accurate, validasi Chart of Accounts, queue jurnal/export JSON.
- `/partner/billing.html` — statement partner.
- `/partner/history.html` — rekonsiliasi booking vs wallet ledger.

## Billing semantics

`FINANCE_ADJUSTMENT.signedAmount` dilihat dari sisi tagihan partner:

- positif = tambahan charge / Debit Note → wallet partner didebit.
- negatif = Credit Note / Refund → wallet partner dikredit.
- `CLAIM_SETTLEMENT` selalu menjadi credit ke wallet partner setelah checker approve.

Statement normal partner deposit umumnya memiliki `outstanding = 0`, karena service charge dibayar dari deposit saat booking. Aging terutama menjadi exception control untuk transaksi yang secara operasional tercatat tetapi belum memiliki debit wallet yang sah.

## Tax configuration

- `BILLING_DUE_DAYS` default `7`.
- `BILLING_TAX_RATE_PCT` default `0`.

Tax rate pada tahap ini hanya metadata/informational pada statement. Sistem **tidak** mendebit pajak tambahan ke wallet secara otomatis. Pertahankan `0` sampai kebijakan pajak dan struktur rate Libra diputuskan secara final.

## Accurate Online connection

Bridge mendukung dua mode koneksi server-side:

### API Token (direkomendasikan untuk penggunaan internal Libra)

- `ACCURATE_API_TOKEN`
- `ACCURATE_API_SECRET`

Request ditandatangani dengan timestamp + HMAC SHA-256 dan host database di-resolve melalui Accurate account API.

### OAuth fallback

- `ACCURATE_ACCESS_TOKEN`
- `ACCURATE_DB_ID`

Bridge membuka database dan memakai host + session yang dikembalikan Accurate.

## Chart of Accounts mapping

Semua mapping hanya lewat environment variables, tidak ditulis ke repository:

- `ACCURATE_ACCOUNT_CUSTOMER_DEPOSIT`
- `ACCURATE_ACCOUNT_SERVICE_REVENUE`
- `ACCURATE_ACCOUNT_CLAIM_EXPENSE`
- `ACCURATE_ACCOUNT_ADJUSTMENT_EXPENSE`
- `ACCURATE_ACCOUNT_BANK_CLEARING` (opsional / tahap top-up posting berikutnya)

Admin `/admin-accurate` dapat membaca `glaccount/list` untuk memverifikasi apakah nomor akun yang dipetakan benar-benar ada di database Accurate.

## Accounting draft dari monthly statement

Untuk booking yang dibayar dari deposit:

- Debit: Customer Deposit Liability
- Credit: Service Revenue

Untuk credit note/refund:

- Debit: Claim Expense atau Adjustment Expense
- Credit: Customer Deposit Liability

Queue memastikan total debit dan credit balanced sebelum diberi status `READY_FOR_REVIEW`.

## Posting Guard

Versi ini **belum mengirim journal voucher live ke Accurate**. Alasannya disengaja:

1. nomor Chart of Accounts PT Libra harus dikunci Finance;
2. schema final jurnal Accurate yang dipakai harus diverifikasi terhadap database Libra;
3. satu statement tidak boleh ter-post dua kali;
4. posting live harus mendapat idempotency/audit/recovery guard.

Sampai gate tersebut selesai, queue hanya berstatus `READY_FOR_REVIEW` atau `NEEDS_MAPPING`, dapat diekspor JSON, dan tidak dapat mengubah pembukuan Accurate.

## Backup / DR

Store baru:

- `libra-billing` — ikut backup dan dapat direstore.
- `libra-accurate-sync` — ikut backup **tetapi immutable saat restore**, agar histori sync tidak di-rewind dan tidak berisiko diposting ulang di masa depan.

Credential Accurate tidak pernah masuk backup, audit, HTML, atau source code.
