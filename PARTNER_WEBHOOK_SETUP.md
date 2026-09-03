# Partner Webhook Libra

## Tujuan

Webhook mengirim perubahan tracking dari backend Libra ke sistem partner setelah Production API aktif. UAT webhook diuji otomatis dari panel `Admin Libra -> Link Partner -> UAT & Go-Live API`.

## Callback URL

Partner wajib memberikan URL HTTPS publik, contoh:

`https://partner.example/webhooks/libra`

Backend menolak URL localhost, jaringan private, link-local, dan hostname internal.

## Signing Secret

Webhook memakai secret khusus terpisah dari API Secret. Saat pengajuan dihubungkan ke Partner ID, Admin Libra menerima secret satu kali. Jika secret hilang/terekspos, gunakan **Rotate/Buat Secret** lalu ulangi UAT webhook.

Header yang dikirim:

- `x-libra-event`
- `x-libra-environment`
- `x-libra-delivery-id`
- `x-libra-timestamp`
- `x-libra-signature`

Canonical string:

`timestamp + "." + delivery_id + "." + raw_body`

Signature:

`v1=BASE64URL(HMAC-SHA256(webhook_secret, canonical_string))`

Partner harus memverifikasi signature menggunakan **raw request body**, bukan JSON yang sudah diserialisasi ulang.

## Event awal

- `libra.webhook.test` — UAT connectivity test
- `shipment.tracking.updated` — perubahan tracking umum
- `shipment.delivered` — delivered/POD tersedia
- `shipment.incident` — HELD, DAMAGED, atau CLAIM_PROCESS

Payload webhook sengaja tidak mengirim foto POD atau koordinat GPS. Partner dapat mengambil detail resmi lewat endpoint tracking yang terautentikasi.

## Retry

Delivery sukses jika callback mengembalikan HTTP 2xx. Jika gagal, backend menyimpan delivery audit dan mencoba ulang hingga 5 kali dengan backoff. Worker retry berjalan setiap menit pada production deploy Netlify.

Status delivery:

- `PENDING`
- `RETRY_PENDING`
- `DELIVERED`
- `DEAD`

## Gate Go-Live

Final PASS UAT mensyaratkan HMAC/auth, quote, booking dry-run, idempotency, tracking, webhook otomatis, dan error handling terkontrol. Production API baru dapat diaktifkan setelah Final PASS dan saldo memenuhi minimum opening deposit.
