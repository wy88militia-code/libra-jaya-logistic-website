# Libra Admin Security & Partner API v1

## Admin per-user + OTP

Legacy `ADMIN_PIN` masih didukung sementara. Untuk mode produksi gunakan `ADMIN_USERS_JSON`.

Generate satu user:

```bash
node scripts/generate-admin-user.mjs wahyudi 123456 SUPERADMIN
```

Hasilnya berupa JSON record dengan `pinSalt`, `pinHash`, dan `totpSecret`.
Gabungkan record menjadi array dan simpan di Netlify Environment Variable `ADMIN_USERS_JSON`.

Contoh struktur (nilai hanya contoh):

```json
[
  {
    "username": "wahyudi",
    "role": "SUPERADMIN",
    "active": true,
    "pinSalt": "...",
    "pinHash": "...",
    "totpSecret": "..."
  }
]
```

Masukkan `totpSecret` ke aplikasi authenticator pengguna. Jangan commit secret ke repository.

Environment yang tetap diperlukan:

- `ADMIN_SESSION_SECRET` minimal 32 karakter.
- Hapus `ADMIN_PIN` setelah `ADMIN_USERS_JSON` berhasil diuji.

## Partner API Authentication

Endpoint awal:

- `POST /api/v1/quote`
- `POST /api/v1/bookings`
- `GET /api/v1/tracking?booking_id=...`

Header wajib:

- `x-libra-key`: API Key partner.
- `x-libra-timestamp`: Unix timestamp seconds (atau milliseconds).
- `x-libra-nonce`: random string minimal 12 karakter dan tidak boleh dipakai ulang.
- `x-libra-signature`: HMAC-SHA256 base64url.
- `x-libra-idempotency-key`: wajib untuk create booking.

Canonical string:

```text
METHOD
PATH_WITH_QUERY
TIMESTAMP
NONCE
SHA256(BODY)
```

Signature:

```text
base64url(HMAC-SHA256(API_SECRET, canonical_string))
```

Server menolak timestamp di luar ±5 menit dan nonce yang pernah digunakan.

## Booking security

Partner tidak mengirim nominal debit. Flow wajib:

1. Partner minta Quote ID.
2. Backend menentukan/menyetujui harga.
3. Booking memakai Quote ID + Idempotency Key.
4. Backend memvalidasi GPS dan kode wilayah.
5. Backend memotong saldo berdasarkan nilai quote yang tersimpan.
6. Retry dengan idempotency key yang sama mengembalikan booking yang sama.

## Yang belum production-grade

Saldo/ledger masih menggunakan Netlify Blobs dengan optimistic concurrency. Sebelum deposit uang riil skala besar, migrasikan wallet dan booking financial transaction ke database ACID seperti PostgreSQL agar debit saldo, ledger, booking, refund, dan adjustment dapat berada dalam satu database transaction.
